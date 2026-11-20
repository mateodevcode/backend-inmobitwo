// controllers/password.recovery.controllers.js
// Flujo "olvidé mi contraseña": OTP de 6 dígitos por email (válido 5 min,
// espera 5 min entre envíos, 3 intentos fallidos bloquean la cuenta).
// Endpoints (ver routes/password.recovery.routes.js):
//   PATCH /api/generar-codigo          -> genera OTP y lo envía por email
//   POST  /api/validar-codigo          -> valida el OTP y entrega un token de restablecimiento
//   PATCH /api/usuario/reset-password  -> con ese token, cambia la contraseña (bcrypt 12)
//
// Seguridad:
// - generar-codigo responde lo mismo exista o no el correo (no revela cuentas).
// - reset-password exige el token firmado (10 min, un solo uso); antes bastaba
//   con el id del usuario, lo que permitía cambiar la contraseña de cualquiera.
// - Cambiar la contraseña revoca todas las sesiones (refresh tokens).

import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { pool } from "../db.js";
import { createTransporter } from "../utils/createTransporter.js";
import { resetPassword as resetPasswordEmail } from "../utils/emails/resetPassword.js";
import { BREVO_EMAIL_NO_REPLY, FRONTEND_URL, JWT_SECRET } from "../config.js";
import {
  crearTokenRestablecer,
  erroresPasswordNueva,
  huellaVigente,
  leerTokenRestablecer,
} from "../lib/restablecerPassword.js";

const MINUTOS_ESPERA = 5;
const MAX_INTENTOS = 3;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MENSAJE_ENVIO =
  "Si el correo está registrado, te enviamos un código de verificación. Revisa también la carpeta de spam.";

const normalizarEmail = (v) => (typeof v === "string" ? v.trim().toLowerCase() : "");

// PATCH /api/generar-codigo — genera OTP de 6 dígitos y lo envía por correo
export const generarCodigo = async (req, res) => {
  try {
    const email = normalizarEmail(req.body?.email);
    if (!email || email.length > 255 || !EMAIL_RE.test(email)) {
      return res.status(400).json({ success: false, error: "Ingresa un correo válido." });
    }

    const { rows } = await pool.query(
      `SELECT id, name, email, codigo_verificacion, date_codigo_verificacion, bloqueado
       FROM usuarios WHERE lower(email) = $1`,
      [email],
    );
    const usuario = rows[0];

    // Misma respuesta si no existe, está bloqueado o pidió un código hace poco.
    const reciente =
      usuario?.codigo_verificacion &&
      usuario.date_codigo_verificacion &&
      Date.now() - new Date(usuario.date_codigo_verificacion).getTime() < MINUTOS_ESPERA * 60_000;
    if (!usuario || usuario.bloqueado || reciente) {
      return res.status(200).json({ success: true, message: MENSAJE_ENVIO });
    }

    const codigo = crypto.randomInt(100000, 1000000);
    await pool.query(
      `UPDATE usuarios
       SET codigo_verificacion = $1, date_codigo_verificacion = NOW(), intentos_fallidos = 0
       WHERE id = $2`,
      [codigo, usuario.id],
    );

    const frontendBase = FRONTEND_URL?.split(",")[0]?.trim();
    const resetUrl = `${frontendBase}/restablecer-contrasena?email=${encodeURIComponent(usuario.email)}`;
    await createTransporter().sendMail({
      from: `"Inmobitwo" <${BREVO_EMAIL_NO_REPLY}>`,
      to: usuario.email,
      subject: "Código de verificación para restablecer tu contraseña",
      html: resetPasswordEmail({ name: usuario.name, codigo, resetUrl }),
    });

    return res.status(200).json({ success: true, message: MENSAJE_ENVIO });
  } catch (error) {
    console.error("Error en PATCH /api/generar-codigo:", error);
    res.status(500).json({ success: false, error: "Error interno del servidor." });
  }
};

