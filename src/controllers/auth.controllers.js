// src/controllers/auth.controllers.js
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { pool } from "../db.js";
import { JWT_SECRET, JWT_REFRESH_SECRET } from "../config.js";
import { usuario_validate } from "../validations/usuario_validate.js";
import { selectFields } from "../lib/fieldSelection.helper.js";
import { CAMPOS_USUARIO } from "../constants/api/fields.js";
import { createTransporter } from "../utils/createTransporter.js";
import { codigoOtpLogin } from "../utils/emails/codigoOtpLogin.js";
import { BREVO_EMAIL_NO_REPLY } from "../config.js";

// ─────────────────────────────────────────────
// Segundo factor OTP en el login (solo usuarios con email_verificado)
// ─────────────────────────────────────────────
const OTP_MINUTOS_VALIDEZ = 10;
const OTP_MAX_INTENTOS = 5;
const OTP_REENVIO_COOLDOWN_SEG = 60;

const generarOtp = () => Math.floor(100000 + Math.random() * 900000);

const enviarOtpLogin = async (usuario, codigo) => {
  const transporter = createTransporter();
  await transporter.sendMail({
    from: `"Inmobitwo" <${BREVO_EMAIL_NO_REPLY}>`,
    to: usuario.email,
    subject: "Tu código de inicio de sesión",
    html: codigoOtpLogin({ name: usuario.name, codigo }),
  });
};

// Emite la sesión completa (access + refresh httpOnly). Se usa tanto en el
// login directo como tras verificar el OTP del segundo factor.
const emitirSesion = async (res, usuario, message = "Login correcto.") => {
  const accessToken = generarAccessToken(usuario);
  const refreshToken = generarRefreshToken(usuario);

  await pool.query(
    `INSERT INTO refresh_tokens (usuario_id, token, expira_en)
     VALUES ($1, $2, NOW() + INTERVAL '7 days')`,
    [usuario.id, refreshToken],
  );

  await pool.query(
    `UPDATE usuarios
     SET intentos_fallidos = 0,
         ultimo_login = NOW(),
         otp_login = NULL,
         otp_login_expira = NULL,
         otp_login_intentos = 0
     WHERE id = $1`,
    [usuario.id],
  );

  res.cookie("refresh_token", refreshToken, cookieOpciones);

  return res.status(200).json({
    success: true,
    message,
    data: {
      usuario: {
        id: usuario.id,
        name: usuario.name,
        email: usuario.email,
        rol: usuario.rol,
        image_url: usuario.image_url,
        email_verificado: !!usuario.email_verificado,
      },
      accessToken,
    },
  });
};

// ─────────────────────────────────────────────
// Helpers para generar tokens
// ─────────────────────────────────────────────
const generarAccessToken = (usuario) => {
  return jwt.sign(
    { id: usuario.id, email: usuario.email, rol: usuario.rol },
    JWT_SECRET,
    { expiresIn: "15m" },
  );
};

const generarRefreshToken = (usuario) => {
  return jwt.sign({ id: usuario.id }, JWT_REFRESH_SECRET, { expiresIn: "7d" });
};

// Opciones de la cookie httpOnly para el refresh token
const cookieOpciones = {
  httpOnly: true, // invisible para JavaScript del navegador
  secure: process.env.NODE_ENV === "production", // solo HTTPS en producción
  sameSite: "strict",
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 días en ms
};

