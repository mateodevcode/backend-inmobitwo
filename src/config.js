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
export const RUST_WEBSOCKET_URL = process.env.RUST_WEBSOCKET_URL;

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
