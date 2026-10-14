// src/controllers/portada.controllers.js — anuncio destacado del hero principal.
// Un solo destacado (tabla portada_destacada, id = 1). Solo el superadmin lo
// gestiona; la lectura es pública para el portal.
import { pool } from "../db.js";

// $ 72.000.000 (puntos de miles, sin decimales)
const formatoCOP = (valor) =>
  `$ ${Number(valor).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;

const portadaMedium = (alias) => `COALESCE(
  (SELECT pg.url FROM propiedades_galeria pg
   WHERE pg.propiedad_id = ${alias}.id AND pg.es_portada = true AND pg.tamaño = 'medium'
   LIMIT 1),
  (SELECT pg.url FROM propiedades_galeria pg
   WHERE pg.propiedad_id = ${alias}.id AND pg.tamaño = 'medium'
   ORDER BY pg.orden ASC LIMIT 1), NULL)`;

// ── GET /portada (público) ──────────────────────────────────────
// data null = sin selección (el portal usa su fallback).
export const getPortada = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT d.imagen_url, d.updated_at,
              p.id AS propiedad_id, p.titulo, ci.name AS ciudad, p.precio,
              (SELECT t.label_es FROM property_types t WHERE t.id = p.property_type_id) AS tipo
       FROM portada_destacada d
       LEFT JOIN propiedades p ON p.id = d.propiedad_id
       LEFT JOIN cities ci ON ci.id = p.city_id
       WHERE d.id = 1`,
    );
    const fila = rows[0];
    if (!fila || !fila.propiedad_id) {
      return res.status(200).json({ success: true, data: null });
    }
    const imagen =
      fila.imagen_url ||
      (await pool.query(
        `SELECT ${portadaMedium("p")} AS url FROM propiedades p WHERE p.id = $1`,
        [fila.propiedad_id],
      )).rows[0]?.url ||
      null;
    return res.status(200).json({
      success: true,
      data: {
        propiedad_id: fila.propiedad_id,
        imagen,
        etiqueta: `${fila.tipo ?? "Inmueble"} en ${fila.ciudad ?? "Colombia"} - ${formatoCOP(fila.precio ?? 0)}`,
        url: `/inmueble/${fila.propiedad_id}`,
        actualizada_en: fila.updated_at,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

// ── GET /portada/buscar (solo superadmin) ────────────────────────
export const buscarPortada = async (req, res) => {
  try {
    let pagina = Math.max(1, parseInt(req.query.pagina, 10) || 1);
    let limite = Math.min(100, Math.max(1, parseInt(req.query.limite, 10) || 20));
    const offset = (pagina - 1) * limite;
    const q = (req.query.q || "").trim();
    const conds = [];
    const params = [];
    if (q) {
      params.push(`%${q}%`);
      conds.push(`(p.titulo ILIKE $1 OR ci.name ILIKE $1 OR p.barrio_nombre ILIKE $1 OR CAST(p.id AS TEXT) = $${params.length + 1})`);
      params.push(q);
    }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const { rows } = await pool.query(
      `SELECT p.id, p.titulo, ci.name AS ciudad, p.precio, p.estado,
              ${portadaMedium("p")} AS portada
       FROM propiedades p LEFT JOIN cities ci ON ci.id = p.city_id ${where}
       ORDER BY p.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limite, offset],
    );
    const total = await pool.query(
      `SELECT COUNT(*)::int AS total FROM propiedades p LEFT JOIN cities ci ON ci.id = p.city_id ${where}`,
      params,
    );
    return res.status(200).json({
      success: true,
      data: rows,
      pagination: { pagina, limite, total: total.rows[0].total },
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

// ── PUT /portada (solo superadmin) ───────────────────────────────
export const putPortada = async (req, res) => {
  try {
    const { propiedad_id, imagen_url } = req.body;
    if (!Number.isInteger(Number(propiedad_id))) {
      return res.status(400).json({ success: false, error: "propiedad_id es requerido." });
    }
    const { rows: props } = await pool.query(
      "SELECT id FROM propiedades WHERE id = $1",
      [propiedad_id],
    );
    if (!props[0]) {
      return res.status(404).json({ success: false, error: "Anuncio no encontrado." });
    }
    let imagen = imagen_url || null;
    if (imagen) {
      const { rows: fotos } = await pool.query(
        "SELECT 1 FROM propiedades_galeria WHERE propiedad_id = $1 AND url = $2 LIMIT 1",
        [propiedad_id, imagen],
      );
      if (!fotos[0]) {
        return res.status(400).json({ success: false, error: "La imagen no pertenece a la galería del anuncio." });
      }
    }
    const { rows } = await pool.query(
      `INSERT INTO portada_destacada (id, propiedad_id, imagen_url, actualizado_por_id, updated_at)
       VALUES (1, $1, $2, $3, now())
       ON CONFLICT (id) DO UPDATE
       SET propiedad_id = $1, imagen_url = $2, actualizado_por_id = $3, updated_at = now()
       RETURNING *`,
      [propiedad_id, imagen, req.usuario.id],
    );
    return res.status(200).json({ success: true, data: rows[0] });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};
