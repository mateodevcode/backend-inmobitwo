// src/controllers/crm.reportes.controllers.js — reportes del CRM
import { pool } from "../db.js";
import {
  identificadorSql,
  whereEspacioPropio,
  wherePropiedadesVisibles,
} from "../lib/crmPermisos.js";
import { solicitudInvalida } from "../lib/errores.js";

const duenoFiltro = (crm, alias) => whereEspacioPropio(crm, alias);

// Agent solo ve sus cifras: fuerza asignado/creado propio.
function alcanceAgente(crm) {
  return crm.tipo === "org" && crm.rolEnOrg === "agent";
}

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

// Rango por días de BOGOTÁ (antes se comparaba la fecha UTC: un lead de las
// 8 p. m. del 31 contaba para el día 1). Fechas inválidas → 400.
function rangoFechas(query, params, columna = "created_at") {
  identificadorSql(columna);
  const conds = [];
  for (const [k, op] of [["desde", ">="], ["hasta", "<="]]) {
    if (!query[k]) continue;
    if (!FECHA_RE.test(query[k]) || Number.isNaN(Date.parse(query[k]))) {
      throw solicitudInvalida(`${k}: fecha inválida (aaaa-mm-dd).`);
    }
    params.push(query[k]);
    conds.push(`(${columna} AT TIME ZONE 'America/Bogota')::date ${op} $${params.length}::date`);
  }
  return conds;
}

// ── GET /crm/reportes/embudo ────────────────────────────────────
export const embudo = async (req, res) => {
  try {
    const crm = req.crm;
    const base = duenoFiltro(crm, "o");
    const params = [...base.params];
    const conds = [base.where];
    if (alcanceAgente(crm)) {
      params.push(crm.usuarioId);
      conds.push(`o.asignado_a_id = $${params.length}`);
    }
    if (req.query.asignado && !alcanceAgente(crm)) {
      params.push(req.query.asignado);
      conds.push(`o.asignado_a_id = $${params.length}`);
    }
    conds.push(...rangoFechas(req.query, params, "o.created_at"));
    const where = conds.join(" AND ");
    const { rows } = await pool.query(
      `SELECT e.id AS etapa_id, e.nombre, e.color, e.tipo, e.orden,
              COUNT(o.id)::int AS total,
              COALESCE(SUM(o.valor), 0)::bigint AS valor
       FROM crm_etapas e
       LEFT JOIN crm_oportunidades o ON o.etapa_id = e.id AND (${where})
       WHERE e.${crm.tipo === "personal" ? "usuario_id" : "organizacion_id"} = $${params.length + 1}
       GROUP BY e.id ORDER BY e.orden`,
      [...params, crm.tipo === "personal" ? crm.usuarioId : crm.organizacionId],
    );
    return res.status(200).json({ success: true, data: rows });
  } catch (error) {
    throw error; // errorHandler: HttpError → su status; otro → 500 genérico
  }
};

// ── GET /crm/reportes/conversion ────────────────────────────────
export const conversion = async (req, res) => {
  try {
    const crm = req.crm;
    const base = duenoFiltro(crm, "o");
    const params = [...base.params];
    const conds = [base.where, "o.estado IN ('ganada', 'perdida')"];
    if (alcanceAgente(crm)) {
      params.push(crm.usuarioId);
      conds.push(`o.asignado_a_id = $${params.length}`);
    }
    if (req.query.asignado && !alcanceAgente(crm)) {
      params.push(req.query.asignado);
      conds.push(`o.asignado_a_id = $${params.length}`);
    }
    conds.push(...rangoFechas(req.query, params, "o.cerrada_at"));
    const where = conds.join(" AND ");
    const { rows } = await pool.query(
      `SELECT COUNT(*) FILTER (WHERE o.estado = 'ganada')::int AS ganadas,
              COUNT(*) FILTER (WHERE o.estado = 'perdida')::int AS perdidas,
              COALESCE(SUM(o.valor) FILTER (WHERE o.estado = 'ganada'), 0)::bigint AS valor_ganado
       FROM crm_oportunidades o WHERE ${where}`,
      params,
    );
    const r = rows[0];
    const total = r.ganadas + r.perdidas;
    return res.status(200).json({
      success: true,
      data: { ...r, total, tasa: total ? Math.round((r.ganadas / total) * 100) : 0 },
    });
  } catch (error) {
    throw error; // errorHandler: HttpError → su status; otro → 500 genérico
  }
};

