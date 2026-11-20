// Recuperación de contraseña: token de restablecimiento de un solo uso.
//
// Tras validar el código OTP se entrega un JWT corto (10 min) firmado con una
// clave DERIVADA (no sirve como access token) que lleva una huella del hash
// de la contraseña actual: al cambiarla, la huella deja de coincidir y el
// token queda inservible (un solo uso, sin tabla nueva).
import crypto from "node:crypto";
import jwt from "jsonwebtoken";

const PROPOSITO = "restablecer-password";
export const MINUTOS_TOKEN = 10;

const clave = (secreto) => crypto.createHash("sha256").update(`${secreto}:${PROPOSITO}`).digest("hex");
export const huellaPassword = (hash) => crypto.createHash("sha256").update(String(hash ?? "")).digest("hex").slice(0, 32);

export function crearTokenRestablecer({ id, password }, secreto) {
  if (!secreto) throw new Error("Falta el secreto para firmar el token.");
  return jwt.sign({ sub: String(id), h: huellaPassword(password) }, clave(secreto), {
    expiresIn: `${MINUTOS_TOKEN}m`,
    audience: PROPOSITO,
  });
}

// Devuelve el id de usuario del token (sin comprobar aún la huella) o null.
export function leerTokenRestablecer(token, secreto) {
  if (typeof token !== "string" || token.length > 2000 || !secreto) return null;
  try {
    const p = jwt.verify(token, clave(secreto), { audience: PROPOSITO, algorithms: ["HS256"] });
    const id = Number(p.sub);
    return Number.isInteger(id) && id > 0 && typeof p.h === "string" ? { id, h: p.h } : null;
  } catch {
    return null;
  }
}

// El token sigue vigente solo si la contraseña no ha cambiado desde que se emitió.
export function huellaVigente(datos, passwordHashActual) {
  if (!datos) return false;
  const a = Buffer.from(datos.h);
  const b = Buffer.from(huellaPassword(passwordHashActual));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Reglas de contraseña nueva (mismas que el registro del portal).
export function erroresPasswordNueva(password) {
  if (typeof password !== "string" || !password) return ["La contraseña es requerida."];
  const errores = [];
  if (password.length < 8) errores.push("Debe tener al menos 8 caracteres.");
  if (password.length > 128) errores.push("Debe tener como máximo 128 caracteres.");
  if (!/[A-Z]/.test(password)) errores.push("Debe incluir al menos una mayúscula.");
  if (!/[a-z]/.test(password)) errores.push("Debe incluir al menos una minúscula.");
  if (!/[0-9]/.test(password)) errores.push("Debe incluir al menos un número.");
  if (!/[^A-Za-z0-9]/.test(password)) errores.push("Debe incluir al menos un carácter especial.");
  return errores;
}
