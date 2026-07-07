import { pool } from "../db.js";

// lib/locations.js (o donde tengas tus queries)
export const getCityById = async (cityId) => {
  const { rows } = await pool.query(
    "SELECT id, name FROM cities WHERE id = $1",
    [cityId],
  );
  return rows[0] || null;
};

export const getStateById = async (stateId) => {
  const { rows } = await pool.query(
    "SELECT id, name FROM states WHERE id = $1",
    [stateId],
  );
  return rows[0] || null;
};
