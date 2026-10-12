// src/validations/crm.js — validación de queries del CRM (fase 1)
export const ESTADOS_LEAD = ["nuevo", "contactado", "en_negociacion", "cerrado", "descartado"];
export const ORIGENES_LEAD = ["formulario_directo", "scoring_comportamiento"];

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

export function validarPaginacion(query) {
  const pagina = Math.max(1, Number.parseInt(query.pagina ?? "1", 10) || 1);
  const limite = Math.min(100, Math.max(1, Number.parseInt(query.limite ?? "20", 10) || 20));
  return { pagina, limite, offset: (pagina - 1) * limite };
}

export function validarFiltrosLeads(query) {
  const errores = [];
  const { estado, origen, desde, hasta, propiedadId, q } = query;

  if (estado !== undefined && !ESTADOS_LEAD.includes(estado)) {
    errores.push(`estado inválido: use ${ESTADOS_LEAD.join(", ")}.`);
  }
  if (origen !== undefined && !ORIGENES_LEAD.includes(origen)) {
    errores.push(`origen inválido: use ${ORIGENES_LEAD.join(", ")}.`);
  }
  if (desde !== undefined && !FECHA.test(desde)) errores.push("desde debe ser YYYY-MM-DD.");
  if (hasta !== undefined && !FECHA.test(hasta)) errores.push("hasta debe ser YYYY-MM-DD.");
  const propId = propiedadId === undefined ? null : Number(propiedadId);
  if (propiedadId !== undefined && !Number.isInteger(propId)) {
    errores.push("propiedadId debe ser entero.");
  }
  return { errores, filtros: { estado, origen, desde, hasta, propiedadId: propId, q } };
}

export function validarFiltrosPropiedades(query) {
  const { estado, q } = query;
  return { estado, q };
}

export const TIPOS_CONTACTO = ["comprador", "vendedor", "arrendatario", "inversor", "otro"];
export const ORIGENES_CONTACTO = ["manual", "portal", "chat", "importacion"];
export const TIPOS_ACTIVIDAD = ["nota", "llamada", "email", "whatsapp", "visita", "reunion", "cambio_etapa", "sistema"];
export const PRIORIDADES_TAREA = ["baja", "media", "alta"];

export function validarContacto(body, parcial = false) {
  const errores = [];
  const v = {};
  const req = (campo, cond, msg) => {
    if (body[campo] === undefined) {
      if (!parcial) errores.push(`${campo} es requerido.`);
      return;
    }
    if (!cond(body[campo])) errores.push(msg);
    else v[campo] = body[campo];
  };
  req("nombre", (x) => typeof x === "string" && x.trim().length >= 2, "nombre inválido.");
  if (body.email !== undefined) {
    if (body.email === null || body.email === "") v.email = null;
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) errores.push("email inválido.");
    else v.email = body.email.trim().toLowerCase();
  } else if (!parcial) v.email = null;
  if (body.tipo !== undefined) {
    if (!TIPOS_CONTACTO.includes(body.tipo)) errores.push(`tipo inválido: use ${TIPOS_CONTACTO.join(", ")}.`);
    else v.tipo = body.tipo;
  } else if (!parcial) v.tipo = "otro";
  if (body.origen !== undefined) {
    if (!ORIGENES_CONTACTO.includes(body.origen)) errores.push("origen inválido.");
    else v.origen = body.origen;
  } else if (!parcial) v.origen = "manual";
  for (const m of ["presupuesto_min", "presupuesto_max"]) {
    if (body[m] !== undefined && body[m] !== null) {
      const n = Number(body[m]);
      if (!Number.isInteger(n) || n < 0) errores.push(`${m} debe ser entero >= 0.`);
      else v[m] = n;
    }
  }
  if (body.zona_interes !== undefined) v.zona_interes = body.zona_interes || null;
  if (body.preferencias !== undefined) {
    if (typeof body.preferencias !== "object" || body.preferencias === null) errores.push("preferencias debe ser objeto.");
    else v.preferencias = body.preferencias;
  }
  if (body.etiquetas !== undefined) {
    if (!Array.isArray(body.etiquetas)) errores.push("etiquetas debe ser arreglo.");
    else v.etiquetas = body.etiquetas.map(String);
  }
  if (body.asignado_a_id !== undefined) v.asignado_a_id = body.asignado_a_id;
  if (body.autorizacion === true) {
    v.autorizacion_datos_at = new Date().toISOString();
    v.autorizacion_origen = typeof body.autorizacion_origen === "string" ? body.autorizacion_origen : "crm";
  }
  return { errores, valores: v };
}

export function validarActividad(body) {
  const errores = [];
  if (!Number.isInteger(Number(body.contacto_id))) errores.push("contacto_id requerido.");
  if (!TIPOS_ACTIVIDAD.includes(body.tipo)) errores.push(`tipo inválido: use ${TIPOS_ACTIVIDAD.join(", ")}.`);
  if (body.contenido !== undefined && body.contenido !== null && String(body.contenido).length > 4000) {
    errores.push("contenido máximo 4000 caracteres.");
  }
  if (body.duracion_min !== undefined && body.duracion_min !== null) {
    const n = Number(body.duracion_min);
    if (!Number.isInteger(n) || n < 0) errores.push("duracion_min inválido.");
  }
  return errores;
}

export function validarTarea(body, parcial = false) {
  const errores = [];
  if (!parcial && (typeof body.titulo !== "string" || !body.titulo.trim())) {
    errores.push("titulo es requerido.");
  }
  if (body.prioridad !== undefined && !PRIORIDADES_TAREA.includes(body.prioridad)) {
    errores.push(`prioridad inválida: use ${PRIORIDADES_TAREA.join(", ")}.`);
  }
  return errores;
}
