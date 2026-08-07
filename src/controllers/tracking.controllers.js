// controllers/tracking.controllers.js
import { pool } from "../db.js";
import {
  calcularScore,
  calcularPuntosTiempo,
  UMBRAL_LEAD,
} from "../lib/scoring.js";
import { createTransporter } from "../utils/createTransporter.js";
import { nuevoLead as plantillaNuevoLead } from "../utils/emails/nuevoLead.js";
import {
  BREVO_EMAIL_NO_REPLY,
  FRONTEND_URL,
  RUST_TRACKING_URL,
} from "../config.js";

const fetchOrNull = async (...args) => {
  try {
    const { default: fetch } = await import("node-fetch");
    return await fetch(...args);
  } catch {
    // node-fetch not available, try axios
    try {
      const axios = (await import("axios")).default;
      return await axios(...args);
    } catch {
      return null;
    }
  }
};

// ─────────────────────────────────────────────
// Busca a quién notificar (dueño de la propiedad, o agentes de la organización)
// y le envía el correo. Marca el lead como notificado.
// ─────────────────────────────────────────────
const notificarLead = async (lead) => {
  try {
    const { rows: propRows } = await pool.query(
      `SELECT p.titulo, p.publicado_por_id, p.organizacion_id, p.es_de_organizacion
       FROM propiedades p WHERE p.id = $1`,
      [lead.propiedad_id],
    );
    const propiedad = propRows[0];
    if (!propiedad) return;

    let destinatarios = [];

    if (propiedad.es_de_organizacion && propiedad.organizacion_id) {
      const { rows } = await pool.query(
        `SELECT u.email, u.name
         FROM organizacion_miembros om
         JOIN usuarios u ON u.id = om.usuario_id
         WHERE om.organizacion_id = $1 AND om.estado = 'activo'`,
        [propiedad.organizacion_id],
      );
      destinatarios = rows;
    } else {
      const { rows } = await pool.query(
        "SELECT email, name FROM usuarios WHERE id = $1",
        [propiedad.publicado_por_id],
      );
      destinatarios = rows;
    }

    if (destinatarios.length === 0) return;

    const transporter = createTransporter();

    for (const destinatario of destinatarios) {
      if (!destinatario.email) continue;

      const html = plantillaNuevoLead({
        nombreAgente: destinatario.name,
        propiedadTitulo: propiedad.titulo,
        leadNombre: lead.nombre,
        leadEmail: lead.email,
        leadTelefono: lead.telefono,
        score: lead.score,
        origen: lead.origen,
        frontendUrl: FRONTEND_URL?.split(",")[0],
      });

      await transporter.sendMail({
        from: `"Inmobitwo" <${BREVO_EMAIL_NO_REPLY}>`,
        to: destinatario.email,
        subject: `Nuevo lead interesado en "${propiedad.titulo}"`,
        html,
      });
    }

    await pool.query("UPDATE leads SET notificado = true WHERE id = $1", [
      lead.id,
    ]);
  } catch (error) {
    console.error("Error notificando lead:", error.message);
  }
};

