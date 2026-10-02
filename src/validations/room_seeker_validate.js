// Valida el cuerpo de PUT /room-seeker/me (upsert parcial: todos opcionales).
// Devuelve lista de errores; vacía = válido.

const GENEROS = ["hombre", "mujer", "otro"];
const OCUPACIONES = ["estudio", "trabajo", "ambos"];
const BUSCA_CON = ["solo_yo", "pareja", "amigos"];

const esEnteroPositivo = (v) => Number.isInteger(v) && v > 0;

export function room_seeker_validate(datos = {}) {
  const errores = [];

  if (datos.genero !== undefined && datos.genero !== null) {
    if (!GENEROS.includes(datos.genero)) {
      errores.push("El género no es válido (hombre, mujer u otro).");
    }
  }

  if (datos.edad !== undefined && datos.edad !== null) {
    if (!Number.isInteger(datos.edad) || datos.edad < 16 || datos.edad > 100) {
      errores.push("La edad debe ser un número entre 16 y 100.");
    }
  }

  if (datos.ocupacion !== undefined && datos.ocupacion !== null) {
    if (!OCUPACIONES.includes(datos.ocupacion)) {
      errores.push("La ocupación no es válida (estudio, trabajo o ambos).");
    }
  }

  for (const campo of [
    "fuma_en_casa",
    "tiene_mascota",
    "habitacion_privada",
    "amoblada",
    "bano_privado",
  ]) {
    if (
      datos[campo] !== undefined &&
      datos[campo] !== null &&
      typeof datos[campo] !== "boolean"
    ) {
      errores.push(`El campo ${campo} debe ser verdadero, falso o vacío.`);
    }
  }

  if (datos.busca_con !== undefined && datos.busca_con !== null) {
    if (!BUSCA_CON.includes(datos.busca_con)) {
      errores.push("El campo busca_con no es válido (solo_yo, pareja o amigos).");
    }
  }

  if (datos.presupuesto_max !== undefined && datos.presupuesto_max !== null) {
    if (!esEnteroPositivo(datos.presupuesto_max)) {
      errores.push("El presupuesto máximo debe ser un número mayor a 0.");
    }
  }

  for (const campo of ["state_id", "city_id"]) {
    if (datos[campo] !== undefined && datos[campo] !== null) {
      if (!esEnteroPositivo(datos[campo])) {
        errores.push(`El campo ${campo} debe ser un identificador válido.`);
      }
    }
  }

  if (datos.fecha_entrada !== undefined && datos.fecha_entrada !== null) {
    if (
      typeof datos.fecha_entrada !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(datos.fecha_entrada) ||
      Number.isNaN(Date.parse(datos.fecha_entrada))
    ) {
      errores.push("La fecha de entrada debe tener formato AAAA-MM-DD.");
    }
  }

  return errores;
}
