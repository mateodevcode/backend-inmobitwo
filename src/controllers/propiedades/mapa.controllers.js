// src/controllers/propiedades/mapa.controllers.js — datos livianos del mapa de inmuebles.
//
// GET /propiedades/mapa?minLat&minLng&maxLat&maxLng&zoom[&operation][&tipoInmueble]
//   → { modo: "puntos", total, puntos: [{ id, lat, lng, precio, op }] }
//   → { modo: "grupos", total, grupos: [{ lat, lng, total }] }
//
// Solo lo necesario para pintar chinchetas: la card se completa al hacer
// clic con /propiedades/:id/resumen. Con muchos inmuebles en pantalla
// (país, departamento) agrupa en una rejilla en PostGIS, así los conteos
// son exactos y nunca se corta en un LIMIT.
import { pool } from "../../db.js";
import { buildTipoFilter, esTipoVacacional } from "../../lib/propertyFilters.js";
import { clausulaExcluirDescartados } from "../../utils/descartados.js";
import { geomFiltroSQL } from "../../lib/ubicacion.service.js";
import { solicitudInvalida } from "../../lib/errores.js";
import { leerBboxMapa, tamanoCelda, debeAgrupar } from "../../lib/mapaGrid.js";
import { joinOfertaActiva, operationIdPorCode, filtroPublicoSQL } from "./_comun.js";

// Tope de seguridad para zoom alto (ZOOM_SIEMPRE_PUNTOS): ahí siempre van
// puntos aunque pasen de MAX_PUNTOS, pero nunca una respuesta gigante.
const MAX_PUNTOS_ZOOM_ALTO = 5000;

// Filtro espacial que sí usa los índices GiST (geom y geom_publica): el CASE
// de geomFiltroSQL dentro del WHERE obliga a recorrer toda la tabla.
function filtroBboxSQL(alias, idx) {
  const env = `ST_MakeEnvelope($${idx}::float, $${idx + 1}::float, $${idx + 2}::float, $${idx + 3}::float, 4326)`;
  return `((NOT COALESCE(${alias}.ubicacion_oculta, false) AND ${alias}.geom && ${env})
        OR (COALESCE(${alias}.ubicacion_oculta, false) AND ${alias}.geom_publica && ${env}))`;
}

// FROM + WHERE comunes al conteo, los puntos y los grupos.
async function construirConsultaBase(query, usuarioId, bbox) {
  let { operation } = query;
  const { tipoInmueble } = query;
  if (esTipoVacacional(tipoInmueble)) operation = "alquiler";

  const params = [];
  const filtros = [filtroPublicoSQL("p")];
  let joinOferta = "";
  let precio = "p.precio";
  let op = "ot.code";

  if (operation) {
    const opId = await operationIdPorCode(operation);
    if (!opId) throw solicitudInvalida("Operación no válida.");
    // La operación sale de la oferta activa unida (sin parámetro: el conteo
    // no la selecciona y PostgreSQL no podría deducir su tipo).
    joinOferta = `${joinOfertaActiva(opId)}
    LEFT JOIN operation_types otl ON otl.id = l.operation_type_id`;
    precio = "l.precio";
    op = "otl.code";
  }

  if (tipoInmueble) {
    const { sql, params: tipoParams } = buildTipoFilter(tipoInmueble, {
      alias: "p",
      startIdx: params.length + 1,
    });
    tipoParams.forEach((t) => params.push(t));
    if (sql) filtros.push(sql);
  }

  const excluir = clausulaExcluirDescartados(usuarioId, params);
  if (excluir) filtros.push(excluir.replace(/^ AND /, ""));

  params.push(bbox.minLng, bbox.minLat, bbox.maxLng, bbox.maxLat);
  filtros.push(filtroBboxSQL("p", params.length - 3));

  const from = `
    FROM propiedades p
    LEFT JOIN operation_types ot ON p.operation_type_id = ot.id
    ${joinOferta}
    WHERE ${filtros.join(" AND ")}`;
  return { from, params, precio, op };
}

export const getMapaInmuebles = async (req, res) => {
  const bbox = leerBboxMapa(req.query);
  const { from, params, precio, op } = await construirConsultaBase(
    req.query,
    req.usuario?.id,
    bbox,
  );
  const g = geomFiltroSQL("p");

  const { rows: conteo } = await pool.query(`SELECT COUNT(*)::int AS total ${from}`, params);
  const total = conteo[0]?.total ?? 0;

  if (debeAgrupar(total, bbox.zoom)) {
    params.push(tamanoCelda(bbox.zoom));
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS total,
              AVG(ST_X(t.g))::float AS lng,
              AVG(ST_Y(t.g))::float AS lat
       FROM (SELECT ${g} AS g ${from}) t
       GROUP BY ST_SnapToGrid(t.g, $${params.length}::float)`,
      params,
    );
    return res.json({
      success: true,
      message: null,
      data: { modo: "grupos", total, grupos: rows },
      error: null,
    });
  }

  const { rows } = await pool.query(
    `SELECT p.id, ${precio}::float8 AS precio, ${op} AS op,
            ST_Y(${g})::float AS lat, ST_X(${g})::float AS lng
     ${from}
     LIMIT ${MAX_PUNTOS_ZOOM_ALTO}`,
    params,
  );
  res.json({
    success: true,
    message: null,
    data: { modo: "puntos", total, puntos: rows },
    error: null,
  });
};
