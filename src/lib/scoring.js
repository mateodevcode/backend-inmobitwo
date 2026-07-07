// src/lib/scoring.js
export const PESOS_EVENTOS = {
  vista_propiedad: 1,
  vista_imagen: 0.5,
  favorito_agregado: 5,
  click_telefono: 15,
  click_whatsapp: 15,
  formulario_enviado: 20,
  // tiempo_en_pagina NO va acá a propósito: no tiene sentido pesarlo por
  // CANTIDAD de eventos (3 eventos de 1s cada uno no deberían valer lo
  // mismo que 3 eventos de 60s). Se calcula aparte, por duración acumulada,
  // con calcularPuntosTiempo() más abajo.
};

export const UMBRAL_LEAD = 10; // score mínimo para generar un lead por comportamiento

// Cuántos segundos acumulados equivalen a 1 punto de score
export const SEGUNDOS_POR_PUNTO = 10;

// Tope de puntos que puede aportar el tiempo en página, para que no
// domine el score por sí solo (ej. alguien que deja la pestaña abierta
// sin estar realmente mirando no debería generar un lead solo por eso)
export const PUNTOS_MAX_TIEMPO = 8;

export const calcularScore = (eventosPorTipo) => {
  let score = 0;
  for (const [tipo, cantidad] of Object.entries(eventosPorTipo)) {
    const peso = PESOS_EVENTOS[tipo] || 0;
    score += peso * cantidad;
  }
  return score; // el redondeo final se hace una sola vez en el controller,
  // después de sumar también los puntos de tiempo (ver tracking.controllers.js)
};

// Convierte segundos acumulados de tiempo_en_pagina en puntos de score,
// con un tope máximo
export const calcularPuntosTiempo = (segundosTotales) => {
  return Math.min(segundosTotales / SEGUNDOS_POR_PUNTO, PUNTOS_MAX_TIEMPO);
};
