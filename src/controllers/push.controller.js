// src/controllers/push.controller.js
// Push web: endpoints listos pero apagados por PUSH_ENABLED=false.
import { pool } from "../db.js";

const pushOn = () => process.env.PUSH_ENABLED === "true";

export async function clavePublicaPush(_req, res) {
  if (!pushOn()) return res.status(503).json({ success: false, error: "Push no está habilitado." });
  return res.json({ success: true, data: { publicKey: process.env.VAPID_PUBLIC_KEY } });
}

export async function guardarSuscripcionPush(req, res) {
  if (!pushOn()) return res.status(503).json({ success: false, error: "Push no está habilitado." });
  try {
    const { endpoint, keys } = req.body?.subscription || {};
    if (!endpoint || !keys?.p256dh || !keys?.auth)
      return res.status(400).json({ success: false, error: "Suscripción inválida." });
    await pool.query(
      `INSERT INTO push_subscriptions (usuario_id, endpoint, p256dh, auth, user_agent)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (endpoint) DO UPDATE
         SET usuario_id = EXCLUDED.usuario_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
      [req.usuario.id, endpoint, keys.p256dh, keys.auth, String(req.headers["user-agent"] || "").slice(0, 300)]);
    return res.status(201).json({ success: true });
  } catch (e) {
    console.error("guardarSuscripcionPush:", e);
    return res.status(500).json({ success: false, error: "No se pudo guardar la suscripción." });
  }
}

export async function eliminarSuscripcionPush(req, res) {
  try {
    const { endpoint } = req.body || {};
    if (!endpoint) return res.status(400).json({ success: false, error: "Falta endpoint." });
    await pool.query("DELETE FROM push_subscriptions WHERE endpoint = $1 AND usuario_id = $2",
      [endpoint, req.usuario.id]);
    return res.json({ success: true });
  } catch (e) {
    console.error("eliminarSuscripcionPush:", e);
    return res.status(500).json({ success: false, error: "No se pudo eliminar." });
  }
}
