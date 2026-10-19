// test/pagos.integration.test.js
// Integración de pagos contra Postgres LOCAL (docker postgres_local_dev:5433).
// No usa la BD de producción: crea un esquema mínimo en inmobitwo_pagos_test y
// mockea fetch (nunca llama a Mercado Pago).
//
// Ejecutar:
//   DB_HOST=localhost DB_PORT=5433 DB_USER=pagos_test DB_PASSWORD=pagos_test_pw \
//   DB_NAME=inmobitwo_pagos_test MP_ACCESS_TOKEN=dummy node --test test/

import test, { before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";

process.env.DB_HOST ??= "localhost";
process.env.DB_PORT ??= "5433";
process.env.DB_USER ??= "pagos_test";
process.env.DB_PASSWORD ??= "pagos_test_pw";
process.env.DB_NAME ??= "inmobitwo_pagos_test";
process.env.MP_ACCESS_TOKEN ??= "dummy-token";
process.env.MP_WEBHOOK_SECRET ??= "test-secret-no-real";
process.env.PRECIO_UBICACION_OCULTA_COP ??= "22000";
process.env.REDIS_URL ??= "redis://localhost:6379";

const pool = new pg.Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

let svc;
let ctrl;
let ubicacionOculta;

before(async () => {
  await pool.query("CREATE EXTENSION IF NOT EXISTS postgis");
  await pool.query(`
    DROP TABLE IF EXISTS pagos CASCADE;
    DROP TABLE IF EXISTS propiedades CASCADE;
    DROP TABLE IF EXISTS usuarios CASCADE;
  `);
  await pool.query(`
    CREATE TABLE usuarios (
      id SERIAL PRIMARY KEY,
      name TEXT
    );
    CREATE TABLE propiedades (
      id SERIAL PRIMARY KEY,
      publicado_por_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
      organizacion_id INTEGER,
      ubicacion_oculta BOOLEAN NOT NULL DEFAULT FALSE,
      ubicacion_oculta_at TIMESTAMPTZ,
      ubicacion_oculta_solicitada BOOLEAN NOT NULL DEFAULT FALSE,
      latitude NUMERIC(10,8),
      longitude NUMERIC(11,8),
      latitude_publica NUMERIC(10,8),
      longitude_publica NUMERIC(11,8),
      geom_publica GEOMETRY(Point, 4326)
    );
    CREATE TABLE pagos (
      id BIGSERIAL PRIMARY KEY,
      tipo VARCHAR(50) NOT NULL CHECK (tipo IN ('ubicacion_oculta')),
      usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
      propiedad_id INTEGER REFERENCES propiedades(id) ON DELETE SET NULL,
      monto INTEGER NOT NULL CHECK (monto > 0),
      moneda VARCHAR(3) NOT NULL DEFAULT 'COP',
      external_reference VARCHAR(64) NOT NULL,
      mp_payment_id TEXT UNIQUE,
      mp_idempotency_key TEXT,
      mp_transaction_id TEXT,
      estado VARCHAR(30) NOT NULL DEFAULT 'iniciado'
        CHECK (estado IN (
          'iniciado', 'pending', 'in_process', 'approved',
          'rejected', 'cancelled', 'expirado', 'refunded', 'charged_back'
        )),
      estado_detalle VARCHAR(255),
      verificado_at TIMESTAMPTZ,
      aplicado_at TIMESTAMPTZ,
      requiere_reembolso BOOLEAN NOT NULL DEFAULT FALSE,
      nota TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX idx_pagos_mp_idempotency_key
      ON pagos (mp_idempotency_key) WHERE mp_idempotency_key IS NOT NULL;
    CREATE UNIQUE INDEX idx_pagos_un_pago_en_curso
      ON pagos (propiedad_id, tipo)
      WHERE propiedad_id IS NOT NULL AND (
        estado IN ('iniciado','pending','in_process')
        OR (estado = 'approved' AND aplicado_at IS NULL)
      );
  `);
  svc = await import("../src/lib/pagos/pago.service.js");
  ctrl = await import("../src/controllers/pagos.controllers.js");
  ({ ubicacionOculta } = await import(
    "../src/lib/pagos/productos/ubicacionOculta.js"
  ));
});

beforeEach(async () => {
  await pool.query("TRUNCATE pagos, propiedades, usuarios RESTART IDENTITY CASCADE");
  await pool.query("INSERT INTO usuarios (id, name) VALUES (1, 'duenio')");
  await pool.query(
    `INSERT INTO propiedades (id, publicado_por_id, latitude, longitude)
     VALUES (25, 1, 4.65, -74.05)`,
  );
});

after(async () => {
  await pool.end();
  // El service usa el pool de src/db.js y un cliente Redis: se cierran para
  // que node --test termine (cacheInvalidate abre la conexión lazy).
  const { pool: poolServicio } = await import("../src/db.js");
  await poolServicio.end();
  const { redis } = await import("../src/lib/redis.js");
  redis.disconnect();
});

function ordenMp({ status = "processed", statusDetail = "accredited", amount = "22000.00", externalReference, id = "ORD01TEST0001", payId = "PAY01TEST0001" } = {}) {
  return {
    id,
    status,
    status_detail: statusDetail,
    total_amount: amount,
    external_reference: externalReference,
    currency: "COP",
    created_date: new Date().toISOString(),
    transactions: {
      payments: [
        {
          id: payId,
          amount,
          status,
          status_detail: statusDetail,
          payment_method: { id: "master", type: "credit_card" },
        },
      ],
    },
  };
}

function datosBrick(overrides = {}) {
  return {
    token: "tok-test",
    payment_method_id: "master",
    payment_type: "credit_card",
    installments: 1,
    payer: {
      email: "aprob@testuser.com",
      identification: { type: "CC", number: "123456789" },
    },
    ...overrides,
  };
}

function mockFetch(handler) {
  const original = globalThis.fetch;
  const llamadas = [];
  globalThis.fetch = async (url, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : null;
    llamadas.push({ url: String(url), method: opts.method, body, headers: opts.headers });
    const r = await handler({ url: String(url), opts, body });
    return new Response(JSON.stringify(r.body), {
      status: r.status ?? 200,
      headers: { "content-type": "application/json", ...(r.headers ?? {}) },
    });
  };
  return {
    llamadas,
    restaurar: () => {
      globalThis.fetch = original;
    },
  };
}

test("aprobado: POST /v1/orders con payload correcto y activa la ocultación", async () => {
  let refCreada = null;
  const mock = mockFetch(({ url, body }) => {
    if (url.endsWith("/v1/orders")) {
      refCreada = body.external_reference;
      return { status: 201, body: ordenMp({ externalReference: refCreada }) };
    }
    // GET /v1/orders/{id} para la activación inmediata.
    return {
      status: 200,
      body: ordenMp({ externalReference: refCreada }),
    };
  });
  try {
    const { pago, respuesta } = await svc.crearPago({
      producto: ubicacionOculta,
      contextoId: 25,
      usuario: { id: 1 },
      datos: datosBrick(),
    });

    assert.equal(mock.llamadas.length, 1);
    const llamada = mock.llamadas[0];
    assert.match(llamada.url, /\/v1\/orders$/);
    assert.equal(llamada.method, "POST");
    assert.ok(llamada.headers["X-Idempotency-Key"]);
    assert.equal(llamada.body.type, "online");
    assert.equal(llamada.body.processing_mode, "automatic");
    assert.equal(llamada.body.total_amount, "22000");
    assert.equal(llamada.body.transactions.payments[0].payment_method.type, "credit_card");
    assert.equal(llamada.body.transactions.payments[0].payment_method.token, "tok-test");
    assert.equal("notification_url" in llamada.body, false);

    assert.equal(respuesta.id, "ORD01TEST0001");
    assert.equal(pago.estado, "approved");
    assert.equal(pago.mp_payment_id, "ORD01TEST0001");
    assert.equal(pago.mp_transaction_id, "PAY01TEST0001");
    assert.ok(pago.mp_idempotency_key);

    // El controlador activa inmediatamente si la orden quedó aprobada.
    await svc.sincronizarPago(pago.mp_payment_id);

    const { rows: prop } = await pool.query(
      "SELECT ubicacion_oculta, latitude_publica, longitude_publica FROM propiedades WHERE id = 25",
    );
    assert.equal(prop[0].ubicacion_oculta, true);
    assert.ok(prop[0].latitude_publica);
    assert.ok(prop[0].longitude_publica);
  } finally {
    mock.restaurar();
  }
});

test("rechazado: estado rejected y la ubicación sigue visible", async () => {
  const mock = mockFetch(({ body }) => ({
    status: 201,
    body: ordenMp({
      status: "failed",
      statusDetail: "insufficient_amount",
      externalReference: body.external_reference,
    }),
  }));
  try {
    const { pago } = await svc.crearPago({
      producto: ubicacionOculta,
      contextoId: 25,
      usuario: { id: 1 },
      datos: datosBrick(),
    });
    assert.equal(pago.estado, "rejected");
    const { rows } = await pool.query(
      "SELECT ubicacion_oculta FROM propiedades WHERE id = 25",
    );
    assert.equal(rows[0].ubicacion_oculta, false);
  } finally {
    mock.restaurar();
  }
});

test("HTTP 500: queda iniciado (no rechazado) y conserva la idempotency key", async () => {
  const mock = mockFetch(() => ({
    status: 500,
    body: { error: "internal_error" },
    headers: { "x-request-id": "req-500" },
  }));
  try {
    await assert.rejects(
      svc.crearPago({
        producto: ubicacionOculta,
        contextoId: 25,
        usuario: { id: 1 },
        datos: datosBrick(),
      }),
      (e) => e.status === 502,
    );
    const { rows } = await pool.query("SELECT * FROM pagos");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].estado, "iniciado");
    assert.ok(rows[0].mp_idempotency_key);
    assert.match(rows[0].nota, /HTTP 500/);
  } finally {
    mock.restaurar();
  }
});

