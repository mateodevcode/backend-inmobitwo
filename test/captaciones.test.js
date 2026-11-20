// test/captaciones.test.js — archivos privados y validación de captaciones (sin BD).
import { test } from "node:test";
import assert from "node:assert/strict";
import { detectarTipoDocumento, nombreArchivoSeguro } from "../src/lib/archivos.js";
import {
  actualizarCaptacionSchema,
  crearCaptacionSchema,
  documentoSchema,
  filtrosCaptacionesSchema,
  validar,
} from "../src/validations/captacion.schema.js";

const relleno = (cabecera) => Buffer.concat([Buffer.from(cabecera), Buffer.alloc(32)]);

test("archivos: reconoce PDF, JPG, PNG y WEBP por sus bytes", () => {
  assert.deepEqual(detectarTipoDocumento(relleno("%PDF-1.7\n")), { mime: "application/pdf", ext: "pdf" });
  assert.equal(detectarTipoDocumento(relleno([0xff, 0xd8, 0xff, 0xe0])).ext, "jpg");
  assert.equal(detectarTipoDocumento(relleno([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])).ext, "png");
  const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 "), Buffer.alloc(20)]);
  assert.equal(detectarTipoDocumento(webp).ext, "webp");
});

test("archivos: rechaza ejecutables, HTML o un 'PDF' falso aunque digan ser PDF", () => {
  assert.equal(detectarTipoDocumento(relleno("MZ\x90\x00")), null); // .exe
  assert.equal(detectarTipoDocumento(relleno("<html><script>")), null);
  assert.equal(detectarTipoDocumento(relleno("PK\x03\x04")), null); // zip/docx
  assert.equal(detectarTipoDocumento(Buffer.from("%PDF")), null); // demasiado corto
  assert.equal(detectarTipoDocumento("no es buffer"), null);
});

test("archivos: nombre seguro sin rutas ni caracteres peligrosos y con la extensión real", () => {
  assert.equal(nombreArchivoSeguro("../../etc/passwd", "pdf"), "passwd.pdf");
  assert.equal(nombreArchivoSeguro('Cédula "Juan".exe', "jpg"), "Cédula Juan.jpg");
  assert.equal(nombreArchivoSeguro("C:\\docs\\contrato.PDF", "pdf"), "contrato.pdf");
  assert.equal(nombreArchivoSeguro("", "png"), "documento.png");
  assert.ok(nombreArchivoSeguro("a".repeat(400), "pdf").length <= 154);
});

test("captación: crear con lo mínimo y con fechas coherentes", () => {
  assert.equal(validar(crearCaptacionSchema, { propiedad_id: "3" }).propiedad_id, 3);
  const d = validar(crearCaptacionSchema, {
    propiedad_id: 3,
    tipo_mandato: "exclusiva",
    inicio_el: "2026-11-01",
    vence_el: "2027-02-01",
    comision_tipo: "porcentaje",
    comision_porcentaje: "3.5",
  });
  assert.equal(d.comision_porcentaje, 3.5);
});

test("captación: rechaza vencimiento anterior al inicio, mandato desconocido y comisión > 100 %", () => {
  for (const malo of [
    { propiedad_id: 3, inicio_el: "2026-11-01", vence_el: "2026-10-01" },
    { propiedad_id: 3, tipo_mandato: "verbal" },
    { propiedad_id: 3, comision_porcentaje: 150 },
    { propiedad_id: 3, inicio_el: "01/11/2026" },
    { propiedad_id: 3, organizacion_id: 9 },
  ]) {
    assert.throws(() => validar(crearCaptacionSchema, malo), JSON.stringify(malo));
  }
});

test("captación: actualizar permite null para limpiar y no permite cambiar el inmueble", () => {
  const d = validar(actualizarCaptacionSchema, { vence_el: null, propietario_id: null, precio_propietario: null });
  assert.deepEqual(d, { vence_el: null, propietario_id: null, precio_propietario: null });
  assert.throws(() => validar(actualizarCaptacionSchema, { propiedad_id: 4 }));
});

test("captación: filtros y tipo de documento por defecto", () => {
  assert.equal(validar(filtrosCaptacionesSchema, { vence_en_dias: "30" }).vence_en_dias, 30);
  assert.throws(() => validar(filtrosCaptacionesSchema, { vence_en_dias: "400" }));
  assert.equal(validar(documentoSchema, {}).tipo, "otro");
  assert.throws(() => validar(documentoSchema, { tipo: "foto" }));
});
