// Habeas Data: helpers de auditoría (sin BD).
import { test } from "node:test";
import assert from "node:assert/strict";
import { camposRectificados, puedeGestionarDatos, registrarAuditoria } from "../src/lib/habeasData.js";

test("camposRectificados detecta solo cambios de datos personales", () => {
  const antes = { nombre: "Ana", email: "a@x.com", telefono: null, tipo: "otro" };
  assert.deepEqual(camposRectificados(antes, { ...antes, tipo: "comprador" }), []);
  assert.deepEqual(camposRectificados(antes, { ...antes, nombre: "Ana María", telefono: "3001112233" }), ["nombre", "telefono"]);
  assert.deepEqual(camposRectificados(antes, { ...antes, email: undefined }), ["email"]);
});

test("puedeGestionarDatos: espacio personal o administrador de la inmobiliaria", () => {
  assert.equal(puedeGestionarDatos({ tipo: "personal" }), true);
  assert.equal(puedeGestionarDatos({ tipo: "org", rolEnOrg: "agency_admin" }), true);
  assert.equal(puedeGestionarDatos({ tipo: "org", rolEnOrg: "agent" }), false);
});

test("registrarAuditoria guarda el espacio, la acción y el detalle sin datos personales", async () => {
  const llamadas = [];
  const db = { query: async (sql, params) => llamadas.push({ sql, params }) };
  await registrarAuditoria({ tipo: "org", organizacionId: 7, usuarioId: 3 }, 42, "supresion", { visitas: 2 }, db);
  assert.match(llamadas[0].sql, /INSERT INTO crm_auditoria_datos \(organizacion_id,/);
  assert.deepEqual(llamadas[0].params, [7, 42, "supresion", 3, JSON.stringify({ visitas: 2 })]);
  await registrarAuditoria({ tipo: "personal", usuarioId: 3 }, 9, "exportacion", {}, db);
  assert.match(llamadas[1].sql, /\(usuario_id,/);
  await assert.rejects(() => registrarAuditoria({ tipo: "personal", usuarioId: 3 }, 9, "borrar_todo", {}, db));
});