test("timeout/red: queda iniciado, nunca rejected", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("fetch failed");
  };
  try {
    await assert.rejects(
      svc.crearPago({
        producto: ubicacionOculta,
        contextoId: 25,
        usuario: { id: 1 },
        datos: datosBrick(),
      }),
    );
    const { rows } = await pool.query("SELECT * FROM pagos");
    assert.equal(rows[0].estado, "iniciado");
    assert.match(rows[0].nota, /fetch failed/);
  } finally {
    globalThis.fetch = original;
  }
});

test("402 con ORD en el error: consulta y persiste la orden", async () => {
  let creada = false;
  const mock = mockFetch(({ url, body }) => {
    if (url.endsWith("/v1/orders") && !creada) {
      creada = true;
      return {
        status: 402,
        body: {
          errors: [{ code: "processing_error", message: "ORD01TEST0402" }],
        },
      };
    }
    if (url.includes("/v1/orders/ORD01TEST0402")) {
      return {
        status: 200,
        body: ordenMp({
          status: "failed",
          externalReference: body?.external_reference,
          id: "ORD01TEST0402",
        }),
      };
    }
    throw new Error(`llamada inesperada ${url}`);
  });
  try {
    const { pago } = await svc.crearPago({
      producto: ubicacionOculta,
      contextoId: 25,
      usuario: { id: 1 },
      datos: datosBrick(),
    });
    assert.equal(pago.mp_payment_id, "ORD01TEST0402");
    assert.equal(pago.estado, "rejected");
  } finally {
    mock.restaurar();
  }
});

