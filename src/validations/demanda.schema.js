// src/validations/demanda.schema.js — validación de demandas del CRM (zod).
import { z } from "zod";
export { validar } from "./visita.schema.js";

const idPositivo = z.coerce.number().int().positive();
const listaIds = (max) =>
  z
    .array(idPositivo)
    .max(max, `Máximo ${max} elementos.`)
    .transform((a) => [...new Set(a)]);
const enteroOpcional = (min, max) =>
  z.union([z.null(), z.coerce.number().int().min(min).max(max)]).optional();
const dinero = z.union([z.null(), z.coerce.number().int().min(0).max(1e13)]).optional();

export const ESTADOS_DEMANDA = ["activa", "pausada", "cerrada"];
// La operación se recibe por code: los ids del catálogo no se hardcodean.
export const OPERACIONES_DEMANDA = ["venta", "alquiler"];

const campos = {
  operacion: z.enum(OPERACIONES_DEMANDA, { message: "Operación: venta o alquiler." }),
  property_type_ids: listaIds(16).optional(),
  city_ids: listaIds(20).optional(),
  barrio_ids: listaIds(100).optional(),
  estratos: z.array(z.coerce.number().int().min(1).max(6)).max(6).optional(),
  precio_min: dinero,
  precio_max: dinero,
  habitaciones_min: enteroOpcional(0, 20),
  banos_min: enteroOpcional(0, 20),
  parqueaderos_min: enteroOpcional(0, 20),
  area_min: enteroOpcional(0, 1_000_000),
  area_max: enteroOpcional(0, 1_000_000),
  notas: z.string().trim().max(4000).transform((v) => v || null).nullable().optional(),
  avisar: z.boolean().optional(),
  asignado_a_id: z.union([z.null(), idPositivo]).optional(),
};

const rangosCoherentes = (d, ctx) => {
  if (d.precio_min != null && d.precio_max != null && d.precio_max < d.precio_min) {
    ctx.addIssue({ code: "custom", path: ["precio_max"], message: "Debe ser mayor o igual al mínimo." });
  }
  if (d.area_min != null && d.area_max != null && d.area_max < d.area_min) {
    ctx.addIssue({ code: "custom", path: ["area_max"], message: "Debe ser mayor o igual al mínimo." });
  }
};

export const crearDemandaSchema = z
  .object({ contacto_id: idPositivo, ...campos })
  .strict()
  .superRefine(rangosCoherentes);

export const actualizarDemandaSchema = z
  .object({
    ...Object.fromEntries(Object.entries(campos).map(([k, v]) => [k, v.optional()])),
    estado: z.enum(ESTADOS_DEMANDA).optional(),
  })
  .strict()
  .superRefine(rangosCoherentes);

export const filtrosDemandasSchema = z.object({
  contacto_id: idPositivo.optional(),
  asignado: idPositivo.optional(),
  estado: z.enum(ESTADOS_DEMANDA).optional(),
});

export const coincidenciasSchema = z.object({
  alcance: z.enum(["cartera", "portal"]).optional().default("cartera"),
  incluir_descartadas: z
    .enum(["0", "1", "true", "false"])
    .optional()
    .transform((v) => v === "1" || v === "true"),
  solo_nuevas: z
    .enum(["0", "1", "true", "false"])
    .optional()
    .transform((v) => v === "1" || v === "true"),
});

export const seguimientoSchema = z
  .object({ estado: z.enum(["enviada", "descartada"]) })
  .strict();
