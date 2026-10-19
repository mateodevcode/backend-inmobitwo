// test/ubicacion.test.js
// Regresión de privacidad: una fila con ubicacion_oculta NUNCA debe exponer la
// coordenada real, ni siquiera si latitude_publica/longitude_publica son NULL.

import test from "node:test";
import assert from "node:assert/strict";
import {
  aplicarPrivacidadUbicacion,
  coordenadaSelectSQL,
  geomFiltroSQL,
} from "../src/lib/ubicacion.service.js";

test("oculta sin punto público: coordenadas null (nunca la real)", async () => {
  const filas = [
    {
      id: 1,
      ubicacion_oculta: true,
      publicado_por_id: 1,
      latitude: 4.65,
      longitude: -74.05,
      latitude_publica: null,
      longitude_publica: null,
      direccion: "Calle 1 #2-3",
      geom: "POINT(-74.05 4.65)",
    },
  ];
  await aplicarPrivacidadUbicacion(filas, null); // anónimo
  assert.equal(filas[0].latitude, null);
  assert.equal(filas[0].longitude, null);
  assert.equal(filas[0].ubicacion_aproximada, true);
  assert.equal(filas[0].direccion, undefined);
  assert.equal(filas[0].geom, undefined);
});

test("oculta con punto público: usa solo el público", async () => {
  const filas = [
    {
      id: 2,
      ubicacion_oculta: true,
      latitude: 4.65,
      longitude: -74.05,
      latitude_publica: 4.66,
      longitude_publica: -74.06,
    },
  ];
  await aplicarPrivacidadUbicacion(filas, null);
  assert.equal(filas[0].latitude, 4.66);
  assert.equal(filas[0].longitude, -74.06);
  assert.equal(filas[0].ubicacion_aproximada, true);
});

test("SQL de coordenadas no cae a la real para ocultas", () => {
  assert.doesNotMatch(coordenadaSelectSQL("p"), /COALESCE/);
  assert.match(coordenadaSelectSQL("p"), /THEN p\.latitude_publica/);
});

test("filtro espacial no cae a geom real para ocultas", () => {
  assert.doesNotMatch(geomFiltroSQL("p"), /COALESCE/);
  assert.match(
    geomFiltroSQL("p"),
    /THEN p\.geom_publica ELSE p\.geom END/,
  );
});