test("sincronizarPago: monto alterado → requiere_reembolso sin activar", async () => {
  await pool.query(
    `INSERT INTO pagos (tipo, usuario_id, propiedad_id, monto, moneda,
       external_reference, mp_payment_id, estado)
     VALUES ('ubicacion_oculta', 1, 25, 22000, 'COP', 'pocu-25-x', 'ORD01MALO', 'iniciado')`,
  );
  const mock = mockFetch(() => ({
    status: 200,
    body: ordenMp({ amount: "100.00", externalReference: "pocu-25-x", id: "ORD01MALO" }),
  }));
  try {
    const { accion } = await svc.sincronizarPago("ORD01MALO");
    assert.equal(accion, "invalido");
    const { rows } = await pool.query("SELECT * FROM pagos WHERE mp_payment_id='ORD01MALO'");
    assert.equal(rows[0].requiere_reembolso, true);
    assert.ok(rows[0].nota.includes("monto_ok=false"));
    const prop = await pool.query("SELECT ubicacion_oculta FROM propiedades WHERE id=25");
    assert.equal(prop.rows[0].ubicacion_oculta, false);
  } finally {
    mock.restaurar();
  }
});

test("sincronizarPago: refunded NO activa y queda registrado", async () => {
  await pool.query(
    `INSERT INTO pagos (tipo, usuario_id, propiedad_id, monto, moneda,
       external_reference, mp_payment_id, estado)
     VALUES ('ubicacion_oculta', 1, 25, 22000, 'COP', 'pocu-25-r', 'ORD01REF', 'in_process')`,
  );
  const mock = mockFetch(() => ({
    status: 200,
    body: ordenMp({
      status: "refunded",
      statusDetail: "refunded",
      externalReference: "pocu-25-r",
      id: "ORD01REF",
    }),
  }));
  try {
    const { accion } = await svc.sincronizarPago("ORD01REF");
    assert.equal(accion, "actualizado");
    const { rows } = await pool.query("SELECT * FROM pagos WHERE mp_payment_id='ORD01REF'");
    assert.equal(rows[0].estado, "refunded");
    const prop = await pool.query("SELECT ubicacion_oculta FROM propiedades WHERE id=25");
    assert.equal(prop.rows[0].ubicacion_oculta, false);
  } finally {
    mock.restaurar();
  }
});

