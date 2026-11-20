// src/lib/demandas/avisos.js — resumen diario por correo de coincidencias nuevas.
//
// Agrupa por agente: un solo correo por agente con todas sus demandas que
// tienen inmuebles nuevos. Tras enviar, adelanta notificado_at de esas
// demandas para no repetir los mismos inmuebles mañana. Si el envío falla,
// no se toca notificado_at y se reintenta en la siguiente pasada.
import { pool } from "../../db.js";
import { BREVO_EMAIL_NO_REPLY, CRM_URL } from "../../config.js";
import { createTransporter } from "../../utils/createTransporter.js";
import {
  asuntoCoincidencias,
  htmlCoincidencias,
  textoCoincidencias,
} from "../../utils/emails/coincidenciasDemanda.js";
import { demandasConNovedades } from "./cruce.js";

export async function enviarAvisosDemandas({ transporter = createTransporter(), db = pool } = {}) {
  const inicio = new Date();
  const filas = await demandasConNovedades(db);
  const porAgente = new Map();
  for (const f of filas) {
    if (!f.agente_email) continue;
    if (!porAgente.has(f.agente_email)) porAgente.set(f.agente_email, { agente: f.agente_nombre, demandas: [] });
    porAgente.get(f.agente_email).demandas.push(f);
  }

  let correos = 0;
  for (const [email, { agente, demandas }] of porAgente) {
    try {
      await transporter.sendMail({
        from: `"Inmobitwo CRM" <${BREVO_EMAIL_NO_REPLY}>`,
        to: email,
        subject: asuntoCoincidencias(demandas),
        html: htmlCoincidencias({ agente, demandas, crmUrl: CRM_URL }),
        text: textoCoincidencias({ demandas }),
      });
      // Solo hasta el inicio de esta pasada: lo creado mientras corría se avisa mañana.
      await db.query("UPDATE crm_demandas SET notificado_at = $1 WHERE id = ANY($2::bigint[])", [
        inicio,
        demandas.map((d) => d.id),
      ]);
      correos++;
    } catch (e) {
      console.error("[demandas] aviso falló:", e?.message ?? e);
    }
  }
  return { demandas: filas.length, correos };
}
