// src/jobs/pagos.job.js
// Reconciliación de pagos Mercado Pago: cada 10 min reconsulta los pagos
// pendientes/in_process con mp_payment_id (10 min a 7 días de antigüedad).
// Cubre webhooks perdidos (p.ej. local sin túnel) y pagos PSE/efectivo.

import cron from "node-cron";
import { reconciliarPagosPendientes } from "../lib/pagos.service.js";

export function iniciarCronPagos() {
  if (process.env.PAGOS_CRON_ENABLED === "false") {
    console.log("[pagos] cron desactivado (PAGOS_CRON_ENABLED=false)");
    return;
  }
  // Sin gate gordo: es un GET de reconsulta, barato; MP nunca cobra de nuevo.
  cron.schedule("*/10 * * * *", async () => {
    try {
      const { revisados } = await reconciliarPagosPendientes();
      if (revisados > 0) console.log(`[pagos] reconciliados: ${revisados}`);
    } catch (e) {
      console.error("[pagos] cron:", e?.message ?? e);
    }
  });
  console.log("[pagos] cron programado (*/10 min)");
}
