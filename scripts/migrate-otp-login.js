// scripts/migrate-otp-login.js — Segundo factor OTP en el login.
// Agrega las columnas del OTP de inicio de sesión (solo para usuarios con
// email_verificado = true). Idempotente: puede correrse varias veces.
import { pool } from "../src/db.js";

const sql = `
-- Columnas del OTP de login en usuarios
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS otp_login INTEGER;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS otp_login_expira TIMESTAMP;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS otp_login_intentos INTEGER DEFAULT 0;
`;

pool
  .query(sql)
  .then(() => {
    console.log("✅ Migración otp-login aplicada");
    pool.end();
  })
  .catch((e) => {
    console.error("❌", e.message);
    pool.end();
  });
