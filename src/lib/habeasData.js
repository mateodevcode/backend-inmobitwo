// Habeas Data (Ley 1581 de 2012): constancia de acciones sobre datos personales.
// El registro nunca guarda datos personales: solo ids, acción, actor y conteos.
import { pool } from "../db.js";
import { duenoEspacio } from "./crmPermisos.js";

export const ORIGENES_AUTORIZACION = ["verbal", "escrito", "formulario_web", "correo", "whatsapp", "contrato", "importacion", "crm"];

export const ACCIONES_AUDITORIA = [
  "exportacion",
  "rectificacion",
  "supresion",
  "autorizacion_registrada",
  "autorizacion_retirada",
];

// Campos cuyo cambio cuenta como rectificación de datos personales.
export const CAMPOS_PERSONALES = ["nombre", "email", "telefono"];

export function camposRectificados(antes, despues) {
  return CAMPOS_PERSONALES.filter((c) => (antes?.[c] ?? null) !== (despues?.[c] ?? null));
}

export async function registrarAuditoria(crm, contactoId, accion, detalle = {}, db = pool) {
  if (!ACCIONES_AUDITORIA.includes(accion)) throw new Error(`Acción de auditoría desconocida: ${accion}`);
  const dueno = duenoEspacio(crm);
  await db.query(
    `INSERT INTO crm_auditoria_datos (${dueno.col}, contacto_id, accion, actor_id, detalle)
     VALUES ($1, $2, $3, $4, $5)`,
    [dueno.val, contactoId, accion, crm.usuarioId, JSON.stringify(detalle)],
  );
}

// Quién puede suprimir datos o ver el registro: el dueño del espacio personal
// o un administrador de la inmobiliaria.
export const puedeGestionarDatos = (crm) => crm.tipo === "personal" || crm.rolEnOrg === "agency_admin";
