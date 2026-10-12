import { pool } from "../db.js";
import { crearTokenUsuario, publicarAUsuario } from "../lib/socketCore.js";

const parseId = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Devuelve la conversación si el usuario participa; null si no existe
// o es ajena (404 en ambos casos para no revelar su existencia).
const conversacionDe = async (id, uid) => {
  const { rows } = await pool.query(
    "SELECT * FROM chat_conversaciones WHERE id = $1",
    [id],
  );
  const c = rows[0];
  if (!c || (c.interesado_id !== uid && c.publicador_id !== uid)) return null;
  return c;
};

const mensajePublico = (m) => ({
  id: Number(m.id),
  remitenteId: m.remitente_id,
  contenido: m.contenido,
  createdAt: m.created_at,
  leidoAt: m.leido_at,
  clientMsgId: m.client_msg_id,
});

// ────────────────────────────────────────────────────────────────
// POST /chat/token
// Token WS del canal personal del usuario.
// ────────────────────────────────────────────────────────────────
export const getTokenChat = async (req, res) => {
  try {
    const datos = await crearTokenUsuario(req.usuario.id);
    if (!datos) {
      return res.status(502).json({
        success: false,
        error: "No se pudo preparar el chat en este momento.",
      });
    }
    res.status(200).json({ success: true, data: datos });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      error: "Error al preparar el chat.",
    });
  }
};

// ────────────────────────────────────────────────────────────────
// POST /chat/conversaciones { propiedadId }
// Obtiene o crea la conversación (interesado, anuncio).
// ────────────────────────────────────────────────────────────────
export const crearObtenerConversacion = async (req, res) => {
  try {
    const uid = req.usuario.id;
    const propiedadId = parseId(req.body?.propiedadId);
    if (!propiedadId) {
      return res.status(400).json({
        success: false,
        error: "propiedadId es requerido y debe ser válido.",
      });
    }

    const { rows: propRows } = await pool.query(
      `SELECT id, titulo, direccion, estado, how_to_contact, publicado_por_id
       FROM propiedades WHERE id = $1`,
      [propiedadId],
    );
    const prop = propRows[0];
    if (!prop) {
      return res.status(404).json({
        success: false,
        error: "Propiedad no encontrada.",
      });
    }

    const { rows: ya } = await pool.query(
      `SELECT id FROM chat_conversaciones
       WHERE propiedad_id = $1 AND interesado_id = $2`,
      [propiedadId, uid],
    );
    if (ya.length > 0) {
      return res
        .status(200)
        .json({ success: true, data: { id: Number(ya[0].id), creada: false } });
    }

    if (prop.estado !== "publicado") {
      return res.status(400).json({
        success: false,
        error: "Este anuncio ya no está publicado.",
      });
    }
    if (prop.how_to_contact === "solo_telefono") {
      return res.status(400).json({
        success: false,
        error: "Este anuncio solo admite contacto por teléfono.",
      });
    }
    if (prop.publicado_por_id === uid) {
      return res.status(400).json({
        success: false,
        error: "No puedes chatear con tu propio anuncio.",
      });
    }

    const tituloRespaldo = prop.titulo || prop.direccion || "Anuncio";
    const { rows: ins } = await pool.query(
      `INSERT INTO chat_conversaciones
         (propiedad_id, propiedad_titulo, interesado_id, publicador_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (propiedad_id, interesado_id) DO NOTHING
       RETURNING id`,
      [propiedadId, tituloRespaldo, uid, prop.publicado_por_id],
    );
    // Carrera entre dos clics: otro request la creó primero.
    const fila =
      ins[0] ??
      (
        await pool.query(
          `SELECT id FROM chat_conversaciones
           WHERE propiedad_id = $1 AND interesado_id = $2`,
          [propiedadId, uid],
        )
      ).rows[0];
    if (!fila) {
      return res.status(500).json({
        success: false,
        error: "No se pudo crear la conversación.",
      });
    }
    res.status(201).json({
      success: true,
      data: { id: Number(fila.id), creada: Boolean(ins[0]) },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      error: "Error al crear la conversación.",
    });
  }
};

