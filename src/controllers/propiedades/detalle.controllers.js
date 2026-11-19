// src/controllers/propiedades/detalle.controllers.js — ficha de un inmueble, historial de precios, características, stats y token de vista.
import { pool } from "../../db.js";
import { cacheGet, cacheInvalidate } from "../../lib/redis.js";
import { emitirViewToken } from "../../lib/viewToken.js";
import { aplicarPrivacidadUbicacion } from "../../lib/ubicacion.service.js";
import {
  portadaSubquery,
  portadaPublicIdSubquery,
  ofertasSubquery,
  camposCatalogoSelect,
  joinsCatalogo,
  resolverColumnasPropiedad,
} from "./_comun.js";

// ok
export const getPropiedadesById = async (req, res) => {
  try {
    const { id } = req.params;

    const { selectBase, error } = resolverColumnasPropiedad(req.query.fields);
    if (error) {
      return res.status(400).json({ success: false, error });
    }

    const cacheKey = `propiedad:${id}:${req.query.fields || "default"}`;
    const data = await cacheGet(cacheKey, 30, async () => {
      const { rows } = await pool.query(
        `SELECT 
          ${selectBase},
          p.description_needs_review,
          ${ofertasSubquery("p")},
          ${portadaSubquery("p")},
          ${portadaPublicIdSubquery("p")},
          ${camposCatalogoSelect("p")},
          u.name AS usuario_nombre
        FROM propiedades p
        ${joinsCatalogo("p")}
        JOIN usuarios u 
          ON p.publicado_por_id = u.id
        WHERE p.id = $1`,
        [id],
      );
      const propiedad = rows[0];
      if (!propiedad) {
        return null;
      }

      const { rows: galeria } = await pool.query(
        `SELECT id, url, public_id, orden, tamaño, es_portada
         FROM propiedades_galeria 
         WHERE propiedad_id = $1 
         ORDER BY orden ASC, tamaño ASC`,
        [id],
      );
      const { rows: planos } = await pool.query(
        `SELECT id, url, public_id, orden, tamaño
         FROM propiedades_planos 
         WHERE propiedad_id = $1 
         ORDER BY orden ASC, tamaño ASC`,
        [id],
      );

      // Características N:M activas (agrupadas por categoría)
      const { rows: features } = await pool.query(
        `SELECT fc.id, fc.code, fc.label_es, fc.category, fc.data_type,
                pf.bool_value, pf.numeric_value, pf.text_value
         FROM property_features pf
         JOIN feature_catalog fc ON pf.feature_id = fc.id
         WHERE pf.propiedad_id = $1 AND pf.bool_value = TRUE
         ORDER BY fc.category ASC, fc.id ASC`,
        [id],
      );
      const caracteristicas = features.reduce((acc, fila) => {
        if (!acc[fila.category]) acc[fila.category] = [];
        acc[fila.category].push({
          id: fila.id,
          code: fila.code,
          label_es: fila.label_es,
          data_type: fila.data_type,
        });
        return acc;
      }, {});

      return {
        ...propiedad,
        galeria: galeria || [],
        planos: planos || [],
        caracteristicas,
      };
    });

    if (!data) {
      return res.status(404).json({
        success: false,
        error: "Propiedad no encontrada",
      });
    }

    // PRIVACIDAD DE UBICACIÓN: se aplica FUERA de la caché (la caché guarda el
    // dato real solo en Redis; por request se decide según el usuario).
    await aplicarPrivacidadUbicacion([data], req.usuario);

    res.status(200).json({
      success: true,
      message: "Propiedad obtenida.",
      data,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

// GET /propiedades/:id/historial-precios[?operacion=venta|alquiler]
export const getHistorialPrecios = async (req, res) => {
  const { id } = req.params;
  const { operacion } = req.query;

  if (!id) {
    return res.status(400).json({
      success: false,
      message: "id es requerido",
      data: null,
      error: null,
    });
  }

  try {
    const params = [id];
    let filtroOperacion = "";
    if (operacion) {
      const { rows: opRows } = await pool.query(
        "SELECT id FROM operation_types WHERE LOWER(code) = LOWER($1)",
        [String(operacion)],
      );
      if (opRows.length === 0) {
        return res.status(400).json({
          success: false,
          message: "Operación no válida (venta|alquiler).",
          data: null,
          error: null,
        });
      }
      params.push(opRows[0].id);
      filtroOperacion = `AND ph.operation_type_id = $${params.length}`;
    }
    const { rows } = await pool.query(
      `SELECT ph.id, ph.old_price, ph.new_price, ph.price_change, ph.change_percent,
              ph.change_type, ph.detected_at, ph.source, ph.operation_type_id
       FROM price_history ph
       WHERE ph.propiedad_id = $1 ${filtroOperacion}
       ORDER BY ph.detected_at DESC`,
      params,
    );

    res.json({ success: true, message: null, data: rows, error: null });
  } catch (error) {
    console.error("Error en getHistorialPrecios:", error);
    res.status(500).json({
      success: false,
      message: "Error al obtener historial de precios",
      data: null,
      error: error.message,
    });
  }
};

// GET /propiedades/:id/caracteristicas
// Devuelve las características activas de la propiedad agrupadas por categoría.
export const getPropiedadCaracteristicas = async (req, res) => {
  const { id } = req.params;

  if (!id) {
    return res.status(400).json({
      success: false,
      message: "id es requerido",
      data: null,
      error: null,
    });
  }

  try {
    const { rows } = await pool.query(
      `SELECT fc.id, fc.code, fc.label_es, fc.category, fc.data_type, fc.applies_to,
              pf.bool_value, pf.numeric_value, pf.text_value
       FROM property_features pf
       JOIN feature_catalog fc ON pf.feature_id = fc.id
       WHERE pf.propiedad_id = $1 AND pf.bool_value = TRUE
       ORDER BY fc.category ASC, fc.id ASC`,
      [id],
    );

    const agrupado = rows.reduce((acc, fila) => {
      if (!acc[fila.category]) acc[fila.category] = [];
      acc[fila.category].push({
        id: fila.id,
        code: fila.code,
        label_es: fila.label_es,
        data_type: fila.data_type,
        applies_to: fila.applies_to,
        bool_value: fila.bool_value,
        numeric_value: fila.numeric_value,
        text_value: fila.text_value,
      });
      return acc;
    }, {});

    res.json({ success: true, message: null, data: agrupado, error: null });
  } catch (error) {
    console.error("Error en getPropiedadCaracteristicas:", error);
    res.status(500).json({
      success: false,
      message: "Error al obtener características",
      data: null,
      error: error.message,
    });
  }
};

// POST /propiedades/:id/caracteristicas
// Body: { features: [{ feature_id, bool_value?, numeric_value?, text_value? }] }
// Borra las existentes y reinserta las enviadas.
export const guardarPropiedadCaracteristicas = async (req, res) => {
  const { id } = req.params;
  const { features } = req.body;

  if (!id) {
    return res.status(400).json({
      success: false,
      message: "id es requerido",
      data: null,
      error: null,
    });
  }

  if (!Array.isArray(features)) {
    return res.status(400).json({
      success: false,
      message: "El campo features debe ser un array.",
      data: null,
      error: null,
    });
  }

  try {
    const propiedadResult = await pool.query(
      "SELECT id, publicado_por_id FROM propiedades WHERE id = $1",
      [id],
    );
    if (propiedadResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Propiedad no encontrada",
        data: null,
        error: null,
      });
    }
    if (propiedadResult.rows[0].publicado_por_id !== req.usuario.id) {
      return res.status(403).json({
        success: false,
        message: "No autorizado para modificar esta propiedad.",
        data: null,
        error: null,
      });
    }

    // Fase 4: características solo-rent exigen oferta de alquiler.
    if (features.length > 0) {
      const { rows: rentRows } = await pool.query(
        `SELECT fc.code FROM feature_catalog fc
         WHERE fc.id = ANY($1::int[]) AND fc.applies_to = 'rent'`,
        [features.map((f) => f.feature_id).filter(Boolean)],
      );
      if (rentRows.length > 0) {
        const { rows: alquiler } = await pool.query(
          `SELECT 1 FROM property_listings l
           JOIN operation_types ot ON ot.id = l.operation_type_id
           WHERE l.propiedad_id = $1 AND LOWER(ot.code) = 'alquiler'`,
          [id],
        );
        if (alquiler.length === 0) {
          return res.status(400).json({
            success: false,
            message: `Estas características exigen oferta de alquiler: ${rentRows.map((r) => r.code).join(", ")}.`,
            data: null,
            error: null,
          });
        }
      }
    }

    // 1. Borrar características existentes de esa propiedad
    await pool.query("DELETE FROM property_features WHERE propiedad_id = $1", [
      id,
    ]);

    // 2. Insertar las nuevas
    for (const f of features) {
      if (!f.feature_id) continue;
      await pool.query(
        `INSERT INTO property_features
           (propiedad_id, feature_id, bool_value, numeric_value, text_value)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          id,
          f.feature_id,
          f.bool_value === undefined ? true : f.bool_value,
          f.numeric_value ?? null,
          f.text_value ?? null,
        ],
      );
    }

    await cacheInvalidate("propiedad*");
    res.json({
      success: true,
      message: "Características guardadas.",
      data: { propiedad_id: id, features_guardados: features.length },
      error: null,
    });
  } catch (error) {
    console.error("Error en guardarPropiedadCaracteristicas:", error);
    res.status(500).json({
      success: false,
      message: "Error al guardar características",
      data: null,
      error: error.message,
    });
  }
};

// GET /propiedades/:id/stats — vistas, favoritos y mensajes del anuncio.
// Solo el dueño (o miembro activo de su organización). Las vistas salen del
// resumen diario del algoritmo de vista de detalle (vistas_log es la fuente
// de verdad; el funnel legacy de eventos_tracking sigue intacto pero ya no
// alimenta este contador: ahora excluye internos, bots y duplicados).
export const getPropiedadStats = async (req, res) => {
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
    const { rows: propRows } = await pool.query(
      `SELECT p.id FROM propiedades p
        WHERE p.id = $1
          AND (p.publicado_por_id = $2
            OR p.organizacion_id IN (
              SELECT organizacion_id FROM organizacion_miembros
              WHERE usuario_id = $2 AND estado = 'activo'
            ))`,
      [id, req.usuario.id],
    );
    if (propRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Propiedad no encontrada o sin permiso.",
        data: null,
        error: null,
      });
    }

    const [{ rows: vistas }, { rows: favs }, { rows: leads }] =
      await Promise.all([
        pool.query(
          `SELECT COALESCE(SUM(vistas), 0)::int AS total,
                  COALESCE(SUM(visitantes_unicos), 0)::int AS unicos
           FROM vistas_resumen_diario
           WHERE propiedad_id = $1`,
          [id],
        ),
        pool.query(
          `SELECT COUNT(*)::int AS total FROM usuario_favoritos
           WHERE propiedad_id = $1`,
          [id],
        ),
        pool.query(
          `SELECT COUNT(*)::int AS total FROM leads WHERE propiedad_id = $1`,
          [id],
        ),
      ]);

    res.json({
      success: true,
      message: null,
      data: {
        propiedad_id: Number(id),
        vistas: vistas[0]?.total ?? 0,
        visitantes_unicos: vistas[0]?.unicos ?? 0,
        favoritos: favs[0]?.total ?? 0,
        mensajes: leads[0]?.total ?? 0,
      },
      error: null,
    });
  } catch (error) {
    console.error("Error en getPropiedadStats:", error);
    res.status(500).json({
      success: false,
      message: "Error al obtener estadísticas",
      data: null,
      error: error.message,
    });
  }
};

// Token de ficha para medición de vistas (algoritmo de vista de detalle, Fase 3).
// Ruta pública con rate-limit: prueba que la ficha se cargó y ata el evento al inmueble.
// La verificación (firma, vigencia, uso único) la hace el tracking-service en Rust.
export const emitirTokenVista = async (req, res) => {
  const { id } = req.params;
  const pid = parseInt(id);
  if (!id || isNaN(pid)) {
    return res.status(400).json({
      success: false,
      message: "ID de propiedad inválido o requerido",
      data: null,
      error: null,
    });
  }
  try {
    const { token, expires_at } = emitirViewToken(pid);
    return res.json({
      success: true,
      message: "Token de vista generado.",
      data: { view_token: token, expires_at },
      error: null,
    });
  } catch (e) {
    if (e.message === "VIEW_TOKEN_SECRET no configurado") {
      return res.status(500).json({
        success: false,
        message: "Medición de vistas no configurada.",
        data: null,
        error: null,
      });
    }
    return res.status(400).json({
      success: false,
      message: e.message,
      data: null,
      error: null,
    });
  }
};
