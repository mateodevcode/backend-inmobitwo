// src/controllers/geo.zonas.controllers.js — búsqueda por varias zonas a la vez
// ("Seleccionar en mapa" con varias regiones/departamentos/municipios/barrios).
//
// POST /api/zonas/conteo          { zonas, operation?, tipoInmueble? } → { total }
// POST /api/inmuebles-en-zonas    { zonas, operation?, tipoInmueble? } → { total, propiedades }
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
