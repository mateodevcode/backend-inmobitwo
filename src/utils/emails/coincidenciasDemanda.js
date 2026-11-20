// utils/emails/coincidenciasDemanda.js — resumen diario al agente: inmuebles
// nuevos de su cartera que coinciden con demandas de sus clientes.
import { escapeHtml } from "../sanitize.js";

const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

export function asuntoCoincidencias(demandas) {
  const total = demandas.reduce((s, d) => s + d.nuevos, 0);
  return `${plural(total, "inmueble nuevo coincide", "inmuebles nuevos coinciden")} con tus clientes`;
}

export function htmlCoincidencias({ agente, demandas, crmUrl }) {
  const base = crmUrl ? crmUrl.replace(/\/$/, "") : null;
  const filas = demandas
    .map((d) => {
      const enlace = base ? `${base}/demandas?demanda=${d.id}` : null;
      const ejemplos = (d.ejemplos ?? []).filter(Boolean).map((t) => `<li>${escapeHtml(t)}</li>`).join("");
      return `
        <div style="border:1px solid #e5e5e5;border-radius:8px;padding:12px 16px;margin:12px 0;">
          <p style="margin:0 0 4px;"><strong>${escapeHtml(d.contacto_nombre)}</strong> ·
            ${escapeHtml(plural(d.nuevos, "inmueble nuevo", "inmuebles nuevos"))}</p>
          ${ejemplos ? `<ul style="margin:4px 0 8px;padding-left:18px;color:#444;">${ejemplos}</ul>` : ""}
          ${enlace ? `<a href="${escapeHtml(enlace)}" style="color:#2563eb;">Ver coincidencias</a>` : ""}
        </div>`;
    })
    .join("");
  return `
    <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto;">
      <h2 style="color:#111;">Hay inmuebles nuevos para tus clientes</h2>
      <p>Hola ${escapeHtml(agente) || ""}, estos clientes tienen inmuebles nuevos en tu cartera que encajan con lo que buscan:</p>
      ${filas}
      <p style="color:#666;font-size:12px;margin-top:24px;">Puedes apagar este aviso en cada demanda desde el CRM.</p>
    </div>`;
}

export function textoCoincidencias({ demandas }) {
  return demandas
    .map((d) => `${d.contacto_nombre}: ${plural(d.nuevos, "inmueble nuevo", "inmuebles nuevos")}`)
    .join("\n");
}
