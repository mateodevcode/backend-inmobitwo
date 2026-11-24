// src/controllers/propiedades.controllers.js — índice. La lógica vive en
// ./propiedades/ (un archivo por dominio). Se mantiene este archivo para que
// las rutas sigan importando desde el mismo sitio.
export {
  getPropiedades,
  getPropiedadesHome,
  getPropiedadesMisAnuncios,
  countPropiedadesMisAnuncios,
  getPropiedadesByOrganizacion,
  getPropertiesBySlugs,
  searchVivienda,
  getPropiedadResumen,
} from "./propiedades/listado.controllers.js";
export { getMapaInmuebles } from "./propiedades/mapa.controllers.js";
export {
  getPropiedadesById,
  getHistorialPrecios,
  getPropiedadCaracteristicas,
  guardarPropiedadCaracteristicas,
  getPropiedadStats,
  emitirTokenVista,
} from "./propiedades/detalle.controllers.js";
export {
  createPropiedades,
  updatePropiedades,
  deletePropiedades,
  publicarAnuncios,
} from "./propiedades/escritura.controllers.js";
export {
  calcularPrecioSugeridoPropiedad,
  validarPrecioPropiedad,
} from "./propiedades/precios.controllers.js";
export {
  getOfertasPropiedad,
  upsertOfertaPropiedad,
  eliminarOfertaPropiedad,
  cambiarOperacionPropiedad,
} from "./propiedades/ofertas.controllers.js";
