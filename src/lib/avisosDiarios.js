// src/lib/avisosDiarios.js — avisos del CRM que dependen de la fecha (cron diario).
import { pool } from "../db.js";
import { notificar } from "./notificaciones.js";

const DIAS_AVISO_CAPTACION = 7;

// Captaciones vigentes que vencen en los próximos 7 días (o hoy), una vez por
// captación y fecha de vencimiento (si se renueva, vuelve a avisar).
export async function avisarCaptacionesPorVencer(db = pool) {
  const { rows } = await db.query(
    `SELECT k.id, k.organizacion_id, k.vence_el::text AS vence_el,
            COALESCE(k.asignado_a_id, k.creado_por_id, k.usuario_id) AS destinatario,
            (k.vence_el - (now() AT TIME ZONE 'America/Bogota')::date) AS dias,
            p.titulo
     FROM crm_captaciones k JOIN propiedades p ON p.id = k.propiedad_id
     WHERE k.estado IN ('en_captacion', 'activa') AND k.vence_el IS NOT NULL
       AND k.vence_el BETWEEN (now() AT TIME ZONE 'America/Bogota')::date
                          AND (now() AT TIME ZONE 'America/Bogota')::date + $1::int`,
    [DIAS_AVISO_CAPTACION],
  );
  let creados = 0;
  for (const k of rows) {
    creados += await notificar(
      {
        destinatarios: [k.destinatario],
        organizacionId: k.organizacion_id ?? null,
        tipo: "captacion_por_vencer",
        titulo: k.dias === 0 ? "Una captación vence hoy" : `Una captación vence en ${k.dias} ${k.dias === 1 ? "día" : "días"}`,
        cuerpo: `${k.titulo ?? "Inmueble"}. Renuévala con el propietario o ciérrala.`,
        url: "/captaciones",
        clave: `captacion-vence:${k.id}:${k.vence_el}`,
      },
      db,
    );
  }
  return creados;
}

// Leídas de más de 90 días y no leídas de más de 180 se borran.
export async function purgarNotificaciones(db = pool) {
  const { rowCount } = await db.query(
    `DELETE FROM crm_notificaciones
     WHERE (leida_at IS NOT NULL AND leida_at < now() - interval '90 days')
        OR created_at < now() - interval '180 days'`,
  );
  return rowCount;
}
