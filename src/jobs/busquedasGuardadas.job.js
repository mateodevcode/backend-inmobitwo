// src/jobs/busquedasGuardadas.job.js
import cron from "node-cron";
import { procesarBusquedas } from "../lib/busquedasGuardadas/procesador.js";

export function iniciarCronBusquedas() {
  if (process.env.CRON_BUSQUEDAS_ENABLED !== "true") {
    console.log("[alertas] cron desactivado (CRON_BUSQUEDAS_ENABLED != true)");
    return;
  }
  const opts = { timezone: "America/Bogota" };
  const run = (f) => () => procesarBusquedas(f).catch((e) => console.error(`[alertas] ${f}:`, e));

  cron.schedule("*/15 * * * *", run("inmediata"), opts); // cada 15 min
  cron.schedule("0 8 * * *", run("diaria"), opts);       // todos los días 8:00 Bogotá
  cron.schedule("0 8 * * 1", run("semanal"), opts);      // lunes 8:00 Bogotá
  console.log("[alertas] cron programado");
}
