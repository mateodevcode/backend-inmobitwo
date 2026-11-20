// src/jobs/demandas.job.js — aviso diario (8:30 Bogotá) de inmuebles nuevos que
// coinciden con demandas. Activo por defecto; DEMANDAS_CRON_ENABLED=false lo apaga.
import cron from "node-cron";
import { enviarAvisosDemandas } from "../lib/demandas/avisos.js";

export function iniciarCronDemandas() {
  if (process.env.DEMANDAS_CRON_ENABLED === "false") {
    console.log("[demandas] cron desactivado (DEMANDAS_CRON_ENABLED=false)");
    return;
  }
  cron.schedule(
    "30 8 * * *",
    async () => {
      try {
        const { correos } = await enviarAvisosDemandas();
        if (correos > 0) console.log(`[demandas] avisos enviados: ${correos}`);
      } catch (e) {
        console.error("[demandas] cron:", e?.message ?? e);
      }
    },
    { timezone: "America/Bogota" },
  );
  console.log("[demandas] cron de avisos programado (8:30 Bogotá)");
}