// ─────────────────────────────────────────────
// POST /auth/registro
// ─────────────────────────────────────────────
export const registro = async (req, res) => {
  try {
    const { name, email, password, telefono } = req.body;

    // Validaciones básicas
    const errores = usuario_validate({ name, email, password });
    if (errores.length > 0) {
      return res.status(400).json({ success: false, error: errores });
    }

    // Verificar que el email no exista
    const { rows: existe } = await pool.query(
      "SELECT id FROM usuarios WHERE email = $1",
      [email],
    );
    if (existe.length > 0) {
      return res.status(409).json({
        success: false,
        error: "Ya existe una cuenta con ese email.",
      });
    }

    // Hash de la contraseña
    const passwordHash = await bcrypt.hash(password, 12);

    // Insertar usuario
    const { rows } = await pool.query(
      `INSERT INTO usuarios (name, email, password, telefono, rol, provider)
       VALUES ($1, $2, $3, $4, 'user', 'local')
       RETURNING id, name, email, rol, created_at`,
      [name, email, passwordHash, telefono || null],
    );

    const nuevoUsuario = rows[0];

    // Generar tokens
    const accessToken = generarAccessToken(nuevoUsuario);
    const refreshToken = generarRefreshToken(nuevoUsuario);

    // Guardar refresh token en DB
    await pool.query(
      `INSERT INTO refresh_tokens (usuario_id, token, expira_en)
       VALUES ($1, $2, NOW() + INTERVAL '7 days')`,
      [nuevoUsuario.id, refreshToken],
    );

    // Mandar refresh token en cookie httpOnly
    res.cookie("refresh_token", refreshToken, cookieOpciones);

    return res.status(201).json({
      success: true,
      message: "Cuenta creada correctamente.",
      data: {
        usuario: nuevoUsuario,
        accessToken, // el frontend lo guarda en localStorage
      },
    });
  } catch (error) {
    console.error("❌ Error en POST /auth/registro:", error);
    res
      .status(500)
      .json({ success: false, error: "Error interno del servidor." });
  }
};

// ─────────────────────────────────────────────
// POST /auth/check-email
// ─────────────────────────────────────────────
export const checkEmail = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: "Email es requerido.",
      });
    }

    // Buscar si el usuario existe
    const { rows } = await pool.query(
      "SELECT id, email, bloqueado FROM usuarios WHERE email = $1",
      [email],
    );

    const usuario = rows[0];

    if (!usuario) {
      return res.status(404).json({
        success: false,
        error: "No encontramos una cuenta con este email.",
      });
    }

    // Verificar si está bloqueado
    if (usuario.bloqueado) {
      return res.status(403).json({
        success: false,
        error: "Cuenta bloqueada. Contacta con soporte.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Email válido. Continúa con tu contraseña.",
      data: {
        email: usuario.email,
      },
    });
  } catch (error) {
    console.error("❌ Error en POST /auth/check-email:", error);
    res.status(500).json({
      success: false,
      error: "Error interno del servidor.",
    });
  }
};

// ─────────────────────────────────────────────
// POST /auth/login
// ─────────────────────────────────────────────
export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: "Email y contraseña son requeridos.",
      });
    }

    // Buscar usuario
    const { rows } = await pool.query(
      "SELECT * FROM usuarios WHERE email = $1",
      [email],
    );

    const usuario = rows[0];

    if (!usuario) {
      return res.status(401).json({
        success: false,
        error: "Credenciales incorrectas.",
      });
    }

    // Verificar si está bloqueado
    if (usuario.bloqueado) {
      return res.status(403).json({
        success: false,
        error: "Cuenta bloqueada. Contacta con soporte.",
      });
    }

    // Verificar contraseña
    const passwordValida = await bcrypt.compare(password, usuario.password);

    if (!passwordValida) {
      // Incrementar intentos fallidos
      await pool.query(
        `UPDATE usuarios 
         SET intentos_fallidos = intentos_fallidos + 1,
             bloqueado = CASE WHEN intentos_fallidos + 1 >= 5 THEN true ELSE false END
         WHERE id = $1`,
        [usuario.id],
      );

      return res.status(401).json({
        success: false,
        error: "Credenciales incorrectas.",
      });
    }

    // Contraseña correcta — resetear intentos fallidos de password.
    // (ultimo_login se actualiza al completar la sesión en emitirSesion,
    //  es decir, tras el OTP si el usuario tiene segundo factor.)
    await pool.query(
      `UPDATE usuarios
       SET intentos_fallidos = 0
       WHERE id = $1`,
      [usuario.id],
    );

    // ── Segundo factor: email verificado → OTP, sin emitir sesión aún ──
    if (usuario.email_verificado) {
      const codigo = generarOtp();

      await pool.query(
        `UPDATE usuarios
         SET otp_login = $1,
             otp_login_expira = NOW() + INTERVAL '${OTP_MINUTOS_VALIDEZ} minutes',
             otp_login_intentos = 0
         WHERE id = $2`,
        [codigo, usuario.id],
      );

      try {
        await enviarOtpLogin(usuario, codigo);
      } catch (error) {
        console.error("❌ Error enviando OTP de login:", error);
        return res.status(500).json({
          success: false,
          error: "No pudimos enviar el código. Intenta de nuevo.",
        });
      }

      return res.status(200).json({
        success: true,
        message: "Te enviamos un código de verificación a tu correo.",
        data: { requiereOTP: true, email: usuario.email },
      });
    }

    // ── Login directo (sin segundo factor) ──
    // Generar tokens
    return emitirSesion(res, usuario);
  } catch (error) {
    console.error("❌ Error en POST /auth/login:", error);
    res
      .status(500)
      .json({ success: false, error: "Error interno del servidor." });
  }
};

