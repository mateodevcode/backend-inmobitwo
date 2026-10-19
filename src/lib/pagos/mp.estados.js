// src/lib/pagos/mp.estados.js
// Mapeo puro entre los estados de Orders API y los estados locales de `pagos`.
// Sin BD ni red: se prueba con node:test.
//
// Docs: https://www.mercadopago.com/developers/es/docs/checkout-api-orders/payment-management/status/order-status
//   processed + accredited  → approved
//   processing / created    → in_process
//   action_required         → pending
//   failed                  → rejected
//   canceled                → cancelled
//   refunded / charged_back → refunded / charged_back (NUNCA activan)

export const ESTADOS_PAGO = [
  "iniciado",
  "pending",
  "in_process",
  "approved",
  "rejected",
  "cancelled",
  "expirado",
  "refunded",
  "charged_back",
];

// Estados terminales: nunca se degradan ni se reescriben desde el sync.
export const ESTADOS_TERMINALES = [
  "approved",
  "rejected",
  "cancelled",
  "refunded",
  "charged_back",
];

export function normalizarEstado(status) {
  if (!status) return "iniciado";
  return ESTADOS_PAGO.includes(status) ? status : "iniciado";
}

export function estadoDesdeOrden(orden) {
  const pagoTx = orden?.transactions?.payments?.[0] ?? null;
  const estadoOrden = orden?.status ?? null;
  const estadoTx = pagoTx?.status ?? null;
  // Un reembolso/contracargo a nivel de order manda sobre la transacción:
  // si la order quedó 'refunded'/'charged_back' NUNCA debe activarse.
  const fuente = ["refunded", "charged_back"].includes(estadoOrden)
    ? estadoOrden
    : (estadoTx ?? estadoOrden);
  const detalle =
    pagoTx?.status_detail ?? pagoTx?.reason?.code ?? orden?.status_detail ?? null;

  let status = null;
  switch (fuente) {
    case "processed":
    case "approved":
      status = "approved";
      break;
    case "processing":
    case "created":
      status = "in_process";
      break;
    case "action_required":
    case "pending":
      status = "pending";
      break;
    case "failed":
    case "rejected":
      status = "rejected";
      break;
    case "canceled":
    case "cancelled":
      status = "cancelled";
      break;
    case "refunded":
      status = "refunded";
      break;
    case "charged_back":
      status = "charged_back";
      break;
    default:
      status = null;
  }
  return { status, detalle };
}

// Normaliza una order de MP a la forma que consume sincronizarPago.
export function normalizarOrdenMp(orden) {
  const { status, detalle } = estadoDesdeOrden(orden);
  const pagoTx = orden?.transactions?.payments?.[0] ?? null;
  return {
    id: orden?.id ?? null,
    transaction_id: pagoTx?.id ?? null,
    status,
    status_detail: detalle,
    external_reference: orden?.external_reference ?? null,
    transaction_amount: Number(orden?.total_amount ?? pagoTx?.amount ?? 0),
    currency_id: orden?.currency ?? null,
    payment_method_id: pagoTx?.payment_method?.id ?? null,
    payment_type_id: pagoTx?.payment_method?.type ?? null,
    date_created: orden?.created_date ?? null,
  };
}
