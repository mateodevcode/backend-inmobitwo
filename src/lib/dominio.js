// src/lib/dominio.js — validación única de dominios propios.
//
// El dominio termina como argumento de un script con sudo en el VPS
// (ver sshDominios.js), así que SOLO se aceptan nombres DNS estrictos:
// letras, números, guiones y puntos. Nada de espacios, ;, |, $, comillas…
const DOMINIO_RE =
  /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;

// Minúsculas, sin espacios, sin protocolo, sin "www." y sin barra final.
export function normalizarDominio(valor) {
  return String(valor ?? "")
    .toLowerCase()
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "")
    .replace(/^www\./, "");
}

export function esDominioValido(dominio) {
  return typeof dominio === "string" && dominio.length <= 253 && DOMINIO_RE.test(dominio);
}

// Última barrera antes de construir un comando de shell.
export function asegurarDominio(dominio) {
  if (!esDominioValido(dominio)) {
    throw new Error(`Dominio no válido para ejecución remota: ${JSON.stringify(dominio)}`);
  }
  return dominio;
}
