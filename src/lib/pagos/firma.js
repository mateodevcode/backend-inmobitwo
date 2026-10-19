// src/lib/pagos/firma.js
// Firma de webhooks de Orders API (HMAC-SHA256).
// Docs: https://www.mercadopago.com.co/developers/es/docs/checkout-api-orders/notifications
//   manifiesto = "id:<data.id>;request-id:<x-request-id>;ts:<ts>;"
// El SDK oficial (mercadopago 3.6.1) usa el id TAL CUAL llega; algunas
// notificaciones de Orders llegan con el id en minúsculas. Se aceptan ambas
// variantes (ambas requieren el mismo secreto). Comparación en tiempo
// constante. Nunca loguea el secreto.

import crypto from "crypto";

// MP reintenta la misma notificación durante días (calendario documentado:
// 15 min, 30 min, 6 h, 48 h, 96 h…). Una tolerancia corta rompería reintentos
// legítimos; 7 días cubre ese calendario y acota el replay.
// Doc: https://www.mercadopago.com.co/developers/es/docs/checkout-api-orders/notifications
export const TOLERANCIA_TS_MS = 7 * 24 * 60 * 60 * 1000;

// Template oficial. Los valores ausentes se omiten del manifest, tal como
// indica la doc ("si alguno de los valores no está presente, removerlo").
export function manifiestoFirma(dataId, requestId, ts) {
  const id = dataId === null || dataId === undefined ? "" : String(dataId).trim();
  const rid =
    requestId === null || requestId === undefined
      ? ""
      : String(requestId).trim();
  const partes = [];
  if (id !== "") partes.push(`id:${id}`);
  if (rid !== "") partes.push(`request-id:${rid}`);
  partes.push(`ts:${ts}`);
  return `${partes.join(";")};`;
}

// Extrae "v1" de los distintos formatos de x-signature.
export function extraerV1(firma) {
  if (!firma) return null;
  const m = String(firma).match(/v1=([A-Za-z0-9]+)(,|$)/);
  const f2 = String(firma).match(/^\s*(?:v1=)?([A-Fa-f0-9]+)\s*$/);
  return m?.[1] ?? f2?.[1] ?? null;
}

export function firmaValida({ headers = {}, dataId, secret, ahora = Date.now() }) {
  if (!secret) {
    console.error("[pagos] webhook sin MP_WEBHOOK_SECRET configurado → 401");
    return false;
  }
  const firma = extraerV1(headers["x-signature"]);
  const ts = headers["x-signature"]?.match(/ts=(\d+)/)?.[1];
  const requestId = headers["x-request-id"];
  if (!firma || !ts) return false;

  // El ts de MP viene en milisegundos; se acepta segundos por compatibilidad.
  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum)) return false;
  const tsMs = tsNum < 1e12 ? tsNum * 1000 : tsNum;
  if (Math.abs(ahora - tsMs) > TOLERANCIA_TS_MS) return false;

  const idTrim = dataId === null || dataId === undefined ? "" : String(dataId).trim();
  const variantes = [
    { nombre: "asis", manifiesto: manifiestoFirma(idTrim, requestId, ts) },
  ];
  const idLower = idTrim.toLowerCase();
  if (idLower !== idTrim) {
    variantes.push({
      nombre: "lower",
      manifiesto: manifiestoFirma(idLower, requestId, ts),
    });
  }

  const recibido = String(firma).toLowerCase();
  for (const variante of variantes) {
    const calculado = crypto
      .createHmac("sha256", secret)
      .update(variante.manifiesto)
      .digest("hex");
    const a = Buffer.from(calculado, "utf8");
    const b = Buffer.from(recibido, "utf8");
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
      console.log(`[pagos] firma ok variante=${variante.nombre}`);
      return true;
    }
  }

  // Diagnóstico sin secretos: identifica si el problema es el manifest o el
  // secreto (si ninguna variante coincide, el secreto no es el que firma MP).
  console.warn(
    `[pagos] firma mismatch id=${idTrim || "n/a"} rid=${requestId ?? "n/a"} ts=${ts}`,
  );
  return false;
}
