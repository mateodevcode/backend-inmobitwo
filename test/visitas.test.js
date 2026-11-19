// test/visitas.test.js — validación de visitas (sin BD).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  actualizarVisitaSchema,
  crearVisitaSchema,
  estadoVisitaSchema,
  filtrosVisitasSchema,
  validar,
} from "../src/validations/visita.schema.js";
import { HttpError } from "../src/lib/errores.js";
import {
  asuntoRecordatorioVisita,
  htmlRecordatorioVisita,
} from "../src/utils/emails/recordatorioVisita.js";

const base = { contacto_id: 5, inicio_at: "2026-11-20T15:00:00-05:00" };

test("crear: aplica valores por defecto (60 min y aviso 60 min antes)", () => {
  const d = validar(crearVisitaSchema, base);
  assert.equal(d.duracion_min, 60);
  assert.equal(d.recordatorio_minutos, 60);
  assert.equal(d.forzar, false);
});

test("crear: acepta ids como texto y recordatorio null", () => {
  const d = validar(crearVisitaSchema, { ...base, contacto_id: "5", recordatorio_minutos: null });
  assert.equal(d.contacto_id, 5);
  assert.equal(d.recordatorio_minutos, null);
});

test("crear: textos vacíos se guardan como null", () => {
  const d = validar(crearVisitaSchema, { ...base, lugar: "   ", notas: "" });
  assert.equal(d.lugar, null);
  assert.equal(d.notas, null);
});

test("crear: rechaza fecha sin zona, duración fuera de rango y sin contacto", () => {
  for (const malo of [
    { ...base, inicio_at: "2026-11-20 15:00" },
    { ...base, duracion_min: 5 },
    { ...base, duracion_min: 600 },
    { inicio_at: base.inicio_at },
  ]) {
    assert.throws(() => validar(crearVisitaSchema, malo), (e) => e instanceof HttpError && e.status === 400);
  }
});

test("validar: devuelve todos los mensajes como array", () => {
  try {
    validar(crearVisitaSchema, {});
    assert.fail("debió lanzar");
  } catch (e) {
    assert.ok(Array.isArray(e.error));
    assert.ok(e.error.length >= 2);
  }
});

test("actualizar: no permite cambiar el contacto", () => {
  assert.throws(() => validar(actualizarVisitaSchema, { contacto_id: 3 }));
  assert.deepEqual(validar(actualizarVisitaSchema, { notas: "hola" }), { notas: "hola", forzar: false });
});

test("estado: solo estados e intereses conocidos", () => {
  assert.equal(validar(estadoVisitaSchema, { estado: "realizada", resultado_interes: "alto" }).estado, "realizada");
  assert.throws(() => validar(estadoVisitaSchema, { estado: "terminada" }));
  assert.throws(() => validar(estadoVisitaSchema, { estado: "realizada", resultado_interes: "muy alto" }));
});

test("filtros: fechas aaaa-mm-dd", () => {
  assert.equal(validar(filtrosVisitasSchema, { desde: "2026-11-01", hasta: "2026-11-30" }).desde, "2026-11-01");
  assert.throws(() => validar(filtrosVisitasSchema, { desde: "01/11/2026" }));
});

test("correo de recordatorio: escapa HTML del contacto y enlaza a la agenda", () => {
  const v = {
    id: 9,
    inicio_at: "2026-11-20T20:00:00Z",
    contacto_nombre: '<script>alert(1)</script>',
    agente_nombre: "Ana",
    lugar: "Calle 72",
  };
  const html = htmlRecordatorioVisita(v, "https://crm.ejemplo.co/");
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /https:\/\/crm\.ejemplo\.co\/agenda\?visita=9/);
  assert.match(asuntoRecordatorioVisita(v), /3:00/);
});
