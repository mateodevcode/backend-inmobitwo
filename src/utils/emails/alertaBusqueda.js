// src/utils/emails/alertaBusqueda.js
// Plantilla del email agrupado de búsquedas guardadas (mismo estilo inline que nuevoLead.js).
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const cop = (n) => (n == null ? "" : "$ " + new Intl.NumberFormat("es-CO").format(n));

const ETIQUETA = {
  created: { texto: "Nuevo", color: "#16a34a" },
  price_drop: { texto: "Bajó de precio", color: "#dc2626" },
  relisted: { texto: "Disponible de nuevo", color: "#2563eb" },
};

function tarjeta(it, front) {
  const et = ETIQUETA[it.event_type] || ETIQUETA.created;
  const url = `${front}${it.path}`;
  const precio = it.event_type === "price_drop" && it.precio_anterior
    ? `<span style="text-decoration:line-through;color:#888;font-size:13px">${cop(it.precio_anterior)}</span><br>
       <strong style="font-size:18px;color:#dc2626">${cop(it.precio)}</strong>`
    : `<strong style="font-size:18px">${cop(it.precio)}</strong>`;
  const img = it.imagen
    ? `<img src="${esc(it.imagen)}" width="120" height="90" alt=""
         style="border-radius:8px;object-fit:cover;display:block">`
    : "";
  return `
  <tr><td style="padding:12px 0;border-bottom:1px solid #eee">
    <a href="${esc(url)}" style="text-decoration:none;color:inherit;display:block">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td width="130" valign="top">${img}</td>
      <td valign="top" style="font-family:Arial,sans-serif;padding-left:8px">
        <span style="background:${et.color};color:#fff;font-size:11px;padding:2px 8px;border-radius:10px">${et.texto}</span>
        <div style="font-size:15px;font-weight:bold;margin:6px 0 2px">${esc(it.titulo)}</div>
        <div style="font-size:13px;color:#666">${esc(it.ubicacion)}${it.area ? " · " + esc(it.area) + " m²" : ""}</div>
        <div style="margin-top:6px">${precio}</div>
      </td>
    </tr></table></a>
  </td></tr>`;
}

export function asuntoAlerta({ nombre, total }) {
  return total === 1
    ? `1 novedad para tu búsqueda "${nombre}"`
    : `${total} novedades para tu búsqueda "${nombre}"`;
}

export function htmlAlertaBusqueda({ usuario, busqueda, items, total, front, tokenBaja }) {
  const verTodas = `${front}${busqueda.url_original}`;
  const mas = total > items.length
    ? `<p style="font-family:Arial,sans-serif;font-size:13px;color:#666">Y ${total - items.length} más.</p>` : "";
  return `<!doctype html><html><body style="margin:0;background:#f4f4f5">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
  <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;padding:24px;max-width:100%">
    <tr><td align="center" style="padding:0 0 16px">
      <img src="${front}/logo/logo.png" width="120" alt="Inmobitwo"
        style="display:block;border:0;width:120px;max-width:120px;height:auto">
    </td></tr>
    <tr><td style="font-family:Arial,sans-serif">
      <h2 style="margin:0 0 6px">Hola${usuario?.name ? " " + esc(usuario.name.split(" ")[0]) : ""} 👋</h2>
      <p style="margin:0 0 16px;color:#444">Hay <strong>${total}</strong> ${total === 1 ? "novedad" : "novedades"}
        para tu búsqueda <strong>${esc(busqueda.nombre)}</strong>.</p>
    </td></tr>
    ${items.map((i) => tarjeta(i, front)).join("")}
    <tr><td align="center" style="padding:20px 0 8px">${mas}
      <a href="${esc(verTodas)}" style="background:#000;color:#fff;padding:12px 24px;border-radius:8px;
         text-decoration:none;font-family:Arial,sans-serif;font-weight:bold">Ver todas</a>
    </td></tr>
    <tr><td style="font-family:Arial,sans-serif;font-size:12px;color:#888;padding-top:20px;border-top:1px solid #eee">
      Recibes este correo porque guardaste esta búsqueda en Inmobitwo.<br>
      <a href="${front}/usuario/tus-datos/mis-busquedas">Administrar mis búsquedas</a> ·
      <a href="${front}/busquedas/baja/${tokenBaja}">Dejar de recibir esta alerta</a>
    </td></tr>
  </table></td></tr></table></body></html>`;
}

export function textoAlertaBusqueda({ busqueda, items, total, front, tokenBaja }) {
  const lineas = items.map((i) => `- ${i.titulo} (${i.ubicacion}) ${cop(i.precio)} → ${front}${i.path}`);
  return `${total} novedades para "${busqueda.nombre}":\n\n${lineas.join("\n")}\n\n` +
    `Ver todas: ${front}${busqueda.url_original}\n` +
    `Dejar de recibir: ${front}/busquedas/baja/${tokenBaja}`;
}
