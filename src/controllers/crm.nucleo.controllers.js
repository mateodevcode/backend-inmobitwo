// src/controllers/crm.nucleo.controllers.js — contactos, actividades, tareas
import { pool } from "../db.js";
import { normalizarTelefonoCO, whereEspacioPropio } from "../lib/crmPermisos.js";
import {
  validarActividad,
  validarContacto,
  validarPaginacion,
  validarTarea,
} from "../validations/crm.js";

const duenoCols = (crm) =>
  crm.tipo === "personal"
    ? { cols: "usuario_id", vals: [crm.usuarioId] }
    : { cols: "organizacion_id", vals: [crm.organizacionId] };

// Resuelve un contacto dentro del espacio (404 si no).
async function contactoEnEspacio(crm, id) {
  const base = whereEspacioPropio(crm, "c");
  const { rows } = await pool.query(
    `SELECT c.* FROM crm_contactos c
     WHERE c.id = $${base.nextIndex} AND ${base.where} AND c.archivado_at IS NULL`,
    [...base.params, id],
  );
  return rows[0] || null;
}

async function buscarDuplicado(crm, email, telefono, excluirId = null) {
  const dueno = duenoCols(crm);
  const col = crm.tipo === "personal" ? "usuario_id" : "organizacion_id";
  const conds = [];
  const params = [...dueno.vals];
  if (email) {
    params.push(email.toLowerCase());
    conds.push(`lower(c.email) = $${params.length}`);
  }
  if (telefono) {
    params.push(telefono);
    conds.push(`c.telefono = $${params.length}`);
  }
  if (!conds.length) return null;
  const { rows } = await pool.query(
    `SELECT c.* FROM crm_contactos c WHERE c.${col} = $1 AND c.archivado_at IS NULL AND (${conds.join(" OR ")}) LIMIT 1`,
    params,
  );
  const dup = rows[0] || null;
  if (dup && excluirId && Number(dup.id) === Number(excluirId)) return null;
  return dup;
}

