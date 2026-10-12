// src/controllers/crm.pipeline.controllers.js — etapas y oportunidades
import { pool } from "../db.js";
import { whereEspacioPropio } from "../lib/crmPermisos.js";

const ETAPAS_SEED = [
  { nombre: "Prospecto", color: "#A3A3A3", probabilidad_default: 10, tipo: "abierta" },
  { nombre: "Contactado", color: "#737373", probabilidad_default: 25, tipo: "abierta" },
  { nombre: "Interesado", color: "#525252", probabilidad_default: 40, tipo: "abierta" },
  { nombre: "Visita", color: "#404040", probabilidad_default: 60, tipo: "abierta" },
  { nombre: "Oferta", color: "#262626", probabilidad_default: 75, tipo: "abierta" },
  { nombre: "Negociando", color: "#171717", probabilidad_default: 90, tipo: "abierta" },
  { nombre: "Ganado", color: "#000000", probabilidad_default: 100, tipo: "ganada" },
  { nombre: "Perdido", color: "#D4D4D4", probabilidad_default: 0, tipo: "perdida" },
];

const duenoCols = (crm) =>
  crm.tipo === "personal"
    ? { col: "usuario_id", val: crm.usuarioId }
    : { col: "organizacion_id", val: crm.organizacionId };

function puedeEditarEtapas(crm) {
  return crm.tipo === "personal" || crm.rolEnOrg === "agency_admin";
}

// Crea las 8 etapas si el espacio aún no tiene (primera vez que se usa).
async function asegurarEtapas(crm) {
  const d = duenoCols(crm);
  const { rows } = await pool.query(
    `SELECT id FROM crm_etapas WHERE ${d.col} = $1 LIMIT 1`,
    [d.val],
  );
  if (rows.length > 0) return;
  try {
    const valores = ETAPAS_SEED.map(
      (_, i) => `($1, $${i * 5 + 2}, $${i * 5 + 3}, $${i * 5 + 4}, $${i * 5 + 5}, $${i * 5 + 6})`,
    ).join(", ");
    const params = [d.val];
    ETAPAS_SEED.forEach((e, i) => {
      params.push(e.nombre, i, e.color, e.probabilidad_default, e.tipo);
    });
    await pool.query(
      `INSERT INTO crm_etapas (${d.col}, nombre, orden, color, probabilidad_default, tipo)
       VALUES ${valores}`,
      params,
    );
  } catch (error) {
    // 23505 = otro request sembró a la vez; se sigue con lo existente.
    if (error.code !== "23505") throw error;
  }
}

async function listarEtapas(crm) {
  await asegurarEtapas(crm);
  const d = duenoCols(crm);
  const { rows } = await pool.query(
    `SELECT * FROM crm_etapas WHERE ${d.col} = $1 ORDER BY orden ASC`,
    [d.val],
  );
  return rows;
}