// Crea o recupera una sesión de tracking — delegado a Rust
export const registrarSesion = async (req, res) => {
  try {
    if (RUST_TRACKING_URL) {
      const axios = (await import("axios")).default;
      const response = await axios.post(
        `${RUST_TRACKING_URL}/tracking/sesion`,
        req.body,
        { timeout: 5000 },
      );
      return res.status(200).json(response.data);
    }

    // Fallback Express
    const { session_id, consentimiento_dado } = req.body;
    const usuario_id = req.usuario?.id || null;
    const ip_address = req.ip;
    const user_agent = req.headers["user-agent"];

    if (!session_id) {
      return res.status(400).json({
        success: false,
        error: "session_id es requerido.",
      });
    }

    const { rows } = await pool.query(
      `INSERT INTO sesiones_tracking 
        (session_id, usuario_id, ip_address, user_agent, consentimiento_dado)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (session_id) 
       DO UPDATE SET 
         ultima_actividad = CURRENT_TIMESTAMP,
         usuario_id = COALESCE(sesiones_tracking.usuario_id, EXCLUDED.usuario_id)
       RETURNING *`,
      [session_id, usuario_id, ip_address, user_agent, !!consentimiento_dado],
    );

    res.status(200).json({
      success: true,
      message: "Sesión registrada.",
      data: rows[0],
    });
  } catch (error) {
    console.error("Error en POST /tracking/sesion:", error.message);

    // Fallback si Rust no está disponible
    try {
      const { session_id, consentimiento_dado } = req.body;
      const usuario_id = req.usuario?.id || null;
      const ip_address = req.ip;
      const user_agent = req.headers["user-agent"];

      if (!session_id) {
        return res.status(400).json({
          success: false,
          error: "session_id es requerido.",
        });
      }

      const { rows } = await pool.query(
        `INSERT INTO sesiones_tracking 
          (session_id, usuario_id, ip_address, user_agent, consentimiento_dado)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (session_id) 
         DO UPDATE SET 
           ultima_actividad = CURRENT_TIMESTAMP,
           usuario_id = COALESCE(sesiones_tracking.usuario_id, EXCLUDED.usuario_id)
         RETURNING *`,
        [session_id, usuario_id, ip_address, user_agent, !!consentimiento_dado],
      );

      res.status(200).json({
        success: true,
        message: "Sesión registrada (fallback Express).",
        data: rows[0],
      });
    } catch (fallbackError) {
      res.status(500).json({
        success: false,
        error: "Error interno del servidor.",
        details: fallbackError.message,
      });
    }
  }
};