test("webhook repetido: la segunda sincronización no vuelve a aplicar", async () => {
  await pool.query(
    `INSERT INTO pagos (tipo, usuario_id, propiedad_id, monto, moneda,
       external_reference, mp_payment_id, estado)
     VALUES ('ubicacion_oculta', 1, 25, 22000, 'COP', 'pocu-25-dup', 'ORD01DUP', 'iniciado')`,
  );
  const mock = mockFetch(() => ({
    status: 200,
    body: ordenMp({ externalReference: "pocu-25-dup", id: "ORD01DUP" }),
  }));
  try {
    const a = await svc.sincronizarPago("ORD01DUP");
    const b = await svc.sincronizarPago("ORD01DUP");
    assert.equal(a.accion, "activado");
    assert.equal(b.accion, "repetido");
    const { rows } = await pool.query(
      "SELECT aplicado_at, verificado_at FROM pagos WHERE mp_payment_id='ORD01DUP'",
    );
    assert.ok(rows[0].aplicado_at);
    assert.ok(rows[0].verificado_at);
  } finally {
    mock.restaurar();
  }
});

test("caducidad: intento viejo sin id se reconcilia y, si no existe, expira", async () => {
  await pool.query(
    `INSERT INTO pagos (tipo, usuario_id, propiedad_id, monto, moneda,
       external_reference, mp_idempotency_key, estado, created_at)
     VALUES ('ubicacion_oculta', 1, 25, 22000, 'COP', 'pocu-25-viejo',
       '00000000-0000-4000-8000-000000000000', 'iniciado', NOW() - INTERVAL '30 minutes')`,
  );
  const mock = mockFetch(() => ({
    status: 200,
    body: { data: [] },
  }));
  try {
    const { expirados } = await svc.expirarIntentosSinOrden();
    assert.equal(expirados, 1);
    const { rows } = await pool.query("SELECT estado FROM pagos");
    assert.equal(rows[0].estado, "expirado");
    // Ya no bloquea un nuevo intento.
    const enCurso = await svc.pagoEnCurso("ubicacion_oculta", 25);
    assert.equal(enCurso, null);
  } finally {
    mock.restaurar();
  }
});

test("caducidad: si la orden existe en MP, se sincroniza en vez de expirar", async () => {
  await pool.query(
    `INSERT INTO pagos (tipo, usuario_id, propiedad_id, monto, moneda,
       external_reference, mp_idempotency_key, estado, created_at)
     VALUES ('ubicacion_oculta', 1, 25, 22000, 'COP', 'pocu-25-hallada',
       '00000000-0000-4000-8000-000000000001', 'iniciado', NOW() - INTERVAL '30 minutes')`,
  );
  const mock = mockFetch(({ url }) => {
    if (url.includes("/v1/orders?")) {
      return {
        status: 200,
        body: {
          data: [
            ordenMp({
              externalReference: "pocu-25-hallada",
              id: "ORD01HALLADA",
            }),
          ],
        },
      };
    }
    if (url.includes("/v1/orders/ORD01HALLADA")) {
      return {
        status: 200,
        body: ordenMp({ externalReference: "pocu-25-hallada", id: "ORD01HALLADA" }),
      };
    }
    throw new Error(`llamada inesperada ${url}`);
  });
  try {
    const { expirados } = await svc.expirarIntentosSinOrden();
    assert.equal(expirados, 0);
    const { rows } = await pool.query("SELECT estado, mp_payment_id FROM pagos");
    assert.equal(rows[0].estado, "approved");
    assert.equal(rows[0].mp_payment_id, "ORD01HALLADA");
  } finally {
    mock.restaurar();
  }
});