// ── GET /crm/reportes/valor-ganado ──────────────────────────────
export const valorGanado = async (req, res) => {
  try {
    const crm = req.crm;
    const base = duenoFiltro(crm, "o");
    const params = [...base.params];
    const conds = [base.where, "o.estado = 'ganada'"];
    if (alcanceAgente(crm)) {
      params.push(crm.usuarioId);
      conds.push(`o.asignado_a_id = $${params.length}`);
    }
    if (req.query.asignado && !alcanceAgente(crm)) {
      params.push(req.query.asignado);
      conds.push(`o.asignado_a_id = $${params.length}`);
    }
    conds.push(...rangoFechas(req.query, params, "o.cerrada_at"));
    const where = conds.join(" AND ");
    const { rows } = await pool.query(
      `SELECT to_char(date_trunc('month', o.cerrada_at), 'YYYY-MM') AS periodo,
              COUNT(*)::int AS total, COALESCE(SUM(o.valor), 0)::bigint AS valor
       FROM crm_oportunidades o WHERE ${where}
       GROUP BY 1 ORDER BY 1`,
      params,
    );
    return res.status(200).json({ success: true, data: rows });
  } catch (error) {
    throw error; // errorHandler: HttpError → su status; otro → 500 genérico
  }
};

// ── GET /crm/reportes/actividad (por agente + carga para /equipo) ─
export const actividad = async (req, res) => {
  try {
    const crm = req.crm;
    if (crm.tipo === "personal") {
      return res.status(200).json({ success: true, data: [] });
    }
    const params = [crm.organizacionId];
    const conds = ["om.organizacion_id = $1", "om.estado = 'activo'"];
    if (alcanceAgente(crm)) {
      params.push(crm.usuarioId);
      conds.push(`om.usuario_id = $${params.length}`);
    }
    if (req.query.asignado && !alcanceAgente(crm)) {
      params.push(req.query.asignado);
      conds.push(`om.usuario_id = $${params.length}`);
    }
    const { rows } = await pool.query(
      `SELECT om.usuario_id, u.name, u.email, om.rol_en_org,
              (SELECT COUNT(*)::int FROM crm_contactos c
                WHERE c.organizacion_id = om.organizacion_id AND c.asignado_a_id = om.usuario_id AND c.archivado_at IS NULL) AS contactos,
              (SELECT COUNT(*)::int FROM crm_oportunidades o
                WHERE o.organizacion_id = om.organizacion_id AND o.asignado_a_id = om.usuario_id AND o.estado = 'abierta') AS oportunidades_abiertas,
              (SELECT COUNT(*)::int FROM crm_tareas t
                WHERE t.organizacion_id = om.organizacion_id AND t.asignado_a_id = om.usuario_id
                  AND t.completada_at IS NULL AND t.vence_at < now()) AS tareas_vencidas,
              (SELECT COUNT(*)::int FROM crm_actividades a
                WHERE a.organizacion_id = om.organizacion_id AND a.autor_id = om.usuario_id) AS actividades
       FROM organizacion_miembros om JOIN usuarios u ON u.id = om.usuario_id
       WHERE ${conds.join(" AND ")}
       ORDER BY u.name`,
      params,
    );
    return res.status(200).json({ success: true, data: rows });
  } catch (error) {
    throw error; // errorHandler: HttpError → su status; otro → 500 genérico
  }
};

// ── GET /crm/reportes/leads-origen ──────────────────────────────
export const leadsOrigen = async (req, res) => {
  try {
    const crm = req.crm;
    const vis = wherePropiedadesVisibles(crm, "p");
    const params = [...vis.params];
    const conds = [vis.where];
    conds.push(...rangoFechas(req.query, params, "l.created_at"));
    const { rows } = await pool.query(
      `SELECT l.origen, COUNT(*)::int AS total
       FROM leads l JOIN propiedades p ON p.id = l.propiedad_id
       WHERE ${conds.join(" AND ")}
       GROUP BY l.origen`,
      params,
    );
    return res.status(200).json({ success: true, data: rows });
  } catch (error) {
    throw error; // errorHandler: HttpError → su status; otro → 500 genérico
  }
};