// ─────────────────────────────────────────────
// POST /auth/verificar-otp-login
// Completa el login con el OTP del segundo factor y emite la sesión.
// ─────────────────────────────────────────────
export const verificarOtpLogin = async (req, res) => {
  try {
    const { email, codigo } = req.body;

    if (!email || !codigo) {
      return res.status(400).json({
        success: false,
        error: "Email y código son requeridos.",
      });
    }

    const { rows } = await pool.query(
      "SELECT * FROM usuarios WHERE email = $1",
      [email],
    );
    const usuario = rows[0];

    // Respuesta genérica para no revelar si el email existe.
    const invalido = () =>
      res.status(401).json({
        success: false,
        error: "El código no es válido o expiró.",
      });

    if (!usuario || !usuario.email_verificado) return invalido();

    if (usuario.bloqueado) {
      return res.status(403).json({
        success: false,
        error: "Cuenta bloqueada. Contacta con soporte.",
      });
    }

    if (!usuario.otp_login || !usuario.otp_login_expira) return invalido();

    if (new Date(usuario.otp_login_expira).getTime() < Date.now()) {
      return invalido();
    }

    if ((usuario.otp_login_intentos ?? 0) >= OTP_MAX_INTENTOS) {
      await pool.query(
        `UPDATE usuarios
         SET otp_login = NULL, otp_login_expira = NULL, otp_login_intentos = 0
         WHERE id = $1`,
        [usuario.id],
      );
      return invalido();
    }

    if (String(usuario.otp_login) !== String(codigo).trim()) {
      // Código erróneo: contar intento y bloquear al llegar al máximo
      // (misma política que la contraseña: 5 fallos).
      await pool.query(
        `UPDATE usuarios
         SET otp_login_intentos = otp_login_intentos + 1,
             bloqueado = CASE WHEN otp_login_intentos + 1 >= ${OTP_MAX_INTENTOS}
                              THEN true ELSE bloqueado END
         WHERE id = $1`,
        [usuario.id],
      );
      return invalido();
    }

    // OTP correcto — emitir sesión (limpia el OTP dentro de emitirSesion).
    return emitirSesion(
      res,
      usuario,
      "Verificación correcta. ¡Bienvenido!",
    );
  } catch (error) {
    console.error("❌ Error en POST /auth/verificar-otp-login:", error);
    res
      .status(500)
      .json({ success: false, error: "Error interno del servidor." });
  }
};

// ─────────────────────────────────────────────
// POST /auth/reenviar-otp-login
// Regenera y reenvía el OTP (con cooldown anti-spam).
// ─────────────────────────────────────────────
export const reenviarOtpLogin = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: "Email requerido.",
      });
    }

    const { rows } = await pool.query(
      "SELECT * FROM usuarios WHERE email = $1",
      [email],
    );
    const usuario = rows[0];

    if (!usuario || !usuario.email_verificado) {
      return res.status(400).json({
        success: false,
        error: "No hay una verificación pendiente para este correo.",
      });
    }

    // Cooldown: generado_hace = ahora - (expira - validez)
    if (usuario.otp_login && usuario.otp_login_expira) {
      const generadoEn =
        new Date(usuario.otp_login_expira).getTime() -
        OTP_MINUTOS_VALIDEZ * 60 * 1000;
      if ((Date.now() - generadoEn) / 1000 < OTP_REENVIO_COOLDOWN_SEG) {
        return res.status(429).json({
          success: false,
          error: `Espera ${OTP_REENVIO_COOLDOWN_SEG} segundos antes de pedir otro código.`,
        });
      }
    }

    const codigo = generarOtp();

    await pool.query(
      `UPDATE usuarios
       SET otp_login = $1,
           otp_login_expira = NOW() + INTERVAL '${OTP_MINUTOS_VALIDEZ} minutes',
           otp_login_intentos = 0
       WHERE id = $2`,
      [codigo, usuario.id],
    );

    try {
      await enviarOtpLogin(usuario, codigo);
    } catch (error) {
      console.error("❌ Error reenviando OTP de login:", error);
      return res.status(500).json({
        success: false,
        error: "No pudimos enviar el código. Intenta de nuevo.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Te enviamos un nuevo código a tu correo.",
    });
  } catch (error) {
    console.error("❌ Error en POST /auth/reenviar-otp-login:", error);
    res
      .status(500)
      .json({ success: false, error: "Error interno del servidor." });
  }
};

