// src/controllers/busquedas.guardadas.controller.js
import { pool } from "../db.js";
import { normalizarFiltros, validarFiltros, hashFiltros } from "../lib/busquedasGuardadas/filtros.js";

const MAX = Number(process.env.ALERTAS_MAX_BUSQUEDAS_USUARIO || 10);
const FRECUENCIAS = ["inmediata", "diaria", "semanal"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLS = `id, nombre, filtros, url_original, frecuencia, canal_email, canal_push,
              estado, last_sent_at, created_at, unsubscribe_token`;

const err = (res, status, message) => res.status(status).json({ success: false, error: message });

export async function crearBusqueda(req, res) {
  try {
    const { nombre, filtros, urlOriginal, frecuencia = "diaria",
            canalEmail = true, canalPush = false, aceptaTerminos } = req.body || {};

    if (aceptaTerminos !== true) return err(res, 400, "Debes aceptar el tratamiento de datos para recibir alertas.");
    if (!FRECUENCIAS.includes(frecuencia)) return err(res, 400, "Frecuencia inválida.");

    const f = normalizarFiltros(filtros);
    const errores = validarFiltros(f);
    if (errores.length) return res.status(400).json({ success: false, error: "Filtros inválidos", details: errores });

    const pushActivo = canalPush && process.env.PUSH_ENABLED === "true";
    if (!canalEmail && !pushActivo) return err(res, 400, "Selecciona al menos un canal de aviso.");

    const { rows: [{ total }] } = await pool.query(
      "SELECT COUNT(*)::int AS total FROM saved_searches WHERE usuario_id = $1", [req.usuario.id]);
    if (total >= MAX) return err(res, 409, `Máximo ${MAX} búsquedas guardadas. Elimina alguna para crear otra.`);

    const hash = hashFiltros(f);
    const url = String(urlOriginal || "").slice(0, 1000);
    if (!url.startsWith("/")) return err(res, 400, "URL inválida.");

    const { rows } = await pool.query(
      `INSERT INTO saved_searches
         (usuario_id, nombre, filtros, filtros_hash, url_original, frecuencia,
          canal_email, canal_push, consentimiento_at, last_checked_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW())
       RETURNING ${COLS}`,
      [req.usuario.id, String(nombre || "Mi búsqueda").slice(0, 160), JSON.stringify(f),
       hash, url, frecuencia, !!canalEmail, !!pushActivo]);

    return res.status(201).json({ success: true, message: "Búsqueda guardada", data: rows[0] });
  } catch (e) {
    if (e.code === "23505") return err(res, 409, "Ya tienes guardada esta búsqueda.");
    console.error("crearBusqueda:", e);
    return err(res, 500, "No se pudo guardar la búsqueda.");
  }
}

export async function listarBusquedas(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT ${COLS} FROM saved_searches WHERE usuario_id = $1 ORDER BY created_at DESC`,
      [req.usuario.id]);
    return res.json({ success: true, data: rows });
  } catch (e) {
    console.error("listarBusquedas:", e);
    return err(res, 500, "No se pudieron cargar tus búsquedas.");
  }
}

// ¿El usuario ya guardó estos filtros? (para el estado del botón)
export async function verificarBusqueda(req, res) {
  try {
    const hash = hashFiltros(normalizarFiltros(req.body?.filtros));
    const { rows } = await pool.query(
      "SELECT id FROM saved_searches WHERE usuario_id = $1 AND filtros_hash = $2",
      [req.usuario.id, hash]);
    return res.json({ success: true, data: { guardada: rows.length > 0, id: rows[0]?.id ?? null } });
  } catch (e) {
    console.error("verificarBusqueda:", e);
    return err(res, 500, "No se pudo verificar.");
  }
}

export async function actualizarBusqueda(req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return err(res, 400, "ID inválido.");
    const { nombre, frecuencia, canalEmail, canalPush, estado } = req.body || {};

    const sets = []; const vals = [];
    const add = (col, v) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };

    if (nombre !== undefined) add("nombre", String(nombre).slice(0, 160));
    if (frecuencia !== undefined) {
      if (!FRECUENCIAS.includes(frecuencia)) return err(res, 400, "Frecuencia inválida.");
      add("frecuencia", frecuencia);
    }
    if (canalEmail !== undefined) add("canal_email", !!canalEmail);
    if (canalPush !== undefined) add("canal_push", !!canalPush && process.env.PUSH_ENABLED === "true");
    if (estado !== undefined) {
      if (!["activa", "pausada"].includes(estado)) return err(res, 400, "Estado inválido.");
      add("estado", estado);
      if (estado === "activa") { add("last_checked_at", new Date()); add("fallos_envio", 0); } // no avisar lo ocurrido en pausa
    }
    if (!sets.length) return err(res, 400, "Nada que actualizar.");

    vals.push(id, req.usuario.id);
    const { rows } = await pool.query(
      `UPDATE saved_searches SET ${sets.join(", ")}
       WHERE id = $${vals.length - 1} AND usuario_id = $${vals.length}
       RETURNING ${COLS}`, vals);
    if (!rows.length) return err(res, 404, "Búsqueda no encontrada.");
    return res.json({ success: true, data: rows[0] });
  } catch (e) {
    console.error("actualizarBusqueda:", e);
    return err(res, 500, "No se pudo actualizar.");
  }
}

export async function eliminarBusqueda(req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return err(res, 400, "ID inválido.");
    const { rowCount } = await pool.query(
      "DELETE FROM saved_searches WHERE id = $1 AND usuario_id = $2", [id, req.usuario.id]);
    if (!rowCount) return err(res, 404, "Búsqueda no encontrada.");
    return res.json({ success: true, message: "Búsqueda eliminada" });
  } catch (e) {
    console.error("eliminarBusqueda:", e);
    return err(res, 500, "No se pudo eliminar.");
  }
}

// ===== Baja desde el email (público, sin login, por token) =====
export async function bajaPorToken(req, res) {
  try {
    const { token } = req.params;
    if (!UUID_RE.test(token)) return err(res, 400, "Enlace inválido.");
    const { rows } = await pool.query(
      "UPDATE saved_searches SET estado = 'pausada' WHERE unsubscribe_token = $1 RETURNING nombre", [token]);
    if (!rows.length) return err(res, 404, "Enlace inválido o búsqueda eliminada.");
    return res.json({ success: true, data: { nombre: rows[0].nombre } });
  } catch (e) {
    console.error("bajaPorToken:", e);
    return err(res, 500, "No se pudo procesar la baja.");
  }
}

export async function reactivarPorToken(req, res) {
  try {
    const { token } = req.params;
    if (!UUID_RE.test(token)) return err(res, 400, "Enlace inválido.");
    const { rows } = await pool.query(
      `UPDATE saved_searches SET estado = 'activa', last_checked_at = NOW(), fallos_envio = 0
       WHERE unsubscribe_token = $1 RETURNING nombre`, [token]);
    if (!rows.length) return err(res, 404, "Enlace inválido.");
    return res.json({ success: true, data: { nombre: rows[0].nombre } });
  } catch (e) {
    console.error("reactivarPorToken:", e);
    return err(res, 500, "No se pudo reactivar.");
  }
}
