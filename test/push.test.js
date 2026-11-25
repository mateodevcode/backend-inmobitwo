// Push web (migración 031): validación de suscripciones y envío por app (sin BD ni red).
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { suscripcionValida } from "../src/controllers/push.controller.js";
import { enviarPushUsuarios, pushHabilitado } from "../src/lib/busquedasGuardadas/notificadorPush.js";

const ENV = { ...process.env };
afterEach(() => {
  for (const k of ["PUSH_ENABLED", "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"]) {
    if (ENV[k] === undefined) delete process.env[k];
    else process.env[k] = ENV[k];
  }
});
const encender = () =>
  Object.assign(process.env, {
    PUSH_ENABLED: "true",
    VAPID_PUBLIC_KEY: "pub",
    VAPID_PRIVATE_KEY: "priv",
    VAPID_SUBJECT: "mailto:soporte@ejemplo.co",
  });

const SUB = { endpoint: "https://fcm.googleapis.com/fcm/send/abc123", keys: { p256dh: "B".repeat(87), auth: "a".repeat(22) } };

test("suscripcionValida: https y claves base64url", () => {
  assert.equal(suscripcionValida(SUB), true);
  assert.equal(suscripcionValida({ ...SUB, endpoint: "http://fcm.googleapis.com/x" }), false);
  assert.equal(suscripcionValida({ ...SUB, endpoint: "javascript:alert(1)" }), false);
  assert.equal(suscripcionValida({ ...SUB, keys: { p256dh: "<script>", auth: "a".repeat(22) } }), false);
  assert.equal(suscripcionValida(null), false);
});

test("sin PUSH_ENABLED o sin claves VAPID no se envía nada", async () => {
  process.env.PUSH_ENABLED = "true";
  delete process.env.VAPID_PRIVATE_KEY;
  assert.equal(pushHabilitado(), false);
  const db = { query: async () => assert.fail("no debe consultar") };
  assert.equal((await enviarPushUsuarios([1], { titulo: "x" }, { app: "crm", db })).size, 0);
});

test("envía solo a las suscripciones de esa app y borra las muertas", async () => {
  encender();
  const consultas = [];
  const db = {
    query: async (sql, params) => {
      consultas.push({ sql, params });
      if (/^SELECT/.test(sql)) {
        return {
          rows: [
            { id: 1, usuario_id: 5, endpoint: "https://a", p256dh: "k", auth: "a" },
            { id: 2, usuario_id: 6, endpoint: "https://muerta", p256dh: "k", auth: "a" },
          ],
        };
      }
      return { rows: [] };
    },
  };
  const enviados = [];
  const wp = {
    sendNotification: async (sub, cuerpo) => {
      if (sub.endpoint === "https://muerta") throw Object.assign(new Error("gone"), { statusCode: 410 });
      enviados.push(JSON.parse(cuerpo));
    },
  };
  const r = await enviarPushUsuarios([5, 6], { titulo: "Hola" }, { app: "crm", db, wp });
  assert.deepEqual([...r], [5]);
  assert.deepEqual(enviados, [{ titulo: "Hola" }]);
  assert.deepEqual(consultas[0].params, [[5, 6], "crm"]);
  assert.match(consultas[0].sql, /app = \$2/);
  assert.ok(consultas.some((c) => /DELETE FROM push_subscriptions/.test(c.sql) && c.params[0] === 2));
});

test("una app desconocida no consulta nada", async () => {
  encender();
  const db = { query: async () => assert.fail("no debe consultar") };
  assert.equal((await enviarPushUsuarios([1], {}, { app: "otra", db })).size, 0);
});
