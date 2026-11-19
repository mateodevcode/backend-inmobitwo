// src/controllers/propiedades/precios.controllers.js — precio sugerido y validación de precio.
import { pool } from "../../db.js";
import { calcularPrecioSugerido, validarPrecioUsuario } from "../../lib/precios_referencia_colombia.js";

// ============================================================================
// ALGORITMO DE PRECIO SUGERIDO (Fase 1)
// ============================================================================

// Deriva la categoría de piso (floor_type) a partir del texto libre de `floor`.
// "PH"/"Penthouse" → ph | "Sótano" → sotano | "Bajo"/"Entreplanta" → bajo_sin_asc
// 7+ → alto_vista | 5-6 → alto | 2-4 → medio | 1 → bajo
function derivarFloorType(floor) {
  if (!floor) return "medio";
  const f = String(floor).toLowerCase().trim();
  if (f.includes("ph") || f.includes("penthouse") || f.includes("ultima") || f.includes("final")) return "ph";
  if (f.includes("sotan") || f.includes("semisotan")) return "sotano";
  if (f.includes("bajo") || f.includes("entresuelo") || f.includes("entreplanta") || f === "1" || f === "0" || f === "-1") return "bajo_sin_asc";
  const num = parseInt(f, 10);
  if (!isNaN(num) && num >= 7) return "alto_vista";
  if (!isNaN(num) && num >= 5) return "alto";
  if (!isNaN(num) && num >= 2) return "medio";
  return "bajo";
}

// POST /propiedades/calcular-precio-sugerido
// Resuelve city_id → slug y condition_type_id → code, y deriva floor_type.
export const calcularPrecioSugeridoPropiedad = async (req, res) => {
  try {
    const raw = req.body;

    let ciudad = raw.ciudad || "nacional";
    if (raw.city_id) {
      const { rows } = await pool.query("SELECT slug FROM cities WHERE id = $1", [
        raw.city_id,
      ]);
      if (rows[0]?.slug) ciudad = rows[0].slug;
    }

    let conditionTypeCode = raw.condition_type_code || "usado";
    if (raw.condition_type_id && !raw.condition_type_code) {
      const { rows } = await pool.query(
        "SELECT code FROM condition_types WHERE id = $1",
        [raw.condition_type_id],
      );
      if (rows[0]?.code) conditionTypeCode = rows[0].code;
    }

    const resultado = calcularPrecioSugerido({
      ciudad,
      estrato: raw.estrato,
      private_area: raw.private_area,
      constructed_area: raw.constructed_area,
      condition_type_code: conditionTypeCode,
      construction_year: raw.construction_year,
      floor_type: derivarFloorType(raw.floor),
      features: raw.features || [],
      parqueadero_tipo: raw.parqueadero_tipo,
      parqueadero_modo: raw.parqueadero_modo,
      zona: raw.zona,
    });

    if (resultado.error) {
      return res.status(400).json({ success: false, error: resultado.error, data: null });
    }

    res.json({
      success: true,
      message: "Precio calculado correctamente",
      data: resultado,
      error: null,
    });
  } catch (error) {
    console.error("Error en calcular-precio-sugerido:", error);
    res.status(500).json({ success: false, error: error.message, data: null });
  }
};

// POST /propiedades/validar-precio
// Body: { precio_usuario, datos_propiedad }
export const validarPrecioPropiedad = async (req, res) => {
  try {
    const { precio_usuario, datos_propiedad = {} } = req.body;

    if (precio_usuario === undefined || precio_usuario === null || precio_usuario === "") {
      return res.status(400).json({
        success: false,
        error: "precio_usuario es requerido.",
        data: null,
      });
    }

    let ciudad = datos_propiedad.ciudad || "nacional";
    if (datos_propiedad.city_id) {
      const { rows } = await pool.query(
        "SELECT slug FROM cities WHERE id = $1",
        [datos_propiedad.city_id],
      );
      if (rows[0]?.slug) ciudad = rows[0].slug;
    }

    const sugerido = calcularPrecioSugerido({
      ciudad,
      estrato: datos_propiedad.estrato,
      private_area: datos_propiedad.private_area,
      constructed_area: datos_propiedad.constructed_area,
      condition_type_code: datos_propiedad.condition_type_code || "usado",
      construction_year: datos_propiedad.construction_year,
      floor_type: derivarFloorType(datos_propiedad.floor),
      features: datos_propiedad.features || [],
      parqueadero_tipo: datos_propiedad.parqueadero_tipo,
      parqueadero_modo: datos_propiedad.parqueadero_modo,
      zona: datos_propiedad.zona,
    });

    const validacion = validarPrecioUsuario(Number(precio_usuario), sugerido);

    res.json({
      success: true,
      message: "Precio validado correctamente",
      data: {
        ...validacion,
        precio_sugerido_promedio: sugerido.precio_sugerido_promedio,
      },
      error: null,
    });
  } catch (error) {
    console.error("Error en validar-precio:", error);
    res.status(500).json({ success: false, error: error.message, data: null });
  }
};
