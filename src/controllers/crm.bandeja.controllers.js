// src/controllers/crm.bandeja.controllers.js — bandeja unificada y plantillas.
//
// La bandeja junta, del espacio activo:
//   - conversaciones de chat del portal sobre MIS anuncios (soy el publicador;
//     el chat es entre personas, así que solo se ven las propias). Del
//     interesado solo se expone el nombre y la foto, como en el chat.
//   - leads de inmuebles visibles en el CRM (mismo alcance que /crm/leads).
// "Pendiente" = el último mensaje es del interesado, o el lead sigue "nuevo".
import { z } from "zod";
import { pool } from "../db.js";
import { duenoEspacio, wherePropiedadesVisibles } from "../lib/crmPermisos.js";
import { noEncontrado, prohibido } from "../lib/errores.js";
import { validar } from "../validations/visita.schema.js";

const esId = (v) => /^\d+$/.test(String(v));
const LIMITE = 100;
const DIAS_LEADS = 90;

const filtrosSchema = z.object({
  filtro: z
    .enum(["todos", "pendientes", "chat", "leads"], { message: "Filtro no válido." })
    .optional()
    .default("todos"),
  q: z.string().trim().max(80).optional(),
});

// Conversaciones del espacio: personal → anuncios sin org; org → de la org.
function whereChatEspacio(crm, inicio) {
  return crm.tipo === "personal"
    ? { sql: "(p.id IS NULL OR p.organizacion_id IS NULL)", params: [], next: inicio }
    : { sql: `p.organizacion_id = $${inicio}`, params: [crm.organizacionId], next: inicio + 1 };
}

// ── GET /crm/bandeja ─────────────────────────────────────────────
export const listarBandeja = async (req, res) => {
  const crm = req.crm;
  const f = validar(filtrosSchema, req.query);
  const like = f.q ? `%${f.q}%` : null;

  let chats = [];
  if (f.filtro !== "leads") {
    const esp = whereChatEspacio(crm, 2);
    const params = [crm.usuarioId, ...esp.params];
    let extra = "";
    if (like) {
      params.push(like);
      extra = `AND (u.name ILIKE $${params.length} OR c.propiedad_titulo ILIKE $${params.length} OR c.ultimo_mensaje_texto ILIKE $${params.length})`;
    }
    const { rows } = await pool.query(
      `SELECT c.id, c.ultimo_mensaje_texto, c.ultimo_mensaje_at, c.no_leidos_publicador,
              (c.ultimo_mensaje_de = c.interesado_id) AS pendiente,
              u.name AS nombre, u.image_url AS imagen,
              COALESCE(p.titulo, c.propiedad_titulo) AS propiedad_titulo, p.id AS propiedad_id,
              (SELECT k.id FROM crm_contactos k
               WHERE k.preferencias->>'chat_conversacion_id' = c.id::text AND k.archivado_at IS NULL
               LIMIT 1) AS contacto_id
       FROM chat_conversaciones c
       JOIN usuarios u ON u.id = c.interesado_id
       LEFT JOIN propiedades p ON p.id = c.propiedad_id
       WHERE c.publicador_id = $1 AND c.ultimo_mensaje_at IS NOT NULL
         AND c.borrado_publicador_at IS NULL AND ${esp.sql} ${extra}
       ORDER BY c.ultimo_mensaje_at DESC
       LIMIT ${LIMITE}`,
      params,
    );
    chats = rows.map((r) => ({
      tipo: "chat",
      id: Number(r.id),
      nombre: r.nombre,
      imagen: r.imagen,
      propiedad_id: r.propiedad_id,
      propiedad_titulo: r.propiedad_titulo,
      texto: r.ultimo_mensaje_texto,
      at: r.ultimo_mensaje_at,
      no_leidos: r.no_leidos_publicador,
      pendiente: r.pendiente,
      contacto_id: r.contacto_id,
    }));
  }

  let leads = [];
  if (f.filtro !== "chat") {
    const vis = wherePropiedadesVisibles(crm, "p");
    const params = [...vis.params];
    let extra = "";
    if (like) {
      params.push(like);
      extra = `AND (l.nombre ILIKE $${params.length} OR l.email ILIKE $${params.length} OR p.titulo ILIKE $${params.length})`;
    }
    const { rows } = await pool.query(
      `SELECT l.id, l.nombre, l.email, l.telefono, l.score, l.origen, l.estado, l.created_at,
              p.id AS propiedad_id, p.titulo AS propiedad_titulo,
              (SELECT k.id FROM crm_contactos k WHERE k.lead_id = l.id AND k.archivado_at IS NULL LIMIT 1) AS contacto_id
       FROM leads l JOIN propiedades p ON p.id = l.propiedad_id
       WHERE ${vis.where}
         AND l.estado IN ('nuevo', 'contactado', 'en_negociacion')
         AND l.created_at > now() - interval '${DIAS_LEADS} days' ${extra}
       ORDER BY l.created_at DESC
       LIMIT ${LIMITE}`,
      params,
    );
    leads = rows.map((r) => ({
      tipo: "lead",
      id: r.id,
      nombre: r.nombre || r.email || r.telefono || `Lead ${r.id}`,
      email: r.email,
      telefono: r.telefono,
      propiedad_id: r.propiedad_id,
      propiedad_titulo: r.propiedad_titulo,
      texto:
        r.origen === "formulario_directo"
          ? "Dejó sus datos en el formulario de contacto."
          : `Mostró interés navegando el anuncio (puntuación ${r.score}).`,
      at: r.created_at,
      estado: r.estado,
      pendiente: r.estado === "nuevo",
      contacto_id: r.contacto_id,
    }));
  }

  let items = [...chats, ...leads].sort((a, b) => new Date(b.at) - new Date(a.at));
  if (f.filtro === "pendientes") items = items.filter((i) => i.pendiente);
  res.json({
    success: true,
    data: {
      items: items.slice(0, LIMITE),
      pendientes: {
        chat: chats.filter((c) => c.pendiente).length,
        leads: leads.filter((l) => l.pendiente).length,
      },
    },
  });
};

