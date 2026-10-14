// src/controllers/crm.controllers.js — endpoints CRM fase 1 (datos reales)
// Todas las rutas usan: verificarToken + resolverEspacioCrm + rate limit.
// Respuestas { success, data | error }. Paginación data + pagination.
import { pool } from "../db.js";
import { cacheGet } from "../lib/redis.js";
import { wherePropiedadesVisibles } from "../lib/crmPermisos.js";
import {
  validarFiltrosLeads,
  validarFiltrosPropiedades,
  validarPaginacion,
} from "../validations/crm.js";

const portada = (alias) => `COALESCE(
  (SELECT pg.url FROM propiedades_galeria pg
   WHERE pg.propiedad_id = ${alias}.id AND pg.es_portada = true AND pg.tamaño = 'medium'
   LIMIT 1), NULL) AS portada`;

// ────────────────────────────────────────────────────────────────
// GET /crm/dashboard
// ────────────────────────────────────────────────────────────────
export const getDashboard = async (req, res) => {
  try {
    const crm = req.crm;
    const vis = wherePropiedadesVisibles(crm, "p");
    const clave = `crm:dash:${crm.tipo === "personal" ? `personal:${crm.usuarioId}` : `org:${crm.organizacionId}:${crm.usuarioId}`}`;

    const data = await cacheGet(clave, 60, async () => {
      // Cada repetición de vWhere necesita sus propios slots $n:
      // se renumera cada bloque con su desplazamiento.
      const n = vis.params.length;
      const desplazar = (where, base) =>
        where.replace(/\$(\d+)/g, (_, d) => `$${base + Number(d) - 1}`);
      const bloques = [];
      const kpiParams = [];
      for (let k = 0; k < 6; k++) {
        bloques.push(desplazar(vis.where, k * n + 1));
        kpiParams.push(...vis.params);
      }
      const idxMsg = kpiParams.length + 1;
      kpiParams.push(crm.usuarioId);

      const kpis = await pool.query(
        `SELECT
           (SELECT COUNT(*)::int FROM leads l JOIN propiedades p ON p.id = l.propiedad_id
             WHERE ${bloques[0]} AND l.created_at >= NOW() - INTERVAL '7 days') AS leads_nuevos_7,
           (SELECT COUNT(*)::int FROM leads l JOIN propiedades p ON p.id = l.propiedad_id
             WHERE ${bloques[1]} AND l.created_at >= NOW() - INTERVAL '30 days') AS leads_nuevos_30,
           (SELECT COUNT(*)::int FROM propiedades p WHERE ${bloques[2]}) AS anuncios_totales,
           (SELECT COUNT(*)::int FROM propiedades p WHERE ${bloques[3]} AND p.estado = 'publicado') AS anuncios_publicados,
           (SELECT COALESCE(SUM(v.vistas), 0)::int FROM vistas_resumen_diario v
             JOIN propiedades p ON p.id = v.propiedad_id WHERE ${bloques[4]}) AS vistas_totales,
           (SELECT COUNT(*)::int FROM usuario_favoritos f
             JOIN propiedades p ON p.id = f.propiedad_id WHERE ${bloques[5]}) AS favoritos_totales,
           (SELECT COALESCE(SUM(GREATEST(
               CASE WHEN c.interesado_id = $${idxMsg} THEN c.no_leidos_interesado ELSE 0 END +
               CASE WHEN c.publicador_id = $${idxMsg} THEN c.no_leidos_publicador ELSE 0 END, 0)), 0)::int
             FROM chat_conversaciones c) AS mensajes_sin_leer`,
        kpiParams,
      );

      const serie = await pool.query(
        `SELECT to_char(d.dia, 'YYYY-MM-DD') AS fecha, COUNT(l.id)::int AS total
         FROM generate_series(CURRENT_DATE - INTERVAL '29 days', CURRENT_DATE, '1 day') AS d(dia)
         LEFT JOIN leads l ON l.created_at::date = d.dia::date
           AND l.propiedad_id IN (SELECT p.id FROM propiedades p WHERE ${vis.where})
         GROUP BY d.dia ORDER BY d.dia`,
        vis.params,
      );

      const porEstado = await pool.query(
        `SELECT l.estado, COUNT(*)::int AS total
         FROM leads l JOIN propiedades p ON p.id = l.propiedad_id
         WHERE ${vis.where}
         GROUP BY l.estado`,
        vis.params,
      );

      const ultimos = await pool.query(
        `SELECT l.id, l.nombre, l.email, l.telefono, l.score, l.estado, l.origen, l.created_at,
                p.id AS propiedad_id, p.titulo AS propiedad_titulo,
                ${portada("p")}
         FROM leads l JOIN propiedades p ON p.id = l.propiedad_id
         WHERE ${vis.where}
         ORDER BY l.created_at DESC LIMIT 5`,
        vis.params,
      );

      return {
        kpis: kpis.rows[0],
        seriesLeads: serie.rows,
        leadsPorEstado: porEstado.rows,
        ultimosLeads: ultimos.rows,
      };
    });

    return res.status(200).json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

// ────────────────────────────────────────────────────────────────
// GET /crm/propiedades?pagina=&limite=&estado=&q=
// ────────────────────────────────────────────────────────────────
export const getCrmPropiedades = async (req, res) => {
  try {
    const crm = req.crm;
    const { pagina, limite, offset } = validarPaginacion(req.query);
    const { estado, q } = validarFiltrosPropiedades(req.query);
    const vis = wherePropiedadesVisibles(crm, "p");

    const conds = [vis.where];
    const params = [...vis.params];
    if (estado) {
      params.push(estado);
      conds.push(`p.estado = $${params.length}`);
    }
    if (q) {
      params.push(`%${q}%`);
      conds.push(`(p.titulo ILIKE $${params.length} OR p.ciudad ILIKE $${params.length} OR p.direccion ILIKE $${params.length})`);
    }
    const where = conds.join(" AND ");

    const { rows } = await pool.query(
      `SELECT p.id, p.titulo, p.ciudad, p.precio, p.estado, p.created_at,
              ${portada("p")},
              (SELECT COALESCE(SUM(v.vistas), 0)::int FROM vistas_resumen_diario v WHERE v.propiedad_id = p.id) AS vistas,
              (SELECT COUNT(*)::int FROM usuario_favoritos f WHERE f.propiedad_id = p.id) AS favoritos,
              (SELECT COUNT(*)::int FROM leads l WHERE l.propiedad_id = p.id) AS leads
       FROM propiedades p
       WHERE ${where}
       ORDER BY p.created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limite, offset],
    );
    const total = await pool.query(
      `SELECT COUNT(*)::int AS total FROM propiedades p WHERE ${where}`,
      params,
    );

    return res.status(200).json({
      success: true,
      data: rows,
      pagination: { pagina, limite, total: total.rows[0].total },
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

// ────────────────────────────────────────────────────────────────
// GET /crm/leads?pagina=&limite=&estado=&origen=&desde=&hasta=&propiedadId=&q=
// ────────────────────────────────────────────────────────────────
export const getCrmLeads = async (req, res) => {
  try {
    const crm = req.crm;
    const { pagina, limite, offset } = validarPaginacion(req.query);
    const { errores, filtros } = validarFiltrosLeads(req.query);
    if (errores.length > 0) {
      return res.status(400).json({ success: false, error: errores });
    }
    const vis = wherePropiedadesVisibles(crm, "p");

    const conds = [vis.where];
    const params = [...vis.params];
    const push = (sql, val) => {
      params.push(val);
      conds.push(sql(params.length));
    };
    if (filtros.estado) push((i) => `l.estado = $${i}`, filtros.estado);
    if (filtros.origen) push((i) => `l.origen = $${i}`, filtros.origen);
    if (filtros.desde) push((i) => `l.created_at::date >= $${i}`, filtros.desde);
    if (filtros.hasta) push((i) => `l.created_at::date <= $${i}`, filtros.hasta);
    if (filtros.propiedadId != null) push((i) => `l.propiedad_id = $${i}`, filtros.propiedadId);
    if (filtros.q) {
      params.push(`%${filtros.q}%`);
      const i = params.length;
      conds.push(`(l.nombre ILIKE $${i} OR l.email ILIKE $${i} OR l.telefono ILIKE $${i})`);
    }
    const where = conds.join(" AND ");

    const { rows } = await pool.query(
      `SELECT l.id, l.nombre, l.email, l.telefono, l.score, l.estado, l.origen, l.created_at,
              p.id AS propiedad_id, p.titulo AS propiedad_titulo,
              ${portada("p")}
       FROM leads l JOIN propiedades p ON p.id = l.propiedad_id
       WHERE ${where}
       ORDER BY l.created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limite, offset],
    );
    const total = await pool.query(
      `SELECT COUNT(*)::int AS total FROM leads l JOIN propiedades p ON p.id = l.propiedad_id WHERE ${where}`,
      params,
    );

    return res.status(200).json({
      success: true,
      data: rows,
      pagination: { pagina, limite, total: total.rows[0].total },
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};
