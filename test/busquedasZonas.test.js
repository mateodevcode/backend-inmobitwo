// test/busquedasZonas.test.js — búsquedas guardadas con varias zonas (sin BD).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizarFiltros,
  validarFiltros,
  hashFiltros,
} from "../src/lib/busquedasGuardadas/filtros.js";

test("normalizarFiltros: zonas se ordenan sin duplicados y conservan mayúsculas", () => {
  const f = normalizarFiltros({
    operation: "Venta",
    type: "apartamento",
    zonas: "municipio:11001,barrio:B9x,municipio:11001",
  });
  assert.equal(f.zonas, "barrio:B9x,municipio:11001");
  assert.equal(f.operation, "venta");
});

test("hashFiltros: el orden de las zonas no cambia la búsqueda guardada", () => {
  const a = normalizarFiltros({ operation: "venta", type: "casa", zonas: "municipio:1,municipio:2" });
  const b = normalizarFiltros({ operation: "venta", type: "casa", zonas: "municipio:2,municipio:1" });
  assert.equal(hashFiltros(a), hashFiltros(b));
});

test("validarFiltros: con zonas no hace falta departamento", () => {
  assert.deepEqual(validarFiltros({ operation: "venta", type: "casa", zonas: "municipio:11001" }), []);
  assert.deepEqual(validarFiltros({ operation: "venta", type: "casa" }), ["Falta el departamento."]);
});

test("validarFiltros: zonas inválidas dan error legible", () => {
  const errores = validarFiltros({ operation: "venta", type: "casa", zonas: "pais:co" });
  assert.equal(errores.length, 1);
  assert.match(errores[0], /Tipo de zona no válido/);
});