// ── POST /crm/bandeja/chat/:id/contacto ──────────────────────────
// Guarda al interesado de un chat como contacto (solo nombre: el chat no
// comparte correo ni teléfono). Idempotente por conversación.
export const contactoDesdeChat = async (req, res) => {
  const crm = req.crm;
  if (!esId(req.params.id)) throw noEncontrado("Conversación no encontrada.");
  const esp = whereChatEspacio(crm, 3);
  const { rows } = await pool.query(
    `SELECT c.id, u.name AS nombre, COALESCE(p.titulo, c.propiedad_titulo) AS propiedad_titulo, p.id AS propiedad_id
     FROM chat_conversaciones c
     JOIN usuarios u ON u.id = c.interesado_id
     LEFT JOIN propiedades p ON p.id = c.propiedad_id
     WHERE c.id = $1 AND c.publicador_id = $2 AND ${esp.sql}`,
    [req.params.id, crm.usuarioId, ...esp.params],
  );
  const conv = rows[0];
  if (!conv) throw noEncontrado("Conversación no encontrada.");
  const dueno = duenoEspacio(crm);

  const { rows: existe } = await pool.query(
    `SELECT id FROM crm_contactos
     WHERE ${dueno.col} = $1 AND preferencias->>'chat_conversacion_id' = $2 AND archivado_at IS NULL LIMIT 1`,
    [dueno.val, String(conv.id)],
  );
  if (existe[0]) return res.json({ success: true, message: "Ya estaba en tus contactos.", data: { id: existe[0].id, nuevo: false } });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: c } = await client.query(
      `INSERT INTO crm_contactos (${dueno.col}, nombre, tipo, origen, preferencias, asignado_a_id, creado_por_id)
       VALUES ($1, $2, 'comprador', 'chat', $3, $4, $4) RETURNING id`,
      [dueno.val, conv.nombre.slice(0, 200), { chat_conversacion_id: String(conv.id) }, crm.usuarioId],
    );
    await client.query(
      `INSERT INTO crm_actividades (${dueno.col}, contacto_id, propiedad_id, tipo, contenido, autor_id, metadata)
       VALUES ($1, $2, $3, 'sistema', $4, $5, $6)`,
      [
        dueno.val, c[0].id, conv.propiedad_id,
        `Contacto creado desde el chat del portal${conv.propiedad_titulo ? ` sobre «${conv.propiedad_titulo}»` : ""}.`.slice(0, 4000),
        crm.usuarioId, { chat_conversacion_id: Number(conv.id) },
      ],
    );
    await client.query("COMMIT");
    res.status(201).json({ success: true, message: "Contacto creado.", data: { id: c[0].id, nuevo: true } });
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
};

