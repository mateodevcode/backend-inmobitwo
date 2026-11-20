// src/jobs/notificaciones.job.js — avisos diarios del CRM (8:00 Bogotá):
// captaciones por vencer y limpieza de avisos viejos.
// Activo por defecto; NOTIFICACIONES_CRON_ENABLED=false lo apaga.
import cron from "node-cron";
import { avisarCaptacionesPorVencer, purgarNotificaciones } from "../lib/avisosDiarios.js";

export function iniciarCronNotificaciones() {
  if (process.env.NOTIFICACIONES_CRON_ENABLED === "false") {
    console.log("[notificaciones] cron desactivado (NOTIFICACIONES_CRON_ENABLED=false)");
    return;
  }
  cron.schedule(
    "0 8 * * *",
    async () => {
      try {
        const avisos = await avisarCaptacionesPorVencer();
        const purgadas = await purgarNotificaciones();
        if (avisos || purgadas) console.log(`[notificaciones] captaciones: ${avisos}, purgadas: ${purgadas}`);
      } catch (e) {
        console.error("[notificaciones] cron:", e?.message ?? e);
      }
    },
    { timezone: "America/Bogota" },
  );
  console.log("[notificaciones] cron diario programado (8:00 Bogotá)");
}
