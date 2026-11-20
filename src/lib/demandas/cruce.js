// src/lib/demandas/cruce.js — motor de cruce demanda ↔ inmuebles.
//
// Un inmueble coincide con una demanda si tiene una oferta ACTIVA de la
// operación pedida (una oferta "alquiler_venta" vale para venta y alquiler)
// y cumple todos los filtros que la demanda tenga definidos. Un filtro vacío
// (array vacío o null) no restringe.
//
// Precio: se acepta hasta un 10 % por encima del máximo (el agente puede
// negociar) y se marca con `sobre_presupuesto = true`.
//
// Alcance:
//   cartera → inmuebles del espacio (personal: míos sin org; org: de la org),
//             publicados o no.
//   portal  → cualquier inmueble publicado en el portal. Solo datos públicos y
//             sin dirección si el dueño ocultó la ubicación.
//
// Todo valor va parametrizado; las únicas piezas interpoladas son constantes.

export const TOLERANCIA_PRECIO = 1.1;
export const ALCANCES = ["cartera", "portal"];

// Ids de operation_types que satisfacen la operación pedida. Se resuelven por
// code en SQL para no hardcodear ids.
const SQL_OPERACIONES_OK = `
  (SELECT ot.id FROM operation_types ot
   WHERE ot.id = d.operation_type_id
      OR (ot.code = 'alquiler_venta'
          AND (SELECT code FROM operation_types WHERE id = d.operation_type_id) IN ('venta', 'alquiler')))`;

// Condiciones del cruce sobre p (propiedades) y l (oferta) contra d (demanda).
const CONDICIONES_CRUCE = `
  l.operation_type_id IN ${SQL_OPERACIONES_OK}
  AND (cardinality(d.property_type_ids) = 0 OR p.property_type_id = ANY(d.property_type_ids))
  AND (cardinality(d.city_ids) = 0 OR p.city_id = ANY(d.city_ids))
  AND (cardinality(d.barrio_ids) = 0 OR p.barrio_id = ANY(d.barrio_ids))
  AND (cardinality(d.estratos) = 0 OR p.estrato = ANY(d.estratos))
  AND (d.precio_min IS NULL OR l.precio >= d.precio_min)
  AND (d.precio_max IS NULL OR l.precio <= d.precio_max * ${TOLERANCIA_PRECIO})
  AND (d.habitaciones_min IS NULL OR p.bedroom_count >= d.habitaciones_min)
  AND (d.banos_min IS NULL OR p.bathroom_count >= d.banos_min)
  AND (d.parqueaderos_min IS NULL OR COALESCE(p.parking_space_count, 0) >= d.parqueaderos_min)
  AND (d.area_min IS NULL OR p.constructed_area >= d.area_min)
  AND (d.area_max IS NULL OR p.constructed_area <= d.area_max)`;

// Foto principal (tamaño medium) del inmueble.
const SQL_FOTO = `
  (SELECT pg.url FROM propiedades_galeria pg
   WHERE pg.propiedad_id = p.id AND pg.es_portada = true AND pg.tamaño = 'medium'
   LIMIT 1)`;

// WHERE del alcance. $1 = id del dueño del espacio (usuario u organización).
function whereAlcance(alcance, crm) {
  if (alcance === "portal") return { sql: "p.estado = 'publicado'", params: [] };
  return crm.tipo === "personal"
    ? { sql: "p.publicado_por_id = $1 AND p.organizacion_id IS NULL", params: [crm.usuarioId] }
    : { sql: "p.organizacion_id = $1", params: [crm.organizacionId] };
}

/**
 * Inmuebles que coinciden con una demanda.
 * @param db       pool o client de pg
 * @param demandaId id de la demanda (ya validada en el espacio)
 * @param crm      espacio activo ({ tipo, usuarioId, organizacionId })
 * @param opts     { alcance, incluirDescartadas, soloNuevas, limite }
 */
