// src/lib/crmPermisos.js — visibilidad por espacio (personal | org).
import { solicitudInvalida } from "./errores.js";
//
// Regla SQL: los nombres de columna/alias que se interpolan en las consultas
// del CRM NUNCA vienen del usuario. Se validan con identificadorSql() y la
// columna dueña sale de una lista blanca (duenoEspacio).
const IDENT_RE = /^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)?$/;

export function identificadorSql(nombre) {
  if (typeof nombre !== "string" || !IDENT_RE.test(nombre)) {
    throw new Error(`Identificador SQL no permitido: ${JSON.stringify(nombre)}`);
  }
  return nombre;
}

// Columna dueña de los registros del CRM según el espacio activo.
// Devuelve las dos formas que usan los controladores: {col, val} y {cols, vals}.
export function duenoEspacio(crm) {
  const col = crm.tipo === "personal" ? "usuario_id" : "organizacion_id";
  const val = crm.tipo === "personal" ? crm.usuarioId : crm.organizacionId;
  return { col, val, cols: col, vals: [val] };
}

// Personal: propiedades con publicado_por_id = yo y sin organización.
// Org agency_admin: todas las de la org. Org agent: las que él publicó.
export function wherePropiedadesVisibles(crm, alias = "p", startIndex = 1) {
  identificadorSql(alias);
  if (crm.tipo === "personal") {
    return {
      where: `${alias}.publicado_por_id = $${startIndex} AND ${alias}.organizacion_id IS NULL`,
      params: [crm.usuarioId],
      nextIndex: startIndex + 1,
    };
  }
  if (crm.rolEnOrg === "agency_admin") {
    return {
      where: `${alias}.organizacion_id = $${startIndex}`,
      params: [crm.organizacionId],
      nextIndex: startIndex + 1,
    };
  }
  // agent
  return {
    where: `${alias}.organizacion_id = $${startIndex} AND ${alias}.publicado_por_id = $${startIndex + 1}`,
    params: [crm.organizacionId, crm.usuarioId],
    nextIndex: startIndex + 2,
  };
}

// ¿Este lead es visible para el usuario? (paridad con getLeads:
// propiedad propia sin org, o propiedad de una org con membresía activa).
// Se usa en el arreglo de seguridad de PATCH /leads/:id.
export async function leadVisibleParaUsuario(pool, usuarioId, leadId) {
  const { rows } = await pool.query(
    `SELECT l.id
     FROM leads l
     JOIN propiedades p ON p.id = l.propiedad_id
     WHERE l.id = $2
       AND (
         (p.publicado_por_id = $1 AND p.organizacion_id IS NULL)
         OR p.organizacion_id IN (
           SELECT om.organizacion_id
           FROM organizacion_miembros om
           JOIN organizaciones o ON o.id = om.organizacion_id
           WHERE om.usuario_id = $1
             AND om.estado = 'activo'
             AND o.estado = 'aprobada'
         )
       )`,
    [usuarioId, leadId],
  );
  return rows.length > 0;
}

// Filtro de lectura para crm_contactos / crm_tareas (y actividades vía contacto).
// Personal: dueño = yo. Org admin: toda la org. Org agent: asignados o creados por él.
export function whereEspacioPropio(crm, alias = "c", startIndex = 1) {
  identificadorSql(alias);
  if (crm.tipo === "personal") {
    return {
      where: `${alias}.usuario_id = $${startIndex}`,
      params: [crm.usuarioId],
      nextIndex: startIndex + 1,
    };
  }
  if (crm.rolEnOrg === "agency_admin") {
    return {
      where: `${alias}.organizacion_id = $${startIndex}`,
      params: [crm.organizacionId],
      nextIndex: startIndex + 1,
    };
  }
  return {
    where: `${alias}.organizacion_id = $${startIndex} AND (${alias}.asignado_a_id = $${startIndex + 1} OR ${alias}.creado_por_id = $${startIndex + 1})`,
    params: [crm.organizacionId, crm.usuarioId],
    nextIndex: startIndex + 2,
  };
}

// Responsable de un registro nuevo o reasignado (contacto, tarea, oportunidad).
// - Personal: solo uno mismo (o porDefecto si no se pide nada).
// - Agente de una org: siempre él mismo.
// - Admin de una org: el pedido, que debe ser miembro activo de la org; sin
//   pedido, porDefecto. Así nadie asigna ni avisa a usuarios ajenos.
// Lanza HttpError 400 si el id no es válido o no es miembro activo.
export async function resolverAsignado(db, crm, solicitado, porDefecto = null) {
  const sinPedido = solicitado === undefined || solicitado === null || solicitado === "";
  if (crm.tipo === "org" && crm.rolEnOrg !== "agency_admin") return crm.usuarioId;
  if (sinPedido) return porDefecto;
  if (crm.tipo === "personal") return crm.usuarioId;
  const id = Number(solicitado);
  if (!Number.isInteger(id) || id <= 0) throw solicitudInvalida("asignado_a_id inválido.");
  const { rows } = await db.query(
    `SELECT 1 FROM organizacion_miembros
     WHERE usuario_id = $1 AND organizacion_id = $2 AND estado = 'activo'`,
    [id, crm.organizacionId],
  );
  if (!rows[0]) throw solicitudInvalida("El agente no es miembro activo de la inmobiliaria.");
  return id;
}

// Inmueble que se puede enlazar a un registro del CRM (visita, oportunidad,
// actividad): personal → publicado por mí y sin org; org → de la inmobiliaria
// (cualquier miembro, no solo quien lo publicó). Devuelve la fila o null.
export async function propiedadEnEspacio(db, crm, id) {
  if (!/^\d+$/.test(String(id))) return null;
  const cond =
    crm.tipo === "personal"
      ? "p.publicado_por_id = $2 AND p.organizacion_id IS NULL"
      : "p.organizacion_id = $2";
  const { rows } = await db.query(
    `SELECT p.id, p.titulo, p.direccion, ci.name AS ciudad
     FROM propiedades p LEFT JOIN cities ci ON ci.id = p.city_id
     WHERE p.id = $1 AND ${cond}`,
    [id, crm.tipo === "personal" ? crm.usuarioId : crm.organizacionId],
  );
  return rows[0] ?? null;
}

// Normalización de teléfono colombiano: 10 dígitos desde 3.
// Devuelve dígitos normalizados o null si no es un celular válido.
export function normalizarTelefonoCO(valor) {
  if (valor == null || valor === "") return null;
  let d = String(valor).replace(/\D/g, "");
  if (d.startsWith("0057")) d = d.slice(4);
  else if (d.startsWith("57") && d.length === 12) d = d.slice(2);
  return /^3\d{9}$/.test(d) ? d : null;
}
