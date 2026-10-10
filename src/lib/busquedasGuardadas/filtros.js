// src/lib/busquedasGuardadas/filtros.js
// Normalización + construcción del WHERE para búsquedas guardadas.
// Replica la lógica de getPropertiesBySlugs (controlador) para que lo que
// se avisa sea lo mismo que se ve en la web. Usa el buildTipoFilter real.
import crypto from "node:crypto";
import { pool } from "../../db.js";
import { buildTipoFilter, esTipoVacacional } from "../propertyFilters.js";

// Parámetros que el FE envía a /propiedades/search-slugs
// (fecha se EXCLUYE a propósito: es relativo y no tiene sentido en una alerta)
const CLAVES_PERMITIDAS = [
  "operation", "type", "dept", "city",
  "min", "max", "tamMin", "tamMax",
  "tipos", "rental", "anunciante", "multimedia",
  "hab", "banos", "estado", "caract",
];

const CLAVES_LISTA = ["tipos", "rental", "hab", "banos", "estado", "caract", "multimedia"];

const toList = (v) =>
  (Array.isArray(v) ? v : String(v).split(","))
    .map((x) => String(x).trim())
    .filter(Boolean);

/** Limpia y ordena para que el mismo conjunto de filtros dé siempre el mismo hash. */
export function normalizarFiltros(raw = {}) {
  const out = {};
  for (const k of CLAVES_PERMITIDAS) {
    const v = raw[k];
    if (v === undefined || v === null || v === "") continue;
    if (CLAVES_LISTA.includes(k) || (k === "type" && String(v).includes(","))) {
      const lista = [...new Set(toList(v))].sort();
      if (lista.length) out[k] = lista.join(",");
    } else {
      out[k] = String(v).trim().toLowerCase();
    }
  }
  return out;
}

export function validarFiltros(f) {
  const errores = [];
  if (!f.operation) errores.push("Falta la operación (venta/arriendo).");
  if (!f.dept) errores.push("Falta el departamento.");
  if (!f.type && !f.tipos) errores.push("Falta el tipo de inmueble.");
  return errores;
}

export function hashFiltros(filtros) {
  const ordenado = Object.keys(filtros).sort().map((k) => [k, filtros[k]]);
  return crypto.createHash("sha256").update(JSON.stringify(ordenado)).digest("hex");
}

// Copiado del controlador (getPropertiesBySlugs): grupo de estado -> condition_types.code
const ESTADO_GRUPOS = {
  obra_nueva: ["nuevo", "para_estrenar", "en_construccion", "obra_negra", "obra_gris"],
  usado: ["usado"],
  remodelado: ["remodelado"],
  para_remodelar: ["para_remodelar"],
};

// Copiado del controlador: caract -> columna de propiedades
const CARACT_COL = {
  ascensor: "has_elevator",
  piscina: "has_swimming_pool",
  gimnasio: "has_gym",
  seguridad_24h: "has_security_24h",
  aire_acondicionado: "has_air_conditioning",
  amoblado: "is_furnished",
  parqueadero: "parking_space_count",
};

// Resuelve el id de operation_types por code (igual que el controlador).
async function operationIdPorCode(code) {
  const { rows } = await pool.query(
    "SELECT id FROM operation_types WHERE LOWER(code) = LOWER($1)",
    [String(code)],
  );
  return rows[0]?.id ?? null;
}

// JOIN a la oferta ACTIVA de la operación (igual que joinOfertaActiva del controlador).
function joinOfertaActiva(opId) {
  const id = Number(opId);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("Operación inválida para el filtro de ofertas.");
  }
  return `INNER JOIN property_listings l ON l.propiedad_id = p.id AND l.operation_type_id = ${id} AND l.listing_status = 'active'`;
}

const numValido = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Construye JOINs + WHERE sobre el alias base:
 *   propiedades p JOIN property_listings l (oferta activa)
 * `params` ya trae los parámetros previos; los nuevos se agregan con índices correctos.
 * Replica las 3 ramas geográficas del controlador:
 *   ciudad+depto, depto con guion (city-dept), solo depto, región.
 */
