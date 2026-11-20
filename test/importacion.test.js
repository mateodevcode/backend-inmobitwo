// Interpretación de filas importadas (sin BD).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  claveTexto,
  operacionInmueble,
  parsearBooleano,
  parsearDinero,
  parsearEntero,
  parsearEtiquetas,
  resolverCiudad,
  resolverTipoInmueble,
  tipoContacto,
} from "../src/lib/importacion/normalizar.js";
import { interpretarContacto, interpretarInmueble, textoAHtml } from "../src/lib/importacion/filas.js";
import { escapeHtml } from "../src/utils/sanitize.js";

const tipos = [
  { id: 1, code: "apartamento", label_es: "Apartamento" },
  { id: 2, code: "casa", label_es: "Casa" },
  { id: 3, code: "casa_campestre", label_es: "Casa campestre" },
  { id: 7, code: "local", label_es: "Local comercial" },
  { id: 12, code: "lote", label_es: "Lote / Terreno" },
];
const ciudades = [
  { id: 8485, name: "Medellín", state_id: 1, state_name: "Antioquia" },
  { id: 8572, name: "Bogotá D.C.", state_id: 2, state_name: "Bogotá D.C." },
  { id: 8581, name: "Cartagena de Indias", state_id: 3, state_name: "Bolívar" },
  { id: 10, name: "La Unión", state_id: 1, state_name: "Antioquia" },
  { id: 11, name: "La Unión", state_id: 4, state_name: "Nariño" },
];

test("claveTexto quita tildes, puntuación y mayúsculas", () => {
  assert.equal(claveTexto("  Bogotá, D.C. "), "bogota d c");
  assert.equal(claveTexto("Nariño"), "narino");
});

test("parsearDinero acepta formatos colombianos", () => {
  assert.equal(parsearDinero("$ 350.000.000"), 350_000_000);
  assert.equal(parsearDinero("350,000,000"), 350_000_000);
  assert.equal(parsearDinero("1.200.000,00"), 1_200_000);
  assert.equal(parsearDinero(2500000), 2_500_000);
  assert.equal(parsearDinero(""), null);
  assert.ok(Number.isNaN(parsearDinero("350 millones")));
  assert.ok(Number.isNaN(parsearDinero("12.5")));
});

test("parsearEntero, booleano y etiquetas", () => {
  assert.equal(parsearEntero("3"), 3);
  assert.equal(parsearEntero("72,5"), 73);
  assert.ok(Number.isNaN(parsearEntero("7", { min: 1, max: 6 })));
  assert.equal(parsearBooleano("Sí"), true);
  assert.equal(parsearBooleano("no"), false);
  assert.equal(parsearBooleano("tal vez"), undefined);
  assert.deepEqual(parsearEtiquetas("vip, referido; vip | inversión"), ["vip", "referido", "inversión"]);
});

test("tipos y operaciones con sinónimos", () => {
  assert.equal(tipoContacto("Propietaria"), "vendedor");
  assert.equal(tipoContacto("inquilino"), "arrendatario");
  assert.equal(tipoContacto(""), "otro");
  assert.equal(tipoContacto("cliente"), null);
  assert.equal(operacionInmueble("Arriendo"), "alquiler");
  assert.equal(operacionInmueble("VENTA"), "venta");
  assert.equal(operacionInmueble("permuta"), null);
  assert.equal(resolverTipoInmueble(tipos, "Apto")?.id, 1);
  assert.equal(resolverTipoInmueble(tipos, "casa campestre")?.id, 3);
  assert.equal(resolverTipoInmueble(tipos, "Local comercial")?.id, 7);
  assert.equal(resolverTipoInmueble(tipos, "terreno")?.id, 12);
  assert.equal(resolverTipoInmueble(tipos, "castillo"), null);
});

test("resolverCiudad: alias, departamento y ambigüedad", () => {
  assert.equal(resolverCiudad(ciudades, "Bogota").ciudad.id, 8572);
  assert.equal(resolverCiudad(ciudades, "cartagena").ciudad.id, 8581);
  assert.equal(resolverCiudad(ciudades, "MEDELLIN", "antioquia").ciudad.id, 8485);
  assert.match(resolverCiudad(ciudades, "La Union").error, /Indica el departamento/);
  assert.equal(resolverCiudad(ciudades, "La Unión", "Nariño").ciudad.id, 11);
  assert.match(resolverCiudad(ciudades, "Medellín", "Nariño").error, /no está en/);
  assert.match(resolverCiudad(ciudades, "Gotham").error, /No se encontró/);
  assert.match(resolverCiudad(ciudades, "").error, /Falta la ciudad/);
});

test("interpretarContacto normaliza y reporta errores", () => {
  const ok = interpretarContacto({
    nombre: " Ana Gómez ",
    email: "ANA@Correo.com",
    telefono: "+57 310 123 4567",
    tipo: "Compradora",
    presupuesto_max: "$ 400.000.000",
    etiquetas: "vip",
  });
  assert.deepEqual(ok.valores, {
    nombre: "Ana Gómez",
    email: "ana@correo.com",
    telefono: "3101234567",
    tipo: "comprador",
    presupuesto_min: null,
    presupuesto_max: 400_000_000,
    zona_interes: null,
    etiquetas: ["vip"],
    notas: null,
  });
  const mal = interpretarContacto({ nombre: "", email: "x@", telefono: "1234", presupuesto_min: "9", presupuesto_max: "1" });
  assert.equal(mal.errores.length, 4);
});

test("interpretarInmueble arma los valores y valida", () => {
  const ok = interpretarInmueble(
    { tipo: "Apartamento", operacion: "venta", precio: "450.000.000", ciudad: "Medellín", direccion: "Cra 43A # 1-50", area: "85", habitaciones: "3", banos: "2", estrato: "5" },
    { tipos, ciudades },
  );
  assert.equal(ok.valores.tipo.id, 1);
  assert.equal(ok.valores.ciudad.id, 8485);
  assert.equal(ok.valores.precio, 450_000_000);
  assert.equal(ok.valores.constructed_area, 85);
  assert.equal(ok.valores.estrato, 5);
  const mal = interpretarInmueble({ tipo: "castillo", operacion: "", precio: "0", ciudad: "Gotham", direccion: "", estrato: "9" }, { tipos, ciudades });
  assert.equal(mal.errores.length, 6);
});

test("textoAHtml escapa y separa párrafos", () => {
  assert.equal(textoAHtml("Hola <b>\nmundo\n\nOtro", escapeHtml), "<p>Hola &lt;b&gt;<br>mundo</p><p>Otro</p>");
  assert.equal(textoAHtml(null, escapeHtml), null);
});
