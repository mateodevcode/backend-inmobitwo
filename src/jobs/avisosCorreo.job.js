// src/jobs/avisosCorreo.job.js — cada 5 minutos manda por correo los avisos del
// CRM que siguen sin leer (lib/avisosCorreo.js).
// Activo por defecto; AVISOS_CORREO_CRON_ENABLED=false lo apaga.
import cron from "node-cron";
import { enviarAvisosPorCorreo } from "../lib/avisosCorreo.js";

let enCurso = false;

export function iniciarCronAvisosCorreo() {
  if (process.env.AVISOS_CORREO_CRON_ENABLED === "false") {
    console.log("[avisos-correo] cron desactivado (AVISOS_CORREO_CRON_ENABLED=false)");
    return;
  }
  cron.schedule("*/5 * * * *", async () => {
    if (enCurso) return; // una pasada lenta no se solapa con la siguiente
    enCurso = true;
    try {
      const r = await enviarAvisosPorCorreo();
      if (r.avisos) console.log(`[avisos-correo] avisos: ${r.avisos}, correos: ${r.correos}, fallidos: ${r.fallidos}`);
    } catch (e) {
      console.error("[avisos-correo] cron:", e?.message ?? e);
    } finally {
      enCurso = false;
    }
  });
  console.log("[avisos-correo] cron programado (cada 5 min)");
}