// ════════════════════════════════════════════════════════════════
// Reportes por agente, por inmueble y de tiempos de respuesta.
// Rango opcional desde/hasta en días de Bogotá (aaaa-mm-dd).
// ════════════════════════════════════════════════════════════════
function rangoValidado(query) {
  const r = [];
  for (const k of ["desde", "hasta"]) {
    const v = query[k];
    if (v && (!FECHA_RE.test(v) || Number.isNaN(Date.parse(v)))) {
      throw solicitudInvalida(`${k}: fecha inválida (aaaa-mm-dd).`);
    }
    r.push(v || null);
  }
  return r;
}
// Condición "columna dentro del rango" con los parámetros $2 (desde) y $3 (hasta).
const enRango = (col) =>
  `(${identificadorSql(col)} AT TIME ZONE 'America/Bogota')::date BETWEEN COALESCE($2::date, '-infinity'::date) AND COALESCE($3::date, 'infinity'::date)`;

// ── GET /crm/reportes/agentes ────────────────────────────────────
// Solo inmobiliarias. El admin ve a todos; un agente, solo su fila.
export const reporteAgentes = async (req, res) => {
  const crm = req.crm;
  if (crm.tipo !== "org") throw solicitudInvalida("Disponible solo en el espacio de una inmobiliaria.");
  const [desde, hasta] = rangoValidado(req.query);
  const params = [crm.organizacionId, desde, hasta];
  let soloYo = "";
  if (alcanceAgente(crm)) {
    params.push(crm.usuarioId);
    soloYo = `AND u.id = $${params.length}`;
  }
  const { rows } = await pool.query(
    `SELECT u.id AS usuario_id, u.name AS nombre, om.rol_en_org,
       (SELECT COUNT(*) FROM crm_contactos c WHERE c.organizacion_id = $1 AND c.asignado_a_id = u.id AND ${enRango("c.created_at")})::int AS contactos_nuevos,
       (SELECT COUNT(*) FROM crm_contactos c WHERE c.organizacion_id = $1 AND c.asignado_a_id = u.id AND c.lead_id IS NOT NULL AND ${enRango("c.created_at")})::int AS leads_asignados,
       (SELECT COUNT(*) FROM crm_visitas v WHERE v.organizacion_id = $1 AND v.asignado_a_id = u.id AND v.estado = 'realizada' AND ${enRango("v.inicio_at")})::int AS visitas_realizadas,
       (SELECT COUNT(*) FROM crm_captaciones k WHERE k.organizacion_id = $1 AND k.asignado_a_id = u.id AND ${enRango("k.created_at")})::int AS captaciones,
       (SELECT COUNT(*) FROM crm_oportunidades o WHERE o.organizacion_id = $1 AND o.asignado_a_id = u.id AND o.estado = 'ganada' AND ${enRango("o.cerrada_at")})::int AS ganadas,
       (SELECT COUNT(*) FROM crm_oportunidades o WHERE o.organizacion_id = $1 AND o.asignado_a_id = u.id AND o.estado = 'perdida' AND ${enRango("o.cerrada_at")})::int AS perdidas,
       (SELECT COALESCE(SUM(o.valor), 0) FROM crm_oportunidades o WHERE o.organizacion_id = $1 AND o.asignado_a_id = u.id AND o.estado = 'ganada' AND ${enRango("o.cerrada_at")})::bigint AS valor_ganado
     FROM organizacion_miembros om JOIN usuarios u ON u.id = om.usuario_id
     WHERE om.organizacion_id = $1 AND om.estado = 'activo' ${soloYo}
     ORDER BY u.name`,
    params,
  );
  const data = rows.map((r) => {
    const cerradas = r.ganadas + r.perdidas;
    return { ...r, valor_ganado: Number(r.valor_ganado), tasa_conversion: cerradas ? Math.round((r.ganadas / cerradas) * 100) : null };
  });
  data.sort((a, b) => b.valor_ganado - a.valor_ganado || b.ganadas - a.ganadas || a.nombre.localeCompare(b.nombre));
  res.json({ success: true, data });
};

