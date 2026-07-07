// lib/validateApiKey.js
import { APIKEY } from "../config.js";

export function validateApiKey(req, res, next) {
  const apiKey = req.headers["x-api-key"];

  if (!apiKey || apiKey !== APIKEY) {
    return res.status(403).json({
      error: "No autorizado. Acceso restringido a clientes autorizados.",
    });
  }

  next();
}
