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

  if (!datos.operation_type_id) {
    errores.push("operation_type_id es requerido.");
  }

  if (!datos.property_type_id) {
    errores.push("property_type_id es requerido.");
  }

  if (!datos.direccion) {
    errores.push("La dirección es requerida.");
  }

  if (!datos.city_id || !datos.state_id) {
    errores.push("city_id y state_id son requeridos.");
  }

  if (datos.estrato !== undefined && datos.estrato !== null && datos.estrato !== "") {
    const estrato = Number(datos.estrato);
    if (!Number.isInteger(estrato) || estrato < 1 || estrato > 6) {
      errores.push("El estrato debe ser un número entre 1 y 6.");
    }
  }

  if (datos.precio !== undefined && datos.precio !== null && datos.precio !== "") {
    const precio = Number(datos.precio);
    if (isNaN(precio) || precio <= 0) {
      errores.push("El precio debe ser un número positivo.");
    }
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
