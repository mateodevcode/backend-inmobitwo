// utils/createTransporter.js
// Si ya tenés este archivo en tu backend, usá el existente y borrá esta copia.

import nodemailer from "nodemailer";
import { BREVO_SMTP_EMAIL, BREVO_SMTP_PASS } from "../config.js";

export const createTransporter = () => {
  let transporter;

  // ===============================
  // 🔹 Configurar Nodemailer con Brevo (antes Sendinblue)
  // ===============================
  transporter = nodemailer.createTransport({
    host: "smtp-relay.brevo.com",
    port: 587,
    secure: false,
    auth: {
      user: BREVO_SMTP_EMAIL,
      pass: BREVO_SMTP_PASS,
    },
  });

  return transporter;
};
