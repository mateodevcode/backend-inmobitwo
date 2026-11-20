// Interpreta una fila importada → { valores } o { errores }. Puro (sin BD).
import { normalizarTelefonoCO } from "../crmPermisos.js";
import {
  EMAIL_RE,
  operacionInmueble,
  parsearDinero,
  parsearEntero,
  parsearEtiquetas,
  resolverCiudad,
  resolverTipoInmueble,
  tipoContacto,
  vacio,
} from "./normalizar.js";

const texto = (v, max) => (vacio(v) ? null : String(v).trim().slice(0, max));

export function interpretarContacto(fila) {
  const errores = [];
  const nombre = texto(fila.nombre, 200);
  if (!nombre || nombre.length < 2) errores.push("Falta el nombre.");

  let email = texto(fila.email, 200);
  if (email) {
    email = email.toLowerCase();
    if (!EMAIL_RE.test(email)) errores.push(`Correo no válido: "${email}".`);
  }

  let telefono = null;
  if (!vacio(fila.telefono)) {
    telefono = normalizarTelefonoCO(fila.telefono);
    if (!telefono) errores.push(`Teléfono no válido: "${String(fila.telefono).trim()}" (celular colombiano de 10 dígitos).`);
  }

  const tipo = tipoContacto(fila.tipo);
  if (!tipo) errores.push(`Tipo desconocido: "${String(fila.tipo).trim()}" (comprador, vendedor, arrendatario, inversor u otro).`);

  const presupuesto_min = parsearDinero(fila.presupuesto_min);
  const presupuesto_max = parsearDinero(fila.presupuesto_max);
  if (Number.isNaN(presupuesto_min)) errores.push("Presupuesto mínimo no es un valor en pesos.");
  if (Number.isNaN(presupuesto_max)) errores.push("Presupuesto máximo no es un valor en pesos.");
  if (presupuesto_min != null && presupuesto_max != null && presupuesto_min > presupuesto_max) {
    errores.push("El presupuesto mínimo es mayor que el máximo.");
  }

  if (errores.length) return { errores };
  return {
    valores: {
      nombre,
      email,
      telefono,
      tipo,
      presupuesto_min,
      presupuesto_max,
      zona_interes: texto(fila.zona_interes, 200),
      etiquetas: parsearEtiquetas(fila.etiquetas),
      notas: texto(fila.notas, 4000),
    },
  };
}

// catalogos: { tipos: [{id, code, label_es}], ciudades: [{id, name, state_id, state_name}] }
export function interpretarInmueble(fila, catalogos) {
  const errores = [];

  const tipo = resolverTipoInmueble(catalogos.tipos, fila.tipo);
  if (!tipo) errores.push(vacio(fila.tipo) ? "Falta el tipo de inmueble." : `Tipo de inmueble desconocido: "${String(fila.tipo).trim()}".`);

  const operacion = operacionInmueble(fila.operacion);
  if (!operacion) errores.push(vacio(fila.operacion) ? "Falta la operación (venta o arriendo)." : `Operación desconocida: "${String(fila.operacion).trim()}".`);

  const precio = parsearDinero(fila.precio);
  if (precio == null) errores.push("Falta el precio.");
  else if (Number.isNaN(precio) || precio <= 0 || precio > 1e13) errores.push("El precio no es un valor en pesos válido.");

  const { ciudad, error: errorCiudad } = resolverCiudad(catalogos.ciudades, fila.ciudad, fila.departamento);
  if (errorCiudad) errores.push(errorCiudad);

  const direccion = texto(fila.direccion, 255);
  if (!direccion || direccion.length < 3) errores.push("Falta la dirección.");

  const numeros = {
    estrato: parsearEntero(fila.estrato, { min: 1, max: 6 }),
    constructed_area: parsearEntero(fila.area, { min: 1, max: 10_000_000 }),
    private_area: parsearEntero(fila.area_privada, { min: 1, max: 10_000_000 }),
    bedroom_count: parsearEntero(fila.habitaciones, { min: 0, max: 50 }),
    bathroom_count: parsearEntero(fila.banos, { min: 0, max: 50 }),
    parking_space_count: parsearEntero(fila.parqueaderos, { min: 0, max: 100 }),
  };
  const nombres = {
    estrato: "Estrato (1 a 6)",
    constructed_area: "Área construida",
    private_area: "Área privada",
    bedroom_count: "Habitaciones",
    bathroom_count: "Baños",
    parking_space_count: "Parqueaderos",
  };
  for (const [k, v] of Object.entries(numeros)) {
    if (Number.isNaN(v)) errores.push(`${nombres[k]}: valor no válido.`);
  }
  const administracion = parsearDinero(fila.administracion);
  if (Number.isNaN(administracion) || administracion > 2_000_000_000) errores.push("Administración no es un valor en pesos válido.");

  if (errores.length) return { errores };
  return {
    valores: {
      tipo,
      operacion,
      precio,
      ciudad,
      direccion,
      barrio: texto(fila.barrio, 255),
      administracion,
      descripcion: texto(fila.descripcion, 5000),
      ...numeros,
    },
  };
}

// Texto plano → HTML sencillo (párrafos y saltos), ya escapado.
export function textoAHtml(textoPlano, escapar) {
  if (!textoPlano) return null;
  return textoPlano
    .split(/\r?\n\s*\r?\n/)
    .map((p) => `<p>${escapar(p.trim()).replace(/\r?\n/g, "<br>")}</p>`)
    .join("");
}