export async function buscarCoincidencias(db, demandaId, crm, opts = {}) {
  const alcance = ALCANCES.includes(opts.alcance) ? opts.alcance : "cartera";
  const limite = Math.min(Math.max(Number(opts.limite) || 50, 1), 200);
  const a = whereAlcance(alcance, crm);
  const params = [...a.params, demandaId];
  const iDemanda = params.length;
  const extra = [];
  if (!opts.incluirDescartadas) extra.push("COALESCE(dp.estado, '') <> 'descartada'");
  if (opts.soloNuevas) extra.push("p.created_at > d.coincidencias_vistas_at");
  // En el portal no se muestran los inmuebles propios: ya salen en "cartera".
  let sinPropios = "";
  if (alcance === "portal") {
    params.push(crm.tipo === "personal" ? crm.usuarioId : crm.organizacionId);
    sinPropios =
      crm.tipo === "personal"
        ? `AND NOT (p.publicado_por_id = $${params.length} AND p.organizacion_id IS NULL)`
        : `AND p.organizacion_id IS DISTINCT FROM $${params.length}`;
  }

  const ubicacion =
    alcance === "portal"
      ? "CASE WHEN p.ubicacion_oculta THEN NULL ELSE p.direccion END"
      : "p.direccion";

  const { rows } = await db.query(
    `SELECT DISTINCT ON (p.id)
            p.id, p.titulo, ${ubicacion} AS direccion, p.barrio_nombre,
            ci.name AS ciudad, pt.label_es AS tipo, p.estrato,
            p.bedroom_count AS habitaciones, p.bathroom_count AS banos,
            p.parking_space_count AS parqueaderos, p.constructed_area AS area,
            p.estado, l.precio, ot.code AS operacion,
            (d.precio_max IS NOT NULL AND l.precio > d.precio_max) AS sobre_presupuesto,
            (p.created_at > d.coincidencias_vistas_at) AS nueva,
            dp.estado AS seguimiento,
            p.created_at,
            ${SQL_FOTO} AS foto,
            ${alcance === "portal" ? "o.nombre" : "NULL"} AS inmobiliaria
     FROM crm_demandas d
     JOIN propiedades p ON ${a.sql} ${sinPropios}
     JOIN property_listings l ON l.propiedad_id = p.id AND l.listing_status = 'active'
     JOIN operation_types ot ON ot.id = l.operation_type_id
     LEFT JOIN cities ci ON ci.id = p.city_id
     LEFT JOIN property_types pt ON pt.id = p.property_type_id
     LEFT JOIN organizaciones o ON o.id = p.organizacion_id
     LEFT JOIN crm_demanda_propiedades dp ON dp.demanda_id = d.id AND dp.propiedad_id = p.id
     WHERE d.id = $${iDemanda}
       AND ${CONDICIONES_CRUCE}
       ${extra.length ? `AND ${extra.join(" AND ")}` : ""}
     ORDER BY p.id, l.precio`,
    params,
  );

  // Orden final: nuevas primero, luego dentro de presupuesto, luego más recientes.
  return rows
    .sort(
      (x, y) =>
        Number(y.nueva) - Number(x.nueva) ||
        Number(x.sobre_presupuesto) - Number(y.sobre_presupuesto) ||
        new Date(y.created_at) - new Date(x.created_at),
    )
    .slice(0, limite);
}

/**
 * Demandas activas del espacio que coinciden con un inmueble ("¿a quién se lo
 * ofrezco?"). Usa las mismas condiciones que buscarCoincidencias.
 */
