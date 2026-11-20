// src/controllers/crm.visitas.controllers.js — agenda y visitas del CRM.
//
// Visibilidad (igual que contactos/tareas, vía whereEspacioPropio):
//   personal → las mías · org admin → toda la org · org agent → asignadas a él
//   o creadas por él.
// Un agente solo puede agendarse a sí mismo; el admin puede asignar a
// cualquier miembro activo. Los errores se lanzan como HttpError (Express 5).
import { pool } from "../db.js";
import { duenoEspacio, whereEspacioPropio } from "../lib/crmPermisos.js";
import { noEncontrado, prohibido, solicitudInvalida } from "../lib/errores.js";
import { fechaCortaBogota, notificar } from "../lib/notificaciones.js";
import {
  ESTADOS_ACTIVOS,
  actualizarVisitaSchema,
  crearVisitaSchema,
  estadoVisitaSchema,
  filtrosVisitasSchema,
  validar,
} from "../validations/visita.schema.js";

const MAX_DIAS_RANGO = 93;
const ZONA = "America/Bogota";

// SELECT con los datos que pinta la agenda (contacto, inmueble y agente).
const SELECT_VISITA = `
  SELECT v.*,
         c.nombre AS contacto_nombre, c.telefono AS contacto_telefono, c.email AS contacto_email,
         p.titulo AS propiedad_titulo, p.direccion AS propiedad_direccion,
         ci.name AS propiedad_ciudad,
         u.name AS agente_nombre
  FROM crm_visitas v
  JOIN crm_contactos c ON c.id = v.contacto_id
  LEFT JOIN propiedades p ON p.id = v.propiedad_id
  LEFT JOIN cities ci ON ci.id = p.city_id
  LEFT JOIN usuarios u ON u.id = v.asignado_a_id`;

const esAgente = (crm) => crm.tipo === "org" && crm.rolEnOrg === "agent";

// Aviso al agente de la visita cuando otra persona la crea, mueve o cancela.
function avisarAgente(crm, visita, tipo, titulo) {
  if (crm.tipo !== "org") return null;
  return notificar({
    destinatarios: [visita.asignado_a_id],
    organizacionId: crm.organizacionId,
    tipo,
    titulo,
    cuerpo: [fechaCortaBogota(visita.inicio_at), visita.propiedad_titulo].filter(Boolean).join(" · "),
    url: `/agenda?visita=${visita.id}`,
    actorId: crm.usuarioId,
  });
}

async function visitaEnEspacio(crm, id) {
  if (!/^\d+$/.test(String(id))) throw noEncontrado("Visita no encontrada.");
  const base = whereEspacioPropio(crm, "v");
  const { rows } = await pool.query(
    `${SELECT_VISITA} WHERE v.id = $${base.nextIndex} AND ${base.where}`,
    [...base.params, id],
  );
  if (!rows[0]) throw noEncontrado("Visita no encontrada.");
  return rows[0];
}

async function contactoEnEspacio(crm, id) {
  const base = whereEspacioPropio(crm, "c");
  const { rows } = await pool.query(
    `SELECT c.id FROM crm_contactos c
     WHERE c.id = $${base.nextIndex} AND ${base.where} AND c.archivado_at IS NULL`,
    [...base.params, id],
  );
  if (!rows[0]) throw noEncontrado("Contacto no encontrado.");
}

// El inmueble tiene que ser del espacio (personal: mío sin org; org: de la org).
async function propiedadDelEspacio(crm, id) {
  const cond =
    crm.tipo === "personal"
      ? "p.publicado_por_id = $2 AND p.organizacion_id IS NULL"
      : "p.organizacion_id = $2";
  const { rows } = await pool.query(
    `SELECT p.id, p.titulo, p.direccion, ci.name AS ciudad
     FROM propiedades p LEFT JOIN cities ci ON ci.id = p.city_id
     WHERE p.id = $1 AND ${cond}`,
    [id, crm.tipo === "personal" ? crm.usuarioId : crm.organizacionId],
  );
  if (!rows[0]) throw noEncontrado("Inmueble no encontrado en este espacio.");
  return rows[0];
}

async function oportunidadDelEspacio(crm, id) {
  const d = duenoEspacio(crm);
  const { rows } = await pool.query(
    `SELECT id FROM crm_oportunidades WHERE id = $1 AND ${d.col} = $2`,
    [id, d.val],
  );
  if (!rows[0]) throw noEncontrado("Oportunidad no encontrada.");
}

