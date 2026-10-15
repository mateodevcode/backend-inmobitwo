// src/controllers/oauth.controllers.js — ingreso con Google (Authorization Code).
// El navegador nunca toca tokens de Google: redirige a Google, Google devuelve
// a /callback con ?code=, el backend intercambia el código y crea la sesión
// propia. El accessToken viaja al frontend con un código de un solo uso
// (Redis, 5 min) que se canjea por POST.
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { pool } from "../db.js";
import {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_CRM_URL,
  GOOGLE_PORTAL_URL,
  GOOGLE_REDIRECT_URI,
  JWT_SECRET,
} from "../config.js";
import { crearSesion } from "./auth.controllers.js";
import { redis } from "../lib/redis.js";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

const oauthListo = () => GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_REDIRECT_URI;

const baseDestino = (app) =>
  String(app === "crm" ? GOOGLE_CRM_URL : GOOGLE_PORTAL_URL).trim().replace(/\/$/, "");

// next debe ser ruta relativa interna (/...), nunca URL absoluta.
const sanearNext = (next) =>
  typeof next === "string" && next.startsWith("/") && !next.startsWith("//") ? next : "/";

// ── GET /auth/oauth/google?next=/ruta&app=crm → redirige a Google ──────
export const iniciarGoogle = async (req, res) => {
  try {
    if (!oauthListo()) {
      return res.status(503).json({ success: false, error: "Ingreso con Google no configurado." });
    }
    const app = req.query.app === "crm" ? "crm" : "portal";
    const state = jwt.sign(
      { next: sanearNext(req.query.next), app, nonce: crypto.randomUUID() },
      JWT_SECRET,
      { expiresIn: "10m" },
    );
    const params = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: GOOGLE_REDIRECT_URI,
      response_type: "code",
      scope: "openid email profile",
      access_type: "online",
      prompt: "select_account",
      state,
    });
    return res.redirect(302, `${GOOGLE_AUTH_URL}?${params.toString()}`);
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

// ── GET /auth/oauth/google/callback?code=...&state=... ──────────
export const callbackGoogle = async (req, res) => {
  let destino = baseDestino("portal");
  let etapa = "inicio";
  const volver = (ruta) => res.redirect(302, `${destino}${ruta}`);
  try {
    if (!oauthListo()) return volver("/login?error=google_no_configurado");
    let next = "/";
    etapa = "state";
    try {
      const dec = jwt.verify(req.query.state, JWT_SECRET);
      next = sanearNext(dec.next);
      destino = baseDestino(dec.app);
    } catch {
      return volver("/login?error=google_estado_invalido");
    }
    const { code } = req.query;
    if (!code) return volver("/login?error=google_sin_codigo");

    // Intercambio código → access token (solo servidor a servidor).
    etapa = "intercambio";
    const tr = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: GOOGLE_REDIRECT_URI,
        grant_type: "authorization_code",
      }),
    });
    const tokens = await tr.json();
    if (!tr.ok || !tokens.access_token) {
      // Se expone solo el código de error de Google (invalid_grant,
      // redirect_uri_mismatch...), sin secretos: es lo que diagnostica.
      const detalle = String(tokens.error || "desconocido").slice(0, 40);
      return volver(`/login?error=google_codigo_invalido&detalle=${encodeURIComponent(detalle)}`);
    }

    etapa = "userinfo";
    const ur = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const perfil = await ur.json();
    if (!ur.ok || !perfil.email || perfil.email_verified === false) {
      return volver("/login?error=google_email_no_verificado");
    }
    const email = String(perfil.email).toLowerCase();
    const nombre = perfil.name || email.split("@")[0];

    etapa = "bd";
    let { rows } = await pool.query("SELECT * FROM usuarios WHERE email = $1", [email]);
    let usuario = rows[0];
    if (!usuario) {
      const ins = await pool.query(
        `INSERT INTO usuarios (name, email, password, provider, provider_id, image_url, email_verificado, rol)
         VALUES ($1, $2, NULL, 'google', $3, $4, true, 'user')
         RETURNING *`,
        [nombre, email, perfil.sub, perfil.picture || null],
      );
      usuario = ins.rows[0];
    } else {
      if (usuario.bloqueado) return volver("/login?error=cuenta_bloqueada");
      // Vincula: verifica el email, completa foto/proveedor si faltan.
      await pool.query(
        `UPDATE usuarios
         SET email_verificado = true,
             provider_id = COALESCE(provider_id, $2),
             image_url = COALESCE(image_url, $3),
             intentos_fallidos = 0
         WHERE id = $1`,
        [usuario.id, perfil.sub, perfil.picture || null],
      );
      usuario = { ...usuario, email_verificado: true };
    }

    etapa = "sesion";
    const sesion = await crearSesion(res, usuario);
    const codigo = crypto.randomUUID();
    etapa = "redis";
    try {
      await redis.setex(`oauth:google:${codigo}`, 300, JSON.stringify(sesion));
    } catch {
      return volver("/login?error=google_sesion_no_guardada");
    }
    return volver(`/auth/google/callback?code=${codigo}&next=${encodeURIComponent(next)}`);
  } catch (error) {
    console.error(`❌ OAuth Google falló en etapa ${etapa}:`, error.message);
    return volver(`/login?error=google_error&etapa=${etapa}`);
  }
};

// ── POST /auth/oauth/google/canjear { code } → { usuario, accessToken } ──
export const canjearCodigo = async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ success: false, error: "Código requerido." });
    const clave = `oauth:google:${code}`;
    let sesion = null;
    try {
      const crudo = await redis.get(clave);
      if (crudo) {
        sesion = JSON.parse(crudo);
        await redis.del(clave);
      }
    } catch {
      return res.status(503).json({ success: false, error: "No se pudo validar el código." });
    }
    if (!sesion) {
      return res.status(401).json({ success: false, error: "Código inválido o expirado." });
    }
    return res.status(200).json({ success: true, data: sesion });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};