// ── GET /crm/contactos ──────────────────────────────────────────
export const listarContactos = async (req, res) => {
  try {
    const { pagina, limite, offset } = validarPaginacion(req.query);
    const { q, tipo, origen, asignado, etiqueta } = req.query;
    const base = whereEspacioPropio(req.crm, "c");
    const conds = [base.where, "c.archivado_at IS NULL"];
    const params = [...base.params];
    if (q) {
      params.push(`%${q}%`);
      conds.push(`(c.nombre ILIKE $${params.length} OR c.email ILIKE $${params.length} OR c.telefono ILIKE $${params.length})`);
    }
    if (tipo) {
      params.push(tipo);
      conds.push(`c.tipo = $${params.length}`);
    }
    if (origen) {
      params.push(origen);
      conds.push(`c.origen = $${params.length}`);
    }
    if (asignado) {
      params.push(asignado);
      conds.push(`c.asignado_a_id = $${params.length}`);
    }
    if (etiqueta) {
      params.push(etiqueta);
      conds.push(`$${params.length} = ANY(c.etiquetas)`);
    }
    const where = conds.join(" AND ");
    const { rows } = await pool.query(
      `SELECT c.* FROM crm_contactos c WHERE ${where}
       ORDER BY c.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limite, offset],
    );
    const total = await pool.query(
      `SELECT COUNT(*)::int AS total FROM crm_contactos c WHERE ${where}`,
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

// ── POST /crm/contactos ─────────────────────────────────────────
export const crearContacto = async (req, res) => {
  try {
    const crm = req.crm;
    const { errores, valores } = validarContacto(req.body);
    if (errores.length > 0) return res.status(400).json({ success: false, error: errores });

    let telefono = null;
    if (req.body.telefono !== undefined && req.body.telefono !== null && req.body.telefono !== "") {
      telefono = normalizarTelefonoCO(req.body.telefono);
      if (!telefono) {
        return res.status(400).json({ success: false, error: "telefono debe ser un celular colombiano válido." });
      }
    }

    const dup = await buscarDuplicado(crm, valores.email ?? null, telefono);
    if (dup) {
      return res.status(409).json({ success: false, error: "Ya existe un contacto con ese correo o teléfono.", data: dup });
    }

    // Agent crea asignado a sí mismo; admin/personal según lo enviado.
    let asignado = valores.asignado_a_id ?? null;
    if (crm.tipo === "org" && crm.rolEnOrg === "agent") asignado = crm.usuarioId;

    const dueno = duenoCols(crm);
    const { rows } = await pool.query(
      `INSERT INTO crm_contactos
        (${dueno.cols}, nombre, email, telefono, tipo, origen, presupuesto_min, presupuesto_max,
         zona_interes, preferencias, etiquetas, asignado_a_id, creado_por_id,
         autorizacion_datos_at, autorizacion_origen)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       RETURNING *`,
      [
        ...dueno.vals,
        valores.nombre.trim(),
        valores.email ?? null,
        telefono,
        valores.tipo ?? "otro",
        valores.origen ?? "manual",
        valores.presupuesto_min ?? null,
        valores.presupuesto_max ?? null,
        valores.zona_interes ?? null,
        JSON.stringify(valores.preferencias ?? {}),
        valores.etiquetas ?? [],
        asignado,
        crm.usuarioId,
        valores.autorizacion_datos_at ?? null,
        valores.autorizacion_origen ?? null,
      ],
    );
    return res.status(201).json({ success: true, data: rows[0] });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ success: false, error: "Ya existe un contacto con ese correo o teléfono." });
    }
    return res.status(500).json({ success: false, error: error.message });
  }
};

// ── GET /crm/contactos/:id ──────────────────────────────────────
export const obtenerContacto = async (req, res) => {
  try {
    const c = await contactoEnEspacio(req.crm, req.params.id);
    if (!c) return res.status(404).json({ success: false, error: "Contacto no encontrado." });
    return res.status(200).json({ success: true, data: c });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

// ── PATCH /crm/contactos/:id ────────────────────────────────────
export const actualizarContacto = async (req, res) => {
  try {
    const crm = req.crm;
    const actual = await contactoEnEspacio(crm, req.params.id);
    if (!actual) return res.status(404).json({ success: false, error: "Contacto no encontrado." });

    const { errores, valores } = validarContacto(req.body, true);
    if (errores.length > 0) return res.status(400).json({ success: false, error: errores });

    let telefono = actual.telefono;
    if (req.body.telefono !== undefined) {
      if (req.body.telefono === null || req.body.telefono === "") telefono = null;
      else {
        telefono = normalizarTelefonoCO(req.body.telefono);
        if (!telefono) {
          return res.status(400).json({ success: false, error: "telefono debe ser un celular colombiano válido." });
        }
      }
    }
    const email = valores.email !== undefined ? valores.email : actual.email;
    const dup = await buscarDuplicado(crm, email, telefono, actual.id);
    if (dup) {
      return res.status(409).json({ success: false, error: "Ya existe un contacto con ese correo o teléfono.", data: dup });
    }

    const sets = ["telefono = $1", "email = $2", "updated_at = now()"];
    const params = [telefono, email];
    const put = (col, val) => {
      params.push(val);
      sets.push(`${col} = $${params.length}`);
    };
    if (valores.nombre !== undefined) put("nombre", valores.nombre.trim());
    if (valores.tipo !== undefined) put("tipo", valores.tipo);
    if (valores.presupuesto_min !== undefined) put("presupuesto_min", valores.presupuesto_min ?? null);
    if (valores.presupuesto_max !== undefined) put("presupuesto_max", valores.presupuesto_max ?? null);
    if (valores.zona_interes !== undefined) put("zona_interes", valores.zona_interes);
    if (valores.preferencias !== undefined) put("preferencias", JSON.stringify(valores.preferencias));
    if (valores.etiquetas !== undefined) put("etiquetas", valores.etiquetas);
    if (valores.autorizacion_datos_at) {
      put("autorizacion_datos_at", valores.autorizacion_datos_at);
      put("autorizacion_origen", valores.autorizacion_origen);
    }
    params.push(actual.id);
    const { rows } = await pool.query(
      `UPDATE crm_contactos SET ${sets.join(", ")} WHERE id = $${params.length} RETURNING *`,
      params,
    );
    return res.status(200).json({ success: true, data: rows[0] });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ success: false, error: "Ya existe un contacto con ese correo o teléfono." });
    }
    return res.status(500).json({ success: false, error: error.message });
  }
};

// ── DELETE /crm/contactos/:id (archivar) ────────────────────────
export const archivarContacto = async (req, res) => {
  try {
    const crm = req.crm;
    const actual = await contactoEnEspacio(crm, req.params.id);
    if (!actual) return res.status(404).json({ success: false, error: "Contacto no encontrado." });
    // Agent solo archiva los suyos: contactoEnEspacio ya filtra asignados/creados.
    await pool.query("UPDATE crm_contactos SET archivado_at = now() WHERE id = $1", [actual.id]);
    return res.status(200).json({ success: true, data: { id: actual.id, archivado: true } });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

// ── PATCH /crm/contactos/:id/asignar (solo agency_admin en org) ─
export const asignarContacto = async (req, res) => {
  try {
    const crm = req.crm;
    if (crm.tipo !== "org" || crm.rolEnOrg !== "agency_admin") {
      return res.status(403).json({ success: false, error: "Solo un administrador puede reasignar." });
    }
    const base = whereEspacioPropio(crm, "c");
    const { rows } = await pool.query(
      `UPDATE crm_contactos c SET asignado_a_id = $1, updated_at = now()
       WHERE c.id = $2 AND ${base.where} AND c.archivado_at IS NULL RETURNING c.*`,
      [req.body.asignado_a_id ?? null, req.params.id, ...base.params],
    );
    if (!rows[0]) return res.status(404).json({ success: false, error: "Contacto no encontrado." });
    return res.status(200).json({ success: true, data: rows[0] });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

// ── POST /crm/leads/:id/convertir (idempotente por lead_id) ──────
export const convertirLead = async (req, res) => {
  try {
    const crm = req.crm;
    const { rows: leads } = await pool.query(
      `SELECT l.* FROM leads l JOIN propiedades p ON p.id = l.propiedad_id
       WHERE l.id = $1 AND (
         (p.publicado_por_id = $2 AND p.organizacion_id IS NULL)
         OR p.organizacion_id IN (
           SELECT om.organizacion_id FROM organizacion_miembros om
           JOIN organizaciones o ON o.id = om.organizacion_id
           WHERE om.usuario_id = $2 AND om.estado = 'activo' AND o.estado = 'aprobada'))`,
      [req.params.id, crm.usuarioId],
    );
    const lead = leads[0];
    if (!lead) return res.status(404).json({ success: false, error: "Lead no encontrado." });

    const dueno = duenoCols(crm);
    const col = crm.tipo === "personal" ? "usuario_id" : "organizacion_id";
    const { rows: existentes } = await pool.query(
      `SELECT * FROM crm_contactos WHERE ${col} = $1 AND lead_id = $2 AND archivado_at IS NULL LIMIT 1`,
      [...dueno.vals, lead.id],
    );
    if (existentes[0]) return res.status(200).json({ success: true, data: existentes[0], message: "El lead ya era contacto." });

    const telefono = normalizarTelefonoCO(lead.telefono);
    const asignado = crm.tipo === "org" && crm.rolEnOrg === "agent" ? crm.usuarioId : crm.usuarioId;
    const { rows } = await pool.query(
      `INSERT INTO crm_contactos
        (${dueno.cols}, nombre, email, telefono, origen, lead_id, asignado_a_id, creado_por_id)
       VALUES ($1, $2, $3, $4, 'portal', $5, $6, $7)
       ON CONFLICT DO NOTHING RETURNING *`,
      [
        ...dueno.vals,
        lead.nombre || lead.email || `Lead ${lead.id}`,
        lead.email || null,
        telefono,
        lead.id,
        asignado,
        crm.usuarioId,
      ],
    );
    const contacto = rows[0] || existentes[0];
    if (contacto) {
      await pool.query(
        `INSERT INTO crm_actividades (${dueno.cols}, contacto_id, tipo, contenido, autor_id)
         VALUES ($1, $2, 'sistema', 'Contacto creado desde un lead del portal.', $3)`,
        [...dueno.vals, contacto.id, crm.usuarioId],
      );
    }
    return res.status(201).json({ success: true, data: contacto });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

// ── GET /crm/contactos/:id/actividades ───────────────────────────
export const listarActividades = async (req, res) => {
  try {
    const contacto = await contactoEnEspacio(req.crm, req.params.id);
    if (!contacto) return res.status(404).json({ success: false, error: "Contacto no encontrado." });
    const { rows } = await pool.query(
      `SELECT a.*, u.name AS autor_nombre FROM crm_actividades a
       LEFT JOIN usuarios u ON u.id = a.autor_id
       WHERE a.contacto_id = $1 ORDER BY a.ocurrio_at DESC, a.id DESC LIMIT 200`,
      [contacto.id],
    );
    return res.status(200).json({ success: true, data: rows });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

// ── POST /crm/actividades ────────────────────────────────────────
export const crearActividad = async (req, res) => {
  try {
    const crm = req.crm;
    const errores = validarActividad(req.body);
    if (errores.length > 0) return res.status(400).json({ success: false, error: errores });
    const contacto = await contactoEnEspacio(crm, req.body.contacto_id);
    if (!contacto) return res.status(404).json({ success: false, error: "Contacto no encontrado." });
    const dueno = duenoCols(crm);
    const { rows } = await pool.query(
      `INSERT INTO crm_actividades
        (${dueno.cols}, contacto_id, propiedad_id, tipo, contenido, resultado, duracion_min, ocurrio_at, autor_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, now()), $9, $10) RETURNING *`,
      [
        ...dueno.vals,
        contacto.id,
        req.body.propiedad_id ?? null,
        req.body.tipo,
        req.body.contenido ?? null,
        req.body.resultado ?? null,
        req.body.duracion_min ?? null,
        req.body.ocurrio_at ?? null,
        crm.usuarioId,
        JSON.stringify(req.body.metadata ?? {}),
      ],
    );
    return res.status(201).json({ success: true, data: rows[0] });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

// ── GET /crm/tareas ──────────────────────────────────────────────
export const listarTareas = async (req, res) => {
  try {
    const crm = req.crm;
    const { pagina, limite, offset } = validarPaginacion(req.query);
    const { vista, asignado } = req.query;
    let base = whereEspacioPropio(crm, "t");
    // Agent: siempre solo las suyas.
    if (crm.tipo === "org" && crm.rolEnOrg === "agent") {
      base = {
        where: `t.organizacion_id = $1 AND t.asignado_a_id = $2`,
        params: [crm.organizacionId, crm.usuarioId],
        nextIndex: 3,
      };
    }
    const conds = [`${base.where}`, "t.completada_at IS NULL"];
    const params = [...base.params];
    if (vista === "hoy") conds.push("t.vence_at::date = CURRENT_DATE");
    else if (vista === "vencidas") conds.push("t.vence_at < now()");
    else if (vista === "proximas") conds.push("t.vence_at > now()");
    if (asignado) {
      params.push(asignado);
      conds.push(`t.asignado_a_id = $${params.length}`);
    }
    const where = conds.join(" AND ");
    const { rows } = await pool.query(
      `SELECT t.*, c.nombre AS contacto_nombre FROM crm_tareas t
       LEFT JOIN crm_contactos c ON c.id = t.contacto_id
       WHERE ${where} ORDER BY t.vence_at NULLS LAST, t.id DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limite, offset],
    );
    const total = await pool.query(
      `SELECT COUNT(*)::int AS total FROM crm_tareas t WHERE ${where}`,
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

// ── POST /crm/tareas ─────────────────────────────────────────────
export const crearTarea = async (req, res) => {
  try {
    const crm = req.crm;
    const errores = validarTarea(req.body);
    if (errores.length > 0) return res.status(400).json({ success: false, error: errores });

    let contactoId = req.body.contacto_id ?? null;
    if (contactoId) {
      const c = await contactoEnEspacio(crm, contactoId);
      if (!c) return res.status(404).json({ success: false, error: "Contacto no encontrado." });
    }
    let asignado = req.body.asignado_a_id ?? crm.usuarioId;
    if (crm.tipo === "org" && crm.rolEnOrg === "agent") asignado = crm.usuarioId;

    const dueno = duenoCols(crm);
    const { rows } = await pool.query(
      `INSERT INTO crm_tareas
        (${dueno.cols}, contacto_id, titulo, descripcion, prioridad, vence_at, asignado_a_id, creado_por_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        ...dueno.vals,
        contactoId,
        req.body.titulo.trim(),
        req.body.descripcion ?? null,
        req.body.prioridad ?? "media",
        req.body.vence_at ?? null,
        asignado,
        crm.usuarioId,
      ],
    );
    return res.status(201).json({ success: true, data: rows[0] });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

async function tareaEnEspacio(crm, id) {
  const base = whereEspacioPropio(crm, "t");
  const { rows } = await pool.query(
    `SELECT t.* FROM crm_tareas t WHERE t.id = $${base.nextIndex} AND ${base.where}`,
    [...base.params, id],
  );
  return rows[0] || null;
}

// ── PATCH /crm/tareas/:id ────────────────────────────────────────
export const actualizarTarea = async (req, res) => {
  try {
    const actual = await tareaEnEspacio(req.crm, req.params.id);
    if (!actual) return res.status(404).json({ success: false, error: "Tarea no encontrada." });
    const errores = validarTarea(req.body, true);
    if (errores.length > 0) return res.status(400).json({ success: false, error: errores });
    const sets = ["updated_at = now()"];
    const params = [];
    const put = (col, val) => {
      params.push(val);
      sets.push(`${col} = $${params.length}`);
    };
    if (req.body.titulo !== undefined) put("titulo", String(req.body.titulo).trim());
    if (req.body.descripcion !== undefined) put("descripcion", req.body.descripcion);
    if (req.body.prioridad !== undefined) put("prioridad", req.body.prioridad);
    if (req.body.vence_at !== undefined) put("vence_at", req.body.vence_at);
    params.push(actual.id);
    const { rows } = await pool.query(
      `UPDATE crm_tareas SET ${sets.join(", ")} WHERE id = $${params.length} RETURNING *`,
      params,
    );
    return res.status(200).json({ success: true, data: rows[0] });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

// ── POST /crm/tareas/:id/completar ───────────────────────────────
export const completarTarea = async (req, res) => {
  try {
    const actual = await tareaEnEspacio(req.crm, req.params.id);
    if (!actual) return res.status(404).json({ success: false, error: "Tarea no encontrada." });
    const { rows } = await pool.query(
      "UPDATE crm_tareas SET completada_at = now(), updated_at = now() WHERE id = $1 RETURNING *",
      [actual.id],
    );
    return res.status(200).json({ success: true, data: rows[0] });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

// ── POST /crm/reasignar (solo agency_admin en org) ─────────────────
// Mueve contactos, oportunidades y tareas de un miembro a otro, en transacción.
export const reasignarMasivo = async (req, res) => {
  const client = await pool.connect();
  try {
    const crm = req.crm;
    if (crm.tipo !== "org" || crm.rolEnOrg !== "agency_admin") {
      return res.status(403).json({ success: false, error: "Solo un administrador puede reasignar." });
    }
    const { desde_id, hacia_id } = req.body;
    if (!Number.isInteger(Number(desde_id)) || !Number.isInteger(Number(hacia_id))) {
      return res.status(400).json({ success: false, error: "desde_id y hacia_id son requeridos." });
    }
    await client.query("BEGIN");
    const contactos = await client.query(
      "UPDATE crm_contactos SET asignado_a_id = $1, updated_at = now() WHERE organizacion_id = $2 AND asignado_a_id = $3 AND archivado_at IS NULL",
      [hacia_id, crm.organizacionId, desde_id],
    );
    const oportunidades = await client.query(
      "UPDATE crm_oportunidades SET asignado_a_id = $1, updated_at = now() WHERE organizacion_id = $2 AND asignado_a_id = $3",
      [hacia_id, crm.organizacionId, desde_id],
    );
    const tareas = await client.query(
      "UPDATE crm_tareas SET asignado_a_id = $1, updated_at = now() WHERE organizacion_id = $2 AND asignado_a_id = $3 AND completada_at IS NULL",
      [hacia_id, crm.organizacionId, desde_id],
    );
    await client.query("COMMIT");
    return res.status(200).json({
      success: true,
      data: { contactos: contactos.rowCount, oportunidades: oportunidades.rowCount, tareas: tareas.rowCount },
    });
  } catch (error) {
    await client.query("ROLLBACK");
    return res.status(500).json({ success: false, error: error.message });
  } finally {
    client.release();
  }
};