// Agente que atiende la visita. Agente → siempre él mismo.
async function resolverAgente(crm, solicitado) {
  if (crm.tipo === "personal" || esAgente(crm)) {
    if (solicitado && Number(solicitado) !== Number(crm.usuarioId)) {
      throw prohibido("Solo puedes agendar visitas a tu nombre.");
    }
    return crm.usuarioId;
  }
  const agente = solicitado ?? crm.usuarioId;
  const { rows } = await pool.query(
    `SELECT 1 FROM organizacion_miembros
     WHERE usuario_id = $1 AND organizacion_id = $2 AND estado = 'activo'`,
    [agente, crm.organizacionId],
  );
  if (!rows[0]) throw solicitudInvalida("El agente no es miembro activo de la inmobiliaria.");
  return agente;
}

// Visitas activas del agente que se cruzan con [inicio, fin).
async function choquesDeHorario(agenteId, inicio, fin, excluirId = null) {
  const { rows } = await pool.query(
    `SELECT v.id, v.inicio_at, v.fin_at, c.nombre AS contacto_nombre
     FROM crm_visitas v JOIN crm_contactos c ON c.id = v.contacto_id
     WHERE v.asignado_a_id = $1
       AND v.estado = ANY($2)
       AND v.inicio_at < $4 AND v.fin_at > $3
       AND ($5::bigint IS NULL OR v.id <> $5)
     ORDER BY v.inicio_at`,
    [agenteId, ESTADOS_ACTIVOS, inicio, fin, excluirId],
  );
  return rows;
}

function finDesde(inicioIso, duracionMin) {
  return new Date(new Date(inicioIso).getTime() + duracionMin * 60000).toISOString();
}

function lugarPorDefecto(prop) {
  if (!prop) return null;
  return [prop.direccion, prop.ciudad].filter(Boolean).join(", ") || null;
}

// ── GET /crm/visitas ─────────────────────────────────────────────
// Rango por días de Bogotá (desde/hasta inclusive). Sin rango: próximos 30
// días, salvo que se filtre por contacto o inmueble (historial completo).
export const listarVisitas = async (req, res) => {
  const crm = req.crm;
  const f = validar(filtrosVisitasSchema, req.query);
  const base = whereEspacioPropio(crm, "v");
  const conds = [base.where];
  const params = [...base.params];
  const add = (sql, valor) => {
    params.push(valor);
    conds.push(sql.replace("?", `$${params.length}`));
  };

  if (f.desde || f.hasta) {
    if (!f.desde || !f.hasta) throw solicitudInvalida("Envía desde y hasta juntos.");
    const dias = (new Date(f.hasta) - new Date(f.desde)) / 86400000;
    if (dias < 0) throw solicitudInvalida("hasta debe ser posterior a desde.");
    if (dias > MAX_DIAS_RANGO) throw solicitudInvalida(`El rango máximo es de ${MAX_DIAS_RANGO} días.`);
    add(`v.inicio_at >= (?::date)::timestamp AT TIME ZONE '${ZONA}'`, f.desde);
    add(`v.inicio_at < (?::date + 1)::timestamp AT TIME ZONE '${ZONA}'`, f.hasta);
  } else if (!f.contacto_id && !f.propiedad_id) {
    conds.push("v.inicio_at >= now() - interval '1 day'", "v.inicio_at < now() + interval '30 days'");
  }
  if (f.asignado) add("v.asignado_a_id = ?", f.asignado);
  if (f.contacto_id) add("v.contacto_id = ?", f.contacto_id);
  if (f.propiedad_id) add("v.propiedad_id = ?", f.propiedad_id);
  if (f.estado) add("v.estado = ?", f.estado);

  const { rows } = await pool.query(
    `${SELECT_VISITA} WHERE ${conds.join(" AND ")} ORDER BY v.inicio_at LIMIT 500`,
    params,
  );
  res.json({ success: true, data: rows });
};

// ── GET /crm/visitas/:id ─────────────────────────────────────────
export const obtenerVisita = async (req, res) => {
  const visita = await visitaEnEspacio(req.crm, req.params.id);
  res.json({ success: true, data: visita });
};

