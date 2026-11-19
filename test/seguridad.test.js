// test/seguridad.test.js — pruebas unitarias de la Fase 1 de seguridad.
// No necesitan base de datos ni Redis.
import { test } from "node:test";
import assert from "node:assert/strict";
import { soloPropioOSuperadmin, verificarRol } from "../src/middleware/auth.middleware.js";
import { ocultarErrores5xx } from "../src/middleware/ocultarErrores.middleware.js";
import { sanitizarHtml } from "../src/lib/sanitizarHtml.js";
import { asegurarDominio, esDominioValido, normalizarDominio } from "../src/lib/dominio.js";

// Respuesta falsa de Express: registra status y body.
function resFalsa() {
  const res = { statusCode: 200, body: undefined };
  res.status = (c) => ((res.statusCode = c), res);
  res.json = (b) => ((res.body = b), res);
  return res;
}

function correr(mw, req) {
  const res = resFalsa();
  let siguio = false;
  mw(req, res, () => (siguio = true));
  return { res, siguio };
}

// ── soloPropioOSuperadmin ─────────────────────────────────────
test("propio: el dueño de la cuenta pasa", () => {
  const { siguio } = correr(soloPropioOSuperadmin("id"), {
    usuario: { id: 7, rol: "user" },
    params: { id: "7" },
  });
  assert.equal(siguio, true);
});

test("propio: otro usuario recibe 403", () => {
  const { siguio, res } = correr(soloPropioOSuperadmin("id"), {
    usuario: { id: 7, rol: "user" },
    params: { id: "8" },
  });
  assert.equal(siguio, false);
  assert.equal(res.statusCode, 403);
});

test("propio: el superadmin pasa sobre cualquier cuenta", () => {
  const { siguio } = correr(soloPropioOSuperadmin("id"), {
    usuario: { id: 1, rol: "superadmin" },
    params: { id: "99" },
  });
  assert.equal(siguio, true);
});

test("propio: sin usuario autenticado recibe 401", () => {
  const { res } = correr(soloPropioOSuperadmin("id"), { params: { id: "1" } });
  assert.equal(res.statusCode, 401);
});

test("verificarRol: un user no entra a rutas de superadmin", () => {
  const { res, siguio } = correr(verificarRol(["superadmin"]), { usuario: { id: 2, rol: "user" } });
  assert.equal(siguio, false);
  assert.equal(res.statusCode, 403);
});

// ── sanitizarHtml ─────────────────────────────────────────────
test("sanitizar: elimina scripts, eventos y enlaces javascript:", () => {
  const sucio =
    '<p>hola</p><script>alert(1)</script><img src=x onerror=alert(1)>' +
    '<a href="javascript:alert(1)">x</a><svg onload=alert(1)></svg>';
  const limpio = sanitizarHtml(sucio);
  assert.doesNotMatch(limpio, /script|onerror|onload|javascript:|<img|<svg/i);
  assert.match(limpio, /<p>hola<\/p>/);
});

test("sanitizar: conserva el formato de Tiptap y endurece los enlaces", () => {
  const limpio = sanitizarHtml('<h2>Título</h2><ul><li><strong>a</strong></li></ul><a href="https://x.co">x</a>');
  assert.match(limpio, /<h2>Título<\/h2>/);
  assert.match(limpio, /<li><strong>a<\/strong><\/li>/);
  assert.match(limpio, /href="https:\/\/x\.co"/);
  assert.match(limpio, /rel="noopener noreferrer nofollow"/);
});

test("sanitizar: null y undefined pasan tal cual", () => {
  assert.equal(sanitizarHtml(null), null);
  assert.equal(sanitizarHtml(undefined), undefined);
});

// ── dominios ──────────────────────────────────────────────────
test("dominio: acepta dominios normales y normaliza", () => {
  assert.equal(normalizarDominio(" HTTPS://www.MiInmo.com.co/ "), "miinmo.com.co");
  assert.equal(esDominioValido("miinmo.com.co"), true);
  assert.equal(esDominioValido("sub-dominio.inmo.co"), true);
});

test("dominio: rechaza cualquier intento de inyección de comandos", () => {
  for (const malo of [
    "x.com; rm -rf /",
    "x.com && reboot",
    "$(whoami).com",
    "`id`.com",
    "x.com | cat /etc/passwd",
    "x.com\nreboot",
    "localhost",
    "",
  ]) {
    assert.equal(esDominioValido(normalizarDominio(malo)), false, malo);
    assert.throws(() => asegurarDominio(malo));
  }
});

// ── ocultarErrores5xx ─────────────────────────────────────────
function conFiltro(entorno, status, body) {
  const previo = process.env.NODE_ENV;
  process.env.NODE_ENV = entorno;
  const res = resFalsa();
  const errorOriginal = console.error;
  console.error = () => {};
  try {
    ocultarErrores5xx({ method: "GET", originalUrl: "/x" }, res, () => {});
    res.status(status).json(body);
  } finally {
    console.error = errorOriginal;
    process.env.NODE_ENV = previo;
  }
  return res.body;
}

test("errores: en producción un 500 no expone el error interno", () => {
  const body = conFiltro("production", 500, {
    success: false,
    error: 'column "x" does not exist',
    details: "stack…",
  });
  assert.deepEqual(body, { success: false, error: "Error interno del servidor." });
});

test("errores: los 4xx conservan su mensaje para el usuario", () => {
  const body = conFiltro("production", 400, { success: false, error: "Email ya registrado." });
  assert.equal(body.error, "Email ya registrado.");
});

test("errores: fuera de producción se conserva el detalle para depurar", () => {
  const body = conFiltro("development", 500, { success: false, error: "boom" });
  assert.equal(body.details, "boom");
});
