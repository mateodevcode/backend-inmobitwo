// controllers/vistas.agregados.controllers.js
// GET /tracking/vistas/agregados?fecha=YYYY-MM-DD — solo superadmin.
// Lee los contadores vistas:agregado:{motivo}:{fecha} con SCAN (nunca KEYS),
// los motivos con filas en vistas_log de ese día y la proporción
// visible_incoherente / counted.
import { pool } from "../db.js";
import { redis } from "../lib/redis.js";

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

async function scanAgregados(fecha) {
  const patron = `vistas:agregado:*:${fecha}`;
  const contadores = {};
  let cursor = "0";
  do {
    const [siguiente, claves] = await redis.scan(cursor, "MATCH", patron, "COUNT", 200);
    cursor = siguiente;
    if (claves.length > 0) {
      const valores = await redis.mget(...claves);
      claves.forEach((clave, i) => {
        const motivo = clave.split(":")[2] ?? clave;
        contadores[motivo] = Number(valores[i]) || 0;
      });
    }
  } while (cursor !== "0");
  return contadores;
}

export const getVistasAgregados = async (req, res) => {
  try {
    const { fecha } = req.query || {};
    if (!fecha || !FECHA_RE.test(fecha)) {
      return res.status(400).json({
        success: false,
        error: "fecha es requerida con formato YYYY-MM-DD.",
      });
    }

    const [agregados, { rows }] = await Promise.all([
      scanAgregados(fecha),
      pool.query(
        `SELECT reason AS motivo, COUNT(*)::int AS filas
         FROM vistas_log WHERE fecha_local = $1::date GROUP BY reason`,
        [fecha],
      ),
    ]);
    const porMotivo = {};
    for (const r of rows) porMotivo[r.motivo] = r.filas;

    const counted = porMotivo.counted ?? 0;
    const incoherentes = agregados.visible_incoherente ?? 0;
    const proporcion_visible_incoherente = counted > 0 ? incoherentes / counted : null;

    return res.json({
      success: true,
      message: null,
      data: { fecha, agregados, por_motivo: porMotivo, proporcion_visible_incoherente },
      error: null,
    });
  } catch (error) {
    console.error("Error en GET /tracking/vistas/agregados:", error.message);
    res.status(500).json({ success: false, error: "Error interno del servidor." });
  }
};
