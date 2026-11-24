// test/zonas.test.js — búsqueda por varias zonas (lib/zonas.js, sin BD).
import { test } from "node:test";
import assert from "node:assert/strict";
import { leerZonas, filtroZonasSQL, MAX_ZONAS } from "../src/lib/zonas.js";
import { HttpError } from "../src/lib/errores.js";

const es400 = (e) => e instanceof HttpError && e.status === 400;

test("leerZonas: acepta el formato de la URL y quita duplicados", () => {
  assert.deepEqual(leerZonas("municipio:11001, barrio:110010101,municipio:11001"), [
    { tipo: "municipio", codigo: "11001" },
    { tipo: "barrio", codigo: "110010101" },
  ]);
});

test("leerZonas: acepta la lista de objetos del body", () => {
  assert.deepEqual(leerZonas([{ tipo: "region", codigo: "caribe" }]), [
    { tipo: "region", codigo: "caribe" },
  ]);
});

test("leerZonas: rechaza tipos raros, códigos con SQL, vacíos y demasiadas zonas", () => {
  assert.throws(() => leerZonas("pais:co"), es400);
  assert.throws(() => leerZonas("municipio:1' OR '1'='1"), es400);
  assert.throws(() => leerZonas("municipio:"), es400);
  assert.throws(() => leerZonas(""), es400);
  assert.throws(() => leerZonas(undefined), es400);
  const muchas = Array.from({ length: MAX_ZONAS + 1 }, (_, i) => `municipio:${i}`).join(",");
  assert.throws(() => leerZonas(muchas), es400);
});

test("filtroZonasSQL: un parámetro (array) por tipo, unidos con OR", () => {
  const params = ["venta"];
  const sql = filtroZonasSQL(
    leerZonas("municipio:11001,municipio:05001,barrio:B1,departamento:76"),
    params,
  );
  assert.deepEqual(params, ["venta", ["76"], ["11001", "05001"], ["B1"]]);
  assert.match(sql, /s\.dane_code = ANY\(\$2::text\[\]\)/);
  assert.match(sql, /c\.dane_code = ANY\(\$3::text\[\]\)/);
  assert.match(sql, /b\.dane_code = ANY\(\$4::text\[\]\)/);
  assert.equal(sql.match(/ OR /g).length, 2);
  assert.doesNotMatch(sql, /11001|05001/); // los códigos nunca van en el SQL
});

test("filtroZonasSQL: regiones por slug a través de states.region_id", () => {
  const params = [];
  const sql = filtroZonasSQL(leerZonas("region:caribe"), params);
  assert.deepEqual(params, [["caribe"]]);
  assert.match(sql, /r\.slug = ANY\(\$1::text\[\]\)/);
});
