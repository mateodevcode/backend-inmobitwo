// src/lib/busquedasGuardadas/notificadorPush.js
// Push web (portal y CRM). Apagado mientras PUSH_ENABLED no sea "true" y
// falten las claves VAPID. Cada suscripción es de una aplicación (migración 031):
// el portal la usa para búsquedas guardadas y el CRM para sus avisos.
import { pool } from "../../db.js";

export const APPS_PUSH = ["portal", "crm"];

export const pushHabilitado = () =>
  process.env.PUSH_ENABLED === "true" &&
  Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT);

let webpush = null;
async function cargar() {
  if (webpush) return webpush;
  const mod = await import("web-push");
  webpush = mod.default || mod;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT, process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
  return webpush;
}

/**
 * Envía el payload a todas las suscripciones de esos usuarios en esa app.
 * Borra las suscripciones muertas (404/410). Nunca lanza.
 * @returns {Promise<Set<number>>} usuarios que recibieron al menos una.
 */
export async function enviarPushUsuarios(usuarioIds, payload, { app = "portal", db = pool, wp = null } = {}) {
  const recibieron = new Set();
  if (!pushHabilitado() || !usuarioIds?.length || !APPS_PUSH.includes(app)) return recibieron;
  try {
    const { rows } = await db.query(
      "SELECT id, usuario_id, endpoint, p256dh, auth FROM push_subscriptions WHERE usuario_id = ANY($1::int[]) AND app = $2",
      [usuarioIds, app],
    );
    if (!rows.length) return recibieron;
    const cliente = wp ?? (await cargar());
    const cuerpo = JSON.stringify(payload);
    for (const sub of rows) {
      try {
        await cliente.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, cuerpo, {
          TTL: 60 * 60 * 24,
        });
        recibieron.add(sub.usuario_id);
      } catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) {
          await db.query("DELETE FROM push_subscriptions WHERE id = $1", [sub.id]); // suscripción muerta
        } else {
          console.error("[push]", e.statusCode, e.message);
        }
      }
    }
  } catch (e) {
    console.error("[push] no se pudo enviar:", e?.message ?? e);
  }
  return recibieron;
}

/** Portal (búsquedas guardadas): true si al menos una suscripción recibió el aviso. */
export async function enviarPushUsuario(usuarioId, payload) {
  return (await enviarPushUsuarios([usuarioId], payload, { app: "portal" })).size > 0;
}
