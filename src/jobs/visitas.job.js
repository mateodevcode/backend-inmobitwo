// src/jobs/visitas.job.js — recordatorios de visitas del CRM cada 5 min.
// Activo por defecto; VISITAS_CRON_ENABLED=false para apagarlo (p. ej. al
// levantar el backend en local contra una BD compartida).
import cron from "node-cron";
import { enviarRecordatoriosVisitas } from "../lib/visitas/recordatorios.js";

export function iniciarCronVisitas() {
  if (process.env.VISITAS_CRON_ENABLED === "false") {
    console.log("[visitas] cron desactivado (VISITAS_CRON_ENABLED=false)");
    return;
  }
  cron.schedule(
    "*/5 * * * *",
    async () => {
      try {
        const { enviados } = await enviarRecordatoriosVisitas();
        if (enviados > 0) console.log(`[visitas] recordatorios enviados: ${enviados}`);
      } catch (e) {
        console.error("[visitas] cron:", e?.message ?? e);
      }
    },
    { timezone: "America/Bogota" },
  );
  console.log("[visitas] cron de recordatorios programado (*/5 min)");
}
