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
