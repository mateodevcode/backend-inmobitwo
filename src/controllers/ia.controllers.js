// controllers/ia.controllers.js
// Generador de descripciones con IA (DeepSeek). La API key nunca sale del servidor.

import OpenAI from "openai";
import { pool } from "../db.js";
import { DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL } from "../config.js";
import { construirPrompt } from "../lib/promptBuilder.js";

const deepseek = new OpenAI({
  apiKey: DEEPSEEK_API_KEY,
  baseURL: DEEPSEEK_BASE_URL,
});

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
