// src/controllers/pagos.controllers.js
// Endpoints genéricos de pagos Mercado Pago (Orders API, Colombia).
// El producto se resuelve por el slug de la ruta; el controlador no conoce
// productos concretos (ver src/lib/pagos/productos/).
//
// Rutas compatibles (mismas URLs que antes):
//   GET  /pagos/config
//   POST /pagos/:producto
//   GET  /pagos/:producto/:contextoId/estado
//   POST /pagos/mp/webhook

import { pool } from "../db.js";
import {
  ErrorPago,
  crearPago,
  expirarIntentosSinOrden,
  pagoEnCurso,
  pagosConfigPublica,
  sincronizarPago,
  ultimoPago,
} from "../lib/pagos/pago.service.js";
import { productoPorSlug } from "../lib/pagos/productos/index.js";
import { firmaValida } from "../lib/pagos/firma.js";
import { puedeGestionarPropiedad } from "../lib/propiedadPermisos.js";
import { MP_WEBHOOK_SECRET } from "../config.js";
import { ipReal } from "../lib/ipReal.js";
import {
  createRateLimitMiddleware,
  createRateLimiter,
} from "../lib/rateLimit.js";

// ────────────────────────────────────────────────────────────────
// GET /pagos/config (verificarToken): precio/moneda/armado del Brick.
// habilitado=false si falta MP_ACCESS_TOKEN: la UI apaga la casilla.
// ────────────────────────────────────────────────────────────────
export const getConfigPagos = (req, res) => {
  res.json({ success: true, data: pagosConfigPublica(), error: null });
};

// ────────────────────────────────────────────────────────────────
// POST /pagos/:producto (verificarToken): inicia el cobro.
// Body: <campoContexto del producto> (p. ej. propiedad_id), token,
//       payment_method_id, payment_type, installments,
//       payer: { email, identification }.
// El MONTO JAMÁS se acepta del body; sale de la definición del producto.
// limiter: 5 inicios por usuario cada 10 min (anti card-testing).
// ────────────────────────────────────────────────────────────────
const pagoInicioLimiter = createRateLimitMiddleware(
  createRateLimiter(5, 10 * 60000, 5, (req) => ipReal(req), "pago-inicio"),
);

function resolverProducto(req, res) {
  const producto = productoPorSlug(req.params.producto);
  if (!producto) {
    res.status(404).json({
      success: false,
      error: "Producto de pago no encontrado.",
    });
    return null;
  }
  return producto;
}