// ────────────────────────────────────────────────────────────────
// GET /chat/conversaciones
// Lista del usuario en una sola consulta (sin N+1).
// ────────────────────────────────────────────────────────────────
export const listarConversaciones = async (req, res) => {
  try {
    const uid = req.usuario.id;
    const { rows } = await pool.query(
      `SELECT c.*,
              ou.id AS otro_id, ou.name AS otro_nombre, ou.image_url AS otro_imagen,
              p.id AS prop_id, p.titulo AS prop_titulo, p.estado AS prop_estado,
              (SELECT pg.url FROM propiedades_galeria pg
               WHERE pg.propiedad_id = p.id ORDER BY pg.orden ASC LIMIT 1) AS portada_url
       FROM chat_conversaciones c
       LEFT JOIN propiedades p ON p.id = c.propiedad_id
       JOIN usuarios ou ON ou.id = CASE WHEN c.interesado_id = $1
         THEN c.publicador_id ELSE c.interesado_id END
       WHERE c.interesado_id = $1
          OR (c.publicador_id = $1 AND c.ultimo_mensaje_at IS NOT NULL)
       ORDER BY COALESCE(c.ultimo_mensaje_at, c.created_at) DESC`,
      [uid],
    );

    const data = rows.map((c) => {
      const soyInteresado = c.interesado_id === uid;
      const disponible = c.prop_id != null && c.prop_estado === "publicado";
      return {
        id: Number(c.id),
        otraPersona: {
          id: c.otro_id,
          nombre: c.otro_nombre,
          imagenUrl: c.otro_imagen,
        },
        propiedad: {
          id: c.prop_id,
          titulo: c.prop_titulo ?? c.propiedad_titulo,
          portadaUrl: c.portada_url ?? null,
          disponible,
        },
        ultimoMensaje: c.ultimo_mensaje_texto
          ? {
              texto: c.ultimo_mensaje_texto,
              at: c.ultimo_mensaje_at,
              deMi: c.ultimo_mensaje_de === uid,
            }
          : null,
        noLeidos: soyInteresado
          ? c.no_leidos_interesado
          : c.no_leidos_publicador,
      };
    });
    res.status(200).json({ success: true, data, total: data.length });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      error: "Error al listar las conversaciones.",
    });
  }
};

// ────────────────────────────────────────────────────────────────
// GET /chat/conversaciones/:id/mensajes?antesDe=&limite=30
// ────────────────────────────────────────────────────────────────
export const listarMensajes = async (req, res) => {
  try {
    const uid = req.usuario.id;
    const id = parseId(req.params.id);
    if (!id) {
      return res.status(400).json({
        success: false,
        error: "Conversación inválida.",
      });
    }
    const conv = await conversacionDe(id, uid);
    if (!conv) {
      return res.status(404).json({
        success: false,
        error: "Conversación no encontrada.",
      });
    }
    const antesDe = req.query.antesDe ? parseId(req.query.antesDe) : null;
    if (req.query.antesDe && !antesDe) {
      return res.status(400).json({
        success: false,
        error: "antesDe debe ser un id de mensaje válido.",
      });
    }
    const limite = Math.min(
      Math.max(parseInt(req.query.limite, 10) || 30, 1),
      50,
    );
    const { rows } = await pool.query(
      `SELECT id, remitente_id, contenido, created_at, leido_at, client_msg_id
       FROM chat_mensajes
       WHERE conversacion_id = $1 AND ($2::bigint IS NULL OR id < $2)
       ORDER BY id DESC LIMIT $3`,
      [id, antesDe, limite],
    );
    res.status(200).json({
      success: true,
      data: {
        mensajes: rows.reverse().map(mensajePublico),
        hayMas: rows.length === limite,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      error: "Error al cargar los mensajes.",
    });
  }
};

// ────────────────────────────────────────────────────────────────
// POST /chat/conversaciones/:id/mensajes { contenido, clientMsgId }
// Guarda (idempotente por clientMsgId) y publica al receptor.
// ────────────────────────────────────────────────────────────────
export const enviarMensaje = async (req, res) => {
  const client = await pool.connect();
  try {
    const uid = req.usuario.id;
    const id = parseId(req.params.id);
    const contenido = req.body?.contenido?.trim?.() ?? "";
    const clientMsgId = req.body?.clientMsgId;
    if (!id) {
      return res.status(400).json({
        success: false,
        error: "Conversación inválida.",
      });
    }
    if (!contenido || contenido.length > 2000) {
      return res.status(400).json({
        success: false,
        error: "El mensaje debe tener entre 1 y 2000 caracteres.",
      });
    }
    if (!clientMsgId || !UUID_RE.test(clientMsgId)) {
      return res.status(400).json({
        success: false,
        error: "clientMsgId debe ser un UUID válido.",
      });
    }

    await client.query("BEGIN");
    const { rows: convRows } = await client.query(
      "SELECT * FROM chat_conversaciones WHERE id = $1 FOR UPDATE",
      [id],
    );
    const conv = convRows[0];
    if (
      !conv ||
      (conv.interesado_id !== uid && conv.publicador_id !== uid)
    ) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        success: false,
        error: "Conversación no encontrada.",
      });
    }

    const { rows: ins } = await client.query(
      `INSERT INTO chat_mensajes (conversacion_id, remitente_id, contenido, client_msg_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT ON CONSTRAINT chat_msg_idempotencia DO NOTHING
       RETURNING *`,
      [id, uid, contenido, clientMsgId],
    );
    // Reintento con el mismo clientMsgId: devuelve el existente sin republicar.
    if (ins.length === 0) {
      const { rows: previo } = await client.query(
        `SELECT id, remitente_id, contenido, created_at, leido_at, client_msg_id
         FROM chat_mensajes
         WHERE conversacion_id = $1 AND remitente_id = $2 AND client_msg_id = $3`,
        [id, uid, clientMsgId],
      );
      await client.query("COMMIT");
      return res
        .status(200)
        .json({ success: true, data: mensajePublico(previo[0]) });
    }

    const soyInteresado = conv.interesado_id === uid;
    const receptorId = soyInteresado ? conv.publicador_id : conv.interesado_id;
    const columnaNoLeidos = soyInteresado
      ? "no_leidos_publicador"
      : "no_leidos_interesado";
    await client.query(
      `UPDATE chat_conversaciones
       SET ultimo_mensaje_texto = left($2, 200),
           ultimo_mensaje_de = $3,
           ultimo_mensaje_at = now(),
           updated_at = now(),
           ${columnaNoLeidos} = ${columnaNoLeidos} + 1
       WHERE id = $1`,
      [id, contenido, uid],
    );
    await client.query("COMMIT");

    // Publica al receptor sin bloquear la respuesta.
    publicarAUsuario(receptorId, {
      type: "mensaje_nuevo",
      conversacionId: Number(id),
      mensaje: mensajePublico(ins[0]),
    }).catch(() => {});

    res.status(201).json({ success: true, data: mensajePublico(ins[0]) });
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // la transacción ya estaba cerrada
    }
    console.error(error);
    res.status(500).json({
      success: false,
      error: "Error al enviar el mensaje.",
    });
  } finally {
    client.release();
  }
};

