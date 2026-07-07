export function organizacion_validate(datos) {
  const errores = [];

  // Validación de nombre (obligatorio, único)
  if (!datos.nombre) {
    errores.push("El nombre de la organización es obligatorio.");
  } else if (datos.nombre.length < 3) {
    errores.push("El nombre debe tener al menos 3 caracteres.");
  } else if (datos.nombre.length > 255) {
    errores.push("El nombre no puede exceder los 255 caracteres.");
  }

  // Validación de email (opcional pero si existe debe ser válido)
  if (datos.email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(datos.email)) {
      errores.push("El email no tiene un formato válido.");
    } else if (datos.email.length > 255) {
      errores.push("El email no puede exceder los 255 caracteres.");
    }
  }

  // Validación de teléfono (opcional)
  if (datos.telefono) {
    const telefonoRegex = /^[0-9+\-\s()]{6,20}$/;
    if (!telefonoRegex.test(datos.telefono)) {
      errores.push("El teléfono no tiene un formato válido.");
    } else if (datos.telefono.length > 20) {
      errores.push("El teléfono no puede exceder los 20 caracteres.");
    }
  }

  // Validación de website (opcional)
  if (datos.website) {
    const urlRegex =
      /^(https?:\/\/)?([\da-z\.-]+)\.([a-z\.]{2,6})([\/\w \.-]*)*\/?$/;
    if (!urlRegex.test(datos.website)) {
      errores.push("La URL del website no es válida.");
    } else if (datos.website.length > 255) {
      errores.push("El website no puede exceder los 255 caracteres.");
    }
  }

  // Validación de descripción (opcional)
  if (datos.descripcion && datos.descripcion.length > 65535) {
    errores.push("La descripción es demasiado larga.");
  }

  // Validación de logo_url (opcional)
  if (datos.logo_url && datos.logo_url.length > 500) {
    errores.push("La URL del logo no puede exceder los 500 caracteres.");
  }

  // Validación de logo_public_id (opcional)
  if (datos.logo_public_id && datos.logo_public_id.length > 255) {
    errores.push("El ID público del logo no puede exceder los 255 caracteres.");
  }

  // Validación de ciudad (opcional)
  if (datos.ciudad && datos.ciudad.length > 100) {
    errores.push("La ciudad no puede exceder los 100 caracteres.");
  }

  // Validación de provincia (opcional)
  if (datos.provincia && datos.provincia.length > 100) {
    errores.push("La provincia no puede exceder los 100 caracteres.");
  }

  // Validación de estado (opcional, con valores permitidos)
  if (datos.estado) {
    const estadosPermitidos = ["pendiente", "activo", "inactivo", "rechazado"];
    if (!estadosPermitidos.includes(datos.estado)) {
      errores.push(
        `El estado debe ser uno de: ${estadosPermitidos.join(", ")}.`,
      );
    }
  }

  // Validación de creada_por_id (obligatorio)
  if (!datos.creada_por_id) {
    errores.push("El ID del usuario creador es obligatorio.");
  } else if (
    typeof datos.creada_por_id !== "number" ||
    datos.creada_por_id <= 0
  ) {
    errores.push("El ID del usuario creador debe ser un número válido.");
  }

  return errores;
}
