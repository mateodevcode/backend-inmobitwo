// Helpers compartidos para construir filtros de búsqueda por tipo de inmueble.
//
// El catálogo de property_types no contiene los "tipos virtuales" que usa el
// buscador (obra-nueva, vacacional). Esos se resuelven aquí con condiciones de
// negocio reales de la base de datos:
//   - obra-nueva  -> is_new_construction = true o condition_type de construcción
//   - vacacional  -> rental_type 'vacacional' o 'temporada'
// Todo lo demás se filtra por código de property_types.

const CONDITION_OBRA_NUEVA = [
  "nuevo",
  "para_estrenar",
  "en_construccion",
  "obra_negra",
  "obra_gris",
];

const RENTAL_VACACIONAL = ["vacacional", "temporada"];

/**
 * Construye el fragmento SQL que filtra propiedades por tipo.
 *
 * @param {string} [type] - Slug de tipo (puede venir con comas, ej "casa,lote").
 * @param {{alias?: string, startIdx?: number}} [opts]
 * @returns {{sql: string, params: string[]}}
 */
export function buildTipoFilter(type, { alias = "p", startIdx = 1 } = {}) {
  const tipos = (type || "")
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);

  if (tipos.length === 0) return { sql: "", params: [] };

  if (tipos.includes("obra-nueva")) {
    const codes = CONDITION_OBRA_NUEVA.map((c) => `'${c}'`).join(", ");
    return {
      sql: `( ${alias}.is_new_construction = TRUE OR ${alias}.condition_type_id IN (SELECT id FROM condition_types WHERE code IN (${codes})) )`,
      params: [],
    };
  }

  if (tipos.includes("vacacional")) {
    const codes = RENTAL_VACACIONAL.map((c) => `'${c}'`).join(", ");
    return {
      sql: `${alias}.rental_type_id IN (SELECT id FROM rental_types WHERE code IN (${codes}))`,
      params: [],
    };
  }

  const params = [];
  if (tipos.length === 1) {
    params.push(tipos[0]);
    return {
      sql: `${alias}.property_type_id IN (SELECT id FROM property_types WHERE LOWER(code) = LOWER($${startIdx}))`,
      params,
    };
  }

  tipos.forEach((t) => params.push(t));
  const placeholders = tipos.map((_, i) => `LOWER($${startIdx + i})`);
  return {
    sql: `${alias}.property_type_id IN (SELECT id FROM property_types WHERE LOWER(code) IN (${placeholders.join(", ")}))`,
    params,
  };
}

/**
 * True cuando el tipo es el filtro virtual de vacacional.
 * Útil para forzar la operación a "arriendo" en ese caso.
 */
export function esTipoVacacional(type) {
  return (type || "")
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
    .includes("vacacional");
}