// POST /api/validar-codigo — valida el OTP y devuelve el token de restablecimiento
export const validarCodigo = async (req, res) => {
  try {
    const email = normalizarEmail(req.body?.email);
    const codigoVerificacion = String(req.body?.codigoVerificacion ?? "").trim();

    if (!email) {
      return res.status(400).json({ success: false, error: "Por favor ingresa tu email." });
    }
    if (!/^\d{6}$/.test(codigoVerificacion)) {
      return res.status(400).json({
        success: false,
        error: "El código de verificación debe tener 6 dígitos numéricos.",
      });
    }

    const { rows } = await pool.query(
      `SELECT id, password, codigo_verificacion, date_codigo_verificacion, intentos_fallidos, bloqueado
       FROM usuarios WHERE lower(email) = $1`,
      [email],
    );
    const user = rows[0];
    if (!user || user.codigo_verificacion == null || !user.date_codigo_verificacion) {
      return res.status(400).json({
        success: false,
        error: "No hay un código activo para este correo. Solicita uno nuevo.",
      });
    }

    if (user.bloqueado) {
      return res.status(403).json({
        success: false,
        error: "Usuario bloqueado. Has excedido el número máximo de intentos. Contacta al soporte.",
      });
    }

    if (Date.now() - new Date(user.date_codigo_verificacion).getTime() > MINUTOS_ESPERA * 60_000) {
      return res.status(401).json({ success: false, error: "El código de verificación ha expirado. Solicita uno nuevo." });
    }

    // codigo_verificacion es INTEGER en BD: comparar como texto de longitud fija.
    const esperado = Buffer.from(String(user.codigo_verificacion).padStart(6, "0"));
    const recibido = Buffer.from(codigoVerificacion);
    if (esperado.length !== recibido.length || !crypto.timingSafeEqual(esperado, recibido)) {
      const nuevosIntentos = (user.intentos_fallidos || 0) + 1;
      if (nuevosIntentos >= MAX_INTENTOS) {
        await pool.query("UPDATE usuarios SET bloqueado = true, intentos_fallidos = $1 WHERE id = $2", [nuevosIntentos, user.id]);
        return res.status(403).json({
          success: false,
          error: "Cuenta bloqueada por seguridad. Contacta al soporte para desbloquearla.",
        });
      }
      await pool.query("UPDATE usuarios SET intentos_fallidos = $1 WHERE id = $2", [nuevosIntentos, user.id]);
      return res.status(401).json({
        success: false,
        error: `Código incorrecto. Te quedan ${MAX_INTENTOS - nuevosIntentos} intentos.`,
      });
    }

    await pool.query(
      "UPDATE usuarios SET codigo_verificacion = NULL, date_codigo_verificacion = NULL, intentos_fallidos = 0 WHERE id = $1",
      [user.id],
    );

    return res.status(200).json({
      success: true,
      message: "Código verificado. Ya puedes elegir tu nueva contraseña.",
      // Token opaco para el portal: es lo único que acepta reset-password.
      data: crearTokenRestablecer(user, JWT_SECRET),
    });
  } catch (error) {
    console.error("Error en POST /api/validar-codigo:", error);
    res.status(500).json({ success: false, error: "Error interno del servidor." });
  }
};

// PATCH /api/usuario/reset-password — restablece la contraseña con el token
export const resetPassword = async (req, res) => {
  try {
    const { password, token } = req.body ?? {};
    const datos = leerTokenRestablecer(token, JWT_SECRET);
    const caducado = {
      success: false,
      error: "El permiso para cambiar la contraseña expiró o ya se usó. Valida un código nuevo.",
    };
    if (!datos) return res.status(401).json(caducado);

    const errores = erroresPasswordNueva(password);
    if (errores.length) return res.status(400).json({ success: false, error: errores[0] });

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query("SELECT id, password FROM usuarios WHERE id = $1 FOR UPDATE", [datos.id]);
      // Un solo uso: si la contraseña cambió desde que se emitió el token, ya no vale.
      if (!rows[0] || !huellaVigente(datos, rows[0].password)) {
        await client.query("ROLLBACK");
        return res.status(401).json(caducado);
      }
      const hashedPassword = await bcrypt.hash(password, 12);
      await client.query(
        `UPDATE usuarios
         SET password = $1, codigo_verificacion = NULL, date_codigo_verificacion = NULL,
             intentos_fallidos = 0, bloqueado = false
         WHERE id = $2`,
        [hashedPassword, datos.id],
      );
      // Cierra las sesiones abiertas: quien tuviera la contraseña vieja queda fuera.
      await client.query("UPDATE refresh_tokens SET revocado = true WHERE usuario_id = $1 AND revocado = false", [datos.id]);
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }

    return res.status(200).json({ success: true, message: "Contraseña restablecida. Inicia sesión con la nueva." });
  } catch (error) {
    console.error("Error en PATCH /api/usuario/reset-password:", error);
    res.status(500).json({ success: false, error: "Error interno del servidor." });
  }
};