// ── GET /crm/reportes/inmuebles ──────────────────────────────────
// Los 50 inmuebles del espacio con más vistas en el rango, con su embudo:
// vistas → favoritos → leads → visitas → envíos a clientes.
export const reporteInmuebles = async (req, res) => {
  const crm = req.crm;
  const [desde, hasta] = rangoValidado(req.query);
  const vis = wherePropiedadesVisibles(crm, "p", 4);
  const { rows } = await pool.query(
    `SELECT p.id, p.titulo, p.estado, ci.name AS ciudad,
       (SELECT COALESCE(SUM(v.vistas), 0) FROM vistas_resumen_diario v
        WHERE v.propiedad_id = p.id AND v.fecha_local BETWEEN COALESCE($2::date, '-infinity'::date) AND COALESCE($3::date, 'infinity'::date))::int AS vistas,
       (SELECT COUNT(*) FROM usuario_favoritos f WHERE f.propiedad_id = p.id)::int AS favoritos,
       (SELECT COUNT(*) FROM leads l WHERE l.propiedad_id = p.id AND ${enRango("l.created_at")})::int AS leads,
       (SELECT COUNT(*) FROM crm_visitas cv WHERE cv.propiedad_id = p.id AND cv.estado = 'realizada' AND ${enRango("cv.inicio_at")})::int AS visitas,
       (SELECT COUNT(*) FROM crm_demanda_propiedades dp WHERE dp.propiedad_id = p.id AND dp.estado = 'enviada' AND ${enRango("dp.created_at")})::int AS enviados
     FROM propiedades p LEFT JOIN cities ci ON ci.id = p.city_id
     WHERE ${vis.where} AND $1::int IS NOT NULL
     ORDER BY vistas DESC, leads DESC, p.id DESC
     LIMIT 50`,
    [0, desde, hasta, ...vis.params],
  );
  res.json({
    success: true,
    data: rows.map((r) => ({ ...r, tasa_lead: r.vistas ? Math.round((r.leads / r.vistas) * 1000) / 10 : null })),
  });
};

// ── GET /crm/reportes/respuesta ──────────────────────────────────
// Chat: minutos entre el primer mensaje del interesado y la primera
// respuesta del anunciante (conversaciones de mis anuncios del espacio; en
// una inmobiliaria el admin ve las de todos los anuncios de la org).
// Leads: minutos entre que llega el lead y se convierte en contacto.
export const reporteRespuesta = async (req, res) => {
  const crm = req.crm;
  const [desde, hasta] = rangoValidado(req.query);
  const params = [crm.usuarioId, desde, hasta];
  let alcanceChat;
  if (crm.tipo === "personal") alcanceChat = "c.publicador_id = $1 AND (p.id IS NULL OR p.organizacion_id IS NULL)";
  else {
    params.push(crm.organizacionId);
    alcanceChat = alcanceAgente(crm)
      ? `c.publicador_id = $1 AND p.organizacion_id = $${params.length}`
      : `p.organizacion_id = $${params.length}`;
  }
  const resumen = (col) => `
    COUNT(*)::int AS total,
    COUNT(${col})::int AS respondidas,
    ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY ${col}))::int AS mediana_min,
    ROUND(AVG(${col}))::int AS promedio_min,
    COUNT(*) FILTER (WHERE ${col} <= 60)::int AS en_1h`;

  const chat = await pool.query(
    `WITH conv AS (
       SELECT c.id, c.publicador_id,
              (SELECT MIN(m.created_at) FROM chat_mensajes m
               WHERE m.conversacion_id = c.id AND m.remitente_id = c.interesado_id) AS t0
       FROM chat_conversaciones c LEFT JOIN propiedades p ON p.id = c.propiedad_id
       WHERE ${alcanceChat}
     ), tiempos AS (
       SELECT conv.id,
              EXTRACT(EPOCH FROM ((SELECT MIN(m.created_at) FROM chat_mensajes m
                                   WHERE m.conversacion_id = conv.id AND m.remitente_id = conv.publicador_id
                                     AND m.created_at > conv.t0) - conv.t0)) / 60 AS minutos
       FROM conv WHERE conv.t0 IS NOT NULL AND ${enRango("conv.t0")}
     )
     SELECT ${resumen("minutos")} FROM tiempos`,
    params,
  );

  const vis = wherePropiedadesVisibles(crm, "p", 4);
  const leads = await pool.query(
    `WITH t AS (
       SELECT EXTRACT(EPOCH FROM (
                (SELECT MIN(k.created_at) FROM crm_contactos k WHERE k.lead_id = l.id) - l.created_at)) / 60 AS minutos
       FROM leads l JOIN propiedades p ON p.id = l.propiedad_id
       WHERE ${vis.where} AND ${enRango("l.created_at")} AND $1::int IS NOT NULL
     )
     SELECT ${resumen("minutos")} FROM t`,
    [0, desde, hasta, ...vis.params],
  );
  res.json({ success: true, data: { chat: chat.rows[0], leads: leads.rows[0] } });
};
