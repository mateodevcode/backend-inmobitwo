// Avisos dentro del CRM (tabla crm_notificaciones).
// notificar() nunca lanza: un aviso fallido no debe romper la acción que lo origina.
import { pool } from "../db.js";

export const TIPOS_NOTIFICACION = [
  "lead_nuevo",
  "lead_asignado",
  "contacto_asignado",
  "tarea_asignada",
  "visita_asignada",
  "visita_cambiada",
  "demanda_coincidencias",
  "captacion_por_vencer",
];

// Destinatarios únicos, válidos y distintos de quien hizo la acción.
export function destinatariosUnicos(ids, actorId = null) {
  const set = new Set();
  for (const id of ids ?? []) {
    const n = Number(id);
    if (Number.isInteger(n) && n > 0 && n !== Number(actorId)) set.add(n);
  }
  return [...set];
}

const corto = (s, max) => (s == null ? null : String(s).replace(/\s+/g, " ").trim().slice(0, max) || null);

/**
 * @param {object} a
 * @param {number[]} a.destinatarios  ids de usuario
 * @param {number|null} a.organizacionId  espacio (null = personal)
 * @param {string} a.tipo  uno de TIPOS_NOTIFICACION
 * @param {string} a.titulo
 * @param {string} [a.cuerpo]
 * @param {string} [a.url]  ruta interna del CRM ("/contactos/5")
 * @param {string} [a.clave]  evita duplicar el mismo hecho por destinatario
 * @param {number} [a.actorId]  quien lo causó (no se le avisa)
 * @returns {Promise<number>} avisos creados
 */
export async function notificar({ destinatarios, organizacionId = null, tipo, titulo, cuerpo, url, clave, actorId = null }, db = pool) {
  try {
    const ids = destinatariosUnicos(destinatarios, actorId);
    if (!ids.length || !TIPOS_NOTIFICACION.includes(tipo)) return 0;
    const ruta = typeof url === "string" && url.startsWith("/") ? url.slice(0, 300) : null;
    const { rowCount } = await db.query(
      `INSERT INTO crm_notificaciones (usuario_id, organizacion_id, tipo, titulo, cuerpo, url, clave, actor_id)
       SELECT u, $2, $3, $4, $5, $6, $7, $8 FROM unnest($1::int[]) AS u
       ON CONFLICT (usuario_id, clave) WHERE clave IS NOT NULL DO NOTHING`,
      [ids, organizacionId, tipo, corto(titulo, 200) ?? "Aviso", corto(cuerpo, 500), ruta, corto(clave, 200), actorId],
    );
    return rowCount;
  } catch (e) {
    console.error("[notificaciones] no se pudo crear el aviso:", e?.message ?? e);
    return 0;
  }
}

export async function adminsDeOrganizacion(organizacionId, db = pool) {
  const { rows } = await db.query(
    `SELECT usuario_id FROM organizacion_miembros
     WHERE organizacion_id = $1 AND estado = 'activo' AND rol_en_org = 'agency_admin'`,
    [organizacionId],
  );
  return rows.map((r) => r.usuario_id);
}

// "lun 24 nov, 3:30 p. m." en hora de Bogotá.
export function fechaCortaBogota(fecha) {
  return new Intl.DateTimeFormat("es-CO", {
    timeZone: "America/Bogota",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(fecha));
}
