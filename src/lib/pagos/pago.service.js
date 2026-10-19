// src/lib/pagos/pago.service.js
// Servicio genérico de pagos con Mercado Pago Orders API (Colombia).
//
// El cliente SOLO inicia el pago: el monto sale de la definición del producto
// en el servidor y la activación ocurre únicamente tras verificar la orden
// contra la API de MP. Cada producto decide qué derecho aplica (ver productos/).
//
// Flujo:
//   1. crearPago(): fila local 'iniciado' → POST /v1/orders → persistir orden.
//   2. sincronizarPago(): GET /v1/orders/{id} → validar monto/moneda/ref →
//      activar el producto dentro de una transacción (idempotente).
//   3. expirarIntentosSinOrden() + reconciliarPagosPendientes(): red de
//      seguridad para webhooks perdidos e intentos sin id de MP.
//
// Estados: ver mp.estados.js. La fuente de verdad es SIEMPRE la API de MP.

import crypto from "crypto";
import { pool } from "../../db.js";
import {
  MP_MAX_INSTALLMENTS,
  PRECIO_UBICACION_OCULTA_COP,
  pagosHabilitados,
} from "../../config.js";
import { cacheInvalidate } from "../redis.js";
import {
  ESTADOS_TERMINALES,
  normalizarEstado,
  normalizarOrdenMp,
} from "./mp.estados.js";
import {
  buscarOrden,
  construirOrdenMp,
  detalleErrorMp,
  extraerIdOrdenDeError,
  generarExternalReference,
  mpCreateOrderRaw,
  mpGetOrderRaw,
} from "./mp.client.js";
import { productoPorTipo, productosPublicos } from "./productos/index.js";
import { ubicacionOculta } from "./productos/ubicacionOculta.js";

// Intento 'iniciado' sin id de MP: tras esta ventana se considera expirado y
// deja de bloquear (índice único parcial). NO se marca rechazado: no sabemos
// si MP llegó a cobrar; la reconciliación por external_reference lo resuelve.
const VENTANA_INTENTO_MS = 10 * 60 * 1000;

export class ErrorPago extends Error {
  constructor(mensaje, status = 400) {
    super(mensaje);
    this.status = status;
  }
}

// Config pública para la UI. Se mantienen los campos históricos de nivel
// superior (precio/moneda/max_cuotas) y se agrega el mapa por producto.
export const pagosConfigPublica = () => ({
  habilitado: pagosHabilitados(),
  precio: PRECIO_UBICACION_OCULTA_COP,
  moneda: ubicacionOculta.moneda,
  max_cuotas: MP_MAX_INSTALLMENTS,
  productos: productosPublicos(),
});

// ────────────────────────────────────────────────────────────────
// Consultas locales
// ────────────────────────────────────────────────────────────────
export async function pagoEnCurso(tipo, contextoId) {
  const { rows } = await pool.query(
    `SELECT id, estado, estado_detalle, external_reference, mp_payment_id,
            mp_idempotency_key, created_at, requiere_reembolso
     FROM pagos
     WHERE ${campoContexto(tipo)} = $1 AND tipo = $2
       AND (estado IN ('iniciado','pending','in_process')
            OR (estado = 'approved' AND aplicado_at IS NULL))
     ORDER BY id DESC
     LIMIT 1`,
    [contextoId, tipo],
  );
  return rows[0] ?? null;
}

export async function ultimoPago(tipo, contextoId) {
  const { rows } = await pool.query(
    `SELECT id, estado, estado_detalle, external_reference, mp_payment_id,
            mp_transaction_id, created_at, verificado_at, aplicado_at,
            requiere_reembolso
     FROM pagos
     WHERE ${campoContexto(tipo)} = $1 AND tipo = $2
     ORDER BY id DESC
     LIMIT 1`,
    [contextoId, tipo],
  );
  return rows[0] ?? null;
}