// ── POST /crm/visitas ────────────────────────────────────────────
// 409 si el agente ya tiene una visita a esa hora (salvo forzar: true);
// el cuerpo trae los choques para que el CRM pregunte.
export const crearVisita = async (req, res) => {
  const crm = req.crm;
  const d = validar(crearVisitaSchema, req.body);

  await contactoEnEspacio(crm, d.contacto_id);
  const prop = d.propiedad_id ? await propiedadDelEspacio(crm, d.propiedad_id) : null;
  if (d.oportunidad_id) await oportunidadDelEspacio(crm, d.oportunidad_id);
  const agente = await resolverAgente(crm, d.asignado_a_id);

  const inicio = new Date(d.inicio_at).toISOString();
  const fin = finDesde(inicio, d.duracion_min);
  if (!d.forzar) {
    const choques = await choquesDeHorario(agente, inicio, fin);
    if (choques.length) {
      return res.status(409).json({
        success: false,
        error: "El agente ya tiene una visita en ese horario.",
        data: { choques },
      });
    }
  }

  const dueno = duenoEspacio(crm);
  const { rows } = await pool.query(
    `INSERT INTO crm_visitas
       (${dueno.col}, contacto_id, propiedad_id, oportunidad_id, inicio_at, fin_at,
        lugar, notas, recordatorio_minutos, asignado_a_id, creado_por_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING id`,
    [
      dueno.val, d.contacto_id, d.propiedad_id ?? null, d.oportunidad_id ?? null, inicio, fin,
      d.lugar ?? lugarPorDefecto(prop), d.notas ?? null, d.recordatorio_minutos,
      agente, crm.usuarioId,
    ],
  );
  const visita = await visitaEnEspacio(crm, rows[0].id);
  await avisarAgente(crm, visita, "visita_asignada", `Nueva visita con ${visita.contacto_nombre}`);
  res.status(201).json({ success: true, message: "Visita agendada.", data: visita });
};

// ── PATCH /crm/visitas/:id ───────────────────────────────────────
// Editar o reprogramar. Solo visitas activas (programada/confirmada).
export const actualizarVisita = async (req, res) => {
  const crm = req.crm;
  const d = validar(actualizarVisitaSchema, req.body);
  const actual = await visitaEnEspacio(crm, req.params.id);
  if (!ESTADOS_ACTIVOS.includes(actual.estado)) {
    throw solicitudInvalida("Solo se pueden editar visitas programadas o confirmadas.");
  }

  const sets = ["updated_at = now()"];
  const params = [];
  const put = (col, valor) => {
    params.push(valor);
    sets.push(`${col} = $${params.length}`);
  };

  let prop = null;
  if (d.propiedad_id !== undefined) {
    prop = d.propiedad_id ? await propiedadDelEspacio(crm, d.propiedad_id) : null;
    put("propiedad_id", d.propiedad_id ?? null);
  }
  if (d.oportunidad_id !== undefined) {
    if (d.oportunidad_id) await oportunidadDelEspacio(crm, d.oportunidad_id);
    put("oportunidad_id", d.oportunidad_id ?? null);
  }
  const agente =
    d.asignado_a_id !== undefined ? await resolverAgente(crm, d.asignado_a_id) : actual.asignado_a_id;
  if (d.asignado_a_id !== undefined) put("asignado_a_id", agente);

  // Horario: se recalcula con lo que llegue y lo que ya había.
  const duracionActual = Math.round((new Date(actual.fin_at) - new Date(actual.inicio_at)) / 60000);
  const inicio = d.inicio_at ? new Date(d.inicio_at).toISOString() : new Date(actual.inicio_at).toISOString();
  const fin = finDesde(inicio, d.duracion_min ?? duracionActual);
  const cambioHorario = d.inicio_at !== undefined || d.duracion_min !== undefined;
  if (cambioHorario) {
    put("inicio_at", inicio);
    put("fin_at", fin);
    // Reprogramada → el recordatorio vuelve a enviarse y se pide confirmar otra vez.
    sets.push("recordatorio_enviado_at = NULL");
    if (actual.estado === "confirmada") sets.push("estado = 'programada'");
  }
  if ((cambioHorario || d.asignado_a_id !== undefined) && !d.forzar) {
    const choques = await choquesDeHorario(agente, inicio, fin, actual.id);
    if (choques.length) {
      return res.status(409).json({
        success: false,
        error: "El agente ya tiene una visita en ese horario.",
        data: { choques },
      });
    }
  }

  if (d.lugar !== undefined) put("lugar", d.lugar ?? lugarPorDefecto(prop));
  if (d.notas !== undefined) put("notas", d.notas);
  if (d.recordatorio_minutos !== undefined) {
    put("recordatorio_minutos", d.recordatorio_minutos);
    sets.push("recordatorio_enviado_at = NULL");
  }

  params.push(actual.id);
  await pool.query(`UPDATE crm_visitas SET ${sets.join(", ")} WHERE id = $${params.length}`, params);
  const visita = await visitaEnEspacio(crm, actual.id);
  if (Number(visita.asignado_a_id) !== Number(actual.asignado_a_id)) {
    await avisarAgente(crm, visita, "visita_asignada", `Te asignaron la visita con ${visita.contacto_nombre}`);
  } else if (cambioHorario && visita.inicio_at?.toString() !== actual.inicio_at?.toString()) {
    await avisarAgente(crm, visita, "visita_cambiada", `Reprogramaron tu visita con ${visita.contacto_nombre}`);
  }
  res.json({ success: true, message: "Visita actualizada.", data: visita });
};

