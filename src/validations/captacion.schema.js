// src/validations/captacion.schema.js — validación de captaciones (zod).
import { z } from "zod";
export { validar } from "./visita.schema.js";

const idPositivo = z.coerce.number().int().positive();
const fecha = z.union([
  z.null(),
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida (aaaa-mm-dd)."),
]);
const dinero = z.union([z.null(), z.coerce.number().int().min(0).max(1e13)]);

export const TIPOS_MANDATO = ["exclusiva", "compartida", "sin_exclusiva"];
export const ESTADOS_CAPTACION = ["en_captacion", "activa", "retirada", "cerrada"];
export const TIPOS_DOCUMENTO = [
  "cedula",
  "certificado_tradicion",
  "contrato_mandato",
  "predial",
  "paz_y_salvo",
  "otro",
];

const campos = {
  propietario_id: z.union([z.null(), idPositivo]),
  tipo_mandato: z.enum(TIPOS_MANDATO, { message: "Tipo de mandato no válido." }),
  inicio_el: fecha,
  vence_el: fecha,
  comision_tipo: z.enum(["porcentaje", "valor"]),
  comision_porcentaje: z.union([z.null(), z.coerce.number().min(0).max(100)]),
  comision_valor: dinero,
  precio_propietario: dinero,
  estado: z.enum(ESTADOS_CAPTACION),
  notas: z.string().trim().max(4000).transform((v) => v || null).nullable(),
  asignado_a_id: z.union([z.null(), idPositivo]),
};

const coherente = (d, ctx) => {
  if (d.inicio_el && d.vence_el && d.vence_el < d.inicio_el) {
    ctx.addIssue({ code: "custom", path: ["vence_el"], message: "El vencimiento debe ser posterior al inicio." });
  }
};

export const crearCaptacionSchema = z
  .object({
    propiedad_id: idPositivo,
    ...Object.fromEntries(Object.entries(campos).map(([k, v]) => [k, v.optional()])),
  })
  .strict()
  .superRefine(coherente);

export const actualizarCaptacionSchema = z
  .object(Object.fromEntries(Object.entries(campos).map(([k, v]) => [k, v.optional()])))
  .strict()
  .superRefine(coherente);

export const filtrosCaptacionesSchema = z.object({
  estado: z.enum(ESTADOS_CAPTACION).optional(),
  // Solo las que vencen en los próximos N días (incluye ya vencidas).
  vence_en_dias: z.coerce.number().int().min(0).max(365).optional(),
  asignado: idPositivo.optional(),
  propietario_id: idPositivo.optional(),
});

export const documentoSchema = z.object({
  tipo: z.enum(TIPOS_DOCUMENTO).optional().default("otro"),
});
