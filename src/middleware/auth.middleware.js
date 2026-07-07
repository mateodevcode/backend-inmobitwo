// src/middleware/auth.middleware.js
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../config.js";

// ─────────────────────────────────────────────
// Verifica que el access_token sea válido
// Uso: router.get("/ruta", verificarToken, controlador)
// ─────────────────────────────────────────────
export const verificarToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader?.split(" ")[1];

  if (!token) {
    return res.status(401).json({
      success: false,
      error: "Acceso denegado. Token requerido.",
    });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.usuario = decoded;
    next();
  } catch (error) {
    // ✅ Distinguir token expirado de token manipulado
    const expirado = error.name === "TokenExpiredError";
    return res.status(expirado ? 401 : 403).json({
      success: false,
      error: expirado ? "Token expirado." : "Token inválido.",
    });
  }
};

// ─────────────────────────────────────────────
// Verifica que el usuario tenga el rol requerido
// Uso: router.delete("/ruta", verificarToken, verificarRol(["superadmin"]), controlador)
// ─────────────────────────────────────────────
export const verificarRol = (rolesPermitidos) => {
  return (req, res, next) => {
    if (!req.usuario) {
      return res.status(401).json({
        success: false,
        error: "No autenticado.",
      });
    }

    if (!rolesPermitidos.includes(req.usuario.rol)) {
      return res.status(403).json({
        success: false,
        error: "No tienes permisos para esta acción.",
      });
    }

    next();
  };
};

// src/middleware/auth.middleware.js — agrega esta función nueva
export const verificarTokenOpcional = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader?.split(" ")[1];

  if (!token) return next(); // sin token → sigue como visitante anónimo, sin bloquear

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.usuario = decoded; // 👈 si el token es válido, ahora sí existe req.usuario
  } catch (error) {
    // Token inválido o expirado — igual lo dejamos pasar como anónimo, no es motivo de bloqueo aquí
  }

  next();
};
