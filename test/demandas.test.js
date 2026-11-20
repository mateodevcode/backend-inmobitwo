// test/demandas.test.js — validación de demandas y correo de avisos (sin BD).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  actualizarDemandaSchema,
  coincidenciasSchema,
  crearDemandaSchema,
  seguimientoSchema,
  validar,
} from "../src/validations/demanda.schema.js";
import { HttpError } from "../src/lib/errores.js";
import { asuntoCoincidencias, htmlCoincidencias } from "../src/utils/emails/coincidenciasDemanda.js";

const base = { contacto_id: 4, operacion: "venta" };

test("crear: mínimo contacto y operación", () => {
  const d = validar(crearDemandaSchema, base);
  assert.equal(d.operacion, "venta");
  assert.equal(d.contacto_id, 4);
});

test("crear: listas sin duplicados y números desde texto", () => {
  const d = validar(crearDemandaSchema, {
    ...base,
    city_ids: ["5", 5, 7],
    property_type_ids: [1, 1],
    precio_max: "450000000",
    habitaciones_min: "3",
  });
  assert.deepEqual(d.city_ids, [5, 7]);
  assert.deepEqual(d.property_type_ids, [1]);
  assert.equal(d.precio_max, 450000000);
  assert.equal(d.habitaciones_min, 3);
});

test("crear: rechaza operación desconocida, rangos invertidos y campos extra", () => {
  for (const malo of [
    { ...base, operacion: "permuta" },
    { ...base, precio_min: 500, precio_max: 100 },
    { ...base, area_min: 90, area_max: 40 },
    { ...base, estratos: [7] },
    { ...base, organizacion_id: 3 },
  ]) {
    assert.throws(() => validar(crearDemandaSchema, malo), (e) => e instanceof HttpError && e.status === 400, JSON.stringify(malo));
  }
});

test("actualizar: todo opcional, acepta estado y null para limpiar un filtro", () => {
  assert.deepEqual(validar(actualizarDemandaSchema, { estado: "pausada" }), { estado: "pausada" });
  assert.equal(validar(actualizarDemandaSchema, { precio_max: null }).precio_max, null);
  assert.throws(() => validar(actualizarDemandaSchema, { contacto_id: 9 }));
});

test("coincidencias: alcance por defecto cartera y banderas booleanas", () => {
  const q = validar(coincidenciasSchema, { incluir_descartadas: "1" });
  assert.equal(q.alcance, "cartera");
  assert.equal(q.incluir_descartadas, true);
  assert.equal(q.solo_nuevas, false);
  assert.throws(() => validar(coincidenciasSchema, { alcance: "todo" }));
});

test("seguimiento: solo enviada o descartada", () => {
  assert.equal(validar(seguimientoSchema, { estado: "enviada" }).estado, "enviada");
  assert.throws(() => validar(seguimientoSchema, { estado: "vista" }));
});

test("correo de avisos: suma nuevos, escapa HTML y enlaza cada demanda", () => {
  const demandas = [
    { id: 3, contacto_nombre: "<b>Ana</b>", nuevos: 2, ejemplos: ["Casa <x>", null] },
    { id: 8, contacto_nombre: "Luis", nuevos: 1, ejemplos: [] },
  ];
  assert.equal(asuntoCoincidencias(demandas), "3 inmuebles nuevos coinciden con tus clientes");
  assert.equal(asuntoCoincidencias([demandas[1]]), "1 inmueble nuevo coincide con tus clientes");
  const html = htmlCoincidencias({ agente: "Mateo", demandas, crmUrl: "https://crm.x.co/" });
  assert.doesNotMatch(html, /<b>Ana|<x>/);
  assert.match(html, /https:\/\/crm\.x\.co\/demandas\?demanda=3/);
  assert.match(html, /https:\/\/crm\.x\.co\/demandas\?demanda=8/);
});
