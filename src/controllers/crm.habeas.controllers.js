// src/controllers/crm.habeas.controllers.js — derechos del titular (Ley 1581):
// acceso (exportar), supresión, autorización y registro de auditoría.
// La rectificación es la edición normal del contacto (se audita allí).
import { z } from "zod";
import { pool } from "../db.js";
import { whereEspacioPropio } from "../lib/crmPermisos.js";
import { noEncontrado, prohibido } from "../lib/errores.js";
import { ORIGENES_AUTORIZACION, puedeGestionarDatos, registrarAuditoria } from "../lib/habeasData.js";
import { validar } from "../validations/visita.schema.js";

const idSchema = z.object({ id: z.coerce.number().int().positive() });

// Contacto del espacio (incluye archivados: también tienen datos personales).
async function contactoDelEspacio(crm, id, db = pool) {
  const base = whereEspacioPropio(crm, "c");
  const { rows } = await db.query(
    `SELECT c.* FROM crm_contactos c WHERE c.id = $${base.nextIndex} AND ${base.where}`,
    [...base.params, id],
  );
  if (!rows[0]) throw noEncontrado("Contacto no encontrado.");
  return rows[0];
}

// ── GET /crm/contactos/:id/datos-personales ──────────────────────
// Derecho de acceso: todo lo que el espacio guarda del titular, en JSON.
export const exportarDatosContacto = async (req, res) => {
  const { id } = validar(idSchema, req.params);
  const crm = req.crm;
  const c = await contactoDelEspacio(crm, id);
  const q = (sql) => pool.query(sql, [c.id]).then((r) => r.rows);

  const [responsable, lead, actividades, tareas, oportunidades, visitas, demandas, captaciones] = await Promise.all([
    crm.tipo === "org"
      ? pool.query("SELECT nombre, email, telefono FROM organizaciones WHERE id = $1", [crm.organizacionId]).then((r) => r.rows[0])
      : pool.query("SELECT name AS nombre, email FROM usuarios WHERE id = $1", [crm.usuarioId]).then((r) => r.rows[0]),
    c.lead_id
      ? pool
          .query(
            `SELECT l.nombre, l.email, l.telefono, l.origen, l.created_at, p.titulo AS inmueble
             FROM leads l LEFT JOIN propiedades p ON p.id = l.propiedad_id WHERE l.id = $1`,
            [c.lead_id],
          )
          .then((r) => r.rows[0] ?? null)
      : null,
    q(`SELECT tipo, contenido, resultado, duracion_min, ocurrio_at FROM crm_actividades
       WHERE contacto_id = $1 ORDER BY ocurrio_at`),
    q(`SELECT titulo, descripcion, prioridad, vence_at, completada_at, created_at FROM crm_tareas
       WHERE contacto_id = $1 ORDER BY created_at`),
    q(`SELECT o.titulo, o.valor, o.estado, e.nombre AS etapa, p.titulo AS inmueble, o.cierre_estimado::text, o.created_at
       FROM crm_oportunidades o JOIN crm_etapas e ON e.id = o.etapa_id LEFT JOIN propiedades p ON p.id = o.propiedad_id
       WHERE o.contacto_id = $1 ORDER BY o.created_at`),
    q(`SELECT v.inicio_at, v.fin_at, v.estado, v.lugar, v.notas, v.resultado_interes, v.resultado_comentario,
              p.titulo AS inmueble
       FROM crm_visitas v LEFT JOIN propiedades p ON p.id = v.propiedad_id
       WHERE v.contacto_id = $1 ORDER BY v.inicio_at`),
    q(`SELECT ot.code AS operacion, d.precio_min, d.precio_max, d.habitaciones_min, d.banos_min, d.area_min, d.area_max,
              d.estratos, d.notas, d.estado, d.created_at,
              (SELECT array_agg(name ORDER BY name) FROM cities WHERE id = ANY(d.city_ids)) AS ciudades
       FROM crm_demandas d JOIN operation_types ot ON ot.id = d.operation_type_id
       WHERE d.contacto_id = $1 ORDER BY d.created_at`),
    q(`SELECT p.titulo AS inmueble, k.estado, k.inicio_el::text, k.vence_el::text, k.created_at
       FROM crm_captaciones k JOIN propiedades p ON p.id = k.propiedad_id
       WHERE k.propietario_id = $1 ORDER BY k.created_at`),
  ]);

  await registrarAuditoria(crm, c.id, "exportacion", {
    actividades: actividades.length,
    tareas: tareas.length,
    oportunidades: oportunidades.length,
    visitas: visitas.length,
    demandas: demandas.length,
    captaciones: captaciones.length,
  });

  res.json({
    success: true,
    data: {
      generado_at: new Date().toISOString(),
      ley: "Ley 1581 de 2012 — derecho de acceso del titular",
      responsable_del_tratamiento: responsable ?? null,
      titular: {
        nombre: c.nombre,
        email: c.email,
        telefono: c.telefono,
        tipo: c.tipo,
        origen: c.origen,
        presupuesto_min: c.presupuesto_min,
        presupuesto_max: c.presupuesto_max,
        zona_interes: c.zona_interes,
        preferencias: c.preferencias,
        etiquetas: c.etiquetas,
        registrado_at: c.created_at,
        actualizado_at: c.updated_at,
        archivado_at: c.archivado_at,
      },
      autorizacion: { otorgada_at: c.autorizacion_datos_at, origen: c.autorizacion_origen },
      solicitud_original_del_portal: lead,
      actividades,
      tareas,
      oportunidades,
      visitas,
      demandas,
      captaciones_como_propietario: captaciones,
    },
  });
};

const autorizacionSchema = z.object({
  autorizado: z.boolean(),
  origen: z.enum(ORIGENES_AUTORIZACION, { message: "Origen de la autorización no válido." }).optional(),
});

