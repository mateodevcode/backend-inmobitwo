// src/controllers/geo.zonas.controllers.js — búsqueda por varias zonas a la vez
// ("Seleccionar en mapa" con varias regiones/departamentos/municipios/barrios).
//
// POST /api/zonas/conteo          { zonas, operation?, tipoInmueble? } → { total }
// POST /api/inmuebles-en-zonas    { zonas, operation?, tipoInmueble? } → { total, propiedades }
// POST /api/zonas/geojson         { zonas } → FeatureCollection (minimapa)
//
// `zonas`: [{ tipo, codigo }] o "tipo:codigo,tipo:codigo" (ver lib/zonas.js).
// El resultado es la UNIÓN: un inmueble en una zona y en su padre cuenta una vez.
import { pool } from "../db.js";
import { leerZonas, filtroZonasSQL } from "../lib/zonas.js";
import { filtrosAnuncios, listarInmueblesEnArea } from "./geo.controllers.js";

export const getConteoZonas = async (req, res) => {
  const zonas = leerZonas(req.body?.zonas);
  const params = [];
  const whereZonas = filtroZonasSQL(zonas, params);
  const { params: valores, filters } = filtrosAnuncios(
    { operation: req.body?.operation, inmueble: req.body?.tipoInmueble },
    params,
  );
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS total
     FROM propiedades p
     WHERE ${filters.join(" AND ")} AND ${whereZonas}`,
    valores,
  );
  res.json({ success: true, message: null, data: { total: rows[0]?.total ?? 0 }, error: null });
};

export const getInmueblesEnZonas = async (req, res) => {
  const zonas = leerZonas(req.body?.zonas);
  const params = [];
  const whereArea = filtroZonasSQL(zonas, params);
  const rows = await listarInmueblesEnArea({
    whereArea,
    params,
    operation: req.body?.operation,
    tipoInmueble: req.body?.tipoInmueble,
    usuario: req.usuario,
  });
  res.json({
    success: true,
    message: null,
    data: { total: rows.length, propiedades: rows },
    error: null,
  });
};

// POST /api/zonas/geojson { zonas } → FeatureCollection con el polígono
// (simplificado) de cada zona. Para pintar las zonas elegidas en el minimapa
// de resultados. Mismas tolerancias que los GeoJSON de cada nivel.
export const getGeoJSONZonas = async (req, res) => {
  const zonas = leerZonas(req.body?.zonas);
  const porTipo = { region: [], departamento: [], municipio: [], barrio: [] };
  for (const z of zonas) porTipo[z.tipo].push(z.codigo);

  const { rows } = await pool.query(
    `SELECT 'region' AS tipo, slug AS codigo, name AS nombre,
            ST_AsGeoJSON(ST_SimplifyPreserveTopology(geom, 0.006), 5)::json AS geometry
       FROM regions WHERE slug = ANY($1::text[]) AND geom IS NOT NULL
     UNION ALL
     SELECT 'departamento', dane_code, name,
            ST_AsGeoJSON(ST_SimplifyPreserveTopology(geom, 0.003), 5)::json
       FROM states WHERE dane_code = ANY($2::text[]) AND geom IS NOT NULL
     UNION ALL
     SELECT 'municipio', dane_code, name,
            ST_AsGeoJSON(ST_SimplifyPreserveTopology(geom, 0.0007), 5)::json
       FROM cities WHERE dane_code = ANY($3::text[]) AND geom IS NOT NULL
     UNION ALL
     SELECT 'barrio', dane_code, name,
            ST_AsGeoJSON(ST_SimplifyPreserveTopology(geom, 0.00005), 6)::json
       FROM barrios WHERE dane_code = ANY($4::text[]) AND geom IS NOT NULL`,
    [porTipo.region, porTipo.departamento, porTipo.municipio, porTipo.barrio],
  );

  const features = rows.map((r) => ({
    type: "Feature",
    properties: { tipo: r.tipo, codigo: r.codigo, nombre: r.nombre },
    geometry: r.geometry,
  }));
  res.json({
    success: true,
    message: null,
    data: { type: "FeatureCollection", features },
    error: null,
  });
};