test("caducidad: búsqueda no confiable (5xx) NO expira el intento", async () => {
  await pool.query(
    `INSERT INTO pagos (tipo, usuario_id, propiedad_id, monto, moneda,
       external_reference, mp_idempotency_key, estado, created_at)
     VALUES ('ubicacion_oculta', 1, 25, 22000, 'COP', 'pocu-25-ambiguo',
       '00000000-0000-4000-8000-000000000002', 'iniciado', NOW() - INTERVAL '30 minutes')`,
  );
  const mock = mockFetch(() => ({ status: 503, body: { error: "unavailable" } }));
  try {
    const { expirados } = await svc.expirarIntentosSinOrden();
    assert.equal(expirados, 0);
    const { rows } = await pool.query("SELECT estado FROM pagos");
    assert.equal(rows[0].estado, "iniciado");
  } finally {
    mock.restaurar();
  }
});

// ────────────────────────────────────────────────────────────────
// Pruebas de caracterización adicionales (Fase 1)
// ────────────────────────────────────────────────────────────────
function mockRes() {
  return {
    statusCode: 200,
    body: undefined,
    headersSent: false,
    status(c) {
      this.statusCode = c;
      return this;
    },
    json(b) {
      this.body = b;
      this.headersSent = true;
      return this;
    },
    sendStatus(c) {
      this.statusCode = c;
      this.headersSent = true;
      return this;
    },
    set() {
      return this;
    },
  };
}

const handlerInicio = () => ctrl.iniciarPagoUbicacionOculta[1];
const handlerWebhook = () => ctrl.webhookMercadoPago[1];

test("pendiente: action_required → pending y no activa", async () => {
  await pool.query(
    `INSERT INTO pagos (tipo, usuario_id, propiedad_id, monto, moneda,
       external_reference, mp_payment_id, estado)
     VALUES ('ubicacion_oculta', 1, 25, 22000, 'COP', 'pocu-25-pend', 'ORD01PEND', 'in_process')`,
  );
  const mock = mockFetch(() => ({
    status: 200,
    body: ordenMp({
      status: "action_required",
      statusDetail: "waiting_payment",
      externalReference: "pocu-25-pend",
      id: "ORD01PEND",
    }),
  }));
  try {
    const { accion } = await svc.sincronizarPago("ORD01PEND");
    assert.equal(accion, "actualizado");
    const { rows } = await pool.query(
      "SELECT estado, estado_detalle FROM pagos WHERE mp_payment_id='ORD01PEND'",
    );
    assert.equal(rows[0].estado, "pending");
    assert.equal(rows[0].estado_detalle, "waiting_payment");
    const prop = await pool.query(
      "SELECT ubicacion_oculta FROM propiedades WHERE id=25",
    );
    assert.equal(prop.rows[0].ubicacion_oculta, false);
  } finally {
    mock.restaurar();
  }
});

test("in_process: processing → in_process sin activar", async () => {
  await pool.query(
    `INSERT INTO pagos (tipo, usuario_id, propiedad_id, monto, moneda,
       external_reference, mp_payment_id, estado)
     VALUES ('ubicacion_oculta', 1, 25, 22000, 'COP', 'pocu-25-proc', 'ORD01PROC', 'iniciado')`,
  );
  const mock = mockFetch(() => ({
    status: 200,
    body: ordenMp({
      status: "processing",
      statusDetail: "processing",
      externalReference: "pocu-25-proc",
      id: "ORD01PROC",
    }),
  }));
  try {
    await svc.sincronizarPago("ORD01PROC");
    const { rows } = await pool.query(
      "SELECT estado FROM pagos WHERE mp_payment_id='ORD01PROC'",
    );
    assert.equal(rows[0].estado, "in_process");
    const prop = await pool.query(
      "SELECT ubicacion_oculta FROM propiedades WHERE id=25",
    );
    assert.equal(prop.rows[0].ubicacion_oculta, false);
  } finally {
    mock.restaurar();
  }
});

