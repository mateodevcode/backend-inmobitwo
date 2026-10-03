// Resolutores de catálogo por code (nunca hardcodear IDs).
// Caché en memoria: los catálogos casi no cambian.
import { pool } from "../db.js";

const cacheIdACode = new Map(); // `${tabla}:${id}` -> code
const cacheCodeAId = new Map(); // `${tabla}:${code}` -> id

async function codePorId(tabla, id) {
  if (id === undefined || id === null || id === "") return null;
  const clave = `${tabla}:${id}`;
  if (cacheIdACode.has(clave)) return cacheIdACode.get(clave);
  const { rows } = await pool.query(
    `SELECT code FROM ${tabla} WHERE id = $1`,
    [Number(id)],
  );
  const code = rows[0]?.code ?? null;
  cacheIdACode.set(clave, code);
  return code;
}

async function idPorCode(tabla, code) {
  if (!code) return null;
  const clave = `${tabla}:${code}`;
  if (cacheCodeAId.has(clave)) return cacheCodeAId.get(clave);
  const { rows } = await pool.query(
    `SELECT id FROM ${tabla} WHERE LOWER(code) = LOWER($1)`,
    [String(code)],
  );
  const id = rows[0]?.id ?? null;
  cacheCodeAId.set(clave, id);
  return id;
}

// NOTA: los nombres de tabla se interpolan pero siempre provienen de estas
// funciones (constantes internas), nunca de input de usuario.
export const getOperationCode = (id) => codePorId("operation_types", id);
export const getOperationId = (code) => idPorCode("operation_types", code);
export const getPropertyTypeCode = (id) => codePorId("property_types", id);
export const getRentalTypeCode = (id) => codePorId("rental_types", id);

export async function rentalTypeExists(id) {
  if (id === undefined || id === null || id === "") return false;
  const { rows } = await pool.query(
    "SELECT 1 FROM rental_types WHERE id = $1",
    [Number(id)],
  );
  return rows.length > 0;
}
