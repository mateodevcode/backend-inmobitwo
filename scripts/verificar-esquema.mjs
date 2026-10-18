// backend-inmobitwo/scripts/verificar-esquema.mjs
// Verifica que cada migración de src/database/migrations/ esté replicada en
// db.sql (schema completo) y contemplada en drop_all.sql (reset).
// Compara TOKENS (nombres de tabla/columna/índice/función), no SQL textual,
// para que db.sql pueda reordenar/ajustar formato.
//
// Uso:  npm run db:check
// Se corre DESPUÉS de escribir cualquier migración nueva: si falla, copia el
// bloque al final de db.sql y añade los DROP correspondientes en drop_all.sql.

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIG_DIR = path.join(RAIZ, "src", "database", "migrations");
const DB_SQL = readFileSync(path.join(RAIZ, "src", "database", "db.sql"), "utf8");
const DROP_SQL = readFileSync(path.join(RAIZ, "src", "database", "drop_all.sql"), "utf8");

const migs = readdirSync(MIG_DIR)
  .filter((f) => /^\d{3}_.+\.sql$/.test(f) && !f.endsWith(".down.sql"))
  .sort();

const errores = [];

function faltaDentro(destino, token, mensaje) {
  const re = new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
  if (!re.test(destino)) errores.push(`  ${mensaje}`);
}

for (const archivo of migs) {
  const sql = readFileSync(path.join(MIG_DIR, archivo), "utf8");

  const tablas = [...sql.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?(\w+)/g)].map((m) => m[1]);
  const indices = [...sql.matchAll(/CREATE (?:UNIQUE )?INDEX (?:IF NOT EXISTS )?(\w+) ON (\w+)/g)];
  const columnas = [...sql.matchAll(/ALTER TABLE (\w+)\s+ADD COLUMN (?:IF NOT EXISTS )?(\w+)/g)];
  const funciones = [...sql.matchAll(/CREATE (?:OR REPLACE )?FUNCTION (\w+)/g)].map((m) => m[1]);

  for (const t of tablas) {
    faltaDentro(DB_SQL, t, `${archivo}: tabla "${t}" no está en db.sql`);
    faltaDentro(
      DROP_SQL,
      `DROP TABLE IF EXISTS ${t} CASCADE`,
      `${archivo}: falta "DROP TABLE IF EXISTS ${t} CASCADE" en drop_all.sql`,
    );
  }

  for (const [, idx, tabla] of indices) {
    faltaDentro(DB_SQL, idx, `${archivo}: índice "${idx}" no está en db.sql`);
    faltaDentro(DB_SQL, tabla, `${archivo}: índice sobre tabla "${tabla}" ausente en db.sql`);
  }

  for (const [, tabla, col] of columnas) {
    faltaDentro(DB_SQL, tabla, `${archivo}: tabla "${tabla}" alterada no está en db.sql`);
    faltaDentro(DB_SQL, col, `${archivo}: columna "${col}" no está en db.sql`);
  }

  for (const f of funciones) {
    faltaDentro(DB_SQL, f, `${archivo}: función "${f}" no está en db.sql`);
    faltaDentro(
      DROP_SQL,
      `DROP FUNCTION IF EXISTS ${f}`,
      `${archivo}: falta "DROP FUNCTION IF EXISTS ${f}();" en drop_all.sql`,
    );
  }
}

console.log(`→ ${migs.length} migraciones revisadas`);
if (errores.length) {
  console.error("\n❌ db.sql / drop_all.sql NO están al día:\n");
  console.error(errores.join("\n"));
  process.exit(1);
}
console.log("✅ db.sql y drop_all.sql replican todas las migraciones");
