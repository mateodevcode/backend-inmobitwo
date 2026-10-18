// src/lib/propiedadPermisos.js
// Dueño o agency_admin de la org del anuncio (o superadmin).
// Vivía en propiedades.controllers.js; se movió aquí para que pagos,
// ubicacion y otros módulos la reutilicen sin imports circulares.

import { puedeAdministrarOrganizacion } from "./organizacionPermisos.js";

export const puedeGestionarPropiedad = async (usuario, propiedad) => {
  if (!propiedad) return false;
  if (!usuario) return false;
  if (Number(propiedad.publicado_por_id) === Number(usuario.id)) return true;
  if (propiedad.organizacion_id == null) return false;
  return puedeAdministrarOrganizacion(
    usuario.id,
    propiedad.organizacion_id,
    usuario.rol,
  );
};
