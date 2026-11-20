// src/lib/archivos.js — tipo REAL de un archivo por sus primeros bytes.
//
// El mimetype que manda el navegador lo puede poner cualquiera (hallazgo N-17
// de la auditoría). Para documentos privados se valida la firma del archivo.
const FIRMAS = [
  { mime: "application/pdf", ext: "pdf", ok: (b) => b.subarray(0, 5).toString("latin1") === "%PDF-" },
  { mime: "image/jpeg", ext: "jpg", ok: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    mime: "image/png",
    ext: "png",
    ok: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    mime: "image/webp",
    ext: "webp",
    ok: (b) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP",
  },
];

// → { mime, ext } o null si no es PDF/JPG/PNG/WEBP.
export function detectarTipoDocumento(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  const f = FIRMAS.find((x) => x.ok(buffer));
  return f ? { mime: f.mime, ext: f.ext } : null;
}

// Nombre seguro para mostrar y para Content-Disposition: sin rutas, sin
// caracteres de control ni comillas, máximo 150 caracteres.
export function nombreArchivoSeguro(nombre, ext) {
  const base = String(nombre ?? "")
    .split(/[\\/]/)
    .pop()
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f"<>|*?:]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 150);
  const sinExt = base.replace(/\.[a-z0-9]{1,5}$/i, "") || "documento";
  return `${sinExt}.${ext}`;
}
