// src/controllers/propiedades/ofertas.controllers.js — ofertas por operación (venta/arriendo) y cambio de operación.
import { pool } from "../../db.js";
import { cacheInvalidate } from "../../lib/redis.js";
import {
  HttpError,
  actualizarOferta,
  cambiarOperacion,
  crearOferta,
  obtenerOfertas,
  quitarOferta,
  verificarPropiedad,
} from "../../lib/ofertas.service.js";

// ============================================================================
// OFERTAS POR OPERACIÓN (rutas :id/ofertas y :id/cambiar-operacion)
// Cada handler abre su transacción; el servicio recibe el client.
// ============================================================================

async function conTransaccion(res, fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const data = await fn(client);
    await client.query("COMMIT");
    await cacheInvalidate("propiedad*");
    return res.status(200).json({
      success: true,
      message: data.message || "Operación realizada correctamente.",
      data: data.payload ?? null,
      error: null,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    if (error instanceof HttpError) {
      return res.status(error.status).json({
        success: false,
        message: null,
        data: null,
        error: error.error,
      });
    }
    console.error("❌ Error en ofertas:", error);
    return res.status(500).json({
      success: false,
      message: null,
      data: null,
      error: "Error interno del servidor.",
    });
  } finally {
    client.release();
  }
}

// GET /propiedades/:id/ofertas — solo lectura (sin transacción de escritura)
export const getOfertasPropiedad = async (req, res) => {
  const { id } = req.params;
  if (!id || isNaN(parseInt(id))) {
    return res.status(400).json({
      success: false,
      message: "ID de propiedad inválido o requerido",
      data: null,
      error: null,
    });
  }
  try {
    await verificarPropiedad(pool, id, req.usuario.id);
    const ofertas = await obtenerOfertas(pool, id);
    return res.json({ success: true, message: null, data: ofertas, error: null });
  } catch (error) {
    if (error instanceof HttpError) {
      return res.status(error.status).json({
        success: false,
        message: null,
        data: null,
        error: error.error,
      });
    }
    console.error("Error en getOfertasPropiedad:", error);
    return res.status(500).json({
      success: false,
      message: "Error al obtener ofertas",
      data: null,
      error: error.message,
    });
  }
};

// PUT /propiedades/:id/ofertas/:operacion — upsert (crea si no existe)
export const upsertOfertaPropiedad = async (req, res) => {
  const { id, operacion } = req.params;
  if (!id || isNaN(parseInt(id))) {
    return res.status(400).json({
      success: false,
      message: "ID de propiedad inválido o requerido",
      data: null,
      error: null,
    });
  }
  return conTransaccion(res, async (client) => {
    const { rows: existentes } = await client.query(
      `SELECT l.id FROM property_listings l
       JOIN operation_types ot ON ot.id = l.operation_type_id
       WHERE l.propiedad_id = $1 AND LOWER(ot.code) = LOWER($2)`,
      [id, operacion],
    );
    if (existentes.length > 0) {
      const payload = await actualizarOferta(client, {
        propiedadId: id,
        operation: operacion,
        datos: req.body || {},
        usuarioId: req.usuario.id,
      });
      return { message: "Oferta actualizada correctamente.", payload };
    }
    const payload = await crearOferta(client, {
      propiedadId: id,
      operation: operacion,
      datos: req.body || {},
      usuarioId: req.usuario.id,
    });
    return { message: "Oferta creada correctamente.", payload };
  });
};

// DELETE /propiedades/:id/ofertas/:operacion
export const eliminarOfertaPropiedad = async (req, res) => {
  const { id, operacion } = req.params;
  if (!id || isNaN(parseInt(id))) {
    return res.status(400).json({
      success: false,
      message: "ID de propiedad inválido o requerido",
      data: null,
      error: null,
    });
  }
  return conTransaccion(res, async (client) => {
    const payload = await quitarOferta(client, {
      propiedadId: id,
      operation: operacion,
      usuarioId: req.usuario.id,
    });
    return { message: "Oferta eliminada correctamente.", payload };
  });
};

// POST /propiedades/:id/cambiar-operacion — { desde, hacia, datos }
export const cambiarOperacionPropiedad = async (req, res) => {
  const { id } = req.params;
  if (!id || isNaN(parseInt(id))) {
    return res.status(400).json({
      success: false,
      message: "ID de propiedad inválido o requerido",
      data: null,
      error: null,
    });
  }
  const { desde, hacia, datos } = req.body || {};
  return conTransaccion(res, async (client) => {
    const payload = await cambiarOperacion(client, {
      propiedadId: id,
      desde,
      hacia,
      datos: datos || {},
      usuarioId: req.usuario.id,
    });
    return { message: "Operación cambiada correctamente.", payload };
  });
};