// ── GET /crm/etapas ─────────────────────────────────────────────
export const getEtapas = async (req, res) => {
  try {
    return res.status(200).json({ success: true, data: await listarEtapas(req.crm) });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

// ── POST /crm/etapas (admin o personal) ─────────────────────────
export const crearEtapa = async (req, res) => {
  try {
    const crm = req.crm;
    if (!puedeEditarEtapas(crm)) {
      return res.status(403).json({ success: false, error: "Solo un administrador puede editar etapas." });
    }
    const { nombre, color, probabilidad_default, tipo } = req.body;
    if (typeof nombre !== "string" || !nombre.trim()) {
      return res.status(400).json({ success: false, error: "nombre es requerido." });
    }
    if (tipo !== undefined && !["abierta", "ganada", "perdida"].includes(tipo)) {
      return res.status(400).json({ success: false, error: "tipo inválido." });
    }
    const d = duenoCols(crm);
    await asegurarEtapas(crm);
    const { rows: max } = await pool.query(
      `SELECT COALESCE(MAX(orden), -1)::int AS m FROM crm_etapas WHERE ${d.col} = $1`,
      [d.val],
    );
    const { rows } = await pool.query(
      `INSERT INTO crm_etapas (${d.col}, nombre, orden, color, probabilidad_default, tipo)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [d.val, nombre.trim(), max[0].m + 1, color ?? null, probabilidad_default ?? 50, tipo ?? "abierta"],
    );
    return res.status(201).json({ success: true, data: rows[0] });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

// ── PATCH /crm/etapas/:id ───────────────────────────────────────
export const actualizarEtapa = async (req, res) => {
  try {
    const crm = req.crm;
    if (!puedeEditarEtapas(crm)) {
      return res.status(403).json({ success: false, error: "Solo un administrador puede editar etapas." });
    }
    const d = duenoCols(crm);
    const sets = ["nombre = COALESCE($1, nombre)"];
    const params = [req.body.nombre ?? null];
    const put = (col, val) => {
      params.push(val);
      sets.push(`${col} = $${params.length}`);
    };
    if (req.body.color !== undefined) put("color", req.body.color);
    if (req.body.probabilidad_default !== undefined) put("probabilidad_default", req.body.probabilidad_default);
    if (req.body.tipo !== undefined) {
      if (!["abierta", "ganada", "perdida"].includes(req.body.tipo)) {
        return res.status(400).json({ success: false, error: "tipo inválido." });
      }
      put("tipo", req.body.tipo);
    }
    params.push(req.params.id, d.val);
    const { rows } = await pool.query(
      `UPDATE crm_etapas SET ${sets.join(", ")} WHERE id = $${params.length - 1} AND ${d.col} = $${params.length} RETURNING *`,
      params,
    );
    if (!rows[0]) return res.status(404).json({ success: false, error: "Etapa no encontrada." });
    return res.status(200).json({ success: true, data: rows[0] });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

// ── DELETE /crm/etapas/:id ──────────────────────────────────────
export const eliminarEtapa = async (req, res) => {
  try {
    const crm = req.crm;
    if (!puedeEditarEtapas(crm)) {
      return res.status(403).json({ success: false, error: "Solo un administrador puede editar etapas." });
    }
    const d = duenoCols(crm);
    const enUso = await pool.query(
      `SELECT 1 FROM crm_oportunidades o JOIN crm_etapas e ON e.id = o.etapa_id
       WHERE o.etapa_id = $1 AND e.${d.col} = $2 LIMIT 1`,
      [req.params.id, d.val],
    );
    if (enUso.rows.length > 0) {
      return res.status(409).json({ success: false, error: "La etapa tiene oportunidades y no se puede borrar." });
    }
    const { rowCount } = await pool.query(
      `DELETE FROM crm_etapas WHERE id = $1 AND ${d.col} = $2`,
      [req.params.id, d.val],
    );
    if (!rowCount) return res.status(404).json({ success: false, error: "Etapa no encontrada." });
    return res.status(200).json({ success: true, data: { id: Number(req.params.id) } });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

// ── GET /crm/oportunidades ──────────────────────────────────────
export const listarOportunidades = async (req, res) => {
  try {
    const crm = req.crm;
    await asegurarEtapas(crm);
    let base = whereEspacioPropio(crm, "o");
    if (crm.tipo === "org" && crm.rolEnOrg === "agent") {
      base = {
        where: "o.organizacion_id = $1 AND o.asignado_a_id = $2",
        params: [crm.organizacionId, crm.usuarioId],
        nextIndex: 3,
      };
    }
    const conds = [base.where, "o.estado = 'abierta'"];
    const params = [...base.params];
    const { asignado, propiedad, valorMin, valorMax } = req.query;
    if (asignado) {
      params.push(asignado);
      conds.push(`o.asignado_a_id = $${params.length}`);
    }
    if (propiedad) {
      params.push(propiedad);
      conds.push(`o.propiedad_id = $${params.length}`);
    }
    if (valorMin) {
      params.push(valorMin);
      conds.push(`o.valor >= $${params.length}`);
    }
    if (valorMax) {
      params.push(valorMax);
      conds.push(`o.valor <= $${params.length}`);
    }
    const where = conds.join(" AND ");
    const { rows } = await pool.query(
      `SELECT o.*, c.nombre AS contacto_nombre, c.email AS contacto_email, c.telefono AS contacto_telefono,
              p.titulo AS propiedad_titulo, e.nombre AS etapa_nombre, e.color AS etapa_color
       FROM crm_oportunidades o
       JOIN crm_contactos c ON c.id = o.contacto_id
       LEFT JOIN propiedades p ON p.id = o.propiedad_id
       JOIN crm_etapas e ON e.id = o.etapa_id
       WHERE ${where}
       ORDER BY o.etapa_id, o.posicion ASC`,
      params,
    );
    return res.status(200).json({ success: true, data: rows });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

async function oportunidadEnEspacio(crm, id) {
  let base = whereEspacioPropio(crm, "o");
  if (crm.tipo === "org" && crm.rolEnOrg === "agent") {
    base = {
      where: "o.organizacion_id = $1 AND o.asignado_a_id = $2",
      params: [crm.organizacionId, crm.usuarioId],
      nextIndex: 3,
    };
  }
  const { rows } = await pool.query(
    `SELECT o.* FROM crm_oportunidades o WHERE o.id = $${base.nextIndex} AND ${base.where}`,
    [...base.params, id],
  );
  return rows[0] || null;
}

// ── POST /crm/oportunidades ─────────────────────────────────────
export const crearOportunidad = async (req, res) => {
  try {
    const crm = req.crm;
    const etapas = await listarEtapas(crm);
    const { contacto_id, propiedad_id, etapa_id, titulo, valor, probabilidad, cierre_estimado } = req.body;
    if (!Number.isInteger(Number(contacto_id))) {
      return res.status(400).json({ success: false, error: "contacto_id es requerido." });
    }
    if (typeof titulo !== "string" || !titulo.trim()) {
      return res.status(400).json({ success: false, error: "titulo es requerido." });
    }
    // Contacto dentro del espacio
    const cBase = whereEspacioPropio(crm, "c");
    const { rows: cs } = await pool.query(
      `SELECT c.id FROM crm_contactos c WHERE c.id = $${cBase.nextIndex} AND ${cBase.where} AND c.archivado_at IS NULL`,
      [...cBase.params, contacto_id],
    );
    if (!cs[0]) return res.status(404).json({ success: false, error: "Contacto no encontrado." });

    const etapa = etapas.find((e) => Number(e.id) === Number(etapa_id)) ?? etapas.find((e) => e.tipo === "abierta");
    if (!etapa) return res.status(400).json({ success: false, error: "No hay etapas abiertas." });

    const { rows: max } = await pool.query(
      "SELECT COALESCE(MAX(posicion), -1)::int AS m FROM crm_oportunidades WHERE etapa_id = $1 AND estado = 'abierta'",
      [etapa.id],
    );
    const asignado = crm.tipo === "org" && crm.rolEnOrg === "agent" ? crm.usuarioId : (req.body.asignado_a_id ?? crm.usuarioId);
    const d = duenoCols(crm);
    const { rows } = await pool.query(
      `INSERT INTO crm_oportunidades
        (${d.col}, contacto_id, propiedad_id, etapa_id, titulo, valor, probabilidad, cierre_estimado, posicion, asignado_a_id, creado_por_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
      [
        d.val,
        contacto_id,
        propiedad_id ?? null,
        etapa.id,
        titulo.trim(),
        valor ?? null,
        probabilidad ?? etapa.probabilidad_default,
        cierre_estimado ?? null,
        max[0].m + 1,
        asignado,
        crm.usuarioId,
      ],
    );
    return res.status(201).json({ success: true, data: rows[0] });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

// ── GET /crm/oportunidades/:id ──────────────────────────────────
export const obtenerOportunidad = async (req, res) => {
  try {
    const o = await oportunidadEnEspacio(req.crm, req.params.id);
    if (!o) return res.status(404).json({ success: false, error: "Oportunidad no encontrada." });
    return res.status(200).json({ success: true, data: o });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

// ── PATCH /crm/oportunidades/:id ────────────────────────────────
export const actualizarOportunidad = async (req, res) => {
  try {
    const actual = await oportunidadEnEspacio(req.crm, req.params.id);
    if (!actual) return res.status(404).json({ success: false, error: "Oportunidad no encontrada." });
    const sets = ["updated_at = now()"];
    const params = [];
    const put = (col, val) => {
      params.push(val);
      sets.push(`${col} = $${params.length}`);
    };
    for (const campo of ["titulo", "valor", "probabilidad", "cierre_estimado", "motivo_perdida", "propiedad_id"]) {
      if (req.body[campo] !== undefined) put(campo, req.body[campo]);
    }
    params.push(actual.id);
    const { rows } = await pool.query(
      `UPDATE crm_oportunidades SET ${sets.join(", ")} WHERE id = $${params.length} RETURNING *`,
      params,
    );
    return res.status(200).json({ success: true, data: rows[0] });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

// ── PATCH /crm/oportunidades/:id/mover ──────────────────────────
export const moverOportunidad = async (req, res) => {
  const client = await pool.connect();
  try {
    const crm = req.crm;
    const { etapaId, indice } = req.body;
    if (!Number.isInteger(Number(etapaId)) || !Number.isInteger(Number(indice)) || indice < 0) {
      return res.status(400).json({ success: false, error: "etapaId e indice (entero >= 0) son requeridos." });
    }
    const actual = await oportunidadEnEspacio(crm, req.params.id);
    if (!actual) return res.status(404).json({ success: false, error: "Oportunidad no encontrada." });
    const etapas = await listarEtapas(crm);
    const destino = etapas.find((e) => Number(e.id) === Number(etapaId));
    if (!destino) return res.status(404).json({ success: false, error: "Etapa no encontrada." });

    await client.query("BEGIN");
    // Cierra el hueco en la etapa origen
    await client.query(
      "UPDATE crm_oportunidades SET posicion = posicion - 1 WHERE etapa_id = $1 AND estado = 'abierta' AND posicion > $2",
      [actual.etapa_id, actual.posicion],
    );
    // Abre hueco en destino (si es la misma etapa, el índice ya contempla el hueco)
    const idx = Number(actual.etapa_id) === Number(destino.id) && Number(indice) > actual.posicion
      ? Number(indice) - 1
      : Number(indice);
    await client.query(
      "UPDATE crm_oportunidades SET posicion = posicion + 1 WHERE etapa_id = $1 AND estado = 'abierta' AND posicion >= $2",
      [destino.id, idx],
    );
    const { rows } = await client.query(
      "UPDATE crm_oportunidades SET etapa_id = $1, posicion = $2, probabilidad = $3, updated_at = now() WHERE id = $4 RETURNING *",
      [destino.id, idx, actual.probabilidad, actual.id],
    );
    const d = duenoCols(crm);
    await client.query(
      `INSERT INTO crm_actividades (${d.col}, contacto_id, oportunidad_id, tipo, contenido, autor_id)
       VALUES ($1, $2, $3, 'cambio_etapa', $4, $5)`,
      [d.val, actual.contacto_id, actual.id, `Etapa: ${destino.nombre}.`, crm.usuarioId],
    );
    await client.query("COMMIT");
    return res.status(200).json({ success: true, data: rows[0] });
  } catch (error) {
    await client.query("ROLLBACK");
    return res.status(500).json({ success: false, error: error.message });
  } finally {
    client.release();
  }
};

// ── PATCH /crm/oportunidades/:id/cerrar ─────────────────────────
export const cerrarOportunidad = async (req, res) => {
  try {
    const crm = req.crm;
    const { estado, motivo_perdida } = req.body;
    if (!["ganada", "perdida"].includes(estado)) {
      return res.status(400).json({ success: false, error: "estado debe ser ganada o perdida." });
    }
    const actual = await oportunidadEnEspacio(crm, req.params.id);
    if (!actual) return res.status(404).json({ success: false, error: "Oportunidad no encontrada." });
    const etapas = await listarEtapas(crm);
    const etapaCierre = etapas.find((e) => e.tipo === estado);
    const { rows } = await pool.query(
      `UPDATE crm_oportunidades
       SET estado = $1, motivo_perdida = $2, cerrada_at = now(),
           etapa_id = COALESCE($3, etapa_id), updated_at = now()
       WHERE id = $4 RETURNING *`,
      [estado, motivo_perdida ?? null, etapaCierre ? etapaCierre.id : null, actual.id],
    );
    const d = duenoCols(crm);
    await pool.query(
      `INSERT INTO crm_actividades (${d.col}, contacto_id, oportunidad_id, tipo, contenido, autor_id)
       VALUES ($1, $2, $3, 'sistema', $4, $5)`,
      [d.val, actual.contacto_id, actual.id, `Oportunidad ${estado}.`, crm.usuarioId],
    );
    return res.status(200).json({ success: true, data: rows[0] });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};
