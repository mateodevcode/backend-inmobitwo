import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  construirOrdenMp,
  extraerIdOrdenDeError,
  detalleErrorMp,
  normalizarTipoTarjeta,
  generarExternalReference,
} from "../src/lib/pagos/mp.client.js";
import {
  estadoDesdeOrden,
  normalizarOrdenMp,
  normalizarEstado,
} from "../src/lib/pagos/mp.estados.js";
import {
  TOLERANCIA_TS_MS,
  firmaValida,
  manifiestoFirma,
} from "../src/lib/pagos/firma.js";

test("construirOrdenMp arma el payload de Orders API (montos string)", () => {
  const orden = construirOrdenMp({
    precio: 22000,
    externalReference: "pocu-25-abcdef0123456789",
    descripcion: "Ocultar ubicación en mapa – pago único",
    datos: {
      token: "tok_123",
      payment_method_id: "master",
      payment_type: "credit_card",
      installments: 1,
      payer: {
        email: "aprob@testuser.com",
        identification: { type: "CC", number: "123456789" },
      },
    },
  });

  assert.equal(orden.type, "online");
  assert.equal(orden.processing_mode, "automatic");
  assert.equal(orden.capture_mode, "automatic");
  assert.equal(orden.total_amount, "22000");
  assert.equal(typeof orden.total_amount, "string");
  assert.equal(orden.external_reference, "pocu-25-abcdef0123456789");
  assert.equal(orden.description, "Ocultar ubicación en mapa – pago único");
  assert.equal(orden.payer.email, "aprob@testuser.com");
  assert.deepEqual(orden.payer.identification, {
    type: "CC",
    number: "123456789",
  });
  const pago = orden.transactions.payments[0];
  assert.equal(pago.amount, "22000");
  assert.deepEqual(pago.payment_method, {
    id: "master",
    type: "credit_card",
    token: "tok_123",
    installments: 1,
  });
  // Orders API: ni notification_url ni issuer_id en el body.
  assert.equal("notification_url" in orden, false);
  assert.equal("issuer_id" in pago.payment_method, false);
});

test("construirOrdenMp exige type de tarjeta y normaliza débito", () => {  assert.equal(normalizarTipoTarjeta("debit_card"), "debit_card");
  assert.equal(normalizarTipoTarjeta("debit"), "debit_card");
  assert.equal(normalizarTipoTarjeta("credit"), "credit_card");
  assert.equal(normalizarTipoTarjeta(undefined), "credit_card");

  const orden = construirOrdenMp({
    precio: 22000,
    externalReference: "ref",
    datos: {
      token: "t",
      payment_method_id: "visa",
      payment_type: "debit_card",
      installments: 0,
      payer: { email: "a@b.co" },
    },
  });
  assert.equal(orden.transactions.payments[0].payment_method.type, "debit_card");
  assert.equal(orden.transactions.payments[0].payment_method.installments, 1);
  assert.equal("identification" in orden.payer, false);
});

test("estadoDesdeOrden mapea los estados de Orders API", () => {
  const casos = [
    ["processed", "approved"],
    ["processing", "in_process"],
    ["created", "in_process"],
    ["action_required", "pending"],
    ["failed", "rejected"],
    ["canceled", "cancelled"],
    ["refunded", "refunded"],
    ["charged_back", "charged_back"],
  ];
  for (const [mp, local] of casos) {
    assert.equal(estadoDesdeOrden({ status: mp }).status, local, mp);
  }
  assert.equal(
    estadoDesdeOrden({
      status: "processed",
      transactions: { payments: [{ status: "failed" }] },
    }).status,
    "rejected",
    "la transacción manda sobre la order",
  );
  assert.equal(estadoDesdeOrden({ status: "desconocido" }).status, null);
});

test("refunded/charged_back no se mapean a approved", () => {
  assert.notEqual(estadoDesdeOrden({ status: "refunded" }).status, "approved");
  assert.notEqual(
    estadoDesdeOrden({ status: "charged_back" }).status,
    "approved",
  );
});