export async function demandasParaPropiedad(db, propiedadId, whereEspacio) {
  const { rows } = await db.query(
    `SELECT DISTINCT ON (d.id)
            d.id, d.contacto_id, c.nombre AS contacto_nombre, c.telefono AS contacto_telefono,
            d.precio_min, d.precio_max, d.estado, l.precio,
            (d.precio_max IS NOT NULL AND l.precio > d.precio_max) AS sobre_presupuesto,
            dp.estado AS seguimiento, u.name AS agente_nombre
     FROM crm_demandas d
     JOIN crm_contactos c ON c.id = d.contacto_id AND c.archivado_at IS NULL
     JOIN propiedades p ON p.id = $${whereEspacio.nextIndex}
     JOIN property_listings l ON l.propiedad_id = p.id AND l.listing_status = 'active'
     LEFT JOIN crm_demanda_propiedades dp ON dp.demanda_id = d.id AND dp.propiedad_id = p.id
     LEFT JOIN usuarios u ON u.id = d.asignado_a_id
     WHERE ${whereEspacio.where}
       AND d.estado = 'activa'
       AND ${CONDICIONES_CRUCE}
     ORDER BY d.id, l.precio`,
    [...whereEspacio.params, propiedadId],
  );
  return rows;
}

/**
 * Para el aviso diario: demandas activas con aviso que tienen inmuebles de su
 * cartera creados después de la última notificación. Devuelve una fila por
 * demanda con el total de nuevos.
 */
export async function demandasConNovedades(db) {
  const { rows } = await db.query(
    `SELECT d.id, d.contacto_id, c.nombre AS contacto_nombre,
            u.name AS agente_nombre, u.email AS agente_email,
            COUNT(DISTINCT p.id)::int AS nuevos,
            (array_agg(DISTINCT p.titulo))[1:3] AS ejemplos
     FROM crm_demandas d
     JOIN crm_contactos c ON c.id = d.contacto_id AND c.archivado_at IS NULL
     JOIN usuarios u ON u.id = d.asignado_a_id
     JOIN propiedades p ON (
           (d.usuario_id IS NOT NULL AND p.publicado_por_id = d.usuario_id AND p.organizacion_id IS NULL)
        OR (d.organizacion_id IS NOT NULL AND p.organizacion_id = d.organizacion_id))
     JOIN property_listings l ON l.propiedad_id = p.id AND l.listing_status = 'active'
     LEFT JOIN crm_demanda_propiedades dp ON dp.demanda_id = d.id AND dp.propiedad_id = p.id
     WHERE d.estado = 'activa' AND d.avisar
       AND p.created_at > d.notificado_at
       AND dp.propiedad_id IS NULL
       AND ${CONDICIONES_CRUCE}
     GROUP BY d.id, c.nombre, u.name, u.email`,
  );
  return rows;
}

/**
 * Conteo de coincidencias en la cartera para varias demandas a la vez
 * (listado). Devuelve { [demandaId]: { total, nuevas } }. No cuenta descartadas.
 */
export async function conteosCartera(db, demandaIds) {
  if (!demandaIds.length) return {};
  const { rows } = await db.query(
    `SELECT d.id,
            COUNT(DISTINCT p.id)::int AS total,
            COUNT(DISTINCT p.id) FILTER (WHERE p.created_at > d.coincidencias_vistas_at)::int AS nuevas
     FROM crm_demandas d
     JOIN propiedades p ON (
           (d.usuario_id IS NOT NULL AND p.publicado_por_id = d.usuario_id AND p.organizacion_id IS NULL)
        OR (d.organizacion_id IS NOT NULL AND p.organizacion_id = d.organizacion_id))
     JOIN property_listings l ON l.propiedad_id = p.id AND l.listing_status = 'active'
     LEFT JOIN crm_demanda_propiedades dp ON dp.demanda_id = d.id AND dp.propiedad_id = p.id
     WHERE d.id = ANY($1::bigint[])
       AND COALESCE(dp.estado, '') <> 'descartada'
       AND ${CONDICIONES_CRUCE}
     GROUP BY d.id`,
    [demandaIds],
  );
  return Object.fromEntries(rows.map((r) => [String(r.id), { total: r.total, nuevas: r.nuevas }]));
}
