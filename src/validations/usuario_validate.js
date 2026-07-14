export function usuario_validate(datos) {
  const errores = [];

  if (!datos.name) {
    errores.push("El nombre es obligatorio.");
  }

  if (datos.name && datos.name.length < 3) {
    errores.push("El nombre debe tener al menos 3 caracteres.");
  }

  if (!datos.email) {
    errores.push("El email es obligatorio.");
  } else {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(datos.email)) {
      errores.push("El email no tiene un formato válido.");
    } else if (datos.email.length > 255) {
      errores.push("El email no puede exceder los 255 caracteres.");
    }
  }

  if (!datos.password) {
    errores.push("La contraseña es obligatoria.");
  }

  return errores;
}
