// src/lib/viewToken.js
// Emisión del token de ficha (Fase 3 del algoritmo de vista de detalle).
// Formato: v1.<payload_b64url>.<sig_hex>, payload {"pid","jti","iat","exp"} (ms UTC).
// Firma: HMAC-SHA256(VIEW_TOKEN_SECRET, "v1.<payload_b64url>") en hex.
// Rust verifica en services/rust-tracking-service/src/vista_token.rs (mismo algoritmo).
import crypto from "node:crypto";
import { VIEW_TOKEN_MAX_AGE_MINUTES, VIEW_TOKEN_SECRET } from "../config.js";

const MAX_AGE_MINUTES = Number(VIEW_TOKEN_MAX_AGE_MINUTES) || 60;

/**
 * Emite un token de ficha de uso único para el inmueble.
 * @param {number|string} propiedadId
 * @param {number} [ahoraMs=Date.now()] Hora del servidor (tests).
 * @returns {{ token: string, expires_at: string }}
 */
export function emitirViewToken(propiedadId, ahoraMs = Date.now()) {
  if (!VIEW_TOKEN_SECRET) {
    throw new Error("VIEW_TOKEN_SECRET no configurado");
  }
  const pid = Number(propiedadId);
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new Error("propiedadId inválido");
  }
  const iat = Number(ahoraMs);
  if (!Number.isInteger(iat) || iat <= 0) {
    throw new Error("ahoraMs inválido");
  }
  const exp = iat + MAX_AGE_MINUTES * 60_000;
  const payload = JSON.stringify({ pid, jti: crypto.randomUUID(), iat, exp });
  const b64 = Buffer.from(payload, "utf8").toString("base64url");
  const body = `v1.${b64}`;
  const sig = crypto.createHmac("sha256", VIEW_TOKEN_SECRET).update(body).digest("hex");
  return { token: `${body}.${sig}`, expires_at: new Date(exp).toISOString() };
}
