// utils/emails/resumenAvisos.js — resumen por correo de los avisos del CRM que
// el usuario no ha leído. Un correo por persona y pasada del cron.
import { escapeHtml } from "../sanitize.js";

export const MAX_AVISOS_EN_CORREO = 15;

export function asuntoResumenAvisos(avisos) {
  if (avisos.length === 1) return avisos[0].titulo;
  return `Tienes ${avisos.length} avisos nuevos en el CRM`;
}

// Enlace absoluto al CRM solo para rutas internas ("/contactos/5").
function enlace(crmUrl, ruta) {
  if (!crmUrl || typeof ruta !== "string" || !ruta.startsWith("/") || ruta.startsWith("//")) return null;
  return `${crmUrl.replace(/\/$/, "")}${ruta}`;
}

export function htmlResumenAvisos({ nombre, avisos, crmUrl }) {
  const visibles = avisos.slice(0, MAX_AVISOS_EN_CORREO);
  const resto = avisos.length - visibles.length;
  const filas = visibles
    .map((a) => {
      const url = enlace(crmUrl, a.url);
      return `
        <div style="border:1px solid #e5e5e5;border-radius:8px;padding:12px 16px;margin:10px 0;">
          <p style="margin:0 0 4px;"><strong>${escapeHtml(a.titulo)}</strong></p>
          ${a.cuerpo ? `<p style="margin:0 0 6px;color:#444;">${escapeHtml(a.cuerpo)}</p>` : ""}
          ${a.organizacion ? `<p style="margin:0 0 6px;color:#888;font-size:12px;">${escapeHtml(a.organizacion)}</p>` : ""}
          ${url ? `<a href="${escapeHtml(url)}" style="color:#2563eb;">Abrir en el CRM</a>` : ""}
        </div>`;
    })
    .join("");
  const ajustes = enlace(crmUrl, "/ajustes");
  return `
    <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto;">
      <h2 style="color:#111;">Avisos del CRM</h2>
      <p>Hola ${escapeHtml(nombre) || ""}, esto pasó en el CRM y aún no lo has visto:</p>
      ${filas}
      ${resto > 0 ? `<p style="color:#444;">Y ${resto} ${resto === 1 ? "aviso más" : "avisos más"} en el CRM.</p>` : ""}
      <p style="color:#666;font-size:12px;margin-top:24px;">Puedes dejar de recibir estos correos en
        ${ajustes ? `<a href="${escapeHtml(ajustes)}" style="color:#666;">Ajustes del CRM</a>` : "Ajustes del CRM"}.</p>
    </div>`;
}

export function textoResumenAvisos({ avisos, crmUrl }) {
  const lineas = avisos.slice(0, MAX_AVISOS_EN_CORREO).map((a) => {
    const url = enlace(crmUrl, a.url);
    return `- ${a.titulo}${a.cuerpo ? `: ${a.cuerpo}` : ""}${url ? ` (${url})` : ""}`;
  });
  const resto = avisos.length - lineas.length;
  if (resto > 0) lineas.push(`Y ${resto} más en el CRM.`);
  lineas.push("", "Puedes dejar de recibir estos correos en Ajustes del CRM.");
  return lineas.join("\n");
}
