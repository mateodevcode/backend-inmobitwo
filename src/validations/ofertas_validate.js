// Validación de ofertas por operación (matriz de src/constants/operaciones.js).
// Async porque verifica rental_type_id contra BD. Devuelve array de errores (vacío = válido).
import {
  MATRIZ_OPERACIONES,
  MAX_PRECIO,
  OPERACIONES_SOPORTADAS,
} from "../constants/operaciones.js";
import { rentalTypeExists } from "../lib/catalogos.js";

export async function validarOferta(operacionCode, datos = {}, { tipoInmuebleCode } = {}) {
  const errores = [];
  const operacion = String(operacionCode || "").toLowerCase();

  if (!OPERACIONES_SOPORTADAS.includes(operacion)) {
    errores.push(
      `La operación debe ser una de: ${OPERACIONES_SOPORTADAS.join(", ")}.`,
    );
    return errores;
  }

  const matriz = MATRIZ_OPERACIONES[operacion];

  for (const campo of matriz.requeridos) {
    const v = datos[campo];
    if (v === undefined || v === null || v === "") {
      errores.push(
        `El campo ${campo} es obligatorio para la operación ${operacion}.`,
      );
    }
  }

  if (datos.precio !== undefined && datos.precio !== null && datos.precio !== "") {
    const precio = Number(datos.precio);
    if (!Number.isInteger(precio) || precio <= 0 || precio > MAX_PRECIO) {
      errores.push(
        `El precio debe ser un entero mayor a 0 y menor o igual a ${MAX_PRECIO}.`,
      );
    }
  }

  if (
    operacion === "arriendo" &&
    datos.rental_type_id !== undefined &&
    datos.rental_type_id !== null &&
    datos.rental_type_id !== ""
  ) {
    if (!(await rentalTypeExists(datos.rental_type_id))) {
      errores.push("El tipo de alquiler indicado no existe.");
    }
  }

  if (
    datos.listing_status !== undefined &&
    datos.listing_status !== null &&
    datos.listing_status !== "" &&
    !matriz.estados.includes(datos.listing_status)
  ) {
    errores.push(
      `El estado debe ser uno de: ${matriz.estados.join(", ")} para ${operacion}.`,
    );
  }

  if (tipoInmuebleCode && String(tipoInmuebleCode).toLowerCase() === "habitacion" && operacion !== "arriendo") {
    errores.push("El tipo habitación solo admite la operación arriendo.");
  }

  return errores;
}
