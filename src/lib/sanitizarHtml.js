// src/lib/sanitizarHtml.js — limpia el HTML de descripciones (Tiptap) ANTES
// de guardarlo. Es la defensa del servidor: los frontends también sanitizan
// al pintar, pero ningún HTML con scripts debe llegar a la base de datos.
import sanitizeHtml from "sanitize-html";

const OPCIONES = {
  allowedTags: [
    "p", "br", "strong", "b", "em", "i", "u", "s", "h1", "h2", "h3", "h4",
    "ul", "ol", "li", "a", "blockquote", "code", "pre", "hr", "span",
  ],
  allowedAttributes: { a: ["href", "target", "rel"], "*": ["class"] },
  allowedSchemes: ["http", "https", "mailto", "tel"],
  allowProtocolRelative: false,
  transformTags: {
    a: sanitizeHtml.simpleTransform("a", {
      target: "_blank",
      rel: "noopener noreferrer nofollow",
    }),
  },
};

export function sanitizarHtml(html) {
  if (html === undefined || html === null) return html;
  return sanitizeHtml(String(html), OPCIONES);
}