// ── PUT /crm/contactos/:id/autorizacion ──────────────────────────
export const actualizarAutorizacion = async (req, res) => {
  const { id } = validar(idSchema, req.params);
  const d = validar(autorizacionSchema, req.body);
  const crm = req.crm;
  const c = await contactoDelEspacio(crm, id);
  const { rows } = await pool.query(
    d.autorizado
      ? `UPDATE crm_contactos SET autorizacion_datos_at = now(), autorizacion_origen = $2, updated_at = now()
         WHERE id = $1 RETURNING *`
      : `UPDATE crm_contactos SET autorizacion_datos_at = NULL, autorizacion_origen = NULL, updated_at = now()
         WHERE id = $1 RETURNING *`,
    d.autorizado ? [c.id, d.origen ?? "crm"] : [c.id],
  );
  await registrarAuditoria(
    crm,
    c.id,
    d.autorizado ? "autorizacion_registrada" : "autorizacion_retirada",
    d.autorizado ? { origen: d.origen ?? "crm" } : {},
  );
  res.json({
    success: true,
    message: d.autorizado ? "Autorización registrada." : "Autorización retirada.",
    data: rows[0],
  });
};

const supresionSchema = z.object({
  confirmar: z.literal(true, { message: "Confirma la supresión." }),
  motivo: z.enum(["solicitud_titular", "fin_finalidad", "revocatoria", "otro"]).default("solicitud_titular"),
});

// ── POST /crm/contactos/:id/suprimir ─────────────────────────────
// Borra el contacto y todo lo suyo (actividades, tareas, oportunidades,
// visitas, demandas); anonimiza la solicitud del portal de la que salió; quita
// avisos que lo nombran. Las captaciones quedan sin propietario (el contrato
// del inmueble sigue siendo de la inmobiliaria). Irreversible.
export const suprimirContacto = async (req, res) => {
  const crm = req.crm;
  if (!puedeGestionarDatos(crm)) throw prohibido("Solo un administrador de la inmobiliaria puede suprimir datos.");
  const { id } = validar(idSchema, req.params);
  const d = validar(supresionSchema, req.body);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const c = await contactoDelEspacio(crm, id, client);
    const cuenta = async (tabla, col = "contacto_id") =>
      (await client.query(`SELECT COUNT(*)::int AS n FROM ${tabla} WHERE ${col} = $1`, [c.id])).rows[0].n;
    const detalle = {
      motivo: d.motivo,
      actividades: await cuenta("crm_actividades"),
      tareas: await cuenta("crm_tareas"),
      oportunidades: await cuenta("crm_oportunidades"),
      visitas: await cuenta("crm_visitas"),
      demandas: await cuenta("crm_demandas"),
      captaciones_desvinculadas: await cuenta("crm_captaciones", "propietario_id"),
      lead_anonimizado: false,
      avisos_borrados: 0,
    };

    // Avisos que enlazan al contacto, sus visitas o sus demandas.
    const { rowCount: avisos } = await client.query(
      `DELETE FROM crm_notificaciones
       WHERE url = '/contactos/' || $1::bigint::text
          OR url IN (SELECT '/agenda?visita=' || id FROM crm_visitas WHERE contacto_id = $1::bigint)
          OR url IN (SELECT '/demandas?demanda=' || id FROM crm_demandas WHERE contacto_id = $1::bigint)`,
      [c.id],
    );
    detalle.avisos_borrados = avisos;

    if (c.lead_id) {
      const { rowCount } = await client.query(
        "UPDATE leads SET nombre = NULL, email = NULL, telefono = NULL WHERE id = $1",
        [c.lead_id],
      );
      detalle.lead_anonimizado = rowCount > 0;
    }

    await client.query("DELETE FROM crm_contactos WHERE id = $1", [c.id]);
    await registrarAuditoria(crm, c.id, "supresion", detalle, client);
    await client.query("COMMIT");
    res.json({ success: true, message: "Datos suprimidos.", data: { contacto_id: c.id, ...detalle } });
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
};

const registroSchema = z.object({
  contacto_id: z.coerce.number().int().positive().optional(),
  pagina: z.coerce.number().int().min(1).max(1000).default(1),
  limite: z.coerce.number().int().min(1).max(100).default(50),
});

// ── GET /crm/habeas-data/registro ────────────────────────────────
export const registroAuditoria = async (req, res) => {
  const crm = req.crm;
  if (!puedeGestionarDatos(crm)) throw prohibido("Solo un administrador de la inmobiliaria puede ver el registro.");
  const f = validar(registroSchema, req.query);
  const params = [crm.tipo === "org" ? crm.organizacionId : crm.usuarioId];
  const conds = [crm.tipo === "org" ? "a.organizacion_id = $1" : "a.usuario_id = $1"];
  if (f.contacto_id) {
    params.push(f.contacto_id);
    conds.push(`a.contacto_id = $${params.length}`);
  }
  const where = conds.join(" AND ");
  const [{ rows }, { rows: total }] = await Promise.all([
    pool.query(
      `SELECT a.id, a.contacto_id, a.accion, a.detalle, a.created_at, u.name AS actor_nombre,
              c.nombre AS contacto_nombre
       FROM crm_auditoria_datos a
       LEFT JOIN usuarios u ON u.id = a.actor_id
       LEFT JOIN crm_contactos c ON c.id = a.contacto_id
       WHERE ${where}
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, f.limite, (f.pagina - 1) * f.limite],
    ),
    pool.query(`SELECT COUNT(*)::int AS total FROM crm_auditoria_datos a WHERE ${where}`, params),
  ]);
  res.json({ success: true, data: rows, pagination: { pagina: f.pagina, limite: f.limite, total: total[0].total } });
};
