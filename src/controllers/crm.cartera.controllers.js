// src/controllers/crm.cartera.controllers.js — gestión avanzada de la cartera:
// acciones masivas, duplicar un anuncio y rendimiento por inmueble.
//
// Un inmueble se puede tocar si es visible en el CRM del espacio
// (wherePropiedadesVisibles) Y el usuario puede gestionarlo
// (puedeGestionarPropiedad: dueño o agency_admin de la org).
import { z } from "zod";
import { pool } from "../db.js";
import { cacheInvalidate } from "../lib/redis.js";
import { wherePropiedadesVisibles, whereEspacioPropio } from "../lib/crmPermisos.js";
import { puedeGestionarPropiedad } from "../lib/propiedadPermisos.js";
import { noEncontrado, prohibido } from "../lib/errores.js";
import { demandasParaPropiedad } from "../lib/demandas/cruce.js";
import { validar } from "../validations/visita.schema.js";

const esId = (v) => /^\d+$/.test(String(v));

async function propiedadGestionable(req, id) {
  if (!esId(id)) throw noEncontrado("Inmueble no encontrado.");
  const vis = wherePropiedadesVisibles(req.crm, "p");
  const { rows } = await pool.query(
    `SELECT p.id, p.titulo, p.estado, p.publicado_por_id, p.organizacion_id, p.created_at, p.published_at
     FROM propiedades p WHERE p.id = $${vis.nextIndex} AND ${vis.where}`,
    [...vis.params, id],
  );
  if (!rows[0]) throw noEncontrado("Inmueble no encontrado.");
  return rows[0];
}

// ── POST /crm/propiedades/acciones ───────────────────────────────
// { ids: [..], accion: "publicar" | "pausar" } → { actualizados, omitidos }
const accionesSchema = z
  .object({
    ids: z.array(z.coerce.number().int().positive()).min(1).max(100).transform((a) => [...new Set(a)]),
    accion: z.enum(["publicar", "pausar"], { message: "Acción no válida." }),
  })
  .strict();

export const accionesMasivas = async (req, res) => {
  const { ids, accion } = validar(accionesSchema, req.body);
  const vis = wherePropiedadesVisibles(req.crm, "p");
  const { rows } = await pool.query(
    `SELECT p.id, p.estado, p.publicado_por_id, p.organizacion_id
     FROM propiedades p WHERE p.id = ANY($${vis.nextIndex}::int[]) AND ${vis.where}`,
    [...vis.params, ids],
  );
  const porId = new Map(rows.map((r) => [r.id, r]));
  const nuevoEstado = accion === "publicar" ? "publicado" : "no_publicado";
  const permitidos = [];
  const omitidos = [];
  for (const id of ids) {
    const p = porId.get(id);
    if (!p) omitidos.push({ id, motivo: "No encontrado en este espacio." });
    else if (!(await puedeGestionarPropiedad(req.usuario, p))) omitidos.push({ id, motivo: "Sin permiso." });
    else if (p.estado === nuevoEstado) omitidos.push({ id, motivo: "Ya estaba así." });
    else permitidos.push(id);
  }
  if (permitidos.length) {
    await pool.query("UPDATE propiedades SET estado = $1 WHERE id = ANY($2::int[])", [nuevoEstado, permitidos]);
    await cacheInvalidate("propiedad*");
  }
  res.json({
    success: true,
    message: `${permitidos.length} ${permitidos.length === 1 ? "inmueble actualizado" : "inmuebles actualizados"}.`,
    data: { actualizados: permitidos, omitidos },
  });
};