export const iniciarPago = [
  pagoInicioLimiter,
  async (req, res) => {
    try {
      const producto = resolverProducto(req, res);
      if (!producto) return;

      const { token, payment_method_id, payment_type, installments, payer } =
        req.body ?? {};
      const contextoId = parseInt(
        req.body?.[producto.campoContexto] ?? req.body?.contexto_id,
      );
      if (!Number.isInteger(contextoId) || contextoId <= 0) {
        return res.status(400).json({
          success: false,
          error: `${producto.campoContexto} inválido.`,
        });
      }

      // El contexto debe pertenecer al usuario (dueño, agency_admin o superadmin).
      const ctx = await producto.cargarContexto(contextoId);
      if (!ctx) {
        return res.status(404).json({
          success: false,
          error: "Propiedad no encontrada.",
        });
      }
      if (!(await puedeGestionarPropiedad(req.usuario, ctx))) {
        return res.status(403).json({
          success: false,
          error: "No autorizado para pagar esta propiedad.",
        });
      }
      if (producto.yaAplicado(ctx)) {
        return res.status(409).json({
          success: false,
          error: producto.mensajeYaAplicado,
          data: producto.datosYaAplicado,
        });
      }

      // Intentos viejos sin id de MP dejan de bloquear (se reconcilian antes
      // por external_reference; nunca se marcan como rechazados).
      await expirarIntentosSinOrden();

      // Si hay un pago en curso (doble pestaña, reintento), NO se cobra de
      // nuevo: se devuelve su estado para que el frontend lo retome.
      const enCurso = await pagoEnCurso(producto.tipo, contextoId);
      if (enCurso) {
        return res.status(409).json({
          success: false,
          error: "Ya existe un pago en curso para esta propiedad.",
          data: {
            pago_id: enCurso.id,
            estado: enCurso.estado,
            estado_detalle: enCurso.estado_detalle,
          },
        });
      }

      // Validaciones mínimas del Brick (Checkout API con token).
      if (!token || typeof token !== "string" || token.length > 2000) {
        return res
          .status(400)
          .json({ success: false, error: "token del Brick requerido." });
      }
      if (!payment_method_id) {
        return res
          .status(400)
          .json({ success: false, error: "payment_method_id requerido." });
      }
      // Orders API exige payment_method.type (credit_card | debit_card).
      const tipoTarjeta = String(payment_type ?? "").toLowerCase();
      const tipoNormalizado =
        tipoTarjeta === "debit_card" || tipoTarjeta === "debit"
          ? "debit_card"
          : tipoTarjeta === "credit_card" || tipoTarjeta === "credit"
            ? "credit_card"
            : null;
      if (!tipoNormalizado) {
        return res.status(400).json({
          success: false,
          error: "payment_type requerido (credit_card o debit_card).",
        });
      }
      if (
        !payer?.email ||
        !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(payer.email)
      ) {
        return res
          .status(400)
          .json({ success: false, error: "payer.email requerido." });
      }
      // MP rechaza installments=0/undefined en algunos medios; el cap se hace
      // en el payload del producto.
      if (
        installments !== undefined &&
        !Number.isInteger(Number(installments))
      ) {
        return res
          .status(400)
          .json({ success: false, error: "installments inválido." });
      }

      try {
        const { pago } = await crearPago({
          producto,
          contextoId,
          usuario: req.usuario,
          datos: {
            token,
            payment_method_id,
            payment_type: tipoNormalizado,
            installments,
            payer,
          },
        });

        // Si la orden quedó aprobada (processed+accredited) se activa YA, sin
        // esperar al webhook. Se compara contra el estado local normalizado.
        if (pago?.estado === "approved" && pago?.mp_payment_id) {
          try {
            await sincronizarPago(pago.mp_payment_id);
          } catch (e) {
            console.error("[pagos] activación inmediata falló:", e?.message ?? e);
          }
        }

        const pagoFinal = await ultimoPago(producto.tipo, contextoId);
        const estadoCtx = await producto.estadoPublico(contextoId);

        return res.json({
          success: true,
          data: {
            ...(estadoCtx ?? {}),
            pago_id: pagoFinal?.id ?? pago.id,
            estado: pagoFinal?.estado ?? pago.estado,
            estado_detalle: pagoFinal?.estado_detalle ?? null,
          },
          error: null,
        });
      } catch (errMP) {
        if (errMP instanceof ErrorPago) {
          return res
            .status(errMP.status)
            .json({ success: false, error: errMP.message });
        }
        // Red/timeout/SDK de MP: el registro queda recuperable ('iniciado' + nota).
        console.error("[pagos] crear cobro MP fallo:", errMP?.message ?? errMP);
        return res.status(502).json({
          success: false,
          error:
            "Mercado Pago no respondió. Tu pago quedó registrado como pendiente; reintenta en unos minutos.",
        });
      }
    } catch (error) {
      console.error("Error en iniciarPago:", error.message);
      return res
        .status(500)
        .json({ success: false, error: "Error interno del servidor" });
    }
  },
];

