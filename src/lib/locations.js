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

export const getBarrioById = async (barrioId) => {
  const { rows } = await pool.query(
    "SELECT id, name FROM barrios WHERE id = $1",
    [barrioId],
  );
  return rows[0] || null;
};

// Labels de catálogos para generar títulos y mostrarlos en el frontend
export const getPropertyTypeLabel = async (propertyTypeId) => {
  if (!propertyTypeId) return null;
  const { rows } = await pool.query(
    "SELECT label_es FROM property_types WHERE id = $1",
    [propertyTypeId],
  );
  return rows[0]?.label_es || null;
};

export const getOperationTypeLabel = async (operationTypeId) => {
  if (!operationTypeId) return null;
  const { rows } = await pool.query(
    "SELECT label_es FROM operation_types WHERE id = $1",
    [operationTypeId],
  );
  return rows[0]?.label_es || null;
};
