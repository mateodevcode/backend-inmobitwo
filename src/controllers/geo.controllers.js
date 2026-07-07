import { pool } from "../db.js";

export const getCountries = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, iso2, phonecode, flag_emoji, latitude, longitude
       FROM countries
       ORDER BY name ASC`,
    );
    res.json({ success: true, message: null, data: rows, error: null });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: "Error al obtener países",
      data: null,
      error: error.message,
    });
  }
};

export const getStates = async (req, res) => {
  const { countryId } = req.query;

  if (!countryId) {
    return res.status(400).json({
      success: false,
      message: "countryId es requerido",
      data: null,
      error: null,
    });
  }

  try {
    const { rows } = await pool.query(
      `SELECT id, country_id, name, latitude, longitude
       FROM states
       WHERE country_id = $1
       ORDER BY name ASC`,
      [countryId],
    );
    res.json({ success: true, message: null, data: rows, error: null });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: "Error al obtener provincias/departamentos",
      data: null,
      error: error.message,
    });
  }
};

export const getCities = async (req, res) => {
  const { stateId } = req.query;

  if (!stateId) {
    return res.status(400).json({
      success: false,
      message: "stateId es requerido",
      data: null,
      error: null,
    });
  }

  try {
    const { rows } = await pool.query(
      `SELECT id, state_id, name, latitude::float, longitude::float
      FROM cities
      WHERE state_id = $1
      ORDER BY name ASC`,
      [stateId],
    );
    res.json({ success: true, message: null, data: rows, error: null });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: "Error al obtener ciudades",
      data: null,
      error: error.message,
    });
  }
};
