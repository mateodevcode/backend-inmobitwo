// utils/emails/codigoVerificacion.js
// Mismo patrón que tu función bienvenida({ name, plan, email, botonWhatsapp })

export const codigoVerificacion = ({ name, codigo }) => {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; color: #1a1a1a;">
      <h2 style="margin-bottom: 8px;">Hola${name ? `, ${name}` : ""} 👋</h2>
      <p style="font-size: 16px; line-height: 1.5;">
        Usa este código para verificar tu correo electrónico y activar la
        seguridad adicional en tu cuenta de Inmobitwo.
      </p>

      <div style="text-align: center; margin: 32px 0;">
        <span
          style="display: inline-block; background-color: #f5f5f4; border: 1px solid #e5e5e4; border-radius: 8px; padding: 16px 32px; font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #111;"
        >
          ${codigo}
        </span>
      </div>

      <p style="font-size: 14px; color: #555; line-height: 1.5;">
        Introduce este código en la pantalla de verificación. Por seguridad,
        no compartas este código con nadie.
      </p>

      <p style="font-size: 13px; color: #888; margin-top: 24px;">
        Este código expira en 10 minutos. Si no solicitaste esta
        verificación, puedes ignorar este correo.
      </p>
    </div>
  `;
};
