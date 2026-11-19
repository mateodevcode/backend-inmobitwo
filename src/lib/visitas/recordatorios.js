// src/lib/visitas/recordatorios.js — envía el correo de recordatorio al
// agente X minutos antes de cada visita activa.
//
// Reserva atómica: un UPDATE … FOR UPDATE SKIP LOCKED marca las visitas como
// enviadas ANTES de mandar el correo, así dos instancias del backend nunca
// envían el mismo recordatorio. Si el envío falla, se libera la marca para
// reintentar en la siguiente pasada (mientras la visita no haya empezado).
import { pool } from "../../db.js";
import { BREVO_EMAIL_NO_REPLY, CRM_URL } from "../../config.js";
import { createTransporter } from "../../utils/createTransporter.js";
import {
  asuntoRecordatorioVisita,
  htmlRecordatorioVisita,
  textoRecordatorioVisita,
} from "../../utils/emails/recordatorioVisita.js";

const LOTE = 50;

export async function reservarRecordatoriosPendientes(db = pool) {
  const { rows } = await db.query(
    `WITH due AS (
       SELECT v.id FROM crm_visitas v
       WHERE v.recordatorio_minutos IS NOT NULL
         AND v.recordatorio_enviado_at IS NULL
         AND v.estado IN ('programada', 'confirmada')
         AND v.inicio_at > now()
         AND v.inicio_at - make_interval(mins => v.recordatorio_minutos) <= now()
       ORDER BY v.inicio_at
       LIMIT ${LOTE}
       FOR UPDATE SKIP LOCKED
     )
     UPDATE crm_visitas v SET recordatorio_enviado_at = now()
     FROM due WHERE v.id = due.id
     RETURNING v.id`,
  );
  if (!rows.length) return [];
  const { rows: visitas } = await db.query(
    `SELECT v.id, v.inicio_at, v.lugar, v.notas,
            c.nombre AS contacto_nombre, c.telefono AS contacto_telefono,
            p.titulo AS propiedad_titulo,
            u.name AS agente_nombre, u.email AS agente_email
     FROM crm_visitas v
     JOIN crm_contactos c ON c.id = v.contacto_id
     LEFT JOIN propiedades p ON p.id = v.propiedad_id
     LEFT JOIN usuarios u ON u.id = v.asignado_a_id
     WHERE v.id = ANY($1)`,
    [rows.map((r) => r.id)],
  );
  return visitas;
}

export async function enviarRecordatoriosVisitas({ transporter = createTransporter() } = {}) {
  const visitas = await reservarRecordatoriosPendientes();
  let enviados = 0;
  for (const v of visitas) {
    if (!v.agente_email) continue; // sin agente con correo: queda marcada, no hay a quién avisar
    try {
      await transporter.sendMail({
        from: `"Inmobitwo CRM" <${BREVO_EMAIL_NO_REPLY}>`,
        to: v.agente_email,
        subject: asuntoRecordatorioVisita(v),
        html: htmlRecordatorioVisita(v, CRM_URL),
        text: textoRecordatorioVisita(v),
      });
      enviados++;
    } catch (e) {
      console.error(`[visitas] recordatorio ${v.id} falló:`, e?.message ?? e);
      await pool.query(
        "UPDATE crm_visitas SET recordatorio_enviado_at = NULL WHERE id = $1 AND inicio_at > now()",
        [v.id],
      );
    }
  }
  return { reservados: visitas.length, enviados };
}
