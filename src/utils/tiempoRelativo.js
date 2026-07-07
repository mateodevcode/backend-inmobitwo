// utils/tiempoRelativo.js (backend)
export const tiempoRelativo = (fecha) => {
  const ahora = new Date(); // en el servidor sí es UTC correcto
  const creado = new Date(fecha);
  const segundos = Math.floor((ahora - creado) / 1000);

  if (segundos < 60) return "Hace unos segundos";

  const minutos = Math.floor(segundos / 60);
  if (minutos < 60) return `Hace ${minutos} min`;

  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `Hace ${horas} h`;

  const dias = Math.floor(horas / 24);
  if (dias < 7) return `Hace ${dias} día${dias > 1 ? "s" : ""}`;

  const semanas = Math.floor(dias / 7);
  if (semanas < 4) return `Hace ${semanas} semana${semanas > 1 ? "s" : ""}`;

  const meses = Math.floor(dias / 30);
  if (meses < 12) return `Hace ${meses} mes${meses > 1 ? "es" : ""}`;

  const años = Math.floor(dias / 365);
  return `Hace ${años} año${años > 1 ? "s" : ""}`;
};
