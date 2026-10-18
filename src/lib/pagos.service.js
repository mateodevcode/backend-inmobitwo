// src/lib/pagos.service.js
// Lógica de pagos Mercado Pago (Colombia). El cliente SOLO inicia el pago:
// el monto sale de la config del servidor y la activación de la ocultación
// ocurre únicamente tras verificar el pago contra la API de MP.

import crypto from "crypto";
import { MercadoPagoConfig, Payment } from "mercadopago";
import { pool } from "../db.js";
import {
  MP_ACCESS_TOKEN,
  MP_NOTIFICATION_URL,
  MP_MAX_INSTALLMENTS,
  PRECIO_UBICACION_OCULTA_COP,
  pagosHabilitados,
} from "../config.js";
import { cacheInvalidate } from "./redis.js";

const DESPLAZAMIENTO_MIN_M = 150;
const DESPLAZAMIENTO_MAX_M = 400; // zona aproximada ~radio 500m
const TIPO_UBICACION_OCULTA = "ubicacion_oculta";

const mpClient = () => {
  if (!pagosHabilitados()) throw new Error("MP_ACCESS_TOKEN no configurado");
  return new Payment(
    new MercadoPagoConfig({
      accessToken: MP_ACCESS_TOKEN,
      options: { timeout: 20000 },
    }),
  );
};

export const pagosConfigPublica = () => ({
  habilitado: pagosHabilitados(),
  precio: PRECIO_UBICACION_OCULTA_COP,
  moneda: "COP",
  max_cuotas: MP_MAX_INSTALLMENTS,
});

// Genera la external_reference única: pocu-<propiedadId>-<random hex>
function generarExternalReference(propiedadId) {
  return `pocu-${propiedadId}-${crypto.randomBytes(8).toString("hex")}`;
}

// Buscar si hay un pago en curso para esta propiedad (así la UI lo retoma).
export async function pagoEnCurso(propiedadId) {
  const { rows } = await pool.query(
    `SELECT id, estado, estado_detalle, external_reference, mp_payment_id,
            created_at, requiere_reembolso
     FROM pagos
     WHERE propiedad_id = $1 AND tipo = $2
       AND (estado IN ('iniciado','pending','in_process')
            OR (estado = 'approved' AND aplicado_at IS NULL))
     ORDER BY id DESC
     LIMIT 1`,
    [propiedadId, TIPO_UBICACION_OCULTA],
  );
  return rows[0] ?? null;
}

export async function ultimoPago(propiedadId) {
  const { rows } = await pool.query(
    `SELECT id, estado, estado_detalle, external_reference, mp_payment_id,
            created_at, verificado_at, aplicado_at, requiere_reembolso
     FROM pagos
     WHERE propiedad_id = $1 AND tipo = $2
     ORDER BY id DESC
     LIMIT 1`,
    [propiedadId, TIPO_UBICACION_OCULTA],
  );
  return rows[0] ?? null;
}