// Registra un evento y evalúa si dispara un lead — delegado a Rust
export const registrarEvento = async (req, res) => {
  try {
    if (RUST_TRACKING_URL) {
      const axios = (await import("axios")).default;
      const response = await axios.post(
        `${RUST_TRACKING_URL}/tracking/evento`,
        req.body,
        { timeout: 5000 },
      );
      return res.status(200).json(response.data);
    }

    // Fallback Express
    const { session_id, propiedad_id, tipo_evento, metadata } = req.body;

    if (!session_id || !propiedad_id || !tipo_evento) {
      return res.status(400).json({
        success: false,
        error: "session_id, propiedad_id y tipo_evento son requeridos.",
      });
    }

    const { rows: sesionRows } = await pool.query(
      "SELECT id, usuario_id, consentimiento_dado FROM sesiones_tracking WHERE session_id = $1",
      [session_id],
    );
    const sesion = sesionRows[0];

    if (!sesion) {
      return res.status(404).json({
        success: false,
        error: "Sesión no encontrada. Llama a /tracking/sesion primero.",
      });
    }

    if (!sesion.consentimiento_dado) {
      return res.status(200).json({
        success: true,
        message: "Evento no registrado: sin consentimiento.",
        data: null,
      });
    }

    await pool.query(
      `INSERT INTO eventos_tracking (sesion_id, propiedad_id, tipo_evento, metadata)
       VALUES ($1, $2, $3, $4)`,
      [sesion.id, propiedad_id, tipo_evento, metadata || {}],
    );

    const { rows: eventosRows } = await pool.query(
      `SELECT tipo_evento, COUNT(*)::int as cantidad
       FROM eventos_tracking
       WHERE sesion_id = $1 AND propiedad_id = $2
       GROUP BY tipo_evento`,
      [sesion.id, propiedad_id],
    );
    const eventosPorTipo = {};
    eventosRows.forEach((r) => (eventosPorTipo[r.tipo_evento] = r.cantidad));

    const { rows: tiempoRows } = await pool.query(
      `SELECT COALESCE(SUM((metadata->>'segundos')::int), 0) AS segundos_totales
       FROM eventos_tracking
       WHERE sesion_id = $1 AND propiedad_id = $2 AND tipo_evento = 'tiempo_en_pagina'`,
      [sesion.id, propiedad_id],
    );
    const segundosTotales = tiempoRows[0]?.segundos_totales || 0;

    const score = Math.round(
      calcularScore(eventosPorTipo) + calcularPuntosTiempo(segundosTotales),
    );

    let leadCreado = null;

    if (score >= UMBRAL_LEAD) {
      let datosUsuario = null;
      if (sesion.usuario_id) {
        const { rows: usuarioRows } = await pool.query(
          "SELECT name, email, telefono FROM usuarios WHERE id = $1",
          [sesion.usuario_id],
        );
        datosUsuario = usuarioRows[0] || null;
      }
      const tieneContacto = !!(datosUsuario?.email || datosUsuario?.telefono);

      const { rows: insertadoRows } = await pool.query(
        `INSERT INTO leads (propiedad_id, sesion_id, usuario_id, nombre, email, telefono, score, origen)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'scoring_comportamiento')
         ON CONFLICT (sesion_id, propiedad_id) DO NOTHING
         RETURNING *`,
        [
          propiedad_id,
          sesion.id,
          sesion.usuario_id,
          datosUsuario?.name || null,
          datosUsuario?.email || null,
          datosUsuario?.telefono || null,
          score,
        ],
      );

      if (insertadoRows.length > 0) {
        leadCreado = insertadoRows[0];

        if (tieneContacto) {
          notificarLead(leadCreado);
        }
      } else {
        const { rows: leadExistenteRows } = await pool.query(
          "SELECT * FROM leads WHERE sesion_id = $1 AND propiedad_id = $2",
          [sesion.id, propiedad_id],
        );
        const leadActual = leadExistenteRows[0];

        if (leadActual) {
          if (!leadActual.email && !leadActual.telefono && tieneContacto) {
            const { rows: actualizadoRows } = await pool.query(
              `UPDATE leads
               SET score = $1, usuario_id = $2, nombre = $3, email = $4, telefono = $5
               WHERE id = $6 RETURNING *`,
              [
                score,
                sesion.usuario_id,
                datosUsuario.name,
                datosUsuario.email,
                datosUsuario.telefono,
                leadActual.id,
              ],
            );
            leadCreado = actualizadoRows[0];
            if (!leadActual.notificado) {
              notificarLead(leadCreado);
            }
          } else {
            await pool.query("UPDATE leads SET score = $1 WHERE id = $2", [
              score,
              leadActual.id,
            ]);
          }
        }
      }
    }

    res.status(200).json({
      success: true,
      message: "Evento registrado.",
      data: { score, leadCreado },
    });
  } catch (error) {
    console.error("Error en POST /tracking/evento:", error.message);

    // Fallback si Rust no está disponible — usar lógica Express original
    try {
      const { session_id, propiedad_id, tipo_evento, metadata } = req.body;

      if (!session_id || !propiedad_id || !tipo_evento) {
        return res.status(400).json({
          success: false,
          error: "session_id, propiedad_id y tipo_evento son requeridos.",
        });
      }

      const { rows: sesionRows } = await pool.query(
        "SELECT id, usuario_id, consentimiento_dado FROM sesiones_tracking WHERE session_id = $1",
        [session_id],
      );
      const sesion = sesionRows[0];

      if (!sesion) {
        return res.status(404).json({
          success: false,
          error: "Sesión no encontrada.",
        });
      }

      if (!sesion.consentimiento_dado) {
        return res.status(200).json({
          success: true,
          message: "Evento no registrado: sin consentimiento.",
          data: null,
        });
      }

      await pool.query(
        `INSERT INTO eventos_tracking (sesion_id, propiedad_id, tipo_evento, metadata)
         VALUES ($1, $2, $3, $4)`,
        [sesion.id, propiedad_id, tipo_evento, metadata || {}],
      );

      const { rows: eventosRows } = await pool.query(
        `SELECT tipo_evento, COUNT(*)::int as cantidad
         FROM eventos_tracking
         WHERE sesion_id = $1 AND propiedad_id = $2
         GROUP BY tipo_evento`,
        [sesion.id, propiedad_id],
      );
      const eventosPorTipo = {};
      eventosRows.forEach((r) => (eventosPorTipo[r.tipo_evento] = r.cantidad));

      const { rows: tiempoRows } = await pool.query(
        `SELECT COALESCE(SUM((metadata->>'segundos')::int), 0) AS segundos_totales
         FROM eventos_tracking
         WHERE sesion_id = $1 AND propiedad_id = $2 AND tipo_evento = 'tiempo_en_pagina'`,
        [sesion.id, propiedad_id],
      );
      const segundosTotales = tiempoRows[0]?.segundos_totales || 0;

      const score = Math.round(
        calcularScore(eventosPorTipo) + calcularPuntosTiempo(segundosTotales),
      );

      res.status(200).json({
        success: true,
        message: "Evento registrado (fallback Express).",
        data: { score },
      });
    } catch (fallbackError) {
      res.status(500).json({
        success: false,
        error: "Error interno del servidor.",
        details: fallbackError.message,
      });
    }
  }
};

