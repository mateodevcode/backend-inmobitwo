// src/lib/organizacionPermisos.js
import { pool } from "../db.js";

// ────────────────────────────────────────────────────────────────
// ¿Puede este usuario administrar esta organización?
// true si es superadmin global, o si es agency_admin ACTIVO de esa org.
// ────────────────────────────────────────────────────────────────
export const puedeAdministrarOrganizacion = async (
  usuarioId,
  organizacionId,
  rolGlobal,
) => {
  if (rolGlobal === "superadmin") return true;

  const { rows } = await pool.query(
    `SELECT 1 FROM organizacion_miembros 
     WHERE usuario_id = $1 
       AND organizacion_id = $2 
       AND rol_en_org = 'agency_admin' 
       AND estado = 'activo'`,
    [usuarioId, organizacionId],
  );

  return rows.length > 0;
};

// ────────────────────────────────────────────────────────────────
// ¿Es este usuario miembro (agent o agency_admin) de esta organización?
// Para lecturas: cualquier miembro activo puede ver, no solo el admin.
// ────────────────────────────────────────────────────────────────
export const esMiembroDeOrganizacion = async (
  usuarioId,
  organizacionId,
  rolGlobal,
) => {
  if (rolGlobal === "superadmin") return true;

  const { rows } = await pool.query(
    `SELECT 1 FROM organizacion_miembros 
     WHERE usuario_id = $1 
       AND organizacion_id = $2 
       AND estado = 'activo'`,
    [usuarioId, organizacionId],
  );

  return rows.length > 0;
};
