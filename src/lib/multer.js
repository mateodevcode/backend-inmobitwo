// lib/multer.js
import multer from "multer";
import { detectarTipoImagen } from "./archivos.js";

const storage = multer.memoryStorage(); // guarda el archivo en RAM como buffer, perfecto para subir directo a S3

const MB = 1024 * 1024;
const MIMES_IMAGEN = ["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif"];
const ERROR_IMAGEN = "Solo se permiten imágenes JPG, PNG, WEBP, AVIF o GIF.";

// Fotos de anuncios y avatares. 10 MB por archivo (el mismo tope que ya
// aplicaban los controladores) y como mucho 41 archivos por petición.
// El mimetype del navegador es solo un primer filtro: el tipo real lo
// comprueba exigirImagenesReales por los bytes (auditoría N-17).
export function filtroImagen(req, file, cb) {
  const ok = MIMES_IMAGEN.includes(file.mimetype);
  cb(ok ? null : Object.assign(new Error(ERROR_IMAGEN), { status: 400 }), ok);
}

export const upload = multer({ storage, limits: { fileSize: 10 * MB, files: 41 }, fileFilter: filtroImagen });

// Va después de upload.fields/single: rechaza (400) cualquier archivo cuyos
// bytes no sean una imagen permitida y fija el Content-Type al tipo real, que
// es el que luego se guarda en S3.
export function exigirImagenesReales(req, res, next) {
  const archivos = [
    ...(req.file ? [req.file] : []),
    ...(Array.isArray(req.files) ? req.files : Object.values(req.files ?? {}).flat()),
  ];
  for (const f of archivos) {
    const tipo = detectarTipoImagen(f.buffer);
    if (!tipo) return res.status(400).json({ success: false, error: ERROR_IMAGEN });
    f.mimetype = tipo.mime;
  }
  next();
}

// Documentos privados (captaciones): un archivo, máximo 10 MB. El tipo real se
// valida después por sus bytes (lib/archivos.js); aquí solo un primer filtro.
export const uploadDocumento = multer({
  storage,
  limits: { fileSize: 10 * MB, files: 1 },
  fileFilter: (req, file, cb) => {
    const ok = file.mimetype === "application/pdf" || file.mimetype.startsWith("image/");
    cb(ok ? null : Object.assign(new Error("Solo PDF o imágenes."), { status: 400 }), ok);
  },
});