// Cuando alguien manda el formulario de contacto directamente (lead inmediato)
export const crearLeadDirecto = async (req, res) => {
  try {
    const { propiedad_id, session_id, nombre, email, telefono, mensaje } =
      req.body;

    if (!propiedad_id || !nombre || (!email && !telefono)) {
      return res.status(400).json({
        success: false,
        error:
          "propiedad_id, nombre y al menos email o telefono son requeridos.",
      });
    }

    let sesion_id_uuid = null;
    if (session_id) {
      const { rows } = await pool.query(
        "SELECT id FROM sesiones_tracking WHERE session_id = $1",
        [session_id],
      );
      sesion_id_uuid = rows[0]?.id || null;
    }

    const { rows } = await pool.query(
      `INSERT INTO leads 
        (propiedad_id, sesion_id, nombre, email, telefono, score, origen, estado)
       VALUES ($1, $2, $3, $4, $5, 20, 'formulario_directo', 'nuevo')
       RETURNING *`,
      [propiedad_id, sesion_id_uuid, nombre, email, telefono],
    );

    const leadCreado = rows[0];

    notificarLead(leadCreado);

    res.status(201).json({
      success: true,
      message: "Lead creado correctamente.",
      data: leadCreado,
    });
  } catch (error) {
    console.error("❌ Error en POST /tracking/lead:", error);
    res.status(500).json({
      success: false,
      error: "Error interno del servidor.",
      details: error.message,
    });
  }
};

// Un visitante anónimo completa sus datos de contacto en el modal,
// para un lead que ya se había generado por scoring sin contacto
export const actualizarContactoLead = async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre, email, telefono } = req.body;

    if (!nombre || (!email && !telefono)) {
      return res.status(400).json({
        success: false,
        error: "nombre y al menos email o telefono son requeridos.",
      });
    }

    const { rows } = await pool.query(
      `UPDATE leads SET nombre = $1, email = $2, telefono = $3
       WHERE id = $4 RETURNING *`,
      [nombre, email || null, telefono || null, id],
    );

    const leadActualizado = rows[0];
    if (!leadActualizado) {
      return res.status(404).json({
        success: false,
        error: "Lead no encontrado.",
      });
    }

    // Recién ahora hay contacto real: si todavía no se había notificado,
    // disparamos el correo al agente/organización
    if (!leadActualizado.notificado) {
      notificarLead(leadActualizado);
    }

    res.status(200).json({
      success: true,
      message: "Contacto actualizado correctamente.",
      data: leadActualizado,
    });
  } catch (error) {
    console.error("❌ Error en PATCH /tracking/lead/:id/contacto:", error);
    res.status(500).json({
      success: false,
      error: "Error interno del servidor.",
      details: error.message,
    });
  }
};

