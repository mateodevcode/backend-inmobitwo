// Endpoints públicos (auditoría N-08, N-11): qué sale y qué se rechaza (sin BD ni red).
import { test } from "node:test";
import assert from "node:assert/strict";
import { CAMPOS_ORGANIZACION, organizacionPublica } from "../src/constants/api/fields.js";
import { getGeocode } from "../src/controllers/geocode.controllers.js";

const ORG = {
  id: 1,
  nombre: "Inmobiliaria X",
  email: "info@x.co",
  telefono: "3001112233",
  slug: "x",
  tema: "tema1",
  logo_url: null,
  creada_por_id: 6,
  plan: "premium",
  estado: "aprobada",
  logo_public_id: "inmobitwo/logos/x.png",
  custom_domain: "x.co",
  dominio_estado: "pendiente_dns",
  created_at: "2026-01-01",
};

test("organizacionPublica solo deja los campos públicos", () => {
  const o = organizacionPublica(ORG);
  assert.deepEqual(Object.keys(o).sort(), [...CAMPOS_ORGANIZACION.publicos].sort());
  for (const oculto of ["creada_por_id", "plan", "estado", "logo_public_id", "dominio_estado"]) {
    assert.equal(oculto in o, false, oculto);
  }
  assert.equal(o.email, "info@x.co");
});

test("el dominio propio solo se publica si está activo", () => {
  assert.equal(organizacionPublica(ORG).custom_domain, null);
  assert.equal(organizacionPublica({ ...ORG, dominio_estado: "activo" }).custom_domain, "x.co");
});

test("organizacionPublica(null) es null", () => {
  assert.equal(organizacionPublica(null), null);
  assert.equal(organizacionPublica(undefined), null);
});

function llamarGeocode(query) {
  const out = {};
  const res = { status(s) { out.status = s; return this; }, json(b) { out.body = b; return this; } };
  return getGeocode({ query }, res).then(() => out);
}

test("geocode rechaza direcciones vacías, cortas, larguísimas o que no son texto", async () => {
  for (const address of [undefined, "abc", "x".repeat(201), ["calle 1", "calle 2"]]) {
    const r = await llamarGeocode({ address });
    assert.equal(r.status, 400, JSON.stringify(address)?.slice(0, 30));
  }
});
