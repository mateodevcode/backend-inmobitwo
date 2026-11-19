// test/base.test.js — utilidades comunes del backend (Fase 2).
import { test } from "node:test";
import assert from "node:assert/strict";
import { duenoEspacio, identificadorSql, whereEspacioPropio } from "../src/lib/crmPermisos.js";
import { HttpError, noEncontrado } from "../src/lib/errores.js";
import { HttpError as HttpErrorOfertas } from "../src/lib/ofertas.service.js";
import { errorHandler } from "../src/middleware/error.middleware.js";

function resFalsa() {
  const res = { statusCode: 200, body: undefined };
  res.status = (c) => ((res.statusCode = c), res);
  res.json = (b) => ((res.body = b), res);
  return res;
}

// ── crmPermisos ───────────────────────────────────────────────
test("duenoEspacio: personal usa usuario_id, org usa organizacion_id", () => {
  assert.deepEqual(duenoEspacio({ tipo: "personal", usuarioId: 3 }), {
    col: "usuario_id", val: 3, cols: "usuario_id", vals: [3],
  });
  assert.equal(duenoEspacio({ tipo: "org", organizacionId: 9 }).col, "organizacion_id");
});

test("identificadorSql: acepta columnas y alias.columna", () => {
  assert.equal(identificadorSql("created_at"), "created_at");
  assert.equal(identificadorSql("o.cerrada_at"), "o.cerrada_at");
});

test("identificadorSql: rechaza cualquier cosa que no sea un identificador", () => {
  for (const malo of ["id; DROP TABLE x", "a b", "1col", "c.id--", "", null, "x)"]) {
    assert.throws(() => identificadorSql(malo), malo);
  }
});

test("whereEspacioPropio: agente ve lo asignado o creado por él en su org", () => {
  const r = whereEspacioPropio({ tipo: "org", rolEnOrg: "agent", organizacionId: 4, usuarioId: 8 }, "c");
  assert.match(r.where, /c\.organizacion_id = \$1/);
  assert.match(r.where, /asignado_a_id = \$2 OR c\.creado_por_id = \$2/);
  assert.deepEqual(r.params, [4, 8]);
  assert.throws(() => whereEspacioPropio({ tipo: "personal", usuarioId: 1 }, "c;--"));
});

// ── errores ───────────────────────────────────────────────────
test("HttpError: ofertas.service reexporta la misma clase", () => {
  assert.equal(HttpErrorOfertas, HttpError);
});

test("errorHandler: un HttpError responde con su status y mensaje", () => {
  const res = resFalsa();
  errorHandler(noEncontrado("Contacto no encontrado."), { method: "GET", originalUrl: "/x" }, res);
  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.body, { success: false, error: "Contacto no encontrado." });
});

test("errorHandler: un error cualquiera es 500 genérico", () => {
  const previo = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  const errorOriginal = console.error;
  console.error = () => {};
  const res = resFalsa();
  try {
    errorHandler(new Error('relation "x" does not exist'), { method: "GET", originalUrl: "/x" }, res);
  } finally {
    console.error = errorOriginal;
    process.env.NODE_ENV = previo;
  }
  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, { success: false, error: "Error interno del servidor." });
});
