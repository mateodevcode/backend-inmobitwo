// src/lib/ubicacion.service.js
// Privacidad de ubicación para anuncios con ubicacion_oculta=true.
// Reglas:
// - El dueño / agency_admin de la org / superadmin SIEMPRE ve la ubicación real.
// - Cualquiera más (o anónimos) ve solo la coordenada pública (desplazada),
//   NUNCA direccion, numero_direccion, floor, interior, postal_code ni geom real.
// - En filtros/orden espaciales se usa geom_publica para los ocultos
//   (ver expresiones SQL al final) para que no se pueda triangular
//   achicando el bbox o el radio.

import crypto from "crypto";
import { puedeAdministrarOrganizacion } from "./organizacionPermisos.js";

export const RADIO_ZONA_UBICACION_M = 500;

const DESPLAZAMIENTO_MIN_M = 150;
const DESPLAZAMIENTO_MAX_M = 400; // zona aproximada ~radio 500m

// ────────────────────────────────────────────────────────────────
// Punto público: desplazamiento aleatorio 150–400 m, rumbo aleatorio,
// criptográficamente aleatorio (crypto), calculado UNA sola vez.
// ────────────────────────────────────────────────────────────────
export function calcularPuntoPublico(latReal, lngReal) {
  if (!Number.isFinite(latReal) || !Number.isFinite(lngReal)) {
    throw new Error("Coordenadas reales inválidas para generar punto público");
  }
  const distancia =
    DESPLAZAMIENTO_MIN_M +
    crypto.randomInt(0, DESPLAZAMIENTO_MAX_M - DESPLAZAMIENTO_MIN_M + 1);
  const rumbo = crypto.randomInt(0, 360) * (Math.PI / 180);

  const deltaLat = (distancia * Math.cos(rumbo)) / 111320;
  const deltaLng =
    (distancia * Math.sin(rumbo)) /
    (111320 * Math.cos((latReal * Math.PI) / 180));

  return {
    lat: Number((latReal + deltaLat).toFixed(8)),
    lng: Number((lngReal + deltaLng).toFixed(8)),
  };
}

// Distancia aproximada en metros entre dos puntos (para anti-triangulación).
export function distanciaMetros(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

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
  // NUNCA caer a la coordenada real: si una fila oculta no tiene punto público
  // (legacy/corrupción), se devuelve sin coordenadas en lugar de filtrar la
  // ubicación exacta.
  const tienePublica =
    fila.latitude_publica != null && fila.longitude_publica != null;
  fila.ubicacion_aproximada = true; // oculta = aproximada (haya o no punto)
  fila.latitude = tienePublica ? fila.latitude_publica : null;
  fila.longitude = tienePublica ? fila.longitude_publica : null;
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
  return `(CASE WHEN ${alias}.ubicacion_oculta THEN ${alias}.latitude_publica ELSE ${alias}.latitude END)`;
}

const lngSelectSQL = (alias) =>
  `(CASE WHEN ${alias}.ubicacion_oculta THEN ${alias}.longitude_publica ELSE ${alias}.longitude END)`;

// Filtro espacial: usa geom_publica para ocultas y geom real para el resto.
// Si una oculta no tiene geom_publica, queda fuera del filtro (NULL): nunca se
// usa la geom real como fallback.
export function geomFiltroSQL(alias = "p") {
  return `(CASE WHEN ${alias}.ubicacion_oculta THEN ${alias}.geom_publica ELSE ${alias}.geom END)`;
}
