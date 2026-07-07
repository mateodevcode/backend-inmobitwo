// utils/emails/nuevoLead.js

export const nuevoLead = ({
  nombreAgente,
  propiedadTitulo,
  leadNombre,
  leadEmail,
  leadTelefono,
  score,
  origen,
  frontendUrl,
}) => {
  const origenTexto =
    origen === "formulario_directo"
      ? "Dejó sus datos directamente en un formulario de contacto."
      : `Mostró un alto nivel de interés navegando la propiedad (puntuación: ${score}).`;

  return `
    <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto;">
      <h2 style="color: #111;">Tienes un nuevo lead 🎯</h2>
      <p>Hola ${nombreAgente || ""},</p>
      <p>Alguien mostró interés en tu propiedad <strong>${propiedadTitulo}</strong>.</p>
      <div style="background: #f5f5f5; border-radius: 8px; padding: 16px; margin: 16px 0;">
        <p style="margin: 4px 0;"><strong>Nombre:</strong> ${leadNombre || "No proporcionado"}</p>
        <p style="margin: 4px 0;"><strong>Email:</strong> ${leadEmail || "No proporcionado"}</p>
        <p style="margin: 4px 0;"><strong>Teléfono:</strong> ${leadTelefono || "No proporcionado"}</p>
      </div>
      <p style="color: #555;">${origenTexto}</p>
      <p style="margin-top: 24px;">Te recomendamos contactarlo lo antes posible mientras el interés está activo.</p>
      <a href="${frontendUrl}/leads" 
         style="display: inline-block; margin-top: 16px; background: #111; color: #fff; padding: 10px 20px; border-radius: 8px; text-decoration: none;">
        Ver mis leads
      </a>
    </div>
  `;
};
