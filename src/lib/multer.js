// lib/multer.js
import multer from "multer";

const storage = multer.memoryStorage(); // guarda el archivo en RAM como buffer, perfecto para subir directo a S3

export const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB máximo
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Solo se permiten imágenes"));
    }
    cb(null, true);
  },
});