// Transiciones permitidas. Una visita cerrada (realizada/cancelada/no_asistio)
// solo puede volver a "programada" para corregir un error.
const TRANSICIONES = {
  programada: ["confirmada", "realizada", "cancelada", "no_asistio"],
  confirmada: ["programada", "realizada", "cancelada", "no_asistio"],
  realizada: ["programada"],
  cancelada: ["programada"],
  no_asistio: ["programada"],
};

// ── POST /crm/visitas/:id/estado ─────────────────────────────────
// Al marcar "realizada" se registra una actividad tipo visita en la línea de
// tiempo del contacto (con el interés y el comentario del cliente).
export const cambiarEstadoVisita = async (req, res) => {
  const crm = req.crm;
  const d = validar(estadoVisitaSchema, req.body);
  const actual = await visitaEnEspacio(crm, req.params.id);
  if (actual.estado === d.estado) {
    return res.json({ success: true, message: "Sin cambios.", data: actual });
  }
  if (!TRANSICIONES[actual.estado]?.includes(d.estado)) {
    throw solicitudInvalida(`No se puede pasar de "${actual.estado}" a "${d.estado}".`);
  }
  if (d.estado === "realizada" && new Date(actual.inicio_at) > new Date()) {
    throw solicitudInvalida("La visita aún no ha empezado.");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE crm_visitas SET
         estado = $1,
         resultado_interes = $2,
         resultado_comentario = $3,
         motivo_cancelacion = $4,
         updated_at = now()
       WHERE id = $5`,
      [
        d.estado,
        d.estado === "realizada" ? (d.resultado_interes ?? null) : null,
        d.estado === "realizada" ? (d.resultado_comentario ?? null) : null,
        d.estado === "cancelada" ? (d.motivo_cancelacion ?? null) : null,
        actual.id,
      ],
    );
    if (d.estado === "realizada") {
      const dueno = duenoEspacio(crm);
      const partes = [
        actual.propiedad_titulo ? `Visita a ${actual.propiedad_titulo}` : "Visita realizada",
        d.resultado_interes ? `Interés ${d.resultado_interes}` : null,
        d.resultado_comentario ?? null,
      ].filter(Boolean);
      await client.query(
        `INSERT INTO crm_actividades
           (${dueno.col}, contacto_id, oportunidad_id, propiedad_id, tipo, contenido, resultado,
            duracion_min, ocurrio_at, autor_id, metadata)
         VALUES ($1, $2, $3, $4, 'visita', $5, $6, $7, $8, $9, $10)`,
        [
          dueno.val, actual.contacto_id, actual.oportunidad_id, actual.propiedad_id,
          partes.join(" · ").slice(0, 4000),
          d.resultado_interes ? `interes_${d.resultado_interes}` : null,
          Math.round((new Date(actual.fin_at) - new Date(actual.inicio_at)) / 60000),
          actual.inicio_at, crm.usuarioId, { visita_id: Number(actual.id) },
        ],
      );
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }

  const visita = await visitaEnEspacio(crm, actual.id);
  if (d.estado === "cancelada") {
    await avisarAgente(crm, visita, "visita_cambiada", `Cancelaron tu visita con ${visita.contacto_nombre}`);
  }
  res.json({ success: true, message: "Estado actualizado.", data: visita });
};

// ── DELETE /crm/visitas/:id ──────────────────────────────────────
// Borrado real solo para visitas creadas por error (activas). Las cerradas
// quedan como historial: para quitarlas de la agenda se cancelan.
export const eliminarVisita = async (req, res) => {
  const crm = req.crm;
  const actual = await visitaEnEspacio(crm, req.params.id);
  if (!ESTADOS_ACTIVOS.includes(actual.estado)) {
    throw solicitudInvalida("Solo se pueden borrar visitas programadas o confirmadas.");
  }
  if (esAgente(crm) && Number(actual.creado_por_id) !== Number(crm.usuarioId)) {
    throw prohibido("Solo quien creó la visita o un administrador puede borrarla.");
  }
  await pool.query("DELETE FROM crm_visitas WHERE id = $1", [actual.id]);
  res.json({ success: true, message: "Visita eliminada.", data: { id: actual.id } });
};

