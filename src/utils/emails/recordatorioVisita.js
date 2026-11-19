// utils/emails/recordatorioVisita.js — correo al agente antes de una visita.
import { escapeHtml } from "../sanitize.js";

const fmtHora = (iso) =>
  new Intl.DateTimeFormat("es-CO", {
    timeZone: "America/Bogota",
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));

export function asuntoRecordatorioVisita(v) {
  return `Recordatorio: visita con ${v.contacto_nombre} · ${fmtHora(v.inicio_at)}`;
}

export function htmlRecordatorioVisita(v, crmUrl) {
  const fila = (etiqueta, valor) =>
    valor ? `<p style="margin:4px 0;"><strong>${etiqueta}:</strong> ${escapeHtml(valor)}</p>` : "";
  const enlace = crmUrl ? `${crmUrl.replace(/\/$/, "")}/agenda?visita=${v.id}` : null;
  return `
    <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto;">
      <h2 style="color:#111;">Tienes una visita pronto</h2>
      <p>Hola ${escapeHtml(v.agente_nombre) || ""},</p>
      <p>Te recordamos tu visita del <strong>${escapeHtml(fmtHora(v.inicio_at))}</strong>.</p>
      <div style="background:#f5f5f5;border-radius:8px;padding:16px;margin:16px 0;">
        ${fila("Cliente", v.contacto_nombre)}
        ${fila("Celular", v.contacto_telefono)}
        ${fila("Inmueble", v.propiedad_titulo)}
        ${fila("Lugar", v.lugar)}
        ${fila("Notas", v.notas)}
      </div>
      ${enlace ? `<p><a href="${escapeHtml(enlace)}" style="color:#2563eb;">Ver en la agenda del CRM</a></p>` : ""}
    </div>`;
}

export function textoRecordatorioVisita(v) {
  return [
    `Visita: ${fmtHora(v.inicio_at)}`,
    `Cliente: ${v.contacto_nombre}${v.contacto_telefono ? ` (${v.contacto_telefono})` : ""}`,
    v.propiedad_titulo ? `Inmueble: ${v.propiedad_titulo}` : null,
    v.lugar ? `Lugar: ${v.lugar}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}
