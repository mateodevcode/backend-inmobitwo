// src/controllers/push.controller.js
// Suscripciones push web del portal (búsquedas guardadas) y del CRM (avisos).
// Responden 503 mientras el push esté apagado (PUSH_ENABLED o claves VAPID).
import { pool } from "../db.js";
import { APPS_PUSH, pushHabilitado } from "../lib/busquedasGuardadas/notificadorPush.js";

const apagado = (res) => res.status(503).json({ success: false, error: "Las notificaciones push no están habilitadas." });

export async function clavePublicaPush(_req, res) {
  if (!pushHabilitado()) return apagado(res);
  return res.json({ success: true, data: { publicKey: process.env.VAPID_PUBLIC_KEY } });
}

// Solo endpoints https de un servicio de push y claves con forma de base64url.
export function suscripcionValida(sub) {
  const { endpoint, keys } = sub || {};
  const b64 = /^[A-Za-z0-9_-]{16,200}={0,2}$/;
  if (typeof endpoint !== "string" || endpoint.length > 1000) return false;
  try {
    if (new URL(endpoint).protocol !== "https:") return false;
  } catch {
    return false;
  }
  return b64.test(keys?.p256dh ?? "") && b64.test(keys?.auth ?? "");
}

export function guardarSuscripcion(app) {
  if (!APPS_PUSH.includes(app)) throw new Error(`App de push desconocida: ${app}`);
  return async function guardarSuscripcionPush(req, res) {
    if (!pushHabilitado()) return apagado(res);
    try {
      const sub = req.body?.subscription;
      if (!suscripcionValida(sub)) return res.status(400).json({ success: false, error: "Suscripción inválida." });
      await pool.query(
        `INSERT INTO push_subscriptions (usuario_id, endpoint, p256dh, auth, user_agent, app)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (endpoint) DO UPDATE
           SET usuario_id = EXCLUDED.usuario_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, app = EXCLUDED.app`,
        [req.usuario.id, sub.endpoint, sub.keys.p256dh, sub.keys.auth, String(req.headers["user-agent"] || "").slice(0, 300), app],
      );
      return res.status(201).json({ success: true });
    } catch (e) {
      console.error("guardarSuscripcionPush:", e);
      return res.status(500).json({ success: false, error: "No se pudo guardar la suscripción." });
    }
  };
}

export async function eliminarSuscripcionPush(req, res) {
  try {
    const { endpoint } = req.body || {};
    if (typeof endpoint !== "string" || !endpoint) return res.status(400).json({ success: false, error: "Falta endpoint." });
    await pool.query("DELETE FROM push_subscriptions WHERE endpoint = $1 AND usuario_id = $2", [endpoint, req.usuario.id]);
    return res.json({ success: true });
  } catch (e) {
    console.error("eliminarSuscripcionPush:", e);
    return res.status(500).json({ success: false, error: "No se pudo eliminar." });
  }
}

// Compatibilidad con las rutas del portal.
export const guardarSuscripcionPush = guardarSuscripcion("portal");