// ─────────────────────────────────────────────
// POST /auth/refresh
// Renueva el access_token y rota el refresh_token
// ─────────────────────────────────────────────
export const refresh = async (req, res) => {
  try {
    const token = req.cookies?.refresh_token;

    if (!token) {
      return res.status(401).json({
        success: false,
        error: "Refresh token no encontrado.",
      });
    }

    // 1. Verificar firma JWT antes de tocar la base de datos
    let decoded;
    try {
      decoded = jwt.verify(token, JWT_REFRESH_SECRET);
    } catch (jwtError) {
      return res.status(403).json({
        success: false,
        error: "Refresh token inválido o expirado.",
      });
    }

    // 2. Verificar que exista en DB y no esté revocado
    const { rows } = await pool.query(
      `SELECT * FROM refresh_tokens 
       WHERE token = $1 AND revocado = false AND expira_en > NOW()`,
      [token],
    );

    if (rows.length === 0) {
      return res.status(403).json({
        success: false,
        error: "Refresh token inválido o expirado.",
      });
    }

    // 3. Buscar usuario actualizado
    const { rows: usuarioRows } = await pool.query(
      "SELECT id, name, email, rol FROM usuarios WHERE id = $1",
      [decoded.id],
    );

    const usuario = usuarioRows[0];
    if (!usuario) {
      return res
        .status(404)
        .json({ success: false, error: "Usuario no encontrado." });
    }

    // 4. Generar nuevo access token
    const nuevoAccessToken = generarAccessToken(usuario);

    // 5. Rotación del refresh token: revocar el viejo y crear uno nuevo
    const nuevoRefreshToken = generarRefreshToken(usuario);

    await pool.query(
      "UPDATE refresh_tokens SET revocado = true WHERE token = $1",
      [token],
    );

    await pool.query(
      `INSERT INTO refresh_tokens (usuario_id, token, expira_en)
       VALUES ($1, $2, NOW() + INTERVAL '7 days')`,
      [usuario.id, nuevoRefreshToken],
    );

    res.cookie("refresh_token", nuevoRefreshToken, cookieOpciones);

    return res.status(200).json({
      success: true,
      data: { accessToken: nuevoAccessToken },
    });
  } catch (error) {
    console.error("❌ Error en POST /auth/refresh:", error);
    res
      .status(500)
      .json({ success: false, error: "Error interno del servidor." });
  }
};

// ─────────────────────────────────────────────
// POST /auth/logout
// ─────────────────────────────────────────────
export const logout = async (req, res) => {
  try {
    const token = req.cookies?.refresh_token;

    if (token) {
      // Revocar el token en DB
      await pool.query(
        "UPDATE refresh_tokens SET revocado = true WHERE token = $1",
        [token],
      );
    }

    // Eliminar la cookie
    res.clearCookie("refresh_token", cookieOpciones);

    return res.status(200).json({
      success: true,
      message: "Sesión cerrada correctamente.",
    });
  } catch (error) {
    console.error("❌ Error en POST /auth/logout:", error);
    res
      .status(500)
      .json({ success: false, error: "Error interno del servidor." });
  }
};

// ─────────────────────────────────────────────
// GET /auth/me
// Devuelve el usuario autenticado actual
// ─────────────────────────────────────────────
export const me = async (req, res) => {
  try {
    const { columnas, error } = selectFields(
      req.query.fields,
      CAMPOS_USUARIO.permitidos,
      CAMPOS_USUARIO.default,
    );

    if (error) {
      return res.status(400).json({ success: false, error });
    }

    const { rows } = await pool.query(
      `SELECT ${columnas.join(", ")}
       FROM usuarios WHERE id = $1`,
      [req.usuario.id],
    );

    if (rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, error: "Usuario no encontrado." });
    }

    return res.status(200).json({ success: true, data: rows[0] });
  } catch (error) {
    console.error("❌ Error en GET /auth/me:", error);
    res
      .status(500)
      .json({ success: false, error: "Error interno del servidor." });
  }
};
