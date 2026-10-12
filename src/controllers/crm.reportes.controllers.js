// src/controllers/crm.reportes.controllers.js — reportes del CRM
import { pool } from "../db.js";
import { whereEspacioPropio, wherePropiedadesVisibles } from "../lib/crmPermisos.js";

const duenoFiltro = (crm, alias) => whereEspacioPropio(crm, alias);

// Agent solo ve sus cifras: fuerza asignado/creado propio.
function alcanceAgente(crm) {
  return crm.tipo === "org" && crm.rolEnOrg === "agent";
}

function rangoFechas(query, params, columna = "created_at") {
  const conds = [];
  if (query.desde) {
    params.push(query.desde);
    conds.push(`${columna}::date >= $${params.length}`);
  }
  if (query.hasta) {
    params.push(query.hasta);
    conds.push(`${columna}::date <= $${params.length}`);
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
    return res.status(500).json({ success: false, error: error.message });
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
    return res.status(500).json({ success: false, error: error.message });
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
    return res.status(500).json({ success: false, error: error.message });
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
    return res.status(500).json({ success: false, error: error.message });
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
    return res.status(500).json({ success: false, error: error.message });
  }
};
