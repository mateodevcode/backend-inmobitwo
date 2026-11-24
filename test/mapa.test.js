// test/mapa.test.js — utilidades puras del mapa de inmuebles (sin BD).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  leerBboxMapa,
  tamanoCelda,
  debeAgrupar,
  MAX_PUNTOS,
  ZOOM_SIEMPRE_PUNTOS,
} from "../src/lib/mapaGrid.js";
import { HttpError } from "../src/lib/errores.js";

test("leerBboxMapa: convierte los strings de la query a números", () => {
  const b = leerBboxMapa({ minLat: "4.5", minLng: "-74.2", maxLat: "4.8", maxLng: "-74", zoom: "12.6" });
  assert.deepEqual(b, { minLat: 4.5, minLng: -74.2, maxLat: 4.8, maxLng: -74, zoom: 12.6 });
});

test("leerBboxMapa: sin zoom usa 12 y recorta latitudes/longitudes fuera de rango", () => {
  const b = leerBboxMapa({ minLat: "-95", minLng: "-200", maxLat: "95", maxLng: "200" });
  assert.deepEqual(b, { minLat: -90, minLng: -180, maxLat: 90, maxLng: 180, zoom: 12 });
});

test("leerBboxMapa: 400 si falta un borde, no es número o está invertido", () => {
  for (const q of [
    { minLat: "1", minLng: "1", maxLat: "2" },
    { minLat: "x", minLng: "1", maxLat: "2", maxLng: "2" },
    { minLat: "3", minLng: "1", maxLat: "2", maxLng: "2" },
    { minLat: "", minLng: "1", maxLat: "2", maxLng: "2" },
  ]) {
    assert.throws(() => leerBboxMapa(q), (e) => e instanceof HttpError && e.status === 400);
  }
});

test("tamanoCelda: se divide entre dos con cada nivel de zoom", () => {
  assert.ok(Math.abs(tamanoCelda(10) / tamanoCelda(11) - 2) < 1e-9);
  assert.equal(tamanoCelda(10.9), tamanoCelda(10));
  assert.ok(tamanoCelda(6) > 1 && tamanoCelda(6) < 2);
});

test("debeAgrupar: solo con muchos inmuebles y zoom por debajo del de barrio", () => {
  assert.equal(debeAgrupar(MAX_PUNTOS, 8), false);
  assert.equal(debeAgrupar(MAX_PUNTOS + 1, 8), true);
  assert.equal(debeAgrupar(MAX_PUNTOS + 1, ZOOM_SIEMPRE_PUNTOS), false);
});
