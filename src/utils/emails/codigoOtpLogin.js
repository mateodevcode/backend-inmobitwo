// utils/emails/codigoOtpLogin.js
// Segundo factor: código de un solo uso para completar el inicio de sesión.
import { escapeHtml } from "../sanitize.js";

export const codigoOtpLogin = ({ name, codigo }) => {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; color: #1a1a1a;">
      <h2 style="margin-bottom: 8px;">Hola${name ? `, ${escapeHtml(name)}` : ""} 👋</h2>
      <p style="font-size: 16px; line-height: 1.5;">
        Alguien está intentando iniciar sesión en tu cuenta de Inmobitwo.
        Usa este código para completar el acceso:
      </p>

      <div style="text-align: center; margin: 32px 0;">
        <span
          style="display: inline-block; background-color: #f5f5f4; border: 1px solid #e5e5e4; border-radius: 8px; padding: 16px 32px; font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #111;"
        >
          ${codigo}
        </span>
      </div>

      <p style="font-size: 14px; color: #555; line-height: 1.5;">
        Por seguridad, no compartas este código con nadie. Si no fuiste tú,
        cambia tu contraseña cuanto antes.
      </p>

      <p style="font-size: 13px; color: #888; margin-top: 24px;">
        Este código expira en 10 minutos y solo puede usarse una vez.
      </p>
    </div>
  `;
};
