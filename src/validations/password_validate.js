// validators/password_validate.js

export function password_validate(data) {
  const errores = [];

  const { passwordActual, passwordNueva } = data;

  if (!passwordActual) {
    errores.push("La contraseña actual es requerida.");
  }

  if (!passwordNueva) {
    errores.push("La nueva contraseña es requerida.");
    return errores; // si no hay nada que validar, salimos directo
  }

  if (passwordNueva.length < 8) {
    errores.push("La nueva contraseña debe tener al menos 8 caracteres.");
  }

  if (!/[A-Z]/.test(passwordNueva)) {
    errores.push("La nueva contraseña debe incluir al menos una mayúscula.");
  }

  if (!/[a-z]/.test(passwordNueva)) {
    errores.push("La nueva contraseña debe incluir al menos una minúscula.");
  }

  if (!/[0-9]/.test(passwordNueva)) {
    errores.push("La nueva contraseña debe incluir al menos un número.");
  }

  if (!/[^A-Za-z0-9]/.test(passwordNueva)) {
    errores.push(
      "La nueva contraseña debe incluir al menos un carácter especial.",
    );
  }

  if (passwordActual === passwordNueva) {
    errores.push("La nueva contraseña debe ser distinta a la actual.");
  }

  return errores;
}
