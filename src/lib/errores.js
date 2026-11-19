// src/lib/errores.js — errores HTTP de la API.
//
// Express 5 envía al errorHandler global cualquier error lanzado (o promesa
// rechazada) en un handler async, así que los controladores nuevos pueden
// hacer simplemente:
//
//   if (!contacto) throw new HttpError(404, "Contacto no encontrado.");
//
// sin try/catch. El errorHandler responde { success: false, error } con ese
// status; los 5xx salen con mensaje genérico (ver ocultarErrores.middleware).
export class HttpError extends Error {
  // `error` puede ser un string o un array de mensajes de validación.
  constructor(status, error) {
    super(Array.isArray(error) ? error[0] : error);
    this.status = status;
    this.error = error;
  }
}

export const noEncontrado = (msg = "Recurso no encontrado.") => new HttpError(404, msg);
export const prohibido = (msg = "No tienes permisos para esta acción.") => new HttpError(403, msg);
export const solicitudInvalida = (msg) => new HttpError(400, msg);
