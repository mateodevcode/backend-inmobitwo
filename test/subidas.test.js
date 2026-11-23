// N-17: las fotos se aceptan por sus bytes, no por el mimetype del navegador (sin BD).
import { test } from "node:test";
import assert from "node:assert/strict";
import { detectarTipoImagen } from "../src/lib/archivos.js";
import { exigirImagenesReales, filtroImagen } from "../src/lib/multer.js";

const relleno = Buffer.alloc(16);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), relleno]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), relleno]);
const WEBP = Buffer.concat([Buffer.from("RIFF\0\0\0\0WEBP", "latin1"), relleno]);
const AVIF = Buffer.concat([Buffer.from("\0\0\0\x1cftypavif", "latin1"), relleno]);
const GIF = Buffer.concat([Buffer.from("GIF89a", "latin1"), relleno]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>');
const HTML = Buffer.from("<!doctype html><script>alert(1)</script>");
const PDF = Buffer.concat([Buffer.from("%PDF-1.7", "latin1"), relleno]);

test("detectarTipoImagen reconoce JPG, PNG, WEBP, AVIF y GIF", () => {
  assert.equal(detectarTipoImagen(JPG).mime, "image/jpeg");
  assert.equal(detectarTipoImagen(PNG).mime, "image/png");
  assert.equal(detectarTipoImagen(WEBP).mime, "image/webp");
  assert.equal(detectarTipoImagen(AVIF).mime, "image/avif");
  assert.equal(detectarTipoImagen(GIF).mime, "image/gif");
});

test("detectarTipoImagen rechaza SVG, HTML, PDF y basura", () => {
  for (const b of [SVG, HTML, PDF, Buffer.from("hola"), null]) assert.equal(detectarTipoImagen(b), null);
});

function ejecutar(req) {
  const out = { status: null, body: null, siguio: false };
  const res = { status(s) { out.status = s; return this; }, json(b) { out.body = b; return this; } };
  exigirImagenesReales(req, res, () => { out.siguio = true; });
  return out;
}

test("exigirImagenesReales deja pasar imágenes reales y corrige el mimetype", () => {
  const png = { buffer: PNG, mimetype: "image/jpeg" };
  const out = ejecutar({ files: { imagenPrincipal: [png], galeria: [{ buffer: JPG, mimetype: "image/jpeg" }] } });
  assert.equal(out.siguio, true);
  assert.equal(png.mimetype, "image/png");
});

test("exigirImagenesReales rechaza un SVG/HTML disfrazado de imagen", () => {
  const out = ejecutar({ files: { galeria: [{ buffer: JPG, mimetype: "image/jpeg" }, { buffer: SVG, mimetype: "image/png" }] } });
  assert.equal(out.siguio, false);
  assert.equal(out.status, 400);
  const html = ejecutar({ file: { buffer: HTML, mimetype: "image/jpeg" } });
  assert.equal(html.status, 400);
});

test("sin archivos no hace nada", () => {
  assert.equal(ejecutar({}).siguio, true);
});

test("filtroImagen rechaza image/svg+xml y acepta los tipos permitidos por mimetype", () => {
  const r = (mimetype) => { let res; filtroImagen({}, { mimetype }, (e, ok) => { res = { e, ok }; }); return res; };
  assert.equal(r("image/svg+xml").ok, false);
  assert.equal(r("image/svg+xml").e.status, 400);
  assert.equal(r("text/html").ok, false);
  assert.equal(r("image/webp").ok, true);
});