// ────────────────────────────────────────────────────────────────
// Crear el cobro en Mercado Pago. NO recibe monto del cliente.
// datos = { token, payment_method_id, installments, issuer_id?, payer{email, identification} }
// Devuelve { pago (fila local), respuesta }
// ────────────────────────────────────────────────────────────────
export async function crearPagoUbicacionOculta({ propiedad, usuario, datos }) {
  if (!pagosHabilitados()) {
    throw ErrorPago("Pagos no configurados en el servidor.", 503);
  }

  const externalReference = generarExternalReference(propiedad.id);

  // 1. Registro local ANTES de llamar a MP (queda recuperable si falla la red).
  const { rows: regRows } = await pool.query(
    `INSERT INTO pagos (tipo, usuario_id, propiedad_id, monto, moneda,
                        external_reference, estado)
     VALUES ($1, $2, $3, $4, 'COP', $5, 'iniciado')
     RETURNING *`,
    [
      TIPO_UBICACION_OCULTA,
      usuario.id,
      propiedad.id,
      PRECIO_UBICACION_OCULTA_COP,
      externalReference,
    ],
  );
  const pago = regRows[0];

  // 2. Cobro en Mercado Pago (Checkout API). El monto JAMÁS viene del body.
  const payload = {
    transaction_amount: PRECIO_UBICACION_OCULTA_COP,
    token: datos.token,
    description: "Ocultar ubicación en mapa – pago único",
    payment_method_id: datos.payment_method_id,
    installments: Math.min(
      Number(datos.installments) || 1,
      MP_MAX_INSTALLMENTS,
    ),
    payer: {
      email: datos.payer?.email?.trim(),
      ...(datos.payer?.identification
        ? { identification: datos.payer.identification }
        : {}),
    },
    external_reference: externalReference,
    notification_url: `${MP_NOTIFICATION_URL}/pagos/mp/webhook`,
  };
  if (datos.issuer_id) payload.issuer_id = String(datos.issuer_id);
  const idempotencyKey = `pocu-${pago.id}-${externalReference}`;

  try {
    const respuesta = await mpClient().create({
      body: payload,
      idempotencyKey,
    });
    await actualizarDesdeRespuesta(pago.id, respuesta);
    return { pago: await pagoPorId(pago.id), respuesta };
  } catch (err) {
    // Error de red/timeout o rechazo de la API: el registro queda 'iniciado'
    // con nota (recuperable con el job o el botón reintentar). NO se marca
    // como rechazado: no sabemos si MP cobró o no.
    await pool.query(
      `UPDATE pagos SET nota = $2 WHERE id = $1`,
      [
        pago.id,
        `error_crear_pago_mp: ${String(err?.message ?? err).slice(0, 200)}`,
      ],
    );
    throw err;
  }
}

export class ErrorPago extends Error {
  constructor(mensaje, status = 400) {
    super(mensaje);
    this.status = status;
  }
}

async function pagoPorId(id) {
  const { rows } = await pool.query("SELECT * FROM pagos WHERE id = $1", [id]);
  return rows[0] ?? null;
}

// Resumen mínimo sin datos sensibles.
function resumenMp(respuesta) {
  return {
    payment_method_id: respuesta?.payment_method_id ?? null,
    payment_type_id: respuesta?.payment_type_id ?? null,
    date_created: respuesta?.date_created ?? null,
  };
}

async function actualizarDesdeRespuesta(pagoId, respuesta) {
  const mpId = respuesta?.id ?? null;
  const estado = normalizarEstado(respuesta?.status);
  await pool.query(
    `UPDATE pagos SET
       mp_payment_id = COALESCE($2, mp_payment_id),
       estado = $3,
       estado_detalle = $4,
       nota = $5
     WHERE id = $1`,
    [
      pagoId,
      mpId,
      estado,
      String(respuesta?.status_detail ?? "").slice(0, 255) || null,
      JSON.stringify(resumenMp(respuesta)),
    ],
  );
}

function normalizarEstado(status) {
  const permitidos = [
    "iniciado",
    "pending",
    "in_process",
    "approved",
    "rejected",
    "cancelled",
  ];
  if (!status) return "iniciado";
  return permitidos.includes(status) ? status : "iniciado";
}

