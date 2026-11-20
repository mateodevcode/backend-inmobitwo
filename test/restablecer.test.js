// Token de restablecimiento de contraseña (sin BD).
import { test } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import {
  crearTokenRestablecer,
  erroresPasswordNueva,
  huellaVigente,
  leerTokenRestablecer,
} from "../src/lib/restablecerPassword.js";

const SECRETO = "secreto-de-prueba";
const usuario = { id: 42, password: "$2a$12$hashviejo" };

test("el token devuelve el usuario y vale mientras la contraseña no cambie", () => {
  const t = crearTokenRestablecer(usuario, SECRETO);
  const datos = leerTokenRestablecer(t, SECRETO);
  assert.equal(datos.id, 42);
  assert.equal(huellaVigente(datos, usuario.password), true);
  // Tras cambiar la contraseña, el mismo token deja de servir (un solo uso).
  assert.equal(huellaVigente(datos, "$2a$12$hashnuevo"), false);
});

test("no sirve como token de acceso ni con otro secreto", () => {
  const t = crearTokenRestablecer(usuario, SECRETO);
  assert.throws(() => jwt.verify(t, SECRETO));
  assert.equal(leerTokenRestablecer(t, "otro-secreto"), null);
});

test("rechaza tokens manipulados, caducados o ajenos", () => {
  assert.equal(leerTokenRestablecer("42", SECRETO), null);
  assert.equal(leerTokenRestablecer(undefined, SECRETO), null);
  assert.equal(leerTokenRestablecer(jwt.sign({ id: 42 }, SECRETO), SECRETO), null);
  const caducado = jwt.sign({ sub: "42", h: "x", exp: Math.floor(Date.now() / 1000) - 10 }, "cualquiera");
  assert.equal(leerTokenRestablecer(caducado, SECRETO), null);
  assert.equal(huellaVigente({ id: 42, h: "corta" }, usuario.password), false);
  assert.equal(huellaVigente(null, usuario.password), false);
});

test("reglas de contraseña nueva", () => {
  assert.deepEqual(erroresPasswordNueva("Segura#2026"), []);
  assert.equal(erroresPasswordNueva("corta").length > 0, true);
  assert.deepEqual(erroresPasswordNueva(undefined), ["La contraseña es requerida."]);
  assert.ok(erroresPasswordNueva("sinmayusculas1!").includes("Debe incluir al menos una mayúscula."));
});