export async function construirWhereBusqueda(f, params) {
  const joins = [
    "INNER JOIN cities c ON c.id = p.city_id",
    "INNER JOIN states s ON s.id = p.state_id",
    "LEFT JOIN regions r ON r.id = s.region_id",
    "LEFT JOIN condition_types ct ON ct.id = p.condition_type_id",
  ];
  const where = [];
  const push = (v) => { params.push(v); return `$${params.length}`; };

  // operación (vacacional fuerza arriendo, igual que el controlador)
  const tiposTxt = `${f.type || ""},${f.tipos || ""}`;
  const opCode = esTipoVacacional(tiposTxt) ? "arriendo" : f.operation;
  const opId = await operationIdPorCode(opCode);
  if (!opId) throw new Error(`Operación desconocida: ${opCode}`);
  joins.unshift(joinOfertaActiva(opId));

  // tipo (usa el filtro real: maneja obra-nueva y vacacionales)
  const { sql: tipoSql, params: tipoParams } = buildTipoFilter(f.tipos || f.type || "", {
    alias: "p",
    startIdx: params.length + 1,
  });
  tipoParams.forEach((t) => params.push(t));
  if (tipoSql) where.push(tipoSql);

  // zona: (ciudad+depto) o depto con guion (city-dept), o depto, o región.
  // El controlador las prueba en ese orden; aquí van en OR (mismo resultado).
  if (f.city) {
    const cSlug = push(f.city);
    const sSlug = push(f.dept);
    const fullSlug = push(`${f.city}-${f.dept}`);
    where.push(`((c.slug = ${cSlug} AND s.slug = ${sSlug}) OR (s.slug = ${fullSlug}))`);
  } else {
    const dSlug = push(f.dept);
    where.push(`(s.slug = ${dSlug} OR r.slug = ${dSlug})`);
  }

  // precio (millones COP sobre la oferta activa)
  const min = numValido(f.min);
  const max = numValido(f.max);
  if (min !== null) where.push(`l.precio >= ${push(Math.round(min * 1_000_000))}`);
  if (max !== null) where.push(`l.precio <= ${push(Math.round(max * 1_000_000))}`);

  // tamaño (área privada con fallback a construida)
  const tamMin = numValido(f.tamMin);
  const tamMax = numValido(f.tamMax);
  if (tamMin !== null) where.push(`COALESCE(p.private_area, p.constructed_area) >= ${push(Math.round(tamMin))}`);
  if (tamMax !== null) where.push(`COALESCE(p.private_area, p.constructed_area) <= ${push(Math.round(tamMax))}`);

  // tipo de alquiler (ids)
  if (f.rental) {
    const ids = toList(f.rental).map(Number).filter((n) => Number.isInteger(n) && n > 0);
    if (ids.length) where.push(`l.rental_type_id = ANY(${push(ids)}::int[])`);
  }

  // anunciante
  const anunc = new Set(toList(f.anunciante || ""));
  if (anunc.has("persona") && !anunc.has("inmobiliaria")) where.push("p.es_de_organizacion = FALSE");
  else if (anunc.has("inmobiliaria") && !anunc.has("persona")) where.push("p.es_de_organizacion = TRUE");

  // multimedia (solo "plano" tiene efecto hoy, igual que el controlador)
  if (f.multimedia && toList(f.multimedia).includes("plano")) {
    where.push("EXISTS (SELECT 1 FROM propiedades_planos pp WHERE pp.propiedad_id = p.id)");
  }

  // habitaciones / baños: el valor máximo significa "o más" (igual que el controlador)
  const rangoMin = (col, lista, tope) => {
    const conds = [];
    for (const v of lista) {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0) continue;
      conds.push(n >= tope ? `${col} >= ${push(n)}` : `${col} = ${push(n)}`);
    }
    return conds.length ? `(${conds.join(" OR ")})` : null;
  };
  if (f.hab) { const c = rangoMin("p.bedroom_count", toList(f.hab), 4); if (c) where.push(c); }
  if (f.banos) { const c = rangoMin("p.bathroom_count", toList(f.banos), 3); if (c) where.push(c); }

  // estado del inmueble
  if (f.estado) {
    const codes = toList(f.estado).flatMap((g) => ESTADO_GRUPOS[g] || []);
    if (codes.length) where.push(`ct.code = ANY(${push(codes)}::text[])`);
  }

  // características
  if (f.caract) {
    for (const k of toList(f.caract)) {
      const col = CARACT_COL[k];
      if (!col) continue;
      where.push(k === "parqueadero" ? `p.${col} > 0` : `p.${col} = TRUE`);
    }
  }

  return { joins: joins.join("\n"), where };
}