// ────────────────────────────────────────────────────────────────
// sincronizarPago(mpPaymentId): fuente de verdad = API de Mercado Pago.
//   1. GET /v1/payments/{id}
//   2. Valida status approved + monto + moneda + external_reference en BD
//   3. Transacción: marca verificado y activa la ocultación con punto público.
// Idempotente por verificado_at (solo el primer UPDATE activa).
// ────────────────────────────────────────────────────────────────
export async function sincronizarPago(mpPaymentId) {
  const idInt = Number(mpPaymentId);
  if (!Number.isInteger(idInt) || idInt <= 0) return null;

  const respuesta = await mpClient().get({ id: idInt });
  if (!respuesta) return null;

  const { rows } = await pool.query(
    `SELECT * FROM pagos
     WHERE mp_payment_id = $1 OR external_reference = $2
     ORDER BY id DESC LIMIT 1`,
    [idInt, respuesta?.external_reference ?? ""],
  );
  const pago = rows[0];
  if (!pago) {
    // Webhook válido pero pago contrario: no nuestro. Respondemos ok a MP.
    return { pago: null, respuesta, accion: "ignorado" };
  }

  const estadoNuevo = normalizarEstado(respuesta?.status);

  if (estadoNuevo === "approved") {
    // Validaciones ANTES de activar: monto, moneda, external_reference.
    const montoOk = Number(respuesta.transaction_amount) === pago.monto;
    const monedaOk = String(respuesta.currency_id ?? "").toUpperCase() === "COP";
    const refOk = respuesta.external_reference === pago.external_reference;
    if (!montoOk || !monedaOk || !refOk) {
      await pool.query(
        `UPDATE pagos SET estado='approved', estado_detalle=$2,
           nota = $3, requiere_reembolso = TRUE
         WHERE id = $1 AND requiere_reembolso = FALSE`,
        [
          pago.id,
          String(respuesta?.status_detail ?? "").slice(0, 255) || null,
          `pago_mp_invalido: monto_ok=${montoOk} moneda_ok=${monedaOk} ref_ok=${refOk}`,
        ],
      );
      console.error(
        `[pagos] ⚠️ Pago MP ${idInt} aprobado con datos inconsistentes → requiere_reembolso (sin activar ocultación). Pago local id=${pago.id}`,
      );
      return { pago, respuesta, accion: "invalido" };
    }

    // TRANSACCIÓN: bloqueo optimista con verificado_at NULL.
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const upd = await client.query(
        `UPDATE pagos SET estado='approved', estado_detalle=$2,
           verificado_at = NOW()
         WHERE id = $1 AND verificado_at IS NULL`,
        [pago.id, String(respuesta?.status_detail ?? "").slice(0, 255) || null],
      );

      if (upd.rowCount === 1) {
        // Primera vez que se verifica → activar ocultación.
        const { rows: propRows } = await client.query(
          `SELECT id, publicado_por_id, organizacion_id, ubicacion_oculta,
                  latitude, longitude
           FROM propiedades WHERE id = $1 FOR UPDATE`,
          [pago.propiedad_id],
        );
        const propiedad = propRows[0];

        if (!propiedad) {
          await client.query(
            `UPDATE pagos SET requiere_reembolso = TRUE,
               nota = COALESCE(nota,'') || ' propiedad_borrada'
             WHERE id = $1`,
            [pago.id],
          );
        } else if (propiedad.ubicacion_oculta) {
          // Pago duplicado: propiedad ya oculta con otro pago.
          await client.query(
            `UPDATE pagos SET requiere_reembolso = TRUE,
               nota = COALESCE(nota,'') || ' pago_duplicado'
             WHERE id = $1`,
            [pago.id],
          );
          console.error(
            `[pagos] ⚠️ Pago MP ${idInt} duplicado (propiedad ${propiedad.id} ya oculta) → requiere_reembolso. Pago local id=${pago.id}`,
          );
        } else {
          const punto = calcularPuntoPublico(
            Number(propiedad.latitude),
            Number(propiedad.longitude),
          );
          await client.query(
            `UPDATE propiedades SET
               ubicacion_oculta = TRUE,
               ubicacion_oculta_at = NOW(),
               ubicacion_oculta_solicitada = TRUE,
               latitude_publica = $2,
               longitude_publica = $3,
               geom_publica = ST_SetSRID(
                 ST_MakePoint($3::double precision, $2::double precision), 4326)
             WHERE id = $1`,
            [propiedad.id, punto.lat, punto.lng],
          );
          await client.query(
            `UPDATE pagos SET aplicado_at = NOW() WHERE id = $1`,
            [pago.id],
          );
        }
      }

      await client.query("COMMIT");
      // Invalidar cachés de propiedades: la ficha pública cambió.
      if (upd.rowCount === 1) await cacheInvalidate("propiedad*");
      return { pago, respuesta, accion: upd.rowCount === 1 ? "activado" : "repetido" };
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  // rejected / cancelled / pending / in_process: solo registrar, nunca degradar.
  const { rows: actRows } = await pool.query("SELECT estado FROM pagos WHERE id = $1", [pago.id]);
  const estadoActual = actRows[0]?.estado;
  const terminales = ["approved", "rejected", "cancelled"];
  if (terminales.includes(estadoActual)) {
    return { pago, respuesta, accion: "sin_cambio" };
  }
  if (estadoActual === "iniciado" && ["pending", "in_process"].includes(estadoNuevo) === false) {
    // rechazado/cancelado desde iniciado: registrar sin activar nada
  }
  await pool.query(
    `UPDATE pagos SET
       mp_payment_id = COALESCE($2, mp_payment_id),
       estado = $3,
       estado_detalle = $4,
       nota = $5
     WHERE id = $1 AND estado NOT IN ('approved','rejected','cancelled')`,
    [
      pago.id,
      respuesta?.id ?? null,
      estadoNuevo,
      String(respuesta?.status_detail ?? "").slice(0, 255) || null,
      JSON.stringify(resumenMp(respuesta)),
    ],
  );
  return { pago, respuesta, accion: "actualizado" };
}

// ────────────────────────────────────────────────────────────────
// Punto público: desplazamiento aleatorio 150–400 m, rumbo aleatorio,
// criptográficamente aleatorio (crypto), calculado UNA sola vez.
// ────────────────────────────────────────────────────────────────
export function calcularPuntoPublico(latReal, lngReal) {
  if (!Number.isFinite(latReal) || !Number.isFinite(lngReal)) {
    throw new Error("Coordenadas reales inválidas para generar punto público");
  }
  // Distancia y rumbo uniformes
  const distancia = DESPLAZAMIENTO_MIN_M + crypto.randomInt(0, DESPLAZAMIENTO_MAX_M - DESPLAZAMIENTO_MIN_M + 1);
  const rumbo = crypto.randomInt(0, 360) * (Math.PI / 180);

  // Constantes WGS-84 aproximadas (paso en metros + corrección por latitud)
  const deltaLat = (distancia * Math.cos(rumbo)) / 111320;
  const deltaLng =
    (distancia * Math.sin(rumbo)) / (111320 * Math.cos((latReal * Math.PI) / 180));

  return {
    lat: Number((latReal + deltaLat).toFixed(8)),
    lng: Number((lngReal + deltaLng).toFixed(8)),
  };
}

// Distancia aproximada en metros entre dos puntos (para anti-triangulación).
export function distanciaMetros(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

// Job de reconciliación: pagos pendientes/realmente en proceso con mp_payment_id.
export async function reconciliarPagosPendientes() {
  if (!pagosHabilitados()) {
    return { revisados: 0 };
  }
  const { rows } = await pool.query(
    `SELECT mp_payment_id FROM pagos
     WHERE estado IN ('pending','in_process','iniciado')
       AND mp_payment_id IS NOT NULL
       AND created_at > NOW() - INTERVAL '7 days'
       AND created_at < NOW() - INTERVAL '10 minutes'
     ORDER BY id DESC
     LIMIT 100`,
  );
  let revisados = 0;
  for (const r of rows) {
    try {
      await sincronizarPago(r.mp_payment_id);
      revisados++;
    } catch (e) {
      console.error(`[pagos] reconciliar ${r.mp_payment_id}:`, e?.message ?? e);
    }
  }
  return { revisados };
}
