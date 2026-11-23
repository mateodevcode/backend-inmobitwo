// resolverAsignado: a quién se le puede asignar un registro del CRM (sin BD).
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolverAsignado } from "../src/lib/crmPermisos.js";

const AGENTE = { tipo: "org", organizacionId: 1, usuarioId: 5, rolEnOrg: "agent" };
const ADMIN = { tipo: "org", organizacionId: 1, usuarioId: 6, rolEnOrg: "agency_admin" };
const PERSONAL = { tipo: "personal", usuarioId: 9 };

// BD falsa: miembros activos de la org 1 = {5, 6}.
function bd() {
  const llamadas = [];
  return {
    llamadas,
    query: async (sql, params) => {
      llamadas.push({ sql, params });
      const [usuario, org] = params;
      return { rows: org === 1 && [5, 6].includes(usuario) ? [{ "?column?": 1 }] : [] };
    },
  };
}

test("el agente siempre queda como responsable, pida lo que pida", async () => {
  const db = bd();
  assert.equal(await resolverAsignado(db, AGENTE, 6, null), 5);
  assert.equal(await resolverAsignado(db, AGENTE, 1, null), 5);
  assert.equal(await resolverAsignado(db, AGENTE, undefined, null), 5);
  assert.equal(db.llamadas.length, 0);
});

test("el admin asigna a un miembro activo", async () => {
  const db = bd();
  assert.equal(await resolverAsignado(db, ADMIN, "5", null), 5);
  assert.deepEqual(db.llamadas[0].params, [5, 1]);
  assert.match(db.llamadas[0].sql, /estado = 'activo'/);
});

test("el admin no puede asignar a alguien de fuera de la inmobiliaria", async () => {
  await assert.rejects(() => resolverAsignado(bd(), ADMIN, 1, null), { status: 400, message: /miembro activo/ });
});

test("ids no válidos dan 400 sin consultar la BD", async () => {
  const db = bd();
  for (const malo of ["abc", -3, 0, 2.5, "5; DROP TABLE x"]) {
    await assert.rejects(() => resolverAsignado(db, ADMIN, malo, null), { status: 400 });
  }
  assert.equal(db.llamadas.length, 0);
});

test("sin pedido se usa el valor por defecto", async () => {
  assert.equal(await resolverAsignado(bd(), ADMIN, undefined, null), null);
  assert.equal(await resolverAsignado(bd(), ADMIN, null, 6), 6);
  assert.equal(await resolverAsignado(bd(), ADMIN, "", 6), 6);
  assert.equal(await resolverAsignado(bd(), PERSONAL, undefined, null), null);
});

test("en el espacio personal solo se asigna a uno mismo", async () => {
  const db = bd();
  assert.equal(await resolverAsignado(db, PERSONAL, 1, null), 9);
  assert.equal(db.llamadas.length, 0);
});

// propiedadEnEspacio: qué inmueble se puede enlazar a una oportunidad, visita o actividad.
import { propiedadEnEspacio } from "../src/lib/crmPermisos.js";

function bdPropiedades() {
  // id 10: org 1 (publicado por 6) · id 20: personal del usuario 9 · id 30: org 2
  const props = [
    { id: 10, org: 1, autor: 6 },
    { id: 20, org: null, autor: 9 },
    { id: 30, org: 2, autor: 7 },
  ];
  const llamadas = [];
  return {
    llamadas,
    query: async (sql, [id, dueno]) => {
      llamadas.push(sql);
      const p = props.find((x) => x.id === Number(id));
      const ok = p && (sql.includes("publicado_por_id = $2") ? p.autor === dueno && p.org === null : p.org === dueno);
      return { rows: ok ? [{ id: p.id }] : [] };
    },
  };
}

test("en una org, cualquier miembro enlaza inmuebles de su inmobiliaria y no de otra", async () => {
  const db = bdPropiedades();
  assert.deepEqual(await propiedadEnEspacio(db, AGENTE, 10), { id: 10 });
  assert.equal(await propiedadEnEspacio(db, ADMIN, 30), null);
  assert.equal(await propiedadEnEspacio(db, ADMIN, 20), null);
});

test("en el espacio personal solo los inmuebles propios sin organización", async () => {
  const db = bdPropiedades();
  assert.deepEqual(await propiedadEnEspacio(db, PERSONAL, "20"), { id: 20 });
  assert.equal(await propiedadEnEspacio(db, PERSONAL, 10), null);
});

test("un id no numérico no llega a la BD", async () => {
  const db = bdPropiedades();
  assert.equal(await propiedadEnEspacio(db, ADMIN, "10 OR 1=1"), null);
  assert.equal(db.llamadas.length, 0);
});
