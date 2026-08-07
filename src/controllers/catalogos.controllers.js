// controllers/catalogos.controllers.js
// Endpoints de solo lectura para los catálogos / lookups del schema v5.0.
import { pool } from "../db.js";

// GET /api/catalogos/operaciones
export const getOperationTypes = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, code, label_es FROM operation_types ORDER BY id ASC`,
    );
    res.status(200).json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// GET /api/catalogos/tipos-inmueble
export const getPropertyTypes = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, code, label_es, label_en, category
       FROM property_types ORDER BY id ASC`,
    );
    res.status(200).json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// GET /api/catalogos/tipos-alquiler
export const getRentalTypes = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, code, label_es FROM rental_types ORDER BY id ASC`,
    );
    res.status(200).json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// GET /api/catalogos/estados
export const getConditionTypes = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, code, label_es FROM condition_types ORDER BY id ASC`,
    );
    res.status(200).json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// GET /api/catalogos/calefaccion
export const getHeatingTypes = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, code, label_es FROM heating_types ORDER BY id ASC`,
    );
    res.status(200).json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// GET /api/catalogos/caracteristicas
// Devuelve el feature_catalog agrupado por `category` para que el frontend
// pueda renderizar secciones (Seguridad, Confort, Ocio, etc.).
export const getFeatureCatalog = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, code, label_es, category, data_type
       FROM feature_catalog ORDER BY category ASC, id ASC`,
    );
    const agrupado = rows.reduce((acc, fila) => {
      if (!acc[fila.category]) acc[fila.category] = [];
      acc[fila.category].push({
        id: fila.id,
        code: fila.code,
        label_es: fila.label_es,
        data_type: fila.data_type,
      });
      return acc;
    }, {});
    res.status(200).json({ success: true, data: agrupado });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};
