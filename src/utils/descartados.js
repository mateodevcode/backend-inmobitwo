/**
 * Devuelve el fragmento SQL para excluir descartados y añade el usuarioId a `params`.
 * Llamar AL FINAL de construir los filtros, justo antes de ORDER BY / LIMIT.
 * Si no hay usuario logueado devuelve "" y no toca params.
 */
export const clausulaExcluirDescartados = (usuarioId, params) => {
  if (!usuarioId) return "";
  params.push(usuarioId);
  return ` AND NOT EXISTS (
    SELECT 1 FROM usuario_descartados ud
    WHERE ud.usuario_id = $${params.length} AND ud.propiedad_id = p.id)`;
};
