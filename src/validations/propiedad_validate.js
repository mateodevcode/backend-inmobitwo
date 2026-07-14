const ESTADOS_PERMITIDOS = ["publicado", "no_publicado"];

export function propiedad_validate(datos, { requerirPublicador = true } = {}) {
  const errores = [];

  if (datos.titulo !== undefined) {
    if (!datos.titulo) {
      errores.push("El título es requerido.");
    } else if (datos.titulo.length < 3) {
      errores.push("El título debe tener al menos 3 caracteres.");
    } else if (datos.titulo.length > 500) {
      errores.push("El título no puede exceder los 500 caracteres.");
    }
  } else if (requerirPublicador) {
    errores.push("El título es requerido.");
  }

  if (datos.estado && !ESTADOS_PERMITIDOS.includes(datos.estado)) {
    errores.push(
      `El estado debe ser uno de: ${ESTADOS_PERMITIDOS.join(", ")}.`,
    );
  }

  if (requerirPublicador) {
    if (!datos.publicado_por_id) {
      errores.push("publicado_por_id es requerido.");
    } else {
      const publicadorId = Number(datos.publicado_por_id);
      if (!Number.isInteger(publicadorId) || publicadorId <= 0) {
        errores.push("publicado_por_id debe ser un número válido.");
      }
    }
  }

  return errores;
}

export function publicar_anuncio_validate(datos) {
  const errores = [];

  if (!datos.tipo) {
    errores.push("El tipo de propiedad es requerido.");
  }

  if (!datos.operacion) {
    errores.push("La operación es requerida.");
  }

  if (!datos.direccion) {
    errores.push("La dirección es requerida.");
  }

  if (!datos.country_id) {
    errores.push("country_id es requerido.");
  }

  if (!datos.city_id || !datos.state_id) {
    errores.push("city_id y state_id son requeridos.");
  }

  if (!datos.publicado_por_id) {
    errores.push("publicado_por_id es requerido.");
  } else {
    const publicadorId = Number(datos.publicado_por_id);
    if (!Number.isInteger(publicadorId) || publicadorId <= 0) {
      errores.push("publicado_por_id debe ser un número válido.");
    }
  }

  return errores;
}
