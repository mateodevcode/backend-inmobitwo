// utils/emails/resetPassword.js
import { escapeHtml } from "../sanitize.js";

export const resetPassword = ({ name, codigo, resetUrl }) => {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; color: #1a1a1a;">
      <h2 style="margin-bottom: 8px;">Hola${name ? `, ${escapeHtml(name)}` : ""} 👋</h2>
      <p style="font-size: 16px; line-height: 1.5;">
        Usa este código para restablecer la contraseña de tu cuenta de Inmobitwo.
      </p>

      <div style="text-align: center; margin: 32px 0;">
        <span
          style="display: inline-block; background-color: #f5f5f4; border: 1px solid #e5e5e4; border-radius: 8px; padding: 16px 32px; font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #111;"
        >
          ${codigo}
        </span>
      </div>

      <p style="font-size: 14px; color: #555; line-height: 1.5;">
        También puedes ir directo a
        <a href="${resetUrl}" style="color: #111; font-weight: bold;">restablecer tu contraseña</a>
        e introducir el código allí.
      </p>

      <p style="font-size: 13px; color: #888; margin-top: 24px;">
        Este código expira en 5 minutos. Si no solicitaste este cambio,
        puedes ignorar este correo.
      </p>
    </div>
  `;
};
