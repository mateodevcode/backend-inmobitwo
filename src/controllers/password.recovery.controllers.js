// controllers/password.recovery.controllers.js
// Flujo "olvidé mi contraseña": OTP de 6 dígitos por email (válido 5 min,
// espera 5 min entre envíos, 3 intentos fallidos bloquean la cuenta).
// Endpoints (ver routes/password.recovery.routes.js):
//   PATCH /api/generar-codigo          -> genera OTP y lo envía por email
//   POST  /api/validar-codigo          -> valida el OTP, devuelve id usuario
//   PATCH /api/usuario/reset-password  -> cambia la contraseña (bcrypt 12)

import bcrypt from "bcryptjs";
import { pool } from "../db.js";
import { createTransporter } from "../utils/createTransporter.js";
import { resetPassword as resetPasswordEmail } from "../utils/emails/resetPassword.js";
import { BREVO_EMAIL_NO_REPLY, FRONTEND_URL } from "../config.js";

const MINUTOS_ESPERA = 5;
const MAX_INTENTOS = 3;

// PATCH /api/generar-codigo — genera OTP de 6 dígitos y lo envía por correo
export const generarCodigo = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, error: "El email es requerido." });
    }

    const { rows } = await pool.query(
      "SELECT id, name, email, codigo_verificacion, date_codigo_verificacion, intentos_fallidos, bloqueado FROM usuarios WHERE email = $1",
      [email],
    );

    const usuario = rows[0];

    if (!usuario) {
      return res.status(404).json({
        success: false,
        error: "El email no está registrado en nuestra base de datos.",
      });
    }

    if (usuario.bloqueado) {
      return res.status(403).json({ success: false, error: "Cuenta bloqueada. Contacta al soporte." });
    }

    // Validar espera de 5 minutos entre envíos
    if (usuario.codigo_verificacion && usuario.date_codigo_verificacion) {
      const ahora = new Date();
      const diferenciaEnMinutos = Math.floor(
        (ahora - new Date(usuario.date_codigo_verificacion)) / 1000 / 60,
      );

      if (diferenciaEnMinutos < MINUTOS_ESPERA) {
        return res.status(400).json({
          success: false,
          error: `Debes esperar ${MINUTOS_ESPERA - diferenciaEnMinutos} minutos para solicitar un nuevo código.`,
        });
      }
    }

    const codigo = Math.floor(100000 + Math.random() * 900000);

    await pool.query(
      `UPDATE usuarios
       SET codigo_verificacion = $1, date_codigo_verificacion = NOW(), intentos_fallidos = 0
       WHERE id = $2`,
      [codigo, usuario.id],
    );

    const transporter = createTransporter();
    const frontendBase = FRONTEND_URL?.split(",")[0]?.trim();
    const resetUrl = `${frontendBase}/restablecer-contrasena?email=${encodeURIComponent(email)}`;

    await transporter.sendMail({
      from: `"Inmobitwo" <${BREVO_EMAIL_NO_REPLY}>`,
      to: email,
      subject: "Código de verificación para restablecer tu contraseña",
      html: resetPasswordEmail({ name: usuario.name, codigo, resetUrl }),
    });

    return res.status(200).json({
      success: true,
      message: "Hemos enviado un código de verificación a tu correo electrónico.",
    });
  } catch (error) {
    console.error("Error en PATCH /api/generar-codigo:", error);
    res.status(500).json({ success: false, error: "Error interno del servidor." });
  }
};

// POST /api/validar-codigo — valida el OTP
export const validarCodigo = async (req, res) => {
  try {
    const { email, codigoVerificacion } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, error: "Por favor ingresa tu email." });
    }
    if (!codigoVerificacion) {
      return res.status(400).json({ success: false, error: "Por favor ingresa tu código de verificación." });
    }

    if (codigoVerificacion.length !== 6 || !/^\d{6}$/.test(codigoVerificacion)) {
      return res.status(400).json({
        success: false,
        error: "El código de verificación debe tener 6 dígitos numéricos.",
      });
    }

    const { rows } = await pool.query(
      "SELECT * FROM usuarios WHERE email = $1",
      [email],
    );

    const user = rows[0];
    if (!user || user.codigo_verificacion == null) {
      return res.status(400).json({
        success: false,
        error: "El correo no está registrado o no tiene un código de verificación activo.",
      });
    }

    if (user.bloqueado) {
      return res.status(403).json({
        success: false,
        error: "Usuario bloqueado. Has excedido el número máximo de intentos. Contacta al soporte.",
      });
    }

    if (!user.date_codigo_verificacion) {
      return res.status(400).json({ success: false, error: "No hay fecha de generación del código. Contacta al soporte." });
    }

    const ahora = new Date();
    const diferenciaEnMinutos = Math.floor(
      (ahora - new Date(user.date_codigo_verificacion)) / 1000 / 60,
    );

    if (diferenciaEnMinutos > MINUTOS_ESPERA) {
      return res.status(401).json({ success: false, error: "El código de verificación ha expirado. Solicita uno nuevo." });
    }

    // codigo_verificacion es INTEGER en BD: comparar como string
    if (String(user.codigo_verificacion) !== codigoVerificacion) {
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
      message: "Código verificado. Puedes restablecer tu contraseña.",
      data: user.id,
    });
  } catch (error) {
    console.error("Error en POST /api/validar-codigo:", error);
    res.status(500).json({ success: false, error: "Error interno del servidor." });
  }
};

// PATCH /api/usuario/reset-password — restablece la contraseña
export const resetPassword = async (req, res) => {
  try {
    const { password, id } = req.body;

    const { rows } = await pool.query("SELECT id FROM usuarios WHERE id = $1", [id]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: "Usuario no encontrado." });
    }

    if (!password || password.length < 8) {
      return res.status(400).json({ success: false, error: "La contraseña debe tener al menos 8 caracteres." });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    await pool.query(
      `UPDATE usuarios
       SET password = $1, codigo_verificacion = NULL, date_codigo_verificacion = NULL,
           intentos_fallidos = 0, bloqueado = false
       WHERE id = $2`,
      [hashedPassword, id],
    );

    return res.status(200).json({ success: true, message: "Contraseña restablecida con éxito." });
  } catch (error) {
    console.error("Error en PATCH /api/usuario/reset-password:", error);
    res.status(500).json({ success: false, error: "Error interno del servidor." });
  }
};
