// src/lib/avisosCorreo.js — avisos del CRM por correo (migración 030).
//
// Cada pasada del cron toma los avisos que siguen sin leer y sin enviar, con
// más de ESPERA_MINUTOS (si el usuario está en el CRM y los lee antes, no hay
// correo) y menos de VENTANA_HORAS, y manda UN correo por usuario con todos.
// Se saltan los tipos que ya tienen su propio correo y a quien lo apagó en
// Ajustes. Los avisos se "reservan" marcando correo_enviado_at antes de enviar
// (dos procesos no mandan el mismo); si el envío falla, se liberan para la
// siguiente pasada.
import { pool } from "../db.js";
import { BREVO_EMAIL_NO_REPLY, CRM_URL } from "../config.js";
import { createTransporter } from "../utils/createTransporter.js";
import {
  asuntoResumenAvisos,
  htmlResumenAvisos,
  textoResumenAvisos,
} from "../utils/emails/resumenAvisos.js";

// lead_nuevo: correo de nuevoLead (tracking). demanda_coincidencias: resumen diario de demandas.
export const TIPOS_CON_CORREO_PROPIO = ["lead_nuevo", "demanda_coincidencias"];
export const ESPERA_MINUTOS = 2;
export const VENTANA_HORAS = 24;
const MAX_POR_PASADA = 500;

// Filas reservadas → Map(usuario_id → { email, nombre, avisos[] }).
export function agruparPorUsuario(filas) {
  const porUsuario = new Map();
  for (const f of filas) {
    if (!porUsuario.has(f.usuario_id)) {
      porUsuario.set(f.usuario_id, { email: f.email, nombre: f.nombre, avisos: [] });
    }
    porUsuario.get(f.usuario_id).avisos.push({
      id: f.id,
      titulo: f.titulo,
      cuerpo: f.cuerpo,
      url: f.url,
      organizacion: f.organizacion,
    });
  }
  for (const u of porUsuario.values()) u.avisos.sort((a, b) => Number(b.id) - Number(a.id));
  return porUsuario;
}

export async function enviarAvisosPorCorreo({ transporter = createTransporter(), db = pool } = {}) {
  const { rows } = await db.query(
    `WITH pendientes AS (
       SELECT n.id
       FROM crm_notificaciones n
       JOIN usuarios u ON u.id = n.usuario_id
       LEFT JOIN crm_preferencias_avisos p ON p.usuario_id = n.usuario_id
       WHERE n.correo_enviado_at IS NULL AND n.leida_at IS NULL
         AND n.created_at < now() - make_interval(mins => $2)
         AND n.created_at > now() - make_interval(hours => $3)
         AND n.tipo <> ALL($1::text[])
         AND COALESCE(p.correo, true)
         AND u.email IS NOT NULL
       ORDER BY n.id
       LIMIT $4
       FOR UPDATE OF n SKIP LOCKED
     )
     UPDATE crm_notificaciones n SET correo_enviado_at = now()
     FROM pendientes, usuarios u
     WHERE n.id = pendientes.id AND u.id = n.usuario_id
     RETURNING n.id, n.usuario_id, n.titulo, n.cuerpo, n.url, u.email, u.name AS nombre,
       (SELECT o.nombre FROM organizaciones o WHERE o.id = n.organizacion_id) AS organizacion`,
    [TIPOS_CON_CORREO_PROPIO, ESPERA_MINUTOS, VENTANA_HORAS, MAX_POR_PASADA],
  );
  if (!rows.length) return { avisos: 0, correos: 0, fallidos: 0 };

  let correos = 0;
  let fallidos = 0;
  for (const { email, nombre, avisos } of agruparPorUsuario(rows).values()) {
    try {
      await transporter.sendMail({
        from: `"Inmobitwo CRM" <${BREVO_EMAIL_NO_REPLY}>`,
        to: email,
        subject: asuntoResumenAvisos(avisos),
        html: htmlResumenAvisos({ nombre, avisos, crmUrl: CRM_URL }),
        text: textoResumenAvisos({ avisos, crmUrl: CRM_URL }),
      });
      correos++;
    } catch (e) {
      fallidos++;
      console.error("[avisos-correo] envío falló:", e?.message ?? e);
      // Se liberan para reintentar en la siguiente pasada (si siguen en la ventana).
      await db
        .query("UPDATE crm_notificaciones SET correo_enviado_at = NULL WHERE id = ANY($1::bigint[])", [
          avisos.map((a) => a.id),
        ])
        .catch(() => {});
    }
  }
  return { avisos: rows.length, correos, fallidos };
}

// Preferencias del usuario (sin fila = recibir correo).
export async function leerPreferenciasAvisos(usuarioId, db = pool) {
  const { rows } = await db.query("SELECT correo FROM crm_preferencias_avisos WHERE usuario_id = $1", [usuarioId]);
  return { correo: rows[0]?.correo ?? true };
}

export async function guardarPreferenciasAvisos(usuarioId, { correo }, db = pool) {
  await db.query(
    `INSERT INTO crm_preferencias_avisos (usuario_id, correo, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (usuario_id) DO UPDATE SET correo = EXCLUDED.correo, updated_at = now()`,
    [usuarioId, Boolean(correo)],
  );
  return { correo: Boolean(correo) };
}
