// src/controllers/crm.notificaciones.controllers.js — avisos del usuario en el espacio activo.
import { z } from "zod";
import { pool } from "../db.js";
import { noEncontrado } from "../lib/errores.js";
import { validar } from "../validations/visita.schema.js";

// Avisos del usuario en el espacio activo (personal = sin organización).
function filtroEspacio(crm, alias = "n") {
  if (crm.tipo === "org") return { where: `${alias}.usuario_id = $1 AND ${alias}.organizacion_id = $2`, params: [crm.usuarioId, crm.organizacionId] };
  return { where: `${alias}.usuario_id = $1 AND ${alias}.organizacion_id IS NULL`, params: [crm.usuarioId] };
}

async function contadores(crm) {
  const { rows } = await pool.query(
    `SELECT COUNT(*) FILTER (WHERE organizacion_id IS NOT DISTINCT FROM $2)::int AS no_leidas,
            COUNT(*) FILTER (WHERE organizacion_id IS DISTINCT FROM $2)::int AS otros_espacios
     FROM crm_notificaciones WHERE usuario_id = $1 AND leida_at IS NULL`,
    [crm.usuarioId, crm.tipo === "org" ? crm.organizacionId : null],
  );
  return rows[0];
}

const listaSchema = z.object({
  solo_no_leidas: z.enum(["0", "1", "true", "false"]).optional(),
  limite: z.coerce.number().int().min(1).max(50).default(20),
  antes: z.coerce.number().int().positive().optional(),
});

// ── GET /crm/notificaciones ─────────────────────────────────────
export const listarNotificaciones = async (req, res) => {
  const q = validar(listaSchema, req.query);
  const f = filtroEspacio(req.crm);
  const params = [...f.params];
  const conds = [f.where];
  if (q.solo_no_leidas === "1" || q.solo_no_leidas === "true") conds.push("n.leida_at IS NULL");
  if (q.antes) {
    params.push(q.antes);
    conds.push(`n.id < $${params.length}`);
  }
  params.push(q.limite + 1);
  const { rows } = await pool.query(
    `SELECT n.id, n.tipo, n.titulo, n.cuerpo, n.url, n.leida_at, n.created_at, u.name AS actor_nombre
     FROM crm_notificaciones n LEFT JOIN usuarios u ON u.id = n.actor_id
     WHERE ${conds.join(" AND ")}
     ORDER BY n.id DESC LIMIT $${params.length}`,
    params,
  );
  const hayMas = rows.length > q.limite;
  res.json({
    success: true,
    data: { items: rows.slice(0, q.limite), hay_mas: hayMas, ...(await contadores(req.crm)) },
  });
};

// ── GET /crm/notificaciones/contador ────────────────────────────
export const contadorNotificaciones = async (req, res) => {
  res.json({ success: true, data: await contadores(req.crm) });
};

// ── POST /crm/notificaciones/:id/leida ──────────────────────────
export const marcarLeida = async (req, res) => {
  const { id } = validar(z.object({ id: z.coerce.number().int().positive() }), req.params);
  const { rowCount } = await pool.query(
    "UPDATE crm_notificaciones SET leida_at = COALESCE(leida_at, now()) WHERE id = $1 AND usuario_id = $2",
    [id, req.crm.usuarioId],
  );
  if (!rowCount) throw noEncontrado("Aviso no encontrado.");
  res.json({ success: true, data: await contadores(req.crm) });
};

// ── POST /crm/notificaciones/leer-todas ─────────────────────────
export const marcarTodasLeidas = async (req, res) => {
  const f = filtroEspacio(req.crm, "crm_notificaciones");
  const { rowCount } = await pool.query(
    `UPDATE crm_notificaciones SET leida_at = now() WHERE ${f.where} AND leida_at IS NULL`,
    f.params,
  );
  res.json({ success: true, data: { marcadas: rowCount, ...(await contadores(req.crm)) } });
};