// Columna de contexto de la tabla `pagos` para un tipo de producto.
// Es un valor controlado por el registro de productos (nunca input del user).
function campoContexto(tipo) {
  const producto = productoPorTipo(tipo);
  if (!producto?.campoContextoDb) {
    throw new Error(`Producto de pago desconocido: ${tipo}`);
  }
  return producto.campoContextoDb;
}

async function pagoPorId(id) {
  const { rows } = await pool.query("SELECT * FROM pagos WHERE id = $1", [id]);
  return rows[0] ?? null;
}

// ────────────────────────────────────────────────────────────────
// Caducidad de intentos: 'iniciado' sin id de MP más viejo que la ventana.
// Nunca 'rejected'. Antes de expirar se intenta reconciliar por referencia.
// ────────────────────────────────────────────────────────────────
export async function expirarIntentosSinOrden() {
  const { rows } = await pool.query(
    `SELECT id, external_reference FROM pagos
     WHERE estado = 'iniciado'
       AND mp_payment_id IS NULL
       AND created_at < NOW() - ($1::bigint * INTERVAL '1 millisecond')
     ORDER BY id
     LIMIT 50`,
    [VENTANA_INTENTO_MS],
  );
  let expirados = 0;
  for (const fila of rows) {
    let busqueda;
    try {
      busqueda = await buscarOrden(fila.external_reference);
    } catch (e) {
      // No se pudo confirmar con MP: NO se expira (podría existir el cobro).
      console.error(
        `[pagos] buscar orden ${fila.external_reference}:`,
        e?.message ?? e,
      );
      continue;
    }
    if (!busqueda.ok) {
      // Búsqueda no confiable (endpoint/credenciales): no se expira.
      console.error(
        `[pagos] búsqueda no confiable para ${fila.external_reference}: HTTP ${busqueda.status}`,
      );
      continue;
    }
    if (busqueda.orden) {
      try {
        await sincronizarPago(busqueda.orden.id);
        continue;
      } catch (e) {
        console.error(
          `[pagos] sync orden encontrada ${busqueda.orden.id}:`,
          e?.message ?? e,
        );
        continue;
      }
    }
    await pool.query(
      `UPDATE pagos SET estado = 'expirado',
         estado_detalle = 'intento_sin_respuesta_mp'
       WHERE id = $1 AND estado = 'iniciado' AND mp_payment_id IS NULL`,
      [fila.id],
    );
    expirados++;
  }
  return { expirados };
}

