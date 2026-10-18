export const PORT = process.env.PORT;
export const DB_HOST = process.env.DB_HOST;
export const DB_PORT = process.env.DB_PORT;
export const DB_USER = process.env.DB_USER;
export const DB_PASSWORD = process.env.DB_PASSWORD;
export const DB_NAME = process.env.DB_NAME;

export const APIKEY = process.env.API_SECRET_KEY;

export const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID;
export const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY;
export const AWS_DEFAULT_REGION = process.env.AWS_DEFAULT_REGION;
export const AWS_BUCKET = process.env.AWS_BUCKET;
export const AWS_URL = process.env.AWS_URL;
export const AWS_BUCKET_SUBFOLDER = process.env.AWS_BUCKET_SUBFOLDER;

export const FRONTEND_URL = process.env.FRONTEND_URL;

// JWT — nuevas variables
export const JWT_SECRET = process.env.JWT_SECRET;
export const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;

// nodemailer
export const BREVO_SMTP_EMAIL = process.env.BREVO_SMTP_EMAIL;
export const BREVO_SMTP_PASS = process.env.BREVO_SMTP_PASS;
export const BREVO_EMAIL_NO_REPLY = process.env.BREVO_EMAIL_NO_REPLY;

// rust
export const RUST_TRACKING_URL = process.env.RUST_TRACKING_URL;
export const RUST_MEDIA_URL = process.env.RUST_MEDIA_URL;

// vistas — token de ficha HMAC (algoritmo de vista de detalle, Fase 3).
// Secreto NUEVO, distinto de JWT_SECRET. Debe coincidir con el del tracking-service.
export const VIEW_TOKEN_SECRET = process.env.VIEW_TOKEN_SECRET;
export const VIEW_TOKEN_MAX_AGE_MINUTES = process.env.VIEW_TOKEN_MAX_AGE_MINUTES;
// Secreto interno Node→Rust (lote 3): Rust exige X-Internal-Secret en /tracking/vista.
export const VIEW_INTERNAL_SECRET = process.env.VIEW_INTERNAL_SECRET;
// Cookie de interno (paso8 6b): HMAC propio, NUNCA el de vistas.
export const INTERNO_COOKIE_SECRET = process.env.INTERNO_COOKIE_SECRET;

// ia (DeepSeek)
export const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
export const DEEPSEEK_BASE_URL = process.env.DEEPSEEK_BASE_URL;

// dominios — ejecución remota en el VPS (módulo Dominios del CRM, solo superadmin)
export const DOMINIOS_SSH_HOST = process.env.DOMINIOS_SSH_HOST;
export const DOMINIOS_SSH_USER = process.env.DOMINIOS_SSH_USER;
export const DOMINIOS_SSH_KEY_PATH = process.env.DOMINIOS_SSH_KEY_PATH;
export const DOMINIOS_SCRIPT_DIR =
  process.env.DOMINIOS_SCRIPT_DIR || "/srv/infra/inmobitwo/scripts-dominios";
export const DOMINIOS_SERVER_IP = process.env.DOMINIOS_SERVER_IP || "161.97.146.80";

// chat — socket-core (transporte en tiempo real). La API key nunca sale al frontend.
export const SOCKET_CORE_URL = process.env.SOCKET_CORE_URL;
export const SOCKET_CORE_API_KEY = process.env.SOCKET_CORE_API_KEY;
export const SOCKET_CORE_ORIGIN = process.env.SOCKET_CORE_ORIGIN;
export const SOCKET_CORE_WS_PUBLIC_URL = process.env.SOCKET_CORE_WS_PUBLIC_URL;

// ─── PAGOS — Mercado Pago Colombia (solo backend; el frontend usa NEXT_PUBLIC_MP_PUBLIC_KEY) ───
// El módulo de pagos se considera apagado (habilitado=false en /pagos/config)
// si falta el access token: el resto de la API sigue funcionando.
export const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
export const MP_WEBHOOK_SECRET = process.env.MP_WEBHOOK_SECRET;
// URL pública del backend para montar el notification_url: p. ej. https://api.inmobitwo.seventwo.tech
export const MP_NOTIFICATION_URL = process.env.MP_NOTIFICATION_URL;
// Precio del pago único por anuncio (COP). Default 22000.
export const PRECIO_UBICACION_OCULTA_COP = (() => {
  const n = parseInt(process.env.PRECIO_UBICACION_OCULTA_COP ?? "22000");
  return Number.isInteger(n) && n > 0 ? n : 22000;
})();
// Cuotas máxima permitida en servidor (1 = un solo pago).
export const MP_MAX_INSTALLMENTS = (() => {
  const n = parseInt(process.env.MP_MAX_INSTALLMENTS ?? "1");
  return Number.isInteger(n) && n > 0 ? n : 1;
})();

// El módulo de pagos está habilitado solo con access token.
export const pagosHabilitados = () => Boolean(MP_ACCESS_TOKEN);

// Google OAuth (Authorization Code). REDIRECT_URI debe coincidir exacta con
// la registrada en Cloud Console (una por entorno).
export const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
export const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
export const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI;
export const GOOGLE_PORTAL_URL = process.env.GOOGLE_PORTAL_URL;
export const GOOGLE_CRM_URL = process.env.GOOGLE_CRM_URL;
