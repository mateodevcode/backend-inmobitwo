// src/lib/busquedasGuardadas/notificadorEmail.js
import { createTransporter } from "../../utils/createTransporter.js";
import { htmlAlertaBusqueda, textoAlertaBusqueda, asuntoAlerta } from "../../utils/emails/alertaBusqueda.js";

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

export async function enviarEmailAlerta({ busqueda, usuario, items, total }) {
  const front = (process.env.FRONTEND_URL || "").split(",")[0].replace(/\/$/, "");
  const tokenBaja = busqueda.unsubscribe_token;
  const transporter = createTransporter();

  const mail = {
    from: `"Inmobitwo" <${process.env.BREVO_EMAIL_NO_REPLY}>`,
    to: usuario.email,
    subject: asuntoAlerta({ nombre: busqueda.nombre, total }),
    html: htmlAlertaBusqueda({ usuario, busqueda, items, total, front, tokenBaja }),
    text: textoAlertaBusqueda({ busqueda, items, total, front, tokenBaja }),
    headers: {
      "List-Unsubscribe": `<${front}/busquedas/baja/${tokenBaja}>`,
    },
  };

  // 3 intentos con espera creciente (la API actual no reintenta)
  let ultimo;
  for (let i = 1; i <= 3; i++) {
    try { return await transporter.sendMail(mail); }
    catch (e) { ultimo = e; if (i < 3) await esperar(i * 2000); }
  }
  throw ultimo;
}
