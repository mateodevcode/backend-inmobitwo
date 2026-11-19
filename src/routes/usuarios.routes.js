import { Router } from "express";
import {
  getUsuarios,
  createUsuario,
  deleteUsuario,
  desbloquearUsuario,
  getUsuarioById,
  updateUsuario,
  updatePassword,
} from "../controllers/usuarios.controllers.js";
import {
  createRateLimitMiddleware,
  defaultLimiter,
  passwordLimiter,
  verificacionCodigoLimiter,
} from "../lib/rateLimit.js";
import {
  soloPropioOSuperadmin,
  verificarToken,
  verificarRol,
} from "../middleware/auth.middleware.js";
import { upload } from "../lib/multer.js";
import {
  enviarCodigoVerificacion,
  confirmarCodigoVerificacion,
  desactivarVerificacionEmail,
} from "../controllers/codigos.verificacion.controllers.js";

const router = Router();

const rateLimit = createRateLimitMiddleware(defaultLimiter);
const rateLimitVerificacionCodigo = createRateLimitMiddleware(
  verificacionCodigoLimiter,
);

const uploadFields = upload.fields([
  { name: "imagenPrincipal", maxCount: 1 },
  { name: "galeria", maxCount: 20 },
]);

const ruta = "/usuarios";
const propio = soloPropioOSuperadmin("id");
const rateLimitPassword = createRateLimitMiddleware(passwordLimiter);

// 🔒 Lista completa y alta/baja administrativa: solo superadmin (módulo Usuarios del CRM)
router.get(ruta, verificarToken, verificarRol(["superadmin"]), getUsuarios);
router.post(ruta, verificarToken, verificarRol(["superadmin"]), createUsuario);

// 🔒 Datos de una cuenta: solo la propia cuenta o el superadmin
router.get(`${ruta}/:id`, verificarToken, propio, getUsuarioById);
router.patch(`${ruta}/:id`, verificarToken, propio, uploadFields, updateUsuario);
router.delete(`${ruta}/:id`, verificarToken, propio, deleteUsuario);
router.patch(
  `${ruta}/:id/password`,
  verificarToken,
  propio,
  rateLimitPassword,
  updatePassword,
);

// Desbloqueo por el superadmin (módulo Usuarios del CRM)
router.patch(
  `${ruta}/:id/desbloquear`,
  verificarToken,
  verificarRol(["superadmin"]),
  desbloquearUsuario,
);

router.post(
  `${ruta}/:id/enviar-codigo`,
  verificarToken,
  propio,
  rateLimit,
  enviarCodigoVerificacion,
);

router.post(
  `${ruta}/:id/confirmar-codigo`,
  verificarToken,
  propio,
  rateLimitVerificacionCodigo,
  confirmarCodigoVerificacion,
);

router.patch(
  `${ruta}/:id/desactivar-verificacion`,
  verificarToken,
  propio,
  rateLimit,
  desactivarVerificacionEmail,
);

export default router;
