// src/lib/zonas.js — búsqueda por varias zonas a la vez (mapa "Seleccionar
// en mapa"). Puro, sin BD: valida la lista y arma el filtro SQL.
//
// Formato en la URL del portal: ?z=municipio:11001,barrio:110010101,region:caribe
// En el body de la API: { zonas: [{ tipo, codigo }] } o el mismo string.
import { solicitudInvalida } from "./errores.js";

export const MAX_ZONAS = 30;
export const TIPOS_ZONA = ["region", "departamento", "municipio", "barrio"];

// Códigos DANE: dígitos (barrios pueden traer letras/guiones según la fuente).
// Regiones: slug.
const CODIGO_VALIDO = /^[A-Za-z0-9_-]{1,40}$/;

// Acepta "tipo:codigo,tipo:codigo" o [{ tipo, codigo }]. Quita duplicados.
export function leerZonas(entrada) {
  let lista;
  if (Array.isArray(entrada)) {
    lista = entrada.map((z) => ({ tipo: z?.tipo, codigo: z?.codigo }));
  } else if (typeof entrada === "string") {
    lista = entrada
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => {
        const i = s.indexOf(":");
        return i < 0 ? { tipo: s, codigo: "" } : { tipo: s.slice(0, i), codigo: s.slice(i + 1) };
      });
  } else {
    throw solicitudInvalida("zonas es requerido.");
  }

  const vistas = new Set();
  const zonas = [];
  for (const z of lista) {
    const tipo = String(z.tipo ?? "").trim();
    const codigo = String(z.codigo ?? "").trim();
    if (!TIPOS_ZONA.includes(tipo)) throw solicitudInvalida(`Tipo de zona no válido: ${tipo}`);
    if (!CODIGO_VALIDO.test(codigo)) throw solicitudInvalida("Código de zona no válido.");
    const clave = `${tipo}:${codigo}`;
    if (vistas.has(clave)) continue;
    vistas.add(clave);
    zonas.push({ tipo, codigo });
  }
  if (zonas.length === 0) throw solicitudInvalida("Selecciona al menos una zona.");
  if (zonas.length > MAX_ZONAS) throw solicitudInvalida(`Máximo ${MAX_ZONAS} zonas.`);
  return zonas;
}

// Filtro SQL "el inmueble está en alguna de las zonas" (unión, sin contar
// dos veces lo que cae en una zona y en su padre). Agrega sus valores a
// `params` y devuelve el fragmento con los $n correspondientes.
export function filtroZonasSQL(zonas, params, alias = "p") {
  const porTipo = Object.fromEntries(TIPOS_ZONA.map((t) => [t, []]));
  for (const z of zonas) porTipo[z.tipo].push(z.codigo);

  const condiciones = [];
  const agregar = (valores, sql) => {
    if (!valores.length) return;
    params.push(valores);
    condiciones.push(sql(`$${params.length}::text[]`));
  };

  agregar(porTipo.region, (v) =>
    `${alias}.city_id IN (SELECT c.id FROM cities c JOIN states s ON c.state_id = s.id
       JOIN regions r ON s.region_id = r.id WHERE r.slug = ANY(${v}))`);
  agregar(porTipo.departamento, (v) =>
    `${alias}.city_id IN (SELECT c.id FROM cities c JOIN states s ON c.state_id = s.id
       WHERE s.dane_code = ANY(${v}))`);
  agregar(porTipo.municipio, (v) =>
    `${alias}.city_id IN (SELECT c.id FROM cities c WHERE c.dane_code = ANY(${v}))`);
  agregar(porTipo.barrio, (v) =>
    `${alias}.barrio_id IN (SELECT b.id FROM barrios b WHERE b.dane_code = ANY(${v}))`);

  return `(${condiciones.join(" OR ")})`;
}
