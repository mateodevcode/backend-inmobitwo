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
