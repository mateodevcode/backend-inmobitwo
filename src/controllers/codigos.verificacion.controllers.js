// controllers/codigos.controllers.js

import { createTransporter } from "../utils/createTransporter.js";
import { codigoVerificacion } from "../utils/emails/codigoVerificacion.js";
import { pool } from "../db.js";
import { BREVO_EMAIL_NO_REPLY } from "../config.js";

// 10 minutos de validez para el código
const MINUTOS_VALIDEZ = 10;

export const enviarCodigoVerificacion = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        error: "ID de usuario requerido",
      });
    }

    const result = await pool.query(
      "SELECT id, name, email, email_verificado FROM usuarios WHERE id = $1",
      [id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Usuario no encontrado.",
      });
    }

    const usuario = result.rows[0];

    if (usuario.email_verificado) {
      return res.status(400).json({
        success: false,
        error: "El correo ya está verificado.",
      });
    }

    // Código numérico de 6 dígitos (entre 100000 y 999999, nunca con 0 a la izquierda)
    const codigo = Math.floor(100000 + Math.random() * 900000);
    const fechaCodigo = new Date();

    await pool.query(
      `UPDATE usuarios
       SET codigo_verificacion = $1, date_codigo_verificacion = $2
       WHERE id = $3`,
      [codigo, fechaCodigo, id],
    );

    const transporter = createTransporter();

    const mailOptions = {
      from: `"Inmobitwo" <${BREVO_EMAIL_NO_REPLY}>`,
      to: usuario.email,
      subject: "Tu código de verificación",
      html: codigoVerificacion({ name: usuario.name, codigo }),
    };

    await transporter.sendMail(mailOptions);

    res.status(200).json({
      success: true,
      message: "Hemos enviado un código de verificación a tu correo.",
    });
  } catch (error) {
    console.error("❌ Error en POST /usuarios/:id/enviar-codigo:", error);
    res.status(500).json({
      success: false,
      error: "Error interno del servidor.",
      details: error.message,
    });
  }
};

export const desactivarVerificacionEmail = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        error: "ID de usuario requerido",
      });
    }

    const { rows } = await pool.query(
      `UPDATE usuarios
       SET email_verificado = FALSE,
           codigo_verificacion = NULL,
           date_codigo_verificacion = NULL
       WHERE id = $1
       RETURNING id, email_verificado`,
      [id],
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Usuario no encontrado.",
      });
    }

    res.status(200).json({
      success: true,
      message: "Verificación por email desactivada.",
      data: rows[0],
    });
  } catch (error) {
    console.error(
      "❌ Error en PATCH /usuarios/:id/desactivar-verificacion:",
      error,
    );
    res.status(500).json({
      success: false,
      error: "Error interno del servidor.",
      details: error.message,
    });
  }
};

export const confirmarCodigoVerificacion = async (req, res) => {
  try {
    const { id } = req.params;
    const { codigo } = req.body;

    if (!id) {
      return res.status(400).json({
        success: false,
        error: "ID de usuario requerido",
      });
    }

    if (!codigo) {
      return res.status(400).json({
        success: false,
        error: "El código de verificación es requerido.",
      });
    }

    const result = await pool.query(
      `SELECT codigo_verificacion, date_codigo_verificacion
       FROM usuarios WHERE id = $1`,
      [id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Usuario no encontrado.",
      });
    }

    const { codigo_verificacion, date_codigo_verificacion } = result.rows[0];

    if (!codigo_verificacion || !date_codigo_verificacion) {
      return res.status(400).json({
        success: false,
        error:
          "No hay un código de verificación pendiente. Solicita uno nuevo.",
      });
    }

    const minutosTranscurridos =
      (Date.now() - new Date(date_codigo_verificacion).getTime()) / 1000 / 60;

    if (minutosTranscurridos > MINUTOS_VALIDEZ) {
      return res.status(400).json({
        success: false,
        error: "El código expiró. Solicita uno nuevo.",
      });
    }

    // Comparamos como string para evitar problemas de tipo (Number vs String)
    if (String(codigo_verificacion) !== String(codigo).trim()) {
      return res.status(400).json({
        success: false,
        error: "El código ingresado no es correcto.",
      });
    }

    const { rows } = await pool.query(
      `UPDATE usuarios
       SET email_verificado = TRUE,
           codigo_verificacion = NULL,
           date_codigo_verificacion = NULL
       WHERE id = $1
       RETURNING id, email_verificado`,
      [id],
    );

    res.status(200).json({
      success: true,
      message: "Tu correo fue verificado correctamente.",
      data: rows[0],
    });
  } catch (error) {
    console.error("❌ Error en POST /usuarios/:id/confirmar-codigo:", error);
    res.status(500).json({
      success: false,
      error: "Error interno del servidor.",
      details: error.message,
    });
  }
};
