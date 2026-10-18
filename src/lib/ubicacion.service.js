// src/lib/ubicacion.service.js
// Privacidad de ubicación para anuncios con ubicacion_oculta=true.
// Reglas:
// - El dueño / agency_admin de la org / superadmin SIEMPRE ve la ubicación real.
// - Cualquiera más (o anónimos) ve solo la coordenada pública (desplazada),
//   NUNCA direccion, numero_direccion, floor, interior, postal_code ni geom real.
// - En filtros/orden espaciales se usa geom_publica para los ocultos
//   (ver expresiones SQL al final) para que no se pueda triangular
//   achicando el bbox o el radio.

import { pool } from "../db.js";
import { puedeAdministrarOrganizacion } from "./organizacionPermisos.js";

export const RADIO_ZONA_UBICACION_M = 500;

// ────────────────────────────────────────────────────────────────
// ¿Este usuario puede ver la ubicación REAL de esta propiedad?
// propiedad debe traer { publicado_por_id, organizacion_id }.
// ────────────────────────────────────────────────────────────────
export const verUbicacionReal = async (usuario, propiedad) => {
  if (!propiedad || !propiedad.ubicacion_oculta) return true;
  if (!usuario) return false;
  if (Number(propiedad.publicado_por_id) === Number(usuario.id)) return true;
  if (usuario.rol === "superadmin") return true;
  if (propiedad.organizacion_id == null) return false;
  return puedeAdministrarOrganizacion(
    usuario.id,
    propiedad.organizacion_id,
    usuario.rol,
  );
};

// ────────────────────────────────────────────────────────────────
// Aplica la privacidad a un array de filas de propiedad. La fila debe traer
// ubicacion_oculta, publicado_por_id y organizacion_id (los SELECT del
// proyecto ya traen publicado_por_id/organizacion_id; los que no, se los
// agrega este helper en batch). Mutante por rendimiento.
// ────────────────────────────────────────────────────────────────
export async function aplicarPrivacidadUbicacion(filas, usuario) {
  if (!Array.isArray(filas) || filas.length === 0) return filas;

  const ocultas = filas.filter((f) => f?.ubicacion_oculta);
  if (ocultas.length === 0) return filas;

  // Anónimos nunca ven la real.
  if (!usuario) {
    for (const f of ocultas) ocultarFila(f);
    return filas;
  }

  for (const f of ocultas) {
    let puedeVer = false;
    if (usuario.rol === "superadmin") {
      puedeVer = true;
    } else if (Number(f.publicado_por_id) === Number(usuario.id)) {
      puedeVer = true;
    } else if (f.organizacion_id != null) {
      puedeVer = await puedeAdministrarOrganizacion(
        usuario.id,
        f.organizacion_id,
        usuario.rol,
      );
    }
    if (puedeVer) protegerFilaInterna(f);
    else ocultarFila(f);
  }
  return filas;
}

// Ocultar: sustituye coordenadas reales por públicas y borra datos exactos.
function ocultarFila(fila) {
  const latPub = fila.latitude_publica ?? fila.latitude;
  const lngPub = fila.longitude_publica ?? fila.longitude;
  if (latPub != null) fila.ubicacion_aproximada = true;
  fila.latitude = latPub;
  fila.longitude = lngPub;
  delete fila.latitude_publica;
  delete fila.longitude_publica;
  delete fila.geom; // defensa extra: algunos SELECT legacy pueden traerla
  delete fila.direccion;
  delete fila.numero_direccion;
  delete fila.floor;
  delete fila.interior_apartment_number;
  delete fila.postal_code;
  delete fila.cedula_catastral;
  delete fila.matricula_inmobiliaria;
  delete fila.ubicacion_oculta_solicitada;
  return fila;
}

// Dueño/admin: solo limpia internos que no debe circular por JSON público.
function protegerFilaInterna(fila) {
  delete fila.ubicacion_oculta_solicitada; // interno de pagos
  return fila;
}

// ────────────────────────────────────────────────────────────────
// Expresiones SQL para listados y filtros espaciales.
// ────────────────────────────────────────────────────────────────
// SELECT de latitud/lng: devuelve la pública si está oculta, sino la real.
export function coordenadaSelectSQL(alias = "p") {
  return `(CASE WHEN ${alias}.ubicacion_oculta THEN COALESCE(${alias}.latitude_publica, ${alias}.latitude) ELSE ${alias}.latitude END)`;
}

const lngSelectSQL = (alias) =>
  `(CASE WHEN ${alias}.ubicacion_oculta THEN COALESCE(${alias}.longitude_publica, ${alias}.longitude) ELSE ${alias}.longitude END)`;

// Filtro espacial: usa geom_publica para ocultas y geom real para el resto.
// Maneja el caso en que geom_publica sea NULL (aún sin activar).
export function geomFiltroSQL(alias = "p") {
  return `COALESCE(CASE WHEN ${alias}.ubicacion_oculta THEN ${alias}.geom_publica END, ${alias}.geom)`;
}
