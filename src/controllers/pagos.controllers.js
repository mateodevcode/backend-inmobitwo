// src/controllers/pagos.controllers.js
// Endpoints de pagos Mercado Pago (Colombia): config, inicio del cobro,
// consulta de estado y webhook con verificación de firma x-signature.

import crypto from "crypto";
import { pool } from "../db.js";
import {
  pagosConfigPublica,
  crearPagoUbicacionOculta,
  sincronizarPago,
  pagoEnCurso,
  ultimoPago,
  ErrorPago,
} from "../lib/pagos.service.js";
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
// POST /pagos/ubicacion-oculta (verificarToken): inicia el cobro.
// Body: propiedad_id, token, payment_method_id, installments, issuer_id?,
//       payer: { email, identification }.
// El MONTO JAMÁS se acepta del body; sale de la config del servidor.
// limiter: 5 inicios por usuario cada 10 min (anti card-testing).
// ────────────────────────────────────────────────────────────────
const pagoInicioLimiter = createRateLimitMiddleware(
  createRateLimiter(5, 10 * 60000, 5, (req) => ipReal(req), "pago-inicio"),
);

export const iniciarPagoUbicacionOculta = [pagoInicioLimiter, async (req, res) => {
  try {
    const { propiedad_id, token, payment_method_id, installments, issuer_id, payer } =
      req.body ?? {};

    const propiedadId = parseInt(propiedad_id);
    if (!Number.isInteger(propiedadId) || propiedadId <= 0) {
      return res.status(400).json({
        success: false,
        error: "propiedad_id inválido.",
      });
    }

    // La propiedad debe pertenecer al usuario (dueño, agency_admin o superadmin).
    const { rows: propRows } = await pool.query(
      `SELECT id, publicado_por_id, organizacion_id, ubicacion_oculta
       FROM propiedades WHERE id = $1`,
      [propiedadId],
    );
    const propiedad = propRows[0];
    if (!propiedad) {
      return res.status(404).json({ success: false, error: "Propiedad no encontrada." });
    }
    if (!(await puedeGestionarPropiedad(req.usuario, propiedad))) {
      return res.status(403).json({
        success: false,
        error: "No autorizado para pagar esta propiedad.",
      });
    }
    if (propiedad.ubicacion_oculta) {
      return res.status(409).json({
        success: false,
        error: "Esta propiedad ya tiene la ubicación oculta.",
        data: { ubicacion_oculta: true },
      });
    }

    // Si hay un pago en curso (doble pestaña, reintento), NO se cobra de nuevo:
    // se devuelve su estado para que el frontend lo retome.
    const enCurso = await pagoEnCurso(propiedadId);
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
      return res.status(400).json({ success: false, error: "token del Brick requerido." });
    }
    if (!payment_method_id) {
      return res.status(400).json({ success: false, error: "payment_method_id requerido." });
    }
    if (!payer?.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(payer.email)) {
      return res.status(400).json({ success: false, error: "payer.email requerido." });
    }
    // mp rejecta installments=0/undefined en algunos medios; el cap se hace en el service.
    if (installments !== undefined && !Number.isInteger(Number(installments))) {
      return res.status(400).json({ success: false, error: "installments inválido." });
    }

    try {
      const { pago, respuesta } = await crearPagoUbicacionOculta({
        propiedad,
        usuario: req.usuario,
        datos: { token, payment_method_id, installments, issuer_id, payer },
      });

      // approved → podría aplicarse instantáneo (webhook asíncrono también llega);
      // por robustez: si el create devolvió approved, verificar/activar YA.
      if (respuesta?.status === "approved" && respuesta?.id) {
        try {
          await sincronizarPago(respuesta.id);
        } catch (e) {
          console.error("[pagos] activación inmediata falló:", e?.message ?? e);
        }
      }

      const pagoFinal = await ultimoPago(propiedadId);
      const { rows: propFinal } = await pool.query(
        "SELECT ubicacion_oculta FROM propiedades WHERE id = $1",
        [propiedadId],
      );

      return res.json({
        success: true,
        data: {
          pago_id: pagoFinal?.id ?? pago.id,
          estado: pagoFinal?.estado ?? pago.estado,
          estado_detalle: pagoFinal?.estado_detalle ?? null,
          ubicacion_oculta: propFinal[0]?.ubicacion_oculta ?? false,
        },
        error: null,
      });
    } catch (errMP) {
      if (errMP instanceof ErrorPago) {
        return res.status(errMP.status).json({ success: false, error: errMP.message });
      }
      // Red/timeout/SDK de MP: el registro queda recuperable ('iniciado' + nota).
      console.error("[pagos] crear cobro MP fallo:", errMP?.message ?? errMP);
      return res.status(502).json({
        success: false,
        error: "Mercado Pago no respondió. Tu pago quedó registrado como pendiente; reintenta en unos minutos.",
      });
    }
  } catch (error) {
    console.error("Error en iniciarPagoUbicacionOculta:", error.message);
    return res.status(500).json({ success: false, error: "Error interno del servidor" });
  }
}];

