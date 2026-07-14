import { Router } from "express";
import {
  getUsuarios,
  createUsuario,
  deleteUsuario,
  getUsuarioById,
  updateUsuario,
  updatePassword,
} from "../controllers/usuarios.controllers.js";
import {
  createRateLimitMiddleware,
  defaultLimiter,
  verificacionCodigoLimiter,
} from "../lib/rateLimit.js";
import { verificarToken, verificarRol } from "../middleware/auth.middleware.js";
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

// 🔒 Todas estas rutas ahora necesitan token de forma obligatoria
router.get(ruta, verificarToken, getUsuarios);
router.get(`${ruta}/:id`, verificarToken, getUsuarioById);
router.patch(`${ruta}/:id`, verificarToken, uploadFields, updateUsuario);

router.patch(`${ruta}/:id/password`, verificarToken, updatePassword);

// Solo el superadmin puede crear o eliminar otros usuarios del sistema
// router.post(ruta, verificarToken, verificarRol(["superadmin"]), createUsuario);
router.post(ruta, verificarToken, createUsuario);
// router.delete(
//   `${ruta}/:id`,
//   verificarToken,
//   verificarRol(["superadmin"]),
//   deleteUsuario,
// );
router.delete(`${ruta}/:id`, verificarToken, deleteUsuario);

router.post(
  `${ruta}/:id/enviar-codigo`,
  verificarToken,
  rateLimit,
  enviarCodigoVerificacion,
);

router.post(
  `${ruta}/:id/confirmar-codigo`,
  verificarToken,
  rateLimitVerificacionCodigo,
  confirmarCodigoVerificacion,
);

router.patch(
  `${ruta}/:id/desactivar-verificacion`,
  verificarToken,
  rateLimit,
  desactivarVerificacionEmail,
);

export default router;
