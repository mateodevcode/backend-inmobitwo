// src/middleware/ocultarErrores.middleware.js
//
// Red de seguridad para toda la API: ninguna respuesta 5xx devuelve al
// cliente el texto interno del error (mensajes de PostgreSQL, nombres de
// columnas, rutas, etc.). El detalle completo queda en el log del servidor.
//
// Los 4xx no se tocan: son mensajes de validación pensados para el usuario.
// Fuera de producción se conserva `details` para depurar.
const MENSAJE_GENERICO = "Error interno del servidor.";
const esProduccion = () => process.env.NODE_ENV === "production";

export function ocultarErrores5xx(req, res, next) {
  const jsonOriginal = res.json.bind(res);

  res.json = (body) => {
    if (res.statusCode < 500 || !body || typeof body !== "object") {
      return jsonOriginal(body);
    }

    const detalle = body.details ?? body.detalle ?? body.error ?? body.message;
    console.error(`❌ ${res.statusCode} ${req.method} ${req.originalUrl}:`, detalle);

    const limpio = { success: false, error: MENSAJE_GENERICO };
    if (!esProduccion() && detalle !== undefined) limpio.details = detalle;
    return jsonOriginal(limpio);
  };

  next();
}
