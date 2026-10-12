// src/lib/crmPermisos.js — visibilidad por espacio (personal | org).
// Personal: propiedades con publicado_por_id = yo y sin organización.
// Org agency_admin: todas las de la org. Org agent: las que él publicó.
export function wherePropiedadesVisibles(crm, alias = "p", startIndex = 1) {
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

// Normalización de teléfono colombiano: 10 dígitos desde 3.
// Devuelve dígitos normalizados o null si no es un celular válido.
export function normalizarTelefonoCO(valor) {
  if (valor == null || valor === "") return null;
  let d = String(valor).replace(/\D/g, "");
  if (d.startsWith("0057")) d = d.slice(4);
  else if (d.startsWith("57") && d.length === 12) d = d.slice(2);
  return /^3\d{9}$/.test(d) ? d : null;
}
