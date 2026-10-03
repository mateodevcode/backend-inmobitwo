// Generación y regeneración del título del anuncio.
// MISMA plantilla que creación (titulo-sugerido): "{Operación} de {Tipo} en
// {dirección}, {ciudad}, {departamento}" con operación Venta/Alquiler.
// Ej: "Alquiler de Casa en Calle 53, Barranquilla, Atlántico"
import { pool } from "../db.js";

// generarTitulo({ operacion: "venta"|"arriendo", ambas, tipoLabel, direccion, ciudad, departamento })
export function generarTitulo({ operacion, ambas, tipoLabel, direccion, ciudad, departamento }) {
  const base =
    String(operacion || "").toLowerCase() === "venta" ? "Venta" : "Alquiler";
  const operacionesTxt = ambas ? "Venta y arriendo" : base;
  const tipo = String(tipoLabel || "Propiedad");
  const lugar = [direccion, ciudad, departamento].filter(Boolean).join(", ");
  const titulo = `${operacionesTxt} de ${tipo}${lugar ? ` en ${lugar}` : ""}`;
  return titulo.charAt(0).toUpperCase() + titulo.slice(1);
}

// Relee ofertas + datos y hace UPDATE de propiedades.titulo.
// Si hay oferta heredada arriendo_venta, NO regenera (se respeta el título).
export async function regenerarTitulo(client, propiedadId) {
  const { rows: ofertas } = await client.query(
    `SELECT l.operation_type_id, ot.code, ot.label_es
     FROM property_listings l
     JOIN operation_types ot ON ot.id = l.operation_type_id
     WHERE l.propiedad_id = $1`,
    [propiedadId],
  );
  if (ofertas.length === 0) return null;
  if (ofertas.some((o) => String(o.code).toLowerCase() === "arriendo_venta")) {
    return null;
  }

  // Venta primero, luego arriendo; "ambas" une con " y ".
  const orden = { venta: 0, arriendo: 1 };
  const principal = [...ofertas].sort(
    (a, b) =>
      (orden[String(a.code).toLowerCase()] ?? 9) -
      (orden[String(b.code).toLowerCase()] ?? 9),
  )[0];
  const esAmbas = ofertas.length > 1;

  const { rows: propRows } = await client.query(
    `SELECT p.property_type_id, p.direccion, c.name AS ciudad, s.name AS departamento
     FROM propiedades p
     LEFT JOIN cities c ON c.id = p.city_id
     LEFT JOIN states s ON s.id = p.state_id
     WHERE p.id = $1`,
    [propiedadId],
  );
  const prop = propRows[0];
  if (!prop) return null;

  let tipoLabel = "Propiedad";
  if (prop.property_type_id) {
    const { rows: tRows } = await client.query(
      "SELECT label_es FROM property_types WHERE id = $1",
      [prop.property_type_id],
    );
    if (tRows[0]?.label_es) tipoLabel = tRows[0].label_es;
  }

  const titulo = generarTitulo({
    operacion: String(principal.code).toLowerCase() === "venta" ? "venta" : "arriendo",
    ambas: esAmbas,
    tipoLabel,
    direccion: prop.direccion,
    ciudad: prop.ciudad,
    departamento: prop.departamento,
  });

  await client.query("UPDATE propiedades SET titulo = $1 WHERE id = $2", [
    titulo,
    propiedadId,
  ]);
  return titulo;
}
