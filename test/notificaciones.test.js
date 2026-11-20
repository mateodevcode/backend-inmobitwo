// Servicio de avisos del CRM (sin BD: se usa un db falso).
import { test } from "node:test";
import assert from "node:assert/strict";
import { destinatariosUnicos, fechaCortaBogota, notificar } from "../src/lib/notificaciones.js";

const dbFalso = () => {
  const llamadas = [];
  return {
    llamadas,
    query: async (sql, params) => {
      llamadas.push({ sql, params });
      return { rowCount: params[0].length, rows: [] };
    },
  };
};

test("destinatariosUnicos quita repetidos, inválidos y a quien actuó", () => {
  assert.deepEqual(destinatariosUnicos([3, "3", 5, null, 0, -1, "x", 7], 5), [3, 7]);
  assert.deepEqual(destinatariosUnicos(undefined), []);
});

test("notificar inserta un aviso por destinatario y recorta textos", async () => {
  const db = dbFalso();
  const n = await notificar(
    { destinatarios: [4, 9, 4], organizacionId: 2, tipo: "tarea_asignada", titulo: "  Nueva   tarea ".padEnd(300, "x"), url: "/tareas", actorId: 9 },
    db,
  );
  assert.equal(n, 1);
  const [ids, org, tipo, titulo, cuerpo, url, clave, actor] = db.llamadas[0].params;
  assert.deepEqual(ids, [4]);
  assert.equal(org, 2);
  assert.equal(tipo, "tarea_asignada");
  assert.equal(titulo.length, 200);
  assert.ok(titulo.startsWith("Nueva tarea"));
  assert.equal(cuerpo, null);
  assert.equal(url, "/tareas");
  assert.equal(clave, null);
  assert.equal(actor, 9);
  assert.match(db.llamadas[0].sql, /ON CONFLICT \(usuario_id, clave\)/);
});

test("notificar ignora tipos desconocidos, URLs externas y sin destinatarios", async () => {
  const db = dbFalso();
  assert.equal(await notificar({ destinatarios: [1], tipo: "spam", titulo: "x" }, db), 0);
  assert.equal(await notificar({ destinatarios: [1], tipo: "lead_nuevo", titulo: "x" }, db), 1);
  assert.equal(db.llamadas.length, 1);
  await notificar({ destinatarios: [1], tipo: "lead_nuevo", titulo: "x", url: "https://malo.com" }, db);
  assert.equal(db.llamadas[1].params[5], null);
  assert.equal(await notificar({ destinatarios: [7], tipo: "lead_nuevo", titulo: "x", actorId: 7 }, db), 0);
});

test("notificar nunca lanza aunque falle la BD", async () => {
  const original = console.error;
  console.error = () => {};
  try {
    const n = await notificar(
      { destinatarios: [1], tipo: "lead_nuevo", titulo: "x" },
      { query: async () => { throw new Error("caída"); } },
    );
    assert.equal(n, 0);
  } finally {
    console.error = original;
  }
});

test("fechaCortaBogota usa la hora de Colombia", () => {
  const texto = fechaCortaBogota("2026-11-24T20:30:00Z");
  assert.match(texto, /24/);
  assert.match(texto, /3:30/);
});