// ────────────────────────────────────────────────────────────────
// POST /chat/conversaciones/:id/leer
// ────────────────────────────────────────────────────────────────
export const marcarLeida = async (req, res) => {
  const client = await pool.connect();
  try {
    const uid = req.usuario.id;
    const id = parseId(req.params.id);
    if (!id) {
      return res.status(400).json({
        success: false,
        error: "Conversación inválida.",
      });
    }
    const { rows: convRows } = await client.query(
      "SELECT * FROM chat_conversaciones WHERE id = $1",
      [id],
    );
    const conv = convRows[0];
    if (
      !conv ||
      (conv.interesado_id !== uid && conv.publicador_id !== uid)
    ) {
      return res.status(404).json({
        success: false,
        error: "Conversación no encontrada.",
      });
    }

    await client.query("BEGIN");
    const columna =
      conv.interesado_id === uid
        ? "no_leidos_interesado"
        : "no_leidos_publicador";
    await client.query(
      `UPDATE chat_conversaciones SET ${columna} = 0 WHERE id = $1`,
      [id],
    );
    await client.query(
      `UPDATE chat_mensajes SET leido_at = now()
       WHERE conversacion_id = $1 AND remitente_id <> $2 AND leido_at IS NULL`,
      [id, uid],
    );
    await client.query("COMMIT");

    const otroId =
      conv.interesado_id === uid ? conv.publicador_id : conv.interesado_id;
    publicarAUsuario(otroId, {
      type: "leido",
      conversacionId: Number(id),
    }).catch(() => {});

    res.status(200).json({ success: true });
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // la transacción ya estaba cerrada
    }
    console.error(error);
    res.status(500).json({
      success: false,
      error: "Error al marcar como leído.",
    });
  } finally {
    client.release();
  }
};

// ────────────────────────────────────────────────────────────────
// GET /chat/no-leidos -> { total }
// ────────────────────────────────────────────────────────────────
export const contarNoLeidos = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT COALESCE(SUM(CASE WHEN interesado_id = $1
         THEN no_leidos_interesado ELSE no_leidos_publicador END), 0) AS total
       FROM chat_conversaciones
       WHERE interesado_id = $1 OR publicador_id = $1`,
      [req.usuario.id],
    );
    res
      .status(200)
      .json({ success: true, data: { total: Number(rows[0].total) } });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      error: "Error al contar no leídos.",
    });
  }
};
