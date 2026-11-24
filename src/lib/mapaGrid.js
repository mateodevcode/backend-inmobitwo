// src/lib/mapaGrid.js — utilidades puras del mapa de inmuebles (sin BD).
// El endpoint /propiedades/mapa decide entre mandar los puntos (pocos) o
// agruparlos en una rejilla en el servidor (muchos), para que el mapa no
// reciba miles de filas ni se corte en un LIMIT arbitrario.
import { solicitudInvalida } from "./errores.js";

// Hasta cuántos inmuebles se mandan como puntos sueltos (el cliente los
// agrupa con supercluster sin volver a pedir al hacer zoom).
export const MAX_PUNTOS = 2000;
// Desde este zoom siempre se mandan puntos (un barrio no tiene miles).
export const ZOOM_SIEMPRE_PUNTOS = 15;
// Tamaño aproximado de cada grupo en pantalla (px) con agrupación en servidor.
const PX_CELDA = 70;

const num = (v) => (v === undefined || v === null || v === "" ? NaN : Number(v));

// Valida y normaliza el bbox y el zoom de la query. Lanza 400 si no sirven.
export function leerBboxMapa(query = {}) {
  const minLat = num(query.minLat);
  const minLng = num(query.minLng);
  const maxLat = num(query.maxLat);
  const maxLng = num(query.maxLng);
  if (![minLat, minLng, maxLat, maxLng].every(Number.isFinite)) {
    throw solicitudInvalida("minLat, minLng, maxLat y maxLng son requeridos y numéricos.");
  }
  if (minLat > maxLat || minLng > maxLng) {
    throw solicitudInvalida("El bbox está invertido.");
  }
  const zoomCrudo = num(query.zoom);
  const zoom = Number.isFinite(zoomCrudo) ? Math.min(22, Math.max(0, zoomCrudo)) : 12;
  return {
    minLat: Math.max(-90, minLat),
    maxLat: Math.min(90, maxLat),
    minLng: Math.max(-180, minLng),
    maxLng: Math.min(180, maxLng),
    zoom,
  };
}

// Lado de la celda de la rejilla en grados para un zoom dado: un tile de
// 256 px mide 360 / 2^z grados, así que PX_CELDA px son esa fracción.
export function tamanoCelda(zoom) {
  const z = Math.max(0, Math.floor(zoom));
  return (360 / 2 ** z) * (PX_CELDA / 256);
}

export function debeAgrupar(total, zoom) {
  return zoom < ZOOM_SIEMPRE_PUNTOS && total > MAX_PUNTOS;
}