test("duplicado: propiedad ya oculta → requiere_reembolso y no re-aplica", async () => {
  await pool.query(
    `UPDATE propiedades SET ubicacion_oculta=TRUE, ubicacion_oculta_at=NOW(),
       latitude_publica=4.66, longitude_publica=-74.06 WHERE id=25`,
  );
  await pool.query(
    `INSERT INTO pagos (tipo, usuario_id, propiedad_id, monto, moneda,
       external_reference, mp_payment_id, estado)
     VALUES ('ubicacion_oculta', 1, 25, 22000, 'COP', 'pocu-25-dup2', 'ORD01DUP2', 'iniciado')`,
  );
  const mock = mockFetch(() => ({
    status: 200,
    body: ordenMp({ externalReference: "pocu-25-dup2", id: "ORD01DUP2" }),
  }));
  try {
    await svc.sincronizarPago("ORD01DUP2");
    const { rows } = await pool.query(
      "SELECT estado, requiere_reembolso FROM pagos WHERE mp_payment_id='ORD01DUP2'",
    );
    assert.equal(rows[0].estado, "approved");
    assert.equal(rows[0].requiere_reembolso, true);
    // No se generó un segundo punto público.
    const prop = await pool.query(
      "SELECT latitude_publica, longitude_publica FROM propiedades WHERE id=25",
    );
    assert.equal(Number(prop.rows[0].latitude_publica), 4.66);
    assert.equal(Number(prop.rows[0].longitude_publica), -74.06);
  } finally {
    mock.restaurar();
  }
});

test("propiedad borrada: approved → requiere_reembolso sin activar", async () => {
  await pool.query(
    `INSERT INTO pagos (tipo, usuario_id, propiedad_id, monto, moneda,
       external_reference, mp_payment_id, estado)
     VALUES ('ubicacion_oculta', 1, NULL, 22000, 'COP', 'pocu-null-borrada', 'ORD01BORR', 'iniciado')`,
  );
  const mock = mockFetch(() => ({
    status: 200,
    body: ordenMp({ externalReference: "pocu-null-borrada", id: "ORD01BORR" }),
  }));
  try {
    const { accion } = await svc.sincronizarPago("ORD01BORR");
    assert.equal(accion, "activado");
    const { rows } = await pool.query(
      "SELECT requiere_reembolso, nota FROM pagos WHERE mp_payment_id='ORD01BORR'",
    );
    assert.equal(rows[0].requiere_reembolso, true);
    assert.match(rows[0].nota, /propiedad_borrada/);
  } finally {
    mock.restaurar();
  }
});

test("moneda alterada: approved → requiere_reembolso sin activar", async () => {
  await pool.query(
    `INSERT INTO pagos (tipo, usuario_id, propiedad_id, monto, moneda,
       external_reference, mp_payment_id, estado)
     VALUES ('ubicacion_oculta', 1, 25, 22000, 'COP', 'pocu-25-ars', 'ORD01ARS', 'iniciado')`,
  );
  const orden = ordenMp({ externalReference: "pocu-25-ars", id: "ORD01ARS" });
  orden.currency = "ARS";
  const mock = mockFetch(() => ({ status: 200, body: orden }));
  try {
    const { accion } = await svc.sincronizarPago("ORD01ARS");
    assert.equal(accion, "invalido");
    const { rows } = await pool.query(
      "SELECT requiere_reembolso FROM pagos WHERE mp_payment_id='ORD01ARS'",
    );
    assert.equal(rows[0].requiere_reembolso, true);
    const prop = await pool.query(
      "SELECT ubicacion_oculta FROM propiedades WHERE id=25",
    );
    assert.equal(prop.rows[0].ubicacion_oculta, false);
  } finally {
    mock.restaurar();
  }
});

test("webhook: firma inválida → 401 y no procesa", async () => {
  const req = {
    body: { type: "order", data: { id: "ORD01FIRMA" } },
    query: {},
    headers: {
      "x-signature": "ts=1700000000,v1=deadbeef",
      "x-request-id": "req-invalida",
    },
  };
  const res = mockRes();
  await handlerWebhook()(req, res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.success, false);
});

