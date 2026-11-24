// Avisos del CRM por correo (migración 030): agrupación, plantilla y envío (sin BD ni SMTP).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  agruparPorUsuario,
  enviarAvisosPorCorreo,
  TIPOS_CON_CORREO_PROPIO,
} from "../src/lib/avisosCorreo.js";
import {
  asuntoResumenAvisos,
  htmlResumenAvisos,
  MAX_AVISOS_EN_CORREO,
  textoResumenAvisos,
} from "../src/utils/emails/resumenAvisos.js";

const fila = (id, usuario_id, extra = {}) => ({
  id: String(id),
  usuario_id,
  email: `u${usuario_id}@ejemplo.co`,
  nombre: `Usuario ${usuario_id}`,
  titulo: `Aviso ${id}`,
  cuerpo: null,
  url: "/tareas",
  organizacion: null,
  ...extra,
});

test("lead nuevo y coincidencias de demandas no se duplican por correo", () => {
  assert.deepEqual(TIPOS_CON_CORREO_PROPIO.sort(), ["demanda_coincidencias", "lead_nuevo"]);
});

test("agruparPorUsuario: un grupo por usuario, avisos más recientes primero", () => {
  const g = agruparPorUsuario([fila(1, 5), fila(3, 6), fila(2, 5)]);
  assert.equal(g.size, 2);
  assert.deepEqual(g.get(5).avisos.map((a) => a.id), ["2", "1"]);
  assert.equal(g.get(6).email, "u6@ejemplo.co");
});

test("asunto: el título si hay uno, el número si hay varios", () => {
  assert.equal(asuntoResumenAvisos([{ titulo: "Te asignaron a Ana" }]), "Te asignaron a Ana");
  assert.equal(asuntoResumenAvisos([{ titulo: "a" }, { titulo: "b" }]), "Tienes 2 avisos nuevos en el CRM");
});

test("la plantilla escapa HTML y solo enlaza rutas internas del CRM", () => {
  const html = htmlResumenAvisos({
    nombre: "<b>Ana</b>",
    crmUrl: "https://crm.ejemplo.co/",
    avisos: [
      { titulo: '<img src=x onerror="alert(1)">', cuerpo: "Visita <script>", url: "/agenda?visita=4" },
      { titulo: "Externo", url: "//malo.com" },
      { titulo: "Absoluto", url: "https://malo.com" },
    ],
  });
  assert.doesNotMatch(html, /<img|<script|<b>Ana/);
  assert.match(html, /https:\/\/crm\.ejemplo\.co\/agenda\?visita=4/);
  assert.doesNotMatch(html, /malo\.com/);
  assert.match(html, /crm\.ejemplo\.co\/ajustes/);
});

test("con muchos avisos se muestran los primeros y se cuenta el resto", () => {
  const avisos = Array.from({ length: MAX_AVISOS_EN_CORREO + 3 }, (_, i) => ({ titulo: `A${i}`, url: "/" }));
  assert.match(htmlResumenAvisos({ nombre: "Ana", avisos, crmUrl: null }), /Y 3 avisos más/);
  assert.match(textoResumenAvisos({ avisos, crmUrl: null }), /Y 3 más en el CRM/);
});

function bdFalsa(filas) {
  const consultas = [];
  return {
    consultas,
    query: async (sql, params) => {
      consultas.push({ sql, params });
      return { rows: /RETURNING/.test(sql) ? filas : [] };
    },
  };
}

test("un correo por usuario; la consulta excluye leídos, enviados y a quien lo apagó", async () => {
  const db = bdFalsa([fila(1, 5), fila(2, 5), fila(3, 6)]);
  const enviados = [];
  const r = await enviarAvisosPorCorreo({ db, transporter: { sendMail: async (m) => enviados.push(m) } });
  assert.deepEqual(r, { avisos: 3, correos: 2, fallidos: 0 });
  assert.deepEqual(enviados.map((m) => m.to).sort(), ["u5@ejemplo.co", "u6@ejemplo.co"]);
  const sql = db.consultas[0].sql;
  for (const cond of ["correo_enviado_at IS NULL", "leida_at IS NULL", "COALESCE(p.correo, true)", "SKIP LOCKED"]) {
    assert.ok(sql.includes(cond), cond);
  }
  assert.deepEqual(db.consultas[0].params[0], TIPOS_CON_CORREO_PROPIO);
});

test("si un envío falla, esos avisos se liberan para la siguiente pasada", async () => {
  const db = bdFalsa([fila(1, 5), fila(2, 6)]);
  const transporter = {
    sendMail: async (m) => {
      if (m.to === "u6@ejemplo.co") throw new Error("SMTP caído");
    },
  };
  const r = await enviarAvisosPorCorreo({ db, transporter });
  assert.deepEqual(r, { avisos: 2, correos: 1, fallidos: 1 });
  const liberar = db.consultas.find((c) => /SET correo_enviado_at = NULL/.test(c.sql));
  assert.deepEqual(liberar.params[0], ["2"]);
});

test("sin pendientes no se envía nada", async () => {
  const r = await enviarAvisosPorCorreo({ db: bdFalsa([]), transporter: { sendMail: async () => assert.fail() } });
  assert.deepEqual(r, { avisos: 0, correos: 0, fallidos: 0 });
});