// Columnas que NO se copian al duplicar: identidad, fechas, estado de
// publicación y la ubicación oculta (es un producto pagado del anuncio).
const NO_COPIAR = new Set([
  "id", "geom", "estado", "published_at", "expires_at", "created_at", "updated_at",
  "description_needs_review", "ubicacion_oculta", "ubicacion_oculta_at",
  "ubicacion_oculta_solicitada", "latitude_publica", "longitude_publica", "geom_publica",
  "publicado_por_id", "titulo",
]);
let columnasCopiables = null;
async function columnasPropiedad(client) {
  if (columnasCopiables) return columnasCopiables;
  const { rows } = await client.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'propiedades' AND table_schema = current_schema() AND is_generated = 'NEVER'
     ORDER BY ordinal_position`,
  );
  // Nombres de columna del catálogo de PostgreSQL: se citan con comillas dobles.
  columnasCopiables = rows.map((r) => r.column_name).filter((c) => !NO_COPIAR.has(c) && /^[a-z_]+$/.test(c));
  return columnasCopiables;
}

// ── POST /crm/propiedades/:id/duplicar ───────────────────────────
// Copia datos, ofertas y características (no fotos, planos, métricas ni
// captación). La copia queda NO publicada, a nombre de quien duplica.
export const duplicarPropiedad = async (req, res) => {
  const original = await propiedadGestionable(req, req.params.id);
  if (!(await puedeGestionarPropiedad(req.usuario, original))) {
    throw prohibido("No puedes gestionar este inmueble.");
  }
  const client = await pool.connect();
  let nuevoId;
  try {
    await client.query("BEGIN");
    const cols = (await columnasPropiedad(client)).map((c) => `"${c}"`).join(", ");
    const { rows } = await client.query(
      `INSERT INTO propiedades (${cols}, titulo, estado, publicado_por_id)
       SELECT ${cols}, LEFT(titulo || ' (copia)', 500), 'no_publicado', $2
       FROM propiedades WHERE id = $1
       RETURNING id`,
      [original.id, req.usuario.id],
    );
    nuevoId = rows[0].id;
    await client.query(
      `INSERT INTO property_listings
         (propiedad_id, operation_type_id, precio, price_per_sqm, rental_type_id, parking_space_price, listing_status)
       SELECT $2, operation_type_id, precio, price_per_sqm, rental_type_id, parking_space_price,
              CASE WHEN listing_status IN ('sold', 'rented', 'expired') THEN 'active' ELSE listing_status END
       FROM property_listings WHERE propiedad_id = $1`,
      [original.id, nuevoId],
    );
    await client.query(
      `INSERT INTO property_features (propiedad_id, feature_id, bool_value, numeric_value, text_value)
       SELECT $2, feature_id, bool_value, numeric_value, text_value
       FROM property_features WHERE propiedad_id = $1`,
      [original.id, nuevoId],
    );
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  res.status(201).json({
    success: true,
    message: "Anuncio duplicado sin publicar. Agrega las fotos y publícalo.",
    data: { id: nuevoId },
  });
};

// ── GET /crm/propiedades/:id/rendimiento ─────────────────────────
// Vistas por día (30 días, Bogotá), favoritos, leads, visitas, interesados,
// envíos a clientes e historial de precio.
export const rendimientoPropiedad = async (req, res) => {
  const p = await propiedadGestionable(req, req.params.id);
  const [serie, totales, leads, visitas, enviados, precios] = await Promise.all([
    pool.query(
      `SELECT to_char(d::date, 'YYYY-MM-DD') AS fecha,
              COALESCE(v.vistas, 0)::int AS vistas, COALESCE(v.visitantes_unicos, 0)::int AS visitantes
       FROM generate_series((now() AT TIME ZONE 'America/Bogota')::date - 29,
                            (now() AT TIME ZONE 'America/Bogota')::date, interval '1 day') d
       LEFT JOIN vistas_resumen_diario v ON v.propiedad_id = $1 AND v.fecha_local = d::date
       ORDER BY d`,
      [p.id],
    ),
    pool.query(
      `SELECT (SELECT COALESCE(SUM(vistas), 0)::int FROM vistas_resumen_diario WHERE propiedad_id = $1) AS vistas,
              (SELECT COALESCE(SUM(visitantes_unicos), 0)::int FROM vistas_resumen_diario WHERE propiedad_id = $1) AS visitantes,
              (SELECT COUNT(*)::int FROM usuario_favoritos WHERE propiedad_id = $1) AS favoritos,
              (SELECT COUNT(*)::int FROM usuario_descartados WHERE propiedad_id = $1) AS descartes`,
      [p.id],
    ),
    pool.query(
      "SELECT estado, COUNT(*)::int AS total FROM leads WHERE propiedad_id = $1 GROUP BY estado",
      [p.id],
    ),
    (() => {
      const base = whereEspacioPropio(req.crm, "v");
      return pool.query(
        `SELECT v.estado, COUNT(*)::int AS total FROM crm_visitas v
         WHERE v.propiedad_id = $${base.nextIndex} AND ${base.where} GROUP BY v.estado`,
        [...base.params, p.id],
      );
    })(),
    pool.query(
      `SELECT COUNT(*) FILTER (WHERE estado = 'enviada')::int AS enviada,
              COUNT(*) FILTER (WHERE estado = 'descartada')::int AS descartada
       FROM crm_demanda_propiedades WHERE propiedad_id = $1`,
      [p.id],
    ),
    pool.query(
      `SELECT old_price, new_price, change_percent, detected_at
       FROM price_history WHERE propiedad_id = $1 ORDER BY detected_at DESC LIMIT 5`,
      [p.id],
    ),
  ]);
  const interesados = await demandasParaPropiedad(pool, p.id, whereEspacioPropio(req.crm, "d"));
  const desde = p.published_at ?? p.created_at;
  res.json({
    success: true,
    data: {
      id: p.id,
      titulo: p.titulo,
      estado: p.estado,
      dias_en_cartera: Math.max(0, Math.floor((Date.now() - new Date(desde)) / 86400000)),
      totales: totales.rows[0],
      serie_vistas: serie.rows,
      leads: Object.fromEntries(leads.rows.map((r) => [r.estado, r.total])),
      visitas: Object.fromEntries(visitas.rows.map((r) => [r.estado, r.total])),
      demandas: { interesadas: interesados.length, ...enviados.rows[0] },
      historial_precio: precios.rows,
    },
  });
};