// ─────────────────────────────────────────────
// Devuelve una línea de tiempo legible con todo lo que pasó:
// sesiones creadas, eventos, leads generados, correos enviados
// ─────────────────────────────────────────────
export const getLogsTracking = async (req, res) => {
  try {
    const limite = parseInt(req.query.limit) || 100;

    // 1. Eventos (vista, favorito, clic, etc.)
    const { rows: eventos } = await pool.query(
      `SELECT 
        e.id,
        e.tipo_evento,
        e.metadata,
        e.created_at,
        p.titulo as propiedad_titulo,
        st.session_id,
        u.name as usuario_nombre
       FROM eventos_tracking e
       JOIN propiedades p ON p.id = e.propiedad_id
       JOIN sesiones_tracking st ON st.id = e.sesion_id
       LEFT JOIN usuarios u ON u.id = st.usuario_id
       ORDER BY e.created_at DESC
       LIMIT $1`,
      [limite],
    );

    // 2. Sesiones creadas
    const { rows: sesiones } = await pool.query(
      `SELECT 
        st.id,
        st.session_id,
        st.created_at,
        u.name as usuario_nombre
       FROM sesiones_tracking st
       LEFT JOIN usuarios u ON u.id = st.usuario_id
       ORDER BY st.created_at DESC
       LIMIT $1`,
      [limite],
    );

    // 3. Leads creados (con info de la propiedad)
    const { rows: leads } = await pool.query(
      `SELECT 
        l.id,
        l.score,
        l.origen,
        l.nombre,
        l.email,
        l.telefono,
        l.notificado,
        l.created_at,
        p.titulo as propiedad_titulo
       FROM leads l
       JOIN propiedades p ON p.id = l.propiedad_id
       ORDER BY l.created_at DESC
       LIMIT $1`,
      [limite],
    );

    // 4. Armamos una sola línea de tiempo, cada una con su "tipo" para que el frontend la pinte distinto
    const linea = [];

    sesiones.forEach((s) => {
      linea.push({
        id: `sesion-${s.id}`,
        tipo: "sesion",
        created_at: s.created_at,
        quien: s.usuario_nombre
          ? `Usuario "${s.usuario_nombre}"`
          : `Visitante anónimo (${s.session_id.slice(0, 8)})`,
        mensaje: "inició una nueva sesión de navegación",
      });
    });

    const emojisEvento = {
      vista_propiedad: "👀",
      vista_imagen: "🖼️",
      favorito_agregado: "❤️",
      click_telefono: "📞",
      click_whatsapp: "💬",
      tiempo_en_pagina: "⏱️",
      formulario_enviado: "📝",
    };

    const textosEvento = {
      vista_propiedad: (m, p) => `vio la propiedad "${p}"`,
      vista_imagen: (m, p) => `vio la imagen ${m?.indiceFoto ?? "?"} de "${p}"`,
      favorito_agregado: (m, p) => `agregó a favoritos "${p}"`,
      click_telefono: (m, p) => `hizo clic en teléfono de "${p}"`,
      click_whatsapp: (m, p) => `hizo clic en WhatsApp de "${p}"`,
      tiempo_en_pagina: (m, p) => `estuvo ${m?.segundos ?? "?"}s viendo "${p}"`,
      formulario_enviado: (m, p) => `envió el formulario de "${p}"`,
    };

    eventos.forEach((e) => {
      const quien = e.usuario_nombre
        ? `Usuario "${e.usuario_nombre}"`
        : `Visitante anónimo (${e.session_id.slice(0, 8)})`;
      const texto =
        textosEvento[e.tipo_evento]?.(e.metadata, e.propiedad_titulo) ||
        `generó evento "${e.tipo_evento}" en "${e.propiedad_titulo}"`;

      linea.push({
        id: `evento-${e.id}`,
        tipo: "evento",
        created_at: e.created_at,
        emoji: emojisEvento[e.tipo_evento] || "📌",
        quien,
        mensaje: texto,
      });
    });

    leads.forEach((l) => {
      const origenTexto =
        l.origen === "formulario_directo"
          ? "formulario directo"
          : "comportamiento";
      const contacto =
        l.nombre || l.email || l.telefono
          ? `${l.nombre || ""} ${l.email || ""} ${l.telefono || ""}`.trim()
          : "sin datos de contacto aún";

      linea.push({
        id: `lead-${l.id}`,
        tipo: "lead",
        created_at: l.created_at,
        mensaje: `LEAD generado (${origenTexto}) sobre "${l.propiedad_titulo}" — score: ${l.score} — contacto: ${contacto}${l.notificado ? " — 📧 correo enviado" : ""}`,
      });
    });

    // Ordenar toda la línea de tiempo combinada por fecha, más reciente primero
    linea.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    res.status(200).json({
      success: true,
      message: "Logs de trazabilidad obtenidos.",
      data: linea.slice(0, limite),
    });
  } catch (error) {
    console.error("❌ Error en GET /tracking/logs:", error);
    res.status(500).json({
      success: false,
      error: "Error interno del servidor.",
      details: error.message,
    });
  }
};
