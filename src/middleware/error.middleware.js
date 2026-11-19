// src/middleware/error.middleware.js — manejador global de errores.
// Recibe lo que lanzan los handlers (Express 5 incluye las promesas
// rechazadas). Un HttpError (lib/errores.js) responde con su status y mensaje;
// cualquier otro error es un 500 con mensaje genérico.
export function errorHandler(err, req, res, next) {
  // Manejo específico para archivos demasiado grandes (Multer)
  if (err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({
      success: false,
      error:
        "Esta imagen pesa demasiado (máx. 15MB). Cámbiala o redúcela e inténtalo de nuevo.",
    });
  }

  const status = err.status || err.statusCode || 500;

  if (status >= 500) {
    console.error(`❌ ${status} ${req.method} ${req.originalUrl}:`, err.stack || err);
  }

  res.status(status).json({
    success: false,
    // HttpError puede traer un array de mensajes de validación en err.error.
    error: status >= 500 ? "Error interno del servidor." : (err.error ?? err.message) || "Error",
    ...(process.env.NODE_ENV !== "production" && status >= 500 && { details: err.message }),
  });
}
