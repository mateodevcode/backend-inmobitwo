import { pool } from "../src/db.js";
import { buildTipoFilter, esTipoVacacional } from "../src/lib/propertyFilters.js";

async function run() {
  const casos = [
    { label: "obra-nueva venta", type: "obra-nueva", operation: "venta" },
    { label: "vacacional", type: "vacacional", operation: "venta", expectArriendo: true },
    { label: "multi-tipo", type: "apartamento,casa", operation: "venta" },
    { label: "tipo unico", type: "casa", operation: "venta" },
  ];

  for (const c of casos) {
    let op = c.operation;
    if (esTipoVacacional(c.type)) op = "arriendo";
    const params = [op];
    const { sql, params: tp } = buildTipoFilter(c.type, { alias: "p", startIdx: params.length + 1 });
    tp.forEach((t) => params.push(t));
    const typeCondition = sql ? `AND ${sql}` : "";
    params.push("barranquilla", "atlantico");
    const cityIdx = params.length - 1;
    const deptIdx = params.length;
    const q = `
      SELECT p.id
      FROM propiedades p
      INNER JOIN operation_types ot ON p.operation_type_id = ot.id
      INNER JOIN property_types pt ON p.property_type_id = pt.id
      INNER JOIN cities c ON p.city_id = c.id
      INNER JOIN states s ON c.state_id = s.id
      WHERE LOWER(ot.code) = $1
        ${typeCondition}
        AND c.slug = $${cityIdx}
        AND s.slug = $${deptIdx}
        AND p.estado = 'publicado'
      ORDER BY p.id DESC LIMIT 100`;
    const { rows } = await pool.query(q, params);
    console.log(`[${c.label}] ${sql}\n  -> ids: ${rows.map(r => r.id).join(",") || "(ninguno)"}`);
  }
  process.exit(0);
}
run().catch(e => { console.error(e); process.exit(1); });
