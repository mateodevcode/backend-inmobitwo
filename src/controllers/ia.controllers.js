// controllers/ia.controllers.js - MEJORADO
// Generador de descripciones con IA (DeepSeek)

import OpenAI from "openai";
import { pool } from "../db.js";
import { DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL } from "../config.js";
import { construirPrompt } from "../lib/promptBuilder.js";

const deepseek = new OpenAI({
  apiKey: DEEPSEEK_API_KEY,
  baseURL: DEEPSEEK_BASE_URL,
});

// ─────────────────────────────────────────────
// POST /ia/generar-descripcion
// Genera 3 formatos de descripción
// ─────────────────────────────────────────────

export const generarDescripcion = async (req, res) => {
  try {
    const raw = req.body;

    if (!raw.property_type_id || !raw.city_id || !raw.precio) {
      return res
        .status(400)
        .json({ success: false, error: "Faltan datos mínimos del inmueble." });
    }

    // ── Resolver ids → labels ──
    const [tipo, cond, ciudad] = await Promise.all([
      pool.query("SELECT label_es FROM property_types WHERE id = $1", [
        raw.property_type_id,
      ]),
      raw.condition_type_id
        ? pool.query("SELECT label_es FROM condition_types WHERE id = $1", [
            raw.condition_type_id,
          ])
        : Promise.resolve({ rows: [] }),
      pool.query("SELECT name FROM cities WHERE id = $1", [raw.city_id]),
    ]);

    let featuresLabels = [];
    if (raw.features?.length) {
      const { rows } = await pool.query(
        "SELECT label_es FROM feature_catalog WHERE id = ANY($1::int[])",
        [raw.features],
      );
      featuresLabels = rows.map((r) => r.label_es);
    }

    const parqueadero =
      raw.parqueadero_tipo && raw.parqueadero_modo
        ? `${raw.parqueadero_modo} ${raw.parqueadero_tipo}`
        : "No tiene";

    const datos = {
      tipo_inmueble: tipo.rows[0]?.label_es || "Inmueble",
      operacion: raw.operacion || "Venta",
      ciudad: ciudad.rows[0]?.name || raw.ciudad || "",
      barrio: raw.barrio || "",
      estrato: raw.estrato || "",
      private_area: raw.private_area || 0,
      constructed_area: raw.constructed_area || 0,
      bedroom_count: raw.bedroom_count || 0,
      bathroom_count: raw.bathroom_count || 0,
      social_bathroom_count: raw.social_bathroom_count || 0,
      condition: cond.rows[0]?.label_es || "Usado",
      floor: raw.floor || "",
      interior: raw.interior || "",
      parqueadero,
      administracion: raw.administracion || 0,
      features: featuresLabels,
      servicios: raw.servicios || {},
      precio: raw.precio || 0,
      price_per_sqm: raw.price_per_sqm || 0,
      zona: raw.zona || "Residencial",
    };

    if (!DEEPSEEK_API_KEY) {
      return res.status(500).json({
        success: false,
        error: "DEEPSEEK_API_KEY no configurada en el servidor.",
      });
    }

    const prompt = construirPrompt(datos);

    const response = await deepseek.chat.completions.create({
      model: "deepseek-chat",
      messages: [
        {
          role: "system",
          content:
            "Eres un redactor inmobiliario experto en Colombia. Español colombiano, tono profesional y ejecutivo. Nunca uses emojis.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.5,
      max_tokens: 2000,
      response_format: { type: "json_object" },
    });

    const contenido = response.choices[0].message.content;
    const jsonLimpio = contenido.replace(/```json\n?|```\n?/g, "").trim();
    const generado = JSON.parse(jsonLimpio);

    res.json({
      success: true,
      data: {
        formatos: [
          {
            id: "moderno",
            nombre: "Moderno y Directo",
            descripcion: generado.formato_moderno,
            caracteristicas:
              "Corto, escaneable, bullets limpios, ideal para profesionales y búsquedas rápidas",
          },
          {
            id: "narrativo",
            nombre: "Narrativo y Emocional",
            descripcion: generado.formato_narrativo,
            caracteristicas:
              "Historia, sensaciones, emocional, ideal para familias o primer comprador",
          },
          {
            id: "tecnico",
            nombre: "Técnico y Detallado",
            descripcion: generado.formato_tecnico,
            caracteristicas:
              "Especificaciones, medidas, financiero, ideal para inversionistas o compradores técnicos",
          },
        ],
      },
    });
  } catch (error) {
    console.error("Error generando descripción:", error);
    res.status(500).json({
      success: false,
      error: "Error generando descripción con IA",
    });
  }
};

// ─────────────────────────────────────────────
// POST /ia/refinar-descripcion
// Refina una descripción existente con opciones
// ─────────────────────────────────────────────

export const refinarDescripcion = async (req, res) => {
  try {
    const { descripcion, tone, formato } = req.body;

    if (!descripcion || !tone) {
      return res.status(400).json({
        success: false,
        error: "Descripción y tono son requeridos.",
      });
    }

    if (!DEEPSEEK_API_KEY) {
      return res.status(500).json({
        success: false,
        error: "DEEPSEEK_API_KEY no configurada en el servidor.",
      });
    }

    // Mapear tonos a instrucciones
    const toneInstructions = {
      "más corto":
        "Acorta esta descripción a la mitad, mantén lo más importante",
      "más formal": "Aumenta el nivel formal y profesional de esta descripción",
      "más casual": "Hazla más casual y cercana, pero profesional",
      "más técnico": "Agrega más detalles técnicos y especificaciones",
    };

    const instruction = toneInstructions[tone] || tone;

    const prompt = `
Tienes esta descripción de una propiedad:

${descripcion}

Por favor: ${instruction}

Responde SOLO con la descripción refinada, sin explicaciones adicionales.
Usa el mismo formato HTML que la original.
Nunca uses emojis.
    `;

    const response = await deepseek.chat.completions.create({
      model: "deepseek-chat",
      messages: [
        {
          role: "system",
          content:
            "Eres un redactor inmobiliario experto. Edita descripciones de propiedades manteniendo calidad y profesionalismo. Nunca uses emojis.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.6,
      max_tokens: 1500,
    });

    const descripcionRefinada = response.choices[0].message.content.trim();

    res.json({
      success: true,
      data: {
        descripcionRefinada,
        tone,
        formato,
      },
    });
  } catch (error) {
    console.error("Error refinando descripción:", error);
    res.status(500).json({
      success: false,
      error: "Error refinando descripción con IA",
    });
  }
};

// ─────────────────────────────────────────────
// POST /ia/mejorar-descripcion
// Mejora general de descripción (sin parámetro tone específico)
// ─────────────────────────────────────────────

export const mejorarDescripcion = async (req, res) => {
  try {
    const { descripcion, aspectos } = req.body;

    if (!descripcion) {
      return res.status(400).json({
        success: false,
        error: "Descripción es requerida.",
      });
    }

    if (!DEEPSEEK_API_KEY) {
      return res.status(500).json({
        success: false,
        error: "DEEPSEEK_API_KEY no configurada en el servidor.",
      });
    }

    // aspectos puede ser: ["gramática", "claridad", "atractivo"]
    const aspectosTexto = aspectos?.length
      ? `Mejora especialmente en: ${aspectos.join(", ")}`
      : "";

    const prompt = `
Mejora esta descripción de propiedad inmobiliaria:

${descripcion}

${aspectosTexto}

Mantén la estructura HTML si existe.
Hazla más atractiva, clara y profesional.
Nunca uses emojis.
Responde SOLO con la descripción mejorada.
    `;

    const response = await deepseek.chat.completions.create({
      model: "deepseek-chat",
      messages: [
        {
          role: "system",
          content:
            "Eres un redactor inmobiliario experto que mejora descripciones. Mantén el tono profesional. Nunca uses emojis.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.6,
      max_tokens: 1500,
    });

    const descripcionMejorada = response.choices[0].message.content.trim();

    res.json({
      success: true,
      data: {
        descripcionMejorada,
        aspectos,
      },
    });
  } catch (error) {
    console.error("Error mejorando descripción:", error);
    res.status(500).json({
      success: false,
      error: "Error mejorando descripción con IA",
    });
  }
};