// ────────────────────────────────────────────────────────────────
// Crear el cobro con Orders API. NO recibe monto del cliente.
// datos = { token, payment_method_id, payment_type, installments,
//           payer{email, identification} }
// Devuelve { pago (fila local), respuesta }
// ────────────────────────────────────────────────────────────────
export async function crearPago({ producto, contextoId, usuario, datos }) {
  if (!pagosHabilitados()) {
    throw new ErrorPago("Pagos no configurados en el servidor.", 503);
  }

  const precio = producto.precio();
  // 1. El controlador ya expiró los intentos viejos sin id de MP antes de
  //    comprobar "pago en curso"; aquí solo se genera el intento nuevo.
  const externalReference = generarExternalReference(
    producto.prefijoReferencia,
    contextoId,
    crypto.randomBytes(8).toString("hex"),
  );
  const idempotencyKey = crypto.randomUUID();

  // 2. Registro local ANTES de llamar a MP (recuperable si falla la red).
  //    La key queda persistida: un reintento del MISMO intento la reutiliza.
  const { rows: regRows } = await (async () => {
    try {
      return await pool.query(
        `INSERT INTO pagos (tipo, usuario_id, ${producto.campoContextoDb},
                            monto, moneda, external_reference,
                            mp_idempotency_key, estado)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'iniciado')
         RETURNING *`,
        [
          producto.tipo,
          usuario.id,
          contextoId,
          precio,
          producto.moneda,
          externalReference,
          idempotencyKey,
        ],
      );
    } catch (e) {
      // Carrera entre dos pestañas: el índice único parcial rechaza el segundo.
      if (e?.code === "23505") {
        throw new ErrorPago(
          "Ya existe un pago en curso para esta propiedad.",
          409,
        );
      }
      throw e;
    }
  })();
  const pago = regRows[0];

  // 3. Payload Orders API: type=online, processing_mode=automatic,
  //    total_amount string, payment_method.type obligatorio. Sin
  //    notification_url (no existe en el body) y sin issuer_id (no
  //    documentado en Orders).
  const payload = construirOrdenMp({
    precio,
    externalReference,
    descripcion: producto.descripcion,
    datos,
    maxInstallments: producto.maxCuotas?.() ?? 1,
  });

  try {
    let { status, body, x_request_id } = await mpCreateOrderRaw(
      payload,
      idempotencyKey,
    );

    // 423 resource_locked: clave bloqueada temporalmente → reintentar igual.
    if (status === 423) {
      await new Promise((r) => setTimeout(r, 1200));
      ({ status, body, x_request_id } = await mpCreateOrderRaw(
        payload,
        idempotencyKey,
      ));
    }

    // 409 idempotency_key_already_used: misma key con otro body (no debería
    // ocurrir con esta fila). Se reconcilia por external_reference.
    if (status === 409) {
      console.error(
        `[pagos] MP 409 idempotencia pago=${pago.id} x-request-id=${x_request_id ?? "n/a"} body=${JSON.stringify(body)}`,
      );
      const busqueda = await buscarOrden(externalReference);
      if (busqueda.orden) {
        await persistirOrden(pago.id, busqueda.orden);
        return { pago: await pagoPorId(pago.id), respuesta: busqueda.orden };
      }
      throw new ErrorPago(
        "No se pudo iniciar el cobro (conflicto de idempotencia). Reintenta en unos segundos.",
        502,
      );
    }

    // 5xx: NO marcar rechazado. La fila queda 'iniciado' con su key y la
    // reconciliación por external_reference decide.
    if (status >= 500) {
      console.error(
        `[pagos] MP ${status} pago=${pago.id} x-request-id=${x_request_id ?? "n/a"} body=${JSON.stringify(body)}`,
      );
      await pool.query(`UPDATE pagos SET nota = $2 WHERE id = $1`, [
        pago.id,
        `error_crear_orden_mp: HTTP ${status} ${detalleErrorMp(body, 180)}`.slice(
          0,
          200,
        ),
      ]);
      throw new ErrorPago(
        "Mercado Pago no respondió. Tu pago quedó registrado como pendiente; reintenta en unos minutos.",
        502,
      );
    }

    if (status >= 400 || !body?.id) {
      console.error(
        `[pagos] MP error crudo → POST /v1/orders HTTP ${status} x-request-id=${x_request_id ?? "n/a"} body=${JSON.stringify(body)}`,
      );
      const detalle = detalleErrorMp(body);
      // 402: la order pudo crearse aunque la transacción falló → persistir.
      const idEnError = extraerIdOrdenDeError(body);
      if (idEnError?.startsWith("ORD")) {
        try {
          const orden = await mpGetOrderRaw(idEnError);
          if (orden.status < 400 && orden.body?.id) {
            await persistirOrden(pago.id, orden.body);
            return { pago: await pagoPorId(pago.id), respuesta: orden.body };
          }
        } catch (e) {
          console.error("[pagos] GET orden tras 402:", e?.message ?? e);
        }
      }
      // 4xx de validación (tarjeta rechazada, payload inválido, credenciales):
      // se terminaliza como 'rejected' para no bloquear 10 min con el índice
      // de "pago en curso". No hubo cobro que reconciliar: MP no creó order.
      if (status >= 400 && status < 500) {
        await pool.query(
          `UPDATE pagos SET estado = 'rejected',
             estado_detalle = 'error_validacion_mp',
             nota = $2
           WHERE id = $1 AND estado = 'iniciado' AND mp_payment_id IS NULL`,
          [
            pago.id,
            `error_crear_orden_mp: HTTP ${status} ${detalle}`.slice(0, 200),
          ],
        );
      } else {
        // 2xx sin id (respuesta rara): dejar 'iniciado' para reconciliar.
        await pool.query(`UPDATE pagos SET nota = $2 WHERE id = $1`, [
          pago.id,
          `error_crear_orden_mp: HTTP ${status} sin id`.slice(0, 200),
        ]);
      }
      // 4xx de MP → 400 (nunca 401/403: no deben disparar el logout global
      // del frontend). 2xx sin id → 502: no sabemos qué pasó, se reconcilia.
      const statusHttp =
        status === 402 ? 402 : status >= 400 && status < 500 ? 400 : 502;
      throw new ErrorPago(
        `Mercado Pago no aceptó el pago (HTTP ${status}${detalle ? `: ${detalle}` : ""}).`,
        statusHttp,
      );
    }

    await persistirOrden(pago.id, body);
    return { pago: await pagoPorId(pago.id), respuesta: body };
  } catch (err) {
    if (err instanceof ErrorPago) throw err;
    // Red/timeout: 'iniciado' + nota. NO rechazado: no sabemos si cobró.
    await pool.query(`UPDATE pagos SET nota = $2 WHERE id = $1`, [
      pago.id,
      `error_crear_orden_mp: ${String(err?.message ?? err).slice(0, 200)}`,
    ]);
    throw err;
  }
}