// ────────────────────────────────────────────────────────────────
// GET /pagos/:producto/:contextoId/estado (verificarToken + dueño).
// Reconcilia pagos pendientes (así funciona aunque el webhook no llegue en local).
// ────────────────────────────────────────────────────────────────
export const estadoPago = async (req, res) => {
  try {
    const producto = resolverProducto(req, res);
    if (!producto) return;

    const contextoId = parseInt(req.params.contextoId);
    if (!Number.isInteger(contextoId) || contextoId <= 0) {
      return res
        .status(400)
        .json({ success: false, error: "propiedad_id inválido." });
    }

    const ctx = await producto.cargarContexto(contextoId);
    if (!ctx) {
      return res
        .status(404)
        .json({ success: false, error: "Propiedad no encontrada." });
    }
    if (!(await puedeGestionarPropiedad(req.usuario, ctx))) {
      return res.status(403).json({ success: false, error: "No autorizado." });
    }

    let u = await ultimoPago(producto.tipo, contextoId);

    // Reconciliación perezosa: si lo último está sin confirmar y tiene id de
    // MP, se consulta la orden; si es un intento viejo sin id, se expira
    // (reconciliando antes por external_reference).
    if (u && ["iniciado", "pending", "in_process"].includes(u.estado)) {
      if (u.mp_payment_id) {
        try {
          await sincronizarPago(u.mp_payment_id);
          u = await ultimoPago(producto.tipo, contextoId);
        } catch (e) {
          console.error("[pagos] reconciliar /estado:", e?.message ?? e);
        }
      } else if (u.estado === "iniciado") {
        try {
          await expirarIntentosSinOrden();
          u = await ultimoPago(producto.tipo, contextoId);
        } catch (e) {
          console.error("[pagos] expirar /estado:", e?.message ?? e);
        }
      }
    }

    const estadoCtx = await producto.estadoPublico(contextoId);

    return res.json({
      success: true,
      data: {
        ...(estadoCtx ?? {}),
        ultimo_pago: u
          ? {
              id: u.id,
              estado: u.estado,
              estado_detalle: u.estado_detalle,
              requiere_reembolso: u.requiere_reembolso,
            }
          : null,
      },
      error: null,
    });
  } catch (error) {
    console.error("Error en estadoPago:", error.message);
    return res
      .status(500)
      .json({ success: false, error: "Error interno del servidor" });
  }
};

// ────────────────────────────────────────────────────────────────
// POST /pagos/mp/webhook (SIN verificarToken, fuera del limiter global).
// Verifica la firma x-signature (HMAC-SHA256, template oficial de MP).
// Cuerpo ignorado como fuente de la verdad: se usa data.id y luego
// sincronizarPago consulta la API de MP.
// ────────────────────────────────────────────────────────────────
const webhookLimiter = createRateLimitMiddleware(
  createRateLimiter(120, 60000, 600, (req) => ipReal(req), "mp-webhook"),
);

export const webhookMercadoPago = [
  webhookLimiter,
  async (req, res) => {
    // Doc: la firma se calcula con el data.id de los query params. El body
    // solo se usa como respaldo para localizar la orden a sincronizar.
    const dataIdQuery = req.query?.["data.id"] ?? null;
    const dataIdBody = req.body?.data?.id ?? null;
    const dataId = dataIdQuery ?? dataIdBody;
    const tipo =
      req.body?.type ?? req.query?.type ?? req.query?.topic ?? null;
    const requestId = req.headers?.["x-request-id"] ?? "n/a";
    const logBase = `tipo=${tipo ?? "n/a"} data.id=${dataId ?? "n/a"} x-request-id=${requestId}`;

    try {
      if (!dataId || (tipo && tipo !== "payment" && tipo !== "order")) {
        // Evento no reconocido: 200 para que MP no reintente, no procesamos nada.
        console.log(`[pagos] webhook 200 ignorado ${logBase}`);
        return res.sendStatus(200);
      }

      if (
        !firmaValida({
          headers: req.headers,
          dataId: dataIdQuery,
          secret: MP_WEBHOOK_SECRET,
        })
      ) {
        console.warn(`[pagos] webhook 401 firma_invalida ${logBase}`);
        return res
          .status(401)
          .json({ success: false, error: "Firma inválida." });
      }

      // Responder rápido y procesar: MP reintenta si respondemos distinto de 2xx.
      res.sendStatus(200);
      try {
        // Fuente de verdad: GET /v1/orders/{id}. No se confía en el body.
        const resultado = await sincronizarPago(dataId);
        console.log(
          `[pagos] webhook 200 ${logBase} accion=${resultado?.accion ?? "sin_resultado"}`,
        );
      } catch (e) {
        // devolvimos 200, MP no reintenta; el job de reconciliación pasa igual.
        console.error(
          `[pagos] webhook 200 sync_error ${logBase} error=${e?.message ?? e}`,
        );
      }
    } catch (error) {
      console.error(
        `[pagos] webhook error ${logBase} error=${error?.message ?? error}`,
      );
      // si aún no respondimos, devolver 500 hace que MP reintente más adelante.
      if (!res.headersSent) {
        return res.status(500).json({ success: false });
      }
    }
  },
];

// Aliases de compatibilidad (nombres históricos usados por tests/imports).
export const iniciarPagoUbicacionOculta = iniciarPago;
export const estadoPagoUbicacionOculta = estadoPago;
