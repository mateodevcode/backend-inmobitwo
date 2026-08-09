import { pool } from "./src/db.js";

const q = async (label, sql) => {
  try {
    const { rows } = await pool.query(sql);
    console.log(`[${label}] rows: ${rows.length}`);
    if (rows.length) console.log(JSON.stringify(rows.map((r) => ({ id: r.id, titulo: r.titulo, city: r.city, state: r.state })).slice(0, 5)));
  } catch (e) {
    console.log(`[${label}] ERROR: ${e.message}`);
  }
};

const base = `
  SELECT p.id, p.titulo, c.slug AS city, s.slug AS state
  FROM propiedades p
  INNER JOIN operation_types ot ON p.operation_type_id = ot.id
  INNER JOIN property_types pt ON p.property_type_id = pt.id
  LEFT JOIN condition_types ct ON p.condition_type_id = ct.id
  INNER JOIN cities c ON p.city_id = c.id
  INNER JOIN states s ON c.state_id = s.id
  LEFT JOIN organizaciones o ON p.organizacion_id = o.id
  WHERE LOWER(ot.code) = 'venta'
    AND LOWER(pt.code) = 'apartamento'
    AND c.slug = 'barranquilla'
    AND s.slug = 'atlantico'
    AND p.estado = 'publicado'
`;

await q("sin filtros", `${base} ORDER BY p.id DESC LIMIT 100`);

await q("con filtros vacios (new WHEREs)", `
  ${base}
  ORDER BY p.id DESC LIMIT 100
`);

// probar el fallback de ciudad
const q2 = `
  SELECT p.id, p.titulo, c.name AS city_name, s.name AS state_name
  FROM propiedades p
  INNER JOIN operation_types ot ON p.operation_type_id = ot.id
  INNER JOIN property_types pt ON p.property_type_id = pt.id
  LEFT JOIN condition_types ct ON p.condition_type_id = ct.id
  INNER JOIN cities c ON p.city_id = c.id
  INNER JOIN states s ON c.state_id = s.id
  WHERE LOWER(ot.code) = 'venta' AND LOWER(pt.code) = 'apartamento'
    AND c.slug = 'barranquilla' AND s.slug = 'atlantico' AND p.estado = 'publicado'
  ORDER BY p.id DESC LIMIT 100
`;
await q("same city/dept", q2);

process.exit(0);