test("409: ya hay un pago en curso para la propiedad", async () => {
  await pool.query(
    `INSERT INTO pagos (tipo, usuario_id, propiedad_id, monto, moneda,
       external_reference, mp_idempotency_key, estado)
     VALUES ('ubicacion_oculta', 1, 25, 22000, 'COP', 'pocu-25-curso',
       '00000000-0000-4000-8000-0000000000aa', 'iniciado')`,
  );
  const req = {
    usuario: { id: 1 },
    params: { producto: "ubicacion-oculta" },
    body: {
      propiedad_id: 25,
      token: "tok",
      payment_method_id: "master",
      payment_type: "credit_card",
      installments: 1,
      payer: { email: "x@testuser.com" },
    },
  };
  const res = mockRes();
  await handlerInicio()(req, res);
  assert.equal(res.statusCode, 409);
  assert.match(res.body.error, /pago en curso/i);
});

test("permisos: usuario que no es dueño → 403 sin llamar a MP", async () => {
  const mock = mockFetch(() => {
    throw new Error("no debería llamar a MP");
  });
  try {
    const req = {
      usuario: { id: 2, rol: "usuario" },
      params: { producto: "ubicacion-oculta" },
      body: {
        propiedad_id: 25,
        token: "tok",
        payment_method_id: "master",
        payment_type: "credit_card",
        installments: 1,
        payer: { email: "x@testuser.com" },
      },
    };
    const res = mockRes();
    await handlerInicio()(req, res);
    assert.equal(res.statusCode, 403);
    assert.equal(mock.llamadas.length, 0);
  } finally {
    mock.restaurar();
  }
});

test("el cliente no puede imponer monto ni ubicacion_oculta/coordenadas", async () => {
  let refEnviada = null;
  const mock = mockFetch(({ url, opts, body }) => {
    if (url.endsWith("/v1/orders") && opts.method === "POST") {
      refEnviada = body.external_reference;
      return {
        status: 200,
        body: ordenMp({
          status: "failed",
          statusDetail: "insufficient_amount",
          externalReference: body.external_reference,
          id: "ORD01INYECT",
        }),
      };
    }
    throw new Error(`llamada inesperada ${url}`);
  });
  try {
    const req = {
      usuario: { id: 1 },
      params: { producto: "ubicacion-oculta" },
      body: {
        propiedad_id: 25,
        token: "tok",
        payment_method_id: "master",
        payment_type: "credit_card",
        installments: 1,
        payer: { email: "x@testuser.com" },
        monto: 1,
        precio: 1,
        ubicacion_oculta: true,
        latitude: 0,
        longitude: 0,
        latitude_publica: 0,
        longitude_publica: 0,
      },
    };
    const res = mockRes();
    await handlerInicio()(req, res);
    assert.equal(res.statusCode, 200);
    assert.ok(refEnviada);
    const llamada = mock.llamadas.find((l) => l.method === "POST");
    assert.equal(llamada.body.total_amount, "22000");
    assert.equal(llamada.body.transactions.payments[0].amount, "22000");
    const pago = await pool.query("SELECT monto FROM pagos");
    assert.equal(pago.rows[0].monto, 22000);
    const prop = await pool.query(
      "SELECT ubicacion_oculta, latitude, longitude FROM propiedades WHERE id=25",
    );
    assert.equal(prop.rows[0].ubicacion_oculta, false);
    assert.equal(Number(prop.rows[0].latitude), 4.65);
    assert.equal(Number(prop.rows[0].longitude), -74.05);
  } finally {
    mock.restaurar();
  }
});

test("fix 4xx: el intento queda rejected y no bloquea un reintento", async () => {
  const mock = mockFetch(() => ({
    status: 400,
    body: {
      errors: [
        {
          code: "property_value",
          message: "invalid payment_method.type",
        },
      ],
    },
    headers: { "x-request-id": "req-400" },
  }));
  try {
    await assert.rejects(
      svc.crearPago({
        producto: ubicacionOculta,
        contextoId: 25,
        usuario: { id: 1 },
        datos: datosBrick(),
      }),
      (e) => e.status === 400,
    );
    const { rows } = await pool.query("SELECT * FROM pagos");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].estado, "rejected");
    assert.equal(rows[0].estado_detalle, "error_validacion_mp");
    assert.equal(rows[0].mp_payment_id, null);
    assert.match(rows[0].nota, /HTTP 400/);
    assert.equal(await svc.pagoEnCurso("ubicacion_oculta", 25), null);
  } finally {
    mock.restaurar();
  }
});
