// src/lib/pagos/mp.client.js
// Cliente HTTP de Mercado Pago Orders API. Mantiene el status HTTP, el
// x-request-id y el cuerpo crudo de los errores porque el flujo los necesita.
// Nunca loguea secretos (MP no los devuelve en las respuestas).
//
// Endpoints:
//   POST /v1/orders                      crear la order (cobro)
//   GET  /v1/orders/{id}                 fuente de verdad para sincronizar
//   GET  /v1/orders?external_reference=… búsqueda con rango de fechas RFC3339
//   GET  /v1/orders/search?…             fallback si el endpoint anterior da 404
//
// COP no acepta decimales en la solicitud (aunque la respuesta los devuelva):
// "Envía una string numérica entera, sin decimales" (doc Orders API Colombia).

import { MP_ACCESS_TOKEN } from "../../config.js";

export const MP_TIMEOUT_MS = 20000;

async function mpFetch(path, { method = "GET", body, idempotencyKey } = {}) {
  const headers = {
    Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
    "Content-Type": "application/json",
  };
  if (idempotencyKey) headers["X-Idempotency-Key"] = idempotencyKey;

  const res = await fetch(`https://api.mercadopago.com${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(MP_TIMEOUT_MS),
  });
  const xRequestId = res.headers.get("x-request-id") ?? null;
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, body: json, x_request_id: xRequestId };
}

export async function mpCreateOrderRaw(payload, idempotencyKey) {
  return mpFetch("/v1/orders", {
    method: "POST",
    body: payload,
    idempotencyKey,
  });
}

export async function mpGetOrderRaw(orderId) {
  return mpFetch(`/v1/orders/${encodeURIComponent(orderId)}`);
}

export async function mpSearchOrderByExternalReference(externalReference) {
  const desde = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const hasta = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const qs = new URLSearchParams({
    external_reference: externalReference,
    begin_date: desde,
    end_date: hasta,
    page: "1",
    page_size: "5",
    sort_by: "created_date",
    sort_order: "desc",
  });
  const primero = await mpFetch(`/v1/orders?${qs}`);
  if (primero.status !== 404) return primero;
  return mpFetch(`/v1/orders/search?${qs}`);
}

// Busca la orden asociada a una external_reference.
// { ok: false } = no se pudo consultar con confianza (no expirar).
export async function buscarOrden(externalReference) {
  const res = await mpSearchOrderByExternalReference(externalReference);
  if (res.status < 200 || res.status >= 300) {
    return { ok: false, status: res.status, orden: null };
  }
  const lista = Array.isArray(res.body?.results)
    ? res.body.results
    : Array.isArray(res.body?.data)
      ? res.body.data
      : Array.isArray(res.body)
        ? res.body
        : res.body?.id
          ? [res.body]
          : [];
  const orden =
    lista.find((o) => o?.external_reference === externalReference) ?? lista[0];
  return { ok: true, status: res.status, orden: orden?.id ? orden : null };
}

// ────────────────────────────────────────────────────────────────
// Payload de POST /v1/orders
//   type=online, processing_mode=automatic, total_amount string,
//   transactions.payments[].amount string y
//   payment_method{id,type,token,installments}
//   payment_method.type es OBLIGATORIO (credit_card | debit_card).
//   notification_url NO existe en el body (se configura en el panel).
//   issuer_id NO tiene equivalente documentado → se omite.
// ────────────────────────────────────────────────────────────────
function montoCop(precio) {
  return String(Math.round(Number(precio)));
}

// El Brick entrega paymentTypeId tal cual ("credit_card"); se acepta también
// "credit"/"debit" por si llega normalizado desde otro cliente.
export function normalizarTipoTarjeta(tipo) {
  const t = String(tipo ?? "").toLowerCase();
  if (t === "debit_card" || t === "debit") return "debit_card";
  return "credit_card";
}

export function construirOrdenMp({
  precio,
  externalReference,
  descripcion,
  datos,
  maxInstallments = 1,
}) {
  const tipoTarjeta = normalizarTipoTarjeta(datos?.payment_type);
  const cuotas =
    Number(datos?.installments) > 0 ? Number(datos.installments) : 1;
  const paymentMethod = {
    id: String(datos.payment_method_id),
    type: tipoTarjeta,
    token: String(datos.token),
    installments: Math.min(cuotas, maxInstallments),
  };

  const payer = { email: String(datos?.payer?.email ?? "").trim() };
  if (datos?.payer?.identification) {
    payer.identification = datos.payer.identification;
  }

  return {
    type: "online",
    processing_mode: "automatic",
    capture_mode: "automatic",
    total_amount: montoCop(precio),
    external_reference: externalReference,
    description: descripcion,
    payer,
    transactions: {
      payments: [
        {
          amount: montoCop(precio),
          payment_method: paymentMethod,
        },
      ],
    },
  };
}

// ────────────────────────────────────────────────────────────────
// Errors: Orders API devuelve TODOS los errores de validación juntos:
//   { errors: [{ code, message, ... }], data: { transactions: ... } }
// Si el cuerpo trae un id ORD… (p. ej. 402 "order creada pero transacción
// fallida") lo devolvemos para consultar la order y persistir el intento.
// ────────────────────────────────────────────────────────────────
export function extraerIdOrdenDeError(body) {
  const texto = typeof body === "string" ? body : JSON.stringify(body ?? {});
  const orden = texto.match(/ORD[A-Z0-9]{8,}/i);
  if (orden) return orden[0];
  const pago = texto.match(/PAY[A-Z0-9]{8,}/i);
  return pago ? pago[0] : null;
}

// Mensaje legible y acotado del error de MP (sin datos sensibles).
export function detalleErrorMp(body, max = 300) {
  if (!body || typeof body !== "object")
    return String(body ?? "").slice(0, max);
  const errores = Array.isArray(body.errors)
    ? body.errors.map((e) => [e.code, e.message].filter(Boolean).join(": "))
    : [];
  const partes = [
    body.error,
    body.message,
    ...errores,
    body.cause?.code,
    body.cause?.description,
  ].filter(Boolean);
  return partes.join(" | ").slice(0, max);
}

// Referencia local única y corta (VARCHAR(64)). El prefijo lo define el
// producto (p. ej. "pocu"); randomHex son 8 bytes en hexadecimal.
export function generarExternalReference(prefijo, contextoId, randomHex) {
  return `${prefijo}-${contextoId}-${randomHex}`;
}
