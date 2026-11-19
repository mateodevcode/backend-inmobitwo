// src/validations/visita.schema.js — validación de visitas del CRM (zod).
import { z } from "zod";
import { HttpError } from "../lib/errores.js";

const idPositivo = z.coerce.number().int().positive();
const idOpcional = z.union([idPositivo, z.null()]).optional();
// Fecha-hora ISO con zona (el CRM manda "2026-11-20T15:00:00-05:00").
const fechaHora = z.iso.datetime({ offset: true, message: "Fecha y hora inválidas." });
const textoOpcional = (max) =>
  z
    .string()
    .trim()
    .max(max, `Máximo ${max} caracteres.`)
    .transform((v) => v || null)
    .nullable()
    .optional();

export const ESTADOS_VISITA = ["programada", "confirmada", "realizada", "cancelada", "no_asistio"];
export const ESTADOS_ACTIVOS = ["programada", "confirmada"];
export const INTERES = ["alto", "medio", "bajo", "ninguno"];

const camposVisita = {
  contacto_id: idPositivo,
  propiedad_id: idOpcional,
  oportunidad_id: idOpcional,
  inicio_at: fechaHora,
  duracion_min: z.coerce.number().int().min(15, "Mínimo 15 minutos.").max(480, "Máximo 8 horas."),
  lugar: textoOpcional(300),
  notas: textoOpcional(5000),
  asignado_a_id: idOpcional,
  recordatorio_minutos: z.union([z.coerce.number().int().min(5).max(2880), z.null()]).optional(),
  // true = guardar aunque el agente ya tenga otra visita a esa hora.
  forzar: z.boolean().optional().default(false),
};

export const crearVisitaSchema = z.object({
  ...camposVisita,
  duracion_min: camposVisita.duracion_min.default(60),
  recordatorio_minutos: camposVisita.recordatorio_minutos.default(60),
});

// PATCH: todos opcionales (contacto_id no se cambia: se crea otra visita).
export const actualizarVisitaSchema = z
  .object({
    propiedad_id: camposVisita.propiedad_id,
    oportunidad_id: camposVisita.oportunidad_id,
    inicio_at: camposVisita.inicio_at.optional(),
    duracion_min: camposVisita.duracion_min.optional(),
    lugar: camposVisita.lugar,
    notas: camposVisita.notas,
    asignado_a_id: camposVisita.asignado_a_id,
    recordatorio_minutos: camposVisita.recordatorio_minutos,
    forzar: camposVisita.forzar,
  })
  .strict();

export const estadoVisitaSchema = z
  .object({
    estado: z.enum(ESTADOS_VISITA, { message: "Estado no válido." }),
    resultado_interes: z.enum(INTERES).nullable().optional(),
    resultado_comentario: textoOpcional(2000),
    motivo_cancelacion: textoOpcional(300),
  })
  .strict();

const fechaDia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida (aaaa-mm-dd).");
export const filtrosVisitasSchema = z.object({
  desde: fechaDia.optional(),
  hasta: fechaDia.optional(),
  asignado: idPositivo.optional(),
  contacto_id: idPositivo.optional(),
  propiedad_id: idPositivo.optional(),
  estado: z.enum(ESTADOS_VISITA).optional(),
});

// Valida o lanza HttpError 400 con todos los mensajes (formato { error: [...] }).
export function validar(schema, datos) {
  const r = schema.safeParse(datos ?? {});
  if (r.success) return r.data;
  const mensajes = r.error.issues.map((i) =>
    i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message,
  );
  throw new HttpError(400, mensajes);
}
