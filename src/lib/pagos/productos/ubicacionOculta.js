// src/lib/pagos/productos/ubicacionOculta.js
// Producto "Ocultar ubicación en el mapa" (pago único, 22.000 COP).
//
// Contrato de producto (ver productos/index.js):
//   tipo, slug, campoContexto, prefijoReferencia, descripcion, moneda
//   precio(), maxCuotas()
//   cargarContexto(id)                   → fila del contexto o null
//   cargarContextoParaAplicar(client,id) → fila con FOR UPDATE o null
//   yaAplicado(ctx)                      → true si no debe re-aplicarse
//   aplicar(client,{pago,ctx})           → aplica el derecho comprado
//   estadoPublico(id)                    → estado que consume el frontend
//   invalidarCache()                     → patrón de claves a invalidar
//
// Reglas de privacidad: el punto público se calcula UNA sola vez al activar
// (desplazamiento 150–400 m). Nunca se toca la coordenada real ni el precio.

import { pool } from "../../../db.js";
import { PRECIO_UBICACION_OCULTA_COP, MP_MAX_INSTALLMENTS } from "../../../config.js";
import { calcularPuntoPublico } from "../../ubicacion.service.js";

export const TIPO_UBICACION_OCULTA = "ubicacion_oculta";

export const ubicacionOculta = {
  tipo: TIPO_UBICACION_OCULTA,
  slug: "ubicacion-oculta",
  campoContexto: "propiedad_id",
  campoContextoDb: "propiedad_id",
  prefijoReferencia: "pocu",
  descripcion: "Ocultar ubicación en mapa – pago único",
  moneda: "COP",
  mensajeYaAplicado: "Esta propiedad ya tiene la ubicación oculta.",
  datosYaAplicado: { ubicacion_oculta: true },

  precio: () => PRECIO_UBICACION_OCULTA_COP,
  maxCuotas: () => MP_MAX_INSTALLMENTS,

  async cargarContexto(id) {
    const { rows } = await pool.query(
      `SELECT id, publicado_por_id, organizacion_id, ubicacion_oculta,
              latitude, longitude
       FROM propiedades WHERE id = $1`,
      [id],
    );
    return rows[0] ?? null;
  },

  async cargarContextoParaAplicar(client, id) {
    const { rows } = await client.query(
      `SELECT id, publicado_por_id, organizacion_id, ubicacion_oculta,
              latitude, longitude
       FROM propiedades WHERE id = $1 FOR UPDATE`,
      [id],
    );
    return rows[0] ?? null;
  },

  yaAplicado: (ctx) => Boolean(ctx?.ubicacion_oculta),

  async aplicar(client, { pago, ctx }) {
    const punto = calcularPuntoPublico(
      Number(ctx.latitude),
      Number(ctx.longitude),
    );
    await client.query(
      `UPDATE propiedades SET
         ubicacion_oculta = TRUE,
         ubicacion_oculta_at = NOW(),
         ubicacion_oculta_solicitada = TRUE,
         latitude_publica = $2::numeric,
         longitude_publica = $3::numeric,
         geom_publica = ST_SetSRID(
           ST_MakePoint($3::double precision, $2::double precision), 4326)
       WHERE id = $1`,
      [ctx.id, punto.lat, punto.lng],
    );
    await client.query(`UPDATE pagos SET aplicado_at = NOW() WHERE id = $1`, [
      pago.id,
    ]);
  },

  async estadoPublico(id) {
    const { rows } = await pool.query(
      "SELECT ubicacion_oculta, ubicacion_oculta_at FROM propiedades WHERE id = $1",
      [id],
    );
    return rows[0] ?? null;
  },

  invalidarCache: () => "propiedad*",
};
