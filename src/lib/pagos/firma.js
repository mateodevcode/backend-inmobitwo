// src/lib/pagos/firma.js
// Firma de webhooks de Orders API (HMAC-SHA256).
// Docs: https://www.mercadopago.com/developers/es/docs/checkout-api-orders/notifications
//   manifiesto = "id:<data.id>;request-id:<x-request-id>;ts:<ts>;"
// El id va en MINÚSCULAS (crítico en Orders API: "ORD01…" → "ord01…").
// Comparación en tiempo constante. Nunca loguea el secreto.

import crypto from "crypto";

export function manifiestoFirma(dataId, requestId, ts) {
  return `id:${String(dataId).toLowerCase()};request-id:${requestId};ts:${ts};`;
}

// Extrae "v1" de los distintos formatos de x-signature.
export function extraerV1(firma) {
  if (!firma) return null;
  const m = String(firma).match(/v1=([A-Za-z0-9]+)(,|$)/);
  const f2 = String(firma).match(/^\s*(?:v1=)?([A-Fa-f0-9]+)\s*$/);
  return m?.[1] ?? f2?.[1] ?? null;
}

export function firmaValida({ headers = {}, dataId, secret }) {
  if (!secret) {
    console.error("[pagos] webhook sin MP_WEBHOOK_SECRET configurado → 401");
    return false;
  }
  const firma = extraerV1(headers["x-signature"]);
  const ts = headers["x-signature"]?.match(/ts=(\d+)/)?.[1];
  const requestId = headers["x-request-id"];
  if (!firma || !ts || !requestId || !dataId) return false;

  const data = manifiestoFirma(dataId, requestId, ts);
  const calculado = crypto
    .createHmac("sha256", secret)
    .update(data)
    .digest("hex");
  const a = Buffer.from(calculado, "utf8");
  const b = Buffer.from(String(firma), "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