// Persiste id ORD/PAY, estado y detalle de una orden de MP.
async function persistirOrden(pagoId, orden) {
  const normalizada = normalizarOrdenMp(orden);
  await pool.query(
    `UPDATE pagos SET
       mp_payment_id = COALESCE($2, mp_payment_id),
       mp_transaction_id = COALESCE($3, mp_transaction_id),
       estado = $4,
       estado_detalle = $5,
       nota = $6
     WHERE id = $1`,
    [
      pagoId,
      normalizada.id,
      normalizada.transaction_id,
      normalizarEstado(normalizada.status),
      String(normalizada.status_detail ?? "").slice(0, 255) || null,
      JSON.stringify({
        payment_method_id: normalizada.payment_method_id,
        payment_type_id: normalizada.payment_type_id,
        date_created: normalizada.date_created,
      }),
    ],
  );
}

// ────────────────────────────────────────────────────────────────
// sincronizarPago(mpId): fuente de verdad = API de Mercado Pago.
//   - "ORD…"/"PAY…" → GET /v1/orders/{id}
//   2. approved: valida monto + moneda + external_reference en BD.
//   3. Transacción: marca verificado y delega la activación al producto.
//   4. refunded/charged_back: se registran y NUNCA activan.
// Idempotente por verificado_at (solo el primer UPDATE activa).
// ────────────────────────────────────────────────────────────────
export async function sincronizarPago(mpPaymentId) {
  const idStr = String(mpPaymentId ?? "").trim();
  if (!idStr) return null;

  // Órdenes API. Los ids numéricos de /v1/payments quedaron fuera de soporte
  // (no hay pagos legacy activos): se ignoran para no consultar un endpoint
  // que ya no usamos.
  if (!/^(ORD|PAY)/i.test(idStr)) {
    console.warn(`[pagos] id de pago no soportado (legacy): ${idStr}`);
    return null;
  }

  const orden = await mpGetOrderRaw(idStr);
  if (orden.status >= 400 || !orden.body?.id) {
    console.error(
      `[pagos] GET orden ${idStr} HTTP ${orden.status} x-request-id=${orden.x_request_id ?? "n/a"} body=${JSON.stringify(orden.body)}`,
    );
    return null;
  }
  const respuesta = normalizarOrdenMp(orden.body);

  if (!respuesta?.status) {
    // Estado desconocido (p. ej. created): registrar el id y esperar.
    const { rows } = await pool.query(
      `SELECT * FROM pagos
       WHERE mp_payment_id = $1::text OR external_reference = $2
       ORDER BY id DESC LIMIT 1`,
      [String(respuesta?.id ?? idStr), respuesta?.external_reference ?? ""],
    );
    if (rows[0] && respuesta?.id) {
      await pool.query(
        `UPDATE pagos SET mp_payment_id = COALESCE(mp_payment_id, $2),
           mp_transaction_id = COALESCE(mp_transaction_id, $3)
         WHERE id = $1`,
        [rows[0].id, respuesta.id, respuesta.transaction_id ?? null],
      );
    }
    return { pago: rows[0] ?? null, respuesta, accion: "sin_estado" };
  }

  const { rows } = await pool.query(
    `SELECT * FROM pagos
     WHERE mp_payment_id = $1::text OR external_reference = $2
     ORDER BY id DESC LIMIT 1`,
    [String(respuesta.id), respuesta.external_reference ?? ""],
  );
  const pago = rows[0];
  if (!pago) {
    // Webhook válido pero pago ajeno: no nuestro. 200 a MP, nada que hacer.
    return { pago: null, respuesta, accion: "ignorado" };
  }

  const estadoNuevo = normalizarEstado(respuesta.status);

  if (estadoNuevo === "approved") {
    const montoOk = Number(respuesta.transaction_amount) === Number(pago.monto);
    const monedaOk =
      String(respuesta.currency_id ?? "").toUpperCase() ===
      String(pago.moneda).toUpperCase();
    const refOk = respuesta.external_reference === pago.external_reference;
    if (!montoOk || !monedaOk || !refOk) {
      await pool.query(
        `UPDATE pagos SET estado='approved', estado_detalle=$2,
           mp_payment_id = COALESCE($4, mp_payment_id),
           mp_transaction_id = COALESCE($5, mp_transaction_id),
           nota = $3, requiere_reembolso = TRUE
         WHERE id = $1 AND requiere_reembolso = FALSE`,
        [
          pago.id,
          String(respuesta?.status_detail ?? "").slice(0, 255) || null,
          `pago_mp_invalido: monto_ok=${montoOk} moneda_ok=${monedaOk} ref_ok=${refOk}`,
          respuesta.id,
          respuesta.transaction_id ?? null,
        ],
      );
      console.error(
        `[pagos] ⚠️ Pago MP ${String(respuesta.id)} aprobado con datos inconsistentes → requiere_reembolso (sin activar). Pago local id=${pago.id}`,
      );
      return { pago, respuesta, accion: "invalido" };
    }

    const producto = productoPorTipo(pago.tipo);
    if (!producto) {
      await pool.query(
        `UPDATE pagos SET estado='approved',
           estado_detalle = COALESCE($2, estado_detalle),
           mp_payment_id = COALESCE($3, mp_payment_id),
           mp_transaction_id = COALESCE($4, mp_transaction_id),
           requiere_reembolso = TRUE,
           nota = COALESCE(nota,'') || ' producto_desconocido'
         WHERE id = $1`,
        [
          pago.id,
          String(respuesta?.status_detail ?? "").slice(0, 255) || null,
          respuesta.id,
          respuesta.transaction_id ?? null,
        ],
      );
      console.error(
        `[pagos] ⚠️ Pago MP ${String(respuesta.id)} de producto desconocido (${pago.tipo}) → requiere_reembolso. Pago local id=${pago.id}`,
      );
      return { pago, respuesta, accion: "producto_desconocido" };
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const upd = await client.query(
        `UPDATE pagos SET estado='approved', estado_detalle=$2,
           mp_payment_id = COALESCE($3, mp_payment_id),
           mp_transaction_id = COALESCE($4, mp_transaction_id),
           verificado_at = NOW()
         WHERE id = $1 AND verificado_at IS NULL`,
        [
          pago.id,
          String(respuesta?.status_detail ?? "").slice(0, 255) || null,
          respuesta.id,
          respuesta.transaction_id ?? null,
        ],
      );

      if (upd.rowCount === 1) {
        const ctx = await producto.cargarContextoParaAplicar(
          client,
          pago[producto.campoContextoDb],
        );

        if (!ctx) {
          await client.query(
            `UPDATE pagos SET requiere_reembolso = TRUE,
               nota = COALESCE(nota,'') || ' propiedad_borrada'
             WHERE id = $1`,
            [pago.id],
          );
        } else if (producto.yaAplicado(ctx)) {
          await client.query(
            `UPDATE pagos SET requiere_reembolso = TRUE,
               nota = COALESCE(nota,'') || ' pago_duplicado'
             WHERE id = $1`,
            [pago.id],
          );
          console.error(
            `[pagos] ⚠️ Pago MP ${String(respuesta.id)} duplicado (contexto ${ctx.id} ya aplicado) → requiere_reembolso. Pago local id=${pago.id}`,
          );
        } else {
          await producto.aplicar(client, { pago, ctx });
        }
      }

      await client.query("COMMIT");
      const cacheKey = producto.invalidarCache?.();
      if (upd.rowCount === 1 && cacheKey) await cacheInvalidate(cacheKey);
      return {
        pago,
        respuesta,
        accion: upd.rowCount === 1 ? "activado" : "repetido",
      };
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  // refunded / charged_back: registrar y NUNCA activar ni degradar un
  // approved ya aplicado (el reembolso se gestiona aparte).
  const terminalesNoAplicables = ["refunded", "charged_back"];

  const { rows: actRows } = await pool.query(
    "SELECT estado, aplicado_at FROM pagos WHERE id = $1",
    [pago.id],
  );
  const estadoActual = actRows[0]?.estado;
  const aplicado = Boolean(actRows[0]?.aplicado_at);

  if (ESTADOS_TERMINALES.includes(estadoActual) && estadoActual !== "approved") {
    return { pago, respuesta, accion: "sin_cambio" };
  }
  if (
    estadoActual === "approved" &&
    terminalesNoAplicables.includes(estadoNuevo)
  ) {
    await pool.query(
      `UPDATE pagos SET estado = $2, estado_detalle = $3,
         mp_payment_id = COALESCE($4, mp_payment_id),
         mp_transaction_id = COALESCE($5, mp_transaction_id),
         nota = $6
       WHERE id = $1`,
      [
        pago.id,
        estadoNuevo,
        String(respuesta?.status_detail ?? "").slice(0, 255) || null,
        respuesta.id,
        respuesta.transaction_id ?? null,
        JSON.stringify({ aplicado, reembolso: true }),
      ],
    );
    return { pago, respuesta, accion: "reembolsado" };
  }
  if (estadoActual === "approved") {
    return { pago, respuesta, accion: "sin_cambio" };
  }

  await pool.query(
    `UPDATE pagos SET
       mp_payment_id = COALESCE($2, mp_payment_id),
       mp_transaction_id = COALESCE($3, mp_transaction_id),
       estado = $4,
       estado_detalle = $5,
       nota = $6
     WHERE id = $1
       AND estado NOT IN ('approved','rejected','cancelled','refunded','charged_back')`,
    [
      pago.id,
      respuesta?.id ?? null,
      respuesta?.transaction_id ?? null,
      estadoNuevo,
      String(respuesta?.status_detail ?? "").slice(0, 255) || null,
      JSON.stringify({
        payment_method_id: respuesta.payment_method_id,
        payment_type_id: respuesta.payment_type_id,
      }),
    ],
  );
  return { pago, respuesta, accion: "actualizado" };
}

// Job de reconciliación: expira intentos sin id y sincroniza pendientes con id.
export async function reconciliarPagosPendientes() {
  if (!pagosHabilitados()) {
    return { revisados: 0, expirados: 0 };
  }

  const { expirados } = await expirarIntentosSinOrden();

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
  return { revisados, expirados };
}