// ── Plantillas ───────────────────────────────────────────────────
const plantillaSchema = z
  .object({
    titulo: z.string().trim().min(2, "Título muy corto.").max(80),
    contenido: z.string().trim().min(2, "Escribe el mensaje.").max(2000),
  })
  .strict();

async function plantillaDelEspacio(crm, id) {
  if (!esId(id)) throw noEncontrado("Plantilla no encontrada.");
  const d = duenoEspacio(crm);
  const { rows } = await pool.query(`SELECT * FROM crm_plantillas WHERE id = $1 AND ${d.col} = $2`, [id, d.val]);
  if (!rows[0]) throw noEncontrado("Plantilla no encontrada.");
  return rows[0];
}

// Editar o borrar: quien la creó, o el admin de la org (en personal, el dueño).
function puedeModificar(crm, plantilla) {
  if (crm.tipo === "personal" || crm.rolEnOrg === "agency_admin") return true;
  return Number(plantilla.creado_por_id) === Number(crm.usuarioId);
}

export const listarPlantillas = async (req, res) => {
  const d = duenoEspacio(req.crm);
  const { rows } = await pool.query(
    `SELECT t.id, t.titulo, t.contenido, t.usos, t.creado_por_id, u.name AS creado_por_nombre, t.updated_at
     FROM crm_plantillas t LEFT JOIN usuarios u ON u.id = t.creado_por_id
     WHERE t.${d.col} = $1 ORDER BY t.usos DESC, t.titulo LIMIT 200`,
    [d.val],
  );
  res.json({ success: true, data: rows.map((r) => ({ ...r, editable: puedeModificar(req.crm, r) })) });
};

export const crearPlantilla = async (req, res) => {
  const v = validar(plantillaSchema, req.body);
  const d = duenoEspacio(req.crm);
  const { rows } = await pool.query(
    `INSERT INTO crm_plantillas (${d.col}, titulo, contenido, creado_por_id)
     VALUES ($1, $2, $3, $4) RETURNING id, titulo, contenido, usos`,
    [d.val, v.titulo, v.contenido, req.crm.usuarioId],
  );
  res.status(201).json({ success: true, message: "Plantilla creada.", data: rows[0] });
};

export const actualizarPlantilla = async (req, res) => {
  const t = await plantillaDelEspacio(req.crm, req.params.id);
  if (!puedeModificar(req.crm, t)) throw prohibido("Solo quien creó la plantilla o un administrador puede editarla.");
  const v = validar(plantillaSchema.partial(), req.body);
  const { rows } = await pool.query(
    `UPDATE crm_plantillas SET titulo = COALESCE($1, titulo), contenido = COALESCE($2, contenido), updated_at = now()
     WHERE id = $3 RETURNING id, titulo, contenido, usos`,
    [v.titulo ?? null, v.contenido ?? null, t.id],
  );
  res.json({ success: true, message: "Plantilla actualizada.", data: rows[0] });
};

export const eliminarPlantilla = async (req, res) => {
  const t = await plantillaDelEspacio(req.crm, req.params.id);
  if (!puedeModificar(req.crm, t)) throw prohibido("Solo quien creó la plantilla o un administrador puede borrarla.");
  await pool.query("DELETE FROM crm_plantillas WHERE id = $1", [t.id]);
  res.json({ success: true, message: "Plantilla eliminada.", data: { id: t.id } });
};

// Cuenta un uso (ordena la lista por las más usadas).
export const usarPlantilla = async (req, res) => {
  const t = await plantillaDelEspacio(req.crm, req.params.id);
  await pool.query("UPDATE crm_plantillas SET usos = usos + 1 WHERE id = $1", [t.id]);
  res.json({ success: true, data: { id: t.id } });
};
