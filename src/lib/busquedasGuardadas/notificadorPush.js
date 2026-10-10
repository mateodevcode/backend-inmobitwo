// src/lib/busquedasGuardadas/notificadorPush.js
// Push web: listo pero apagado por PUSH_ENABLED=false.
import { pool } from "../../db.js";

let webpush = null;
async function cargar() {
  if (webpush) return webpush;
  const mod = await import("web-push"); // solo se carga si PUSH_ENABLED=true
  webpush = mod.default || mod;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT, process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
  return webpush;
}

/** Devuelve true si al menos una suscripción recibió el aviso. */
export async function enviarPushUsuario(usuarioId, payload) {
  if (process.env.PUSH_ENABLED !== "true") return false;
  const { rows } = await pool.query("SELECT * FROM push_subscriptions WHERE usuario_id = $1", [usuarioId]);
  if (!rows.length) return false;

  const wp = await cargar();
  let ok = false;
  for (const sub of rows) {
    try {
      await wp.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload));
      ok = true;
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) {
        await pool.query("DELETE FROM push_subscriptions WHERE id = $1", [sub.id]); // suscripción muerta
      } else { console.error("[push]", e.statusCode, e.message); }
    }
  }
  return ok;
}
