// src/lib/validarSecretos.js
// Arranque TOLERANTE (paso7 punto 1): un secreto de vistas faltante o corto
// NO tumba el servidor. Se registra un error muy visible y SOLO las rutas de
// vistas responden 503 (middleware requiereVistas); auth, propiedades,
// scoring y leads siguen funcionando. Un secreto válido (≥32) las habilita.
import { VIEW_INTERNAL_SECRET } from "../config.js";

export const MIN_SECRET_LEN = 32;

export function validarSecretoArranque(nombre, valor) {
  if (!valor || !String(valor).trim()) {
    throw new Error(`${nombre} vacío o ausente: vistas deshabilitadas`);
  }
  if (String(valor).length < MIN_SECRET_LEN) {
    throw new Error(
      `${nombre} demasiado corto (${String(valor).length} < ${MIN_SECRET_LEN} caracteres): vistas deshabilitadas`,
    );
  }
}

export function validarSecretosArranque() {
  validarSecretoArranque("VIEW_INTERNAL_SECRET", VIEW_INTERNAL_SECRET);
}

/// true si las rutas de vistas están habilitadas (se evalúa en vivo para
/// que rotar el secreto no exija reinicio en este chequeo).
export function vistasHabilitadas() {
  try {
    validarSecretosArranque();
    return true;
  } catch {
    return false;
  }
}

/// Middleware: 503 con mensaje claro si las vistas están deshabilitadas.
export function requiereVistas(req, res, next) {
  if (vistasHabilitadas()) return next();
  return res.status(503).json({
    success: false,
    message: "Medición de vistas deshabilitada: secretos no configurados.",
    data: { vistas_habilitado: false },
    error: null,
  });
}
