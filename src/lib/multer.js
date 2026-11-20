// lib/multer.js
import multer from "multer";

const storage = multer.memoryStorage(); // guarda el archivo en RAM como buffer, perfecto para subir directo a S3

export const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB máximo (holgado para fotos de celular reales)
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Solo se permiten imágenes"));
    }
    cb(null, true);
  },
});

// Documentos privados (captaciones): un archivo, máximo 10 MB. El tipo real se
// valida después por sus bytes (lib/archivos.js); aquí solo un primer filtro.
export const uploadDocumento = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const ok = file.mimetype === "application/pdf" || file.mimetype.startsWith("image/");
    cb(ok ? null : Object.assign(new Error("Solo PDF o imágenes."), { status: 400 }), ok);
  },
});
