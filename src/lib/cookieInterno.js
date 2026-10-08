// src/lib/cookieInterno.js
// Cookie de interno (paso8 6b): marca al staff (superadmin o miembro activo
// agent/agency_admin) para excluir sus vistas aunque navegue sin sesión.
// Firmada con HMAC-SHA256 con secreto PROPIO (INTERNO_COOKIE_SECRET, nunca
// VIEW_TOKEN_SECRET). httpOnly, sameSite Lax, secure en producción, 30 días.
// NO se asigna a usuarios normales que solo publican.
import crypto from "node:crypto";
import { INTERNO_COOKIE_SECRET } from "../config.js";

export const COOKIE_INTERNO = "inmobiliario_interno";
const TREINTA_DIAS_MS = 30 * 24 * 60 * 60 * 1000;

export const opcionesCookieInterno = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  maxAge: TREINTA_DIAS_MS,
});

/** Firma el id de usuario: "{id}.{hmac}". */
export function firmarInterno(usuarioId, secreto = INTERNO_COOKIE_SECRET) {
  if (!secreto) throw new Error("INTERNO_COOKIE_SECRET no configurado");
  const id = String(usuarioId);
  const sig = crypto.createHmac("sha256", secreto).update(id).digest("hex");
  return `${id}.${sig}`;
}

/** Verifica la cookie; devuelve el id o null (manipulada/ausente). */
export function verificarInterno(valor, secreto = INTERNO_COOKIE_SECRET) {
  try {
    if (!secreto || typeof valor !== "string") return null;
    const [id, sig] = valor.split(".");
    if (!id || !sig || !/^\d+$/.test(id)) return null;
    const esperada = crypto.createHmac("sha256", secreto).update(id).digest("hex");
    const a = Buffer.from(sig, "hex");
    const b = Buffer.from(esperada, "hex");
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    return Number(id);
  } catch {
    return null;
  }
}

/** ¿La request trae cookie de interno válida? (para forzar es_interno). */
export function esInternoPorCookie(req) {
  return verificarInterno(req?.cookies?.[COOKIE_INTERNO]) !== null;
}