// ────────────────────────────────────────────────────────────────
// GET /pagos/ubicacion-oculta/:propiedadId/estado (verificarToken + dueño).
// Reconcilia pagos pendientes (así funciona aunque el webhook no llegue en local).
// ────────────────────────────────────────────────────────────────
export const estadoPagoUbicacionOculta = async (req, res) => {
  try {
    const propiedadId = parseInt(req.params.propiedadId);
    if (!Number.isInteger(propiedadId) || propiedadId <= 0) {
      return res.status(400).json({ success: false, error: "propiedad_id inválido." });
    }

    const { rows: propRows } = await pool.query(
      `SELECT id, publicado_por_id, organizacion_id, ubicacion_oculta
       FROM propiedades WHERE id = $1`,
      [propiedadId],
    );
    const propiedad = propRows[0];
    if (!propiedad) {
      return res.status(404).json({ success: false, error: "Propiedad no encontrada." });
    }
    if (!(await puedeGestionarPropiedad(req.usuario, propiedad))) {
      return res.status(403).json({ success: false, error: "No autorizado." });
    }

    let u = await ultimoPago(propiedadId);

    // Reconciliación perezosa: si lo último está sin confirmar y tiene mp id.
    if (u && ['iniciado', 'pending', 'in_process'].includes(u.estado) && u.mp_payment_id) {
      try {
        const { pago } = await sincronizarPago(u.mp_payment_id);
        if (!pago || pago !== undefined) u = await ultimoPago(propiedadId);
      } catch (e) {
        console.error("[pagos] reconciliar /estado:", e?.message ?? e);
      }
    }

    const { rows: propFinal } = await pool.query(
      "SELECT ubicacion_oculta, ubicacion_oculta_at FROM propiedades WHERE id = $1",
      [propiedadId],
    );

    return res.json({
      success: true,
      data: {
        ubicacion_oculta: propFinal[0]?.ubicacion_oculta ?? false,
        ubicacion_oculta_at: propFinal[0]?.ubicacion_oculta_at ?? null,
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
    console.error("Error en estadoPagoUbicacionOculta:", error.message);
    return res.status(500).json({ success: false, error: "Error interno del servidor" });
  }
};

// ────────────────────────────────────────────────────────────────
// POST /pagos/mp/webhook (SIN verificarToken, fuera del limiter global).
// Verifica la firma x-signature (HMAC-SHA256, template oficial de MP):
//   data = "id:<data.id>;request-id:<x-request-id>;ts:<ts>;"
//   v1 = HMAC_SHA256(MP_WEBHOOK_SECRET, data)
// Comparación en tiempo constante. Cuerpo ignorado como fuente de la verdad:
// se usa data.id y luego sincronizarPago consulta la API de MP.
// ────────────────────────────────────────────────────────────────
const webhookLimiter = createRateLimitMiddleware(
  createRateLimiter(120, 60000, 600, (req) => ipReal(req), "mp-webhook"),
);

// Extrae "v1" de los distintos formatos de x-signature.
function extraerV1(firma) {
  if (!firma) return null;
  const m = String(firma).match(/v1=([A-Za-z0-9]+)(,|$)/);
  const f2 = String(firma).match(/^\s*(?:v1=)?([A-Fa-f0-9]+)\s*$/);
  return m?.[1] ?? f2?.[1] ?? null;
}

function firmaValida(req, dataId) {
  if (!MP_WEBHOOK_SECRET) {
    console.error("[pagos] webhook sin MP_WEBHOOK_SECRET configurado → 401");
    return false;
  }
  const firma = extraerV1(req.headers["x-signature"]);
  const ts = req.headers["x-signature"]?.match(/ts=(\d+)/)?.[1];
  const requestId = req.headers["x-request-id"];
  if (!firma || !ts || !requestId || !dataId) return false;

  const data = `id:${dataId};request-id:${requestId};ts:${ts};`;
  const calculado = crypto
    .createHmac("sha256", MP_WEBHOOK_SECRET)
    .update(data)
    .digest("hex");
  const a = Buffer.from(calculado, "utf8");
  const b = Buffer.from(String(firma), "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export const webhookMercadoPago = [webhookLimiter, async (req, res) => {
  try {
    // data.id puede venir en el body (formato nuevo) o en la query (formato viejo).
    const dataId =
      req.body?.data?.id ?? req.query?.["data.id"] ?? req.query?.id ?? null;
    const tipo = req.body?.type ?? req.query?.topic ?? null;

    if (!dataId || (tipo && tipo !== "payment")) {
      // Evento no reconocido: 200 para que MP no reintente, no procesamos nada.
      return res.sendStatus(200);
    }

    if (!firmaValida(req, String(dataId))) {
      return res.status(401).json({ success: false, error: "Firma inválida." });
    }

    // Responder rápido y procesar: MP reintenta si respondemos distinto de 2xx.
    res.sendStatus(200);
    try {
      await sincronizarPago(Number(dataId));
    } catch (e) {
      // devolvimos 200, MP no reintenta; el job de reconciliación pasa por aquí igual.
      console.error(`[pagos] webhook sync ${dataId}:`, e?.message ?? e);
    }
  } catch (error) {
    console.error("Error en webhookMercadoPago:", error.message);
    // si aún no respondimos, devolver 500 hace que MP reintente más adelante.
    if (!res.headersSent) {
      return res.status(500).json({ success: false });
    }
  }
}];