test("normalizarOrdenMp extrae montos, ids y moneda", () => {
  const n = normalizarOrdenMp({
    id: "ORD01ABC",
    status: "processed",
    status_detail: "accredited",
    total_amount: "22000.00",
    external_reference: "pocu-1-x",
    currency: "COP",
    created_date: "2026-10-19T00:00:00.000Z",
    transactions: {
      payments: [
        {
          id: "PAY01XYZ",
          amount: "22000.00",
          status: "processed",
          status_detail: "accredited",
          payment_method: { id: "master", type: "credit_card" },
        },
      ],
    },
  });
  assert.equal(n.id, "ORD01ABC");
  assert.equal(n.transaction_id, "PAY01XYZ");
  assert.equal(n.status, "approved");
  assert.equal(n.transaction_amount, 22000);
  assert.equal(n.currency_id, "COP");
  assert.equal(n.payment_method_id, "master");
  assert.equal(n.payment_type_id, "credit_card");
});

test("extraerIdOrdenDeError encuentra ORD/PAY en el cuerpo del error", () => {
  assert.equal(
    extraerIdOrdenDeError({
      errors: [{ code: "processing_error", details: "ORDTST01ABC123XYZ" }],
    }),
    "ORDTST01ABC123XYZ",
  );
  assert.equal(
    extraerIdOrdenDeError({ data: { id: "PAY01JS2V6CM8KJ0EC4H504R7YE34" } }),
    "PAY01JS2V6CM8KJ0EC4H504R7YE34",
  );
  assert.equal(extraerIdOrdenDeError({ errors: [] }), null);
  assert.equal(extraerIdOrdenDeError(null), null);
});

test("detalleErrorMp concatena los errores de validación", () => {
  const detalle = detalleErrorMp({
    errors: [
      { code: "property_value", message: "invalid payment_method.type" },
      { code: "invalid_total_amount" },
    ],
  });
  assert.match(detalle, /property_value/);
  assert.match(detalle, /invalid payment_method\.type/);
  assert.match(detalle, /invalid_total_amount/);
  assert.equal(detalleErrorMp(null), "");
});

test("normalizarEstado solo admite estados locales conocidos", () => {
  assert.equal(normalizarEstado("approved"), "approved");
  assert.equal(normalizarEstado("expirado"), "expirado");
  assert.equal(normalizarEstado("refunded"), "refunded");
  assert.equal(normalizarEstado("raro"), "iniciado");
  assert.equal(normalizarEstado(null), "iniciado");
});

test("generarExternalReference cabe en VARCHAR(64)", () => {
  const ref = generarExternalReference("pocu", 123456, "abcdef0123456789");
  assert.equal(ref, "pocu-123456-abcdef0123456789");
  assert.ok(ref.length <= 64);
});

test("manifiestoFirma usa data.id tal cual (SDK oficial)", () => {
  assert.equal(
    manifiestoFirma("ORD01ABCXYZ", "req-123", "1690000000"),
    "id:ORD01ABCXYZ;request-id:req-123;ts:1690000000;",
  );
});

test("manifiestoFirma omite valores ausentes (doc MP)", () => {
  assert.equal(
    manifiestoFirma(null, "req-123", "1690000000"),
    "request-id:req-123;ts:1690000000;",
  );
  assert.equal(
    manifiestoFirma("ORD01ABCXYZ", null, "1690000000"),
    "id:ORD01ABCXYZ;ts:1690000000;",
  );
});

const SECRETO_TEST = "secreto-webhook-de-prueba";
const ahoraTest = 1_760_000_000_000;

function firmarWebhook({
  dataId = "ORD01ABCXYZ",
  requestId = "req-123",
  ts = ahoraTest,
  secret = SECRETO_TEST,
} = {}) {
  const manifiesto = manifiestoFirma(dataId, requestId, ts);
  const v1 = crypto
    .createHmac("sha256", secret)
    .update(manifiesto)
    .digest("hex");
  return `ts=${ts},v1=${v1}`;
}

test("firmaValida acepta una firma HMAC correcta", () => {
  const headers = {
    "x-signature": firmarWebhook(),
    "x-request-id": "req-123",
  };
  assert.equal(
    firmaValida({
      headers,
      dataId: "ORD01ABCXYZ",
      secret: SECRETO_TEST,
      ahora: ahoraTest,
    }),
    true,
  );
});

test("firmaValida rechaza firma incorrecta y falta de headers", () => {
  const base = {
    headers: {
      "x-signature": firmarWebhook(),
      "x-request-id": "req-123",
    },
    dataId: "ORD01ABCXYZ",
    secret: SECRETO_TEST,
    ahora: ahoraTest,
  };
  assert.equal(firmaValida({ ...base, secret: "otro-secreto" }), false);
  assert.equal(
    firmaValida({ ...base, headers: { "x-request-id": "req-123" } }),
    false,
  );
  assert.equal(
    firmaValida({ ...base, headers: { "x-signature": "ts=1,v1=abc" } }),
    false,
  );
  assert.equal(firmaValida({ ...base, secret: "" }), false);
});

test("firmaValida rechaza ts demasiado viejo o futuro", () => {
  const viejo = ahoraTest - TOLERANCIA_TS_MS - 60_000;
  const futuro = ahoraTest + TOLERANCIA_TS_MS + 60_000;
  for (const ts of [viejo, futuro]) {
    assert.equal(
      firmaValida({
        headers: {
          "x-signature": firmarWebhook({ ts }),
          "x-request-id": "req-123",
        },
        dataId: "ORD01ABCXYZ",
        secret: SECRETO_TEST,
        ahora: ahoraTest,
      }),
      false,
      String(ts),
    );
  }
});

test("firmaValida acepta ts en segundos (compatibilidad)", () => {
  const tsSegundos = Math.floor(ahoraTest / 1000);
  assert.equal(
    firmaValida({
      headers: {
        "x-signature": firmarWebhook({ ts: tsSegundos }),
        "x-request-id": "req-123",
      },
      dataId: "ORD01ABCXYZ",
      secret: SECRETO_TEST,
      ahora: ahoraTest,
    }),
    true,
  );
});

test("firmaValida sin x-request-id usa el manifest sin ese campo", () => {
  const ts = ahoraTest;
  const v1 = crypto
    .createHmac("sha256", SECRETO_TEST)
    .update(manifiestoFirma("ORD01ABCXYZ", null, ts))
    .digest("hex");
  assert.equal(
    firmaValida({
      headers: { "x-signature": `ts=${ts},v1=${v1}` },
      dataId: "ORD01ABCXYZ",
      secret: SECRETO_TEST,
      ahora: ahoraTest,
    }),
    true,
  );
});

test("construirOrdenMp respeta maxInstallments", () => {
  const base = {
    precio: 22000,
    externalReference: "pocu-1-abc",
    datos: {
      token: "tok",
      payment_method_id: "visa",
      payment_type: "credit_card",
      installments: 12,
      payer: { email: "a@testuser.com" },
    },
  };
  const sinCap = construirOrdenMp({ ...base, maxInstallments: 1 });
  assert.equal(
    sinCap.transactions.payments[0].payment_method.installments,
    1,
  );
  const conCap = construirOrdenMp({ ...base, maxInstallments: 3 });
  assert.equal(
    conCap.transactions.payments[0].payment_method.installments,
    3,
  );
});

test("estadoDesdeOrden: refunded de la order gana sobre la transacción", () => {
  const orden = {
    status: "refunded",
    status_detail: "refunded",
    transactions: { payments: [{ status: "processed", status_detail: "accredited" }] },
  };
  assert.equal(estadoDesdeOrden(orden).status, "refunded");
});
