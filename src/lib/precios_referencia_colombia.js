// ============================================================================
// PRECIOS DE REFERENCIA POR M² PRIVADO — COLOMBIA 2026
// ============================================================================
// Fuente: Rangos de mercado basados en Banco de la República (IPVU/IPVNBR),
//         MetroCuadrado, La Galería Inmobiliaria y oferta de portales locales.
//         Valores representan el PRECIO MEDIO del rango por m² PRIVADO.
//         Se actualiza manualmente cada trimestre o se reemplaza por API real.
// ============================================================================

const PRECIOS_M2_PRIVADO = {
  // ─────────────────────────────────────────────
  // BOGOTÁ D.C. (Ciudad más cara del país)
  // ─────────────────────────────────────────────
  bogota: {
    6: 13500000,  // Chicó, Rosales, Cabrera, Nogal — Zonas de lujo
    5:  6500000,  // Chapinero, Santa Bárbara, Cedritos, El Nogal
    4:  4200000,  // Pasadena, Modelia, Colina Campestre, Ciudad Salitre
    3:  2800000,  // Kennedy, Bosa, Engativá, Fontibón, Suba (sectores)
    2:  1900000,  // Usme, San Cristóbal, Tunjuelito, Rafael Uribe
    1:  1300000,  // Ciudad Bolívar, Bosa (sectores), Usme (sectores rurales)
  },

  // ─────────────────────────────────────────────
  // MEDELLÍN (Segunda ciudad más cara)
  // ─────────────────────────────────────────────
  medellin: {
    6:  8500000,  // El Poblado (más caro), Laureles, Castropol, Astorga
    5:  5200000,  // Estadio, Belén (sectores), Envigado (sectores altos), Sabaneta
    4:  3200000,  // Belén, Laureles (sectores), Calasanz, Castilla
    3:  2100000,  // Aranjuez, Manrique, Villa Hermosa, Robledo
    2:  1400000,  // San Javier, La Candelaria (sectores), Santa Cruz
    1:   950000,  // Popular, Santo Domingo, Manrique (sectores bajos)
  },

  // ─────────────────────────────────────────────
  // CALI (Tercera ciudad, precios moderados)
  // ─────────────────────────────────────────────
  cali: {
    6:  5500000,  // Ciudad Jardín, Granada, San Antonio, El Peñón
    5:  3800000,  // Santa Teresita, La Flora, Versalles, Juanambú
    4:  2600000,  // Tequendama, Panamericano, El Ingenio, Ciudad Capri
    3:  1700000,  // Alfonso López, Jorge Isaacs, Meléndez, Pampalinda
    2:  1150000,  // Agua Blanca, Siloé, Potrero Grande, Mojica
    1:   750000,  // Petecuy, Villacolombia, Polvorines (sectores)
  },

  // ─────────────────────────────────────────────
  // BARRANQUILLA (Costa Caribe, crecimiento alto)
  // ─────────────────────────────────────────────
  barranquilla: {
    6:  4800000,  // Alto Prado, Villa Country, Villa Santos, Buenavista
    5:  3200000,  // Riomar, Villa Campestre, La Castellana, Colombia
    4:  2200000,  // San Vicente, Boston, El Prado (sectores), La Concepción
    3:  1500000,  // Las Flores, San Roque, La Chinita, Rebolo
    2:  1000000,  // La Paz, La Victoria, Siape, Montes
    1:   700000,  // Las Nieves, San Felipe, Sabanilla (sectores rurales)
  },

  // ─────────────────────────────────────────────
  // CARTAGENA (Turismo + costa, precios irregulares)
  // ─────────────────────────────────────────────
  cartagena: {
    6:  6000000,  // Bocagrande, Castillogrande, El Laguito, manga (sectores altos)
    5:  4000000,  // Crespo, Pie de la Popa, Cabrero, Marbella
    4:  2800000,  // Torices, El Bosque, San Diego, La Matuna
    3:  1900000,  // San Fernando, Olaya, Chiquinquirá, Nelson Mandela
    2:  1300000,  // Pozón, La María, Bayunca (sectores), Zaragocilla
    1:   850000,  // Santa Rosa, San Francisco, Canapote (sectores rurales)
  },

  // ─────────────────────────────────────────────
  // BUCARAMANGA (Ciudad bonita, precios estables)
  // ─────────────────────────────────────────────
  bucaramanga: {
    6:  4500000,  // Cabecera del Llano, Cañaveral, San Francisco, Diamante II
    5:  3000000,  // Provenza, Girardot, Lagos del Cacique, La Aurora
    4:  2100000,  // Centro, San Alonso, Mutis, La Joya
    3:  1450000,  // García Rovira, San Cristóbal, El Tejar, La Estrada
    2:   980000,  // Morrorico, La Juventud, Commune 14, Nuevo Símbolo
    1:   680000,  // El Pozón, La Isla, Morrorico (sectores bajos)
  },

  // ─────────────────────────────────────────────
  // PEREIRA (Eje Cafetero, crecimiento)
  // ─────────────────────────────────────────────
  pereira: {
    6:  3800000,  // Pinares, Alamos, Los Alpes, San Joaquín
    5:  2600000,  // Cuba, Galicia, El Jardín, Villa del Prado
    4:  1800000,  // Centro, Boston, San Nicolás, Ferrocarril
    3:  1250000,  // El Oso, Villa Santana, 30 de Agosto, El Rocío
    2:   850000,  // El Pollo, La Badea, El Diamante, El Poblado (sector)
    1:   580000,  // Combia, Morelia, La Bella, Tribunas
  },

  // ─────────────────────────────────────────────
  // MANIZALES (Eje Cafetero, universitaria)
  // ─────────────────────────────────────────────
  manizales: {
    6:  3500000,  // Palogrande, La Francia, Bajo Palogrande, Niza
    5:  2400000,  // Cable, Chipre, San José, La Macarena
    4:  1700000,  // Centro, Cumanday, San Jorge, Campohermoso
    3:  1180000,  // Perseverancia, Ecoturismo, Santa Elena, San Fermín
    2:   800000,  // Villa María, San Silvestre, La Cumbre, Aranjuez
    1:   550000,  // Morrogacho, Alto Morrogacho, El Remanso
  },

  // ─────────────────────────────────────────────
  // CÚCUTA (Frontera, precios bajos)
  // ─────────────────────────────────────────────
  cucuta: {
    6:  2800000,  // Caobos, Quinta Oriental, La Playa, San Luis
    5:  1900000,  // La Cabrera, Ceiba, La Salle, Los Patios (sectores altos)
    4:  1350000,  // Centro, San Luis, La Salle (sectores), Caobos (sectores)
    3:   950000,  // Libertadores, Latino, San Mateo, El Escobal
    2:   650000,  // Aeropuerto, San Rafael, Atalaya, San Felipe
    1:   450000,  // San Rafael (sectores), La Parada, San Faustino
  },

  // ─────────────────────────────────────────────
  // IBAGUÉ (Tolima, precios accesibles)
  // ─────────────────────────────────────────────
  ibague: {
    6:  3200000,  // Ambalá, Picaleña, La Arboleda, Multicentro
    5:  2200000,  // Santa Bárbara, El Carmen, Jordán, La Pola
    4:  1550000,  // Centro, El Salado, Cádiz, Belén
    3:  1080000,  // El Topacio, El Vergel, San Fernando, El Carmen (sectores)
    2:   730000,  // El Salado (sectores), Belén (sectores), El Carmen bajo
    1:   500000,  // El Salado rural, sectores aledaños a la cocha
  },

  // ─────────────────────────────────────────────
  // VILLAVICENCIO (Llano, crecimiento petrolero)
  // ─────────────────────────────────────────────
  villavicencio: {
    6:  3600000,  // Barzal, Vanguardia, Bochalema, San Benito
    5:  2500000,  // El Recreo, El Centro, Barzal (sectores), Catumare
    4:  1750000,  // Covisan, El Carmen, Nueva Colombia, Pueblo Nuevo
    3:  1200000,  // San Antonio, La Esperanza, El Porvenir, El Progreso
    2:   820000,  // 12 de Octubre, La Reliquia, Los Centauros, La Rochela
    1:   560000,  // El Progreso (sectores), La Rochela (sectores rurales)
  },

  // ─────────────────────────────────────────────
  // NEIVA (Huila, capital)
  // ─────────────────────────────────────────────
  neiva: {
    6:  3000000,  // Santa Mónica, Santa Inés, El Edén, San Pedro
    5:  2100000,  // Santa Mónica (sectores), San Francisco, El Edén (sectores)
    4:  1480000,  // Centro, San José, La Toma, El Caguán
    3:  1020000,  // San Pedro (sectores), La Toma (sectores), El Caguán bajo
    2:   700000,  // La Libertad, San Jorge, San Antonio, El Carmen
    1:   480000,  // Comuneros, La Libertad (sectores), sectores rurales
  },

  // ─────────────────────────────────────────────
  // SANTA MARTA (Costa, turismo + local)
  // ─────────────────────────────────────────────
  santa_marta: {
    6:  4200000,  // Rodadero, Pozos Colorados, Bello Horizonte, Jardín
    5:  2900000,  // Centro Histórico (sectores altos), Bavaria, 11 de Noviembre
    4:  2000000,  // Centro, Bastidas, Pescaíto, Ciudad Equidad
    3:  1380000,  // Bastidas (sectores), 20 de Julio, Gaira, Bureche
    2:   950000,  // Pescaíto (sectores), Gaira (sectores), Bureche bajo
    1:   650000,  // Taganga rural, Bureche rural, sectores de la Sierra
  },

  // ─────────────────────────────────────────────
  // MONTERÍA (Sinú, precios creciendo)
  // ─────────────────────────────────────────────
  monteria: {
    6:  3400000,  // Castellana, Buenavista, La Castellana, Alameda
    5:  2350000,  // El Recreo, La Pradera, San José, El Carmen
    4:  1650000,  // Centro, El Carmen (sectores), San Antonio, La Pradera bajo
    3:  1150000,  // El Bosque, San Antonio (sectores), La Granja, La Pradera
    2:   780000,  // El Bosque (sectores), La Granja (sectores), sectores rurales
    1:   530000,  // Sectores rurales de los corregimientos
  },

  // ─────────────────────────────────────────────
  // PASTO (Nariño, precios bajos)
  // ─────────────────────────────────────────────
  pasto: {
    6:  2600000,  // San Felipe, San Juan de Dios, La Aurora, Santiago
    5:  1800000,  // San Andrés, San Juan de Dios (sectores), Santiago (sectores)
    4:  1260000,  // Centro, San Andrés (sectores), San Agustín, El Poblado
    3:   880000,  // San Agustín (sectores), El Poblado (sectores), Catambuco
    2:   600000,  // Catambuco, El Encano, sectores aledaños al volcán
    1:   410000,  // Corregimientos rurales, sectores altoandinos
  },

  // ─────────────────────────────────────────────
  // PROMEDIO NACIONAL (Fallback si no encuentra la ciudad)
  // ─────────────────────────────────────────────
  nacional: {
    6:  6500000,
    5:  4200000,
    4:  2900000,
    3:  1950000,
    2:  1320000,
    1:   900000,
  }
};

// ============================================================================
// MULTIPLICADORES DE CORRECCIÓN
// ============================================================================

const MULTIPLICADORES = {
  // ── Estado de conservación ──
  estado: {
    nuevo:            1.15,   // Nuevo (sin estrenar, recién construido)
    para_estrenar:    1.12,   // Para estrenar (nadie ha vivido)
    usado:            1.00,   // Usado (estándar)
    remodelado:       1.08,   // Remodelado recientemente
    para_remodelar:   0.85,   // Para reformar (descuento)
    obra_negra:       0.75,   // Obra negra (sin acabados)
    obra_gris:        0.80,   // Obra gris (estructura, sin pañetes)
    en_construccion:  0.90,   // En construcción (preventa)
  },

  // ── Antigüedad (se calcula desde construction_year) ──
  // 0-5 años: 1.00 (sin depreciación)
  // 6-15 años: -1% por año
  // 16-30 años: -1.5% por año
  // >30 años: -2% por año (hasta -40% máximo)
  antiguedad: (anios) => {
    if (anios <= 5)  return 1.00;
    if (anios <= 15) return 1.00 - ((anios - 5) * 0.01);
    if (anios <= 30) return 0.90 - ((anios - 15) * 0.015);
    return Math.max(0.60, 0.675 - ((anios - 30) * 0.02));
  },

  // ── Piso / Ubicación vertical ──
  piso: {
    ph:               1.08,   // Penthouse / último piso
    alto_vista:       1.05,   // Piso alto con vista (7+ en edificio de 10+)
    alto:             1.02,   // Piso alto sin vista especial
    medio:            1.00,   // Pisos intermedios
    bajo:             0.97,   // Piso bajo (1-2) con ascensor
    bajo_sin_asc:     0.93,   // Planta baja sin ascensor en edificio +3 pisos
    sotano:           0.85,   // Sótano / semisótano
  },

  // ── Amenities del conjunto (acumulativos, máx +8%) ──
  amenities: (features = []) => {
    let factor = 1.00;
    const cuenta = features.filter(f => [
      'piscina', 'gimnasio', 'salon_social', 'zona_bbq',
      'canchas', 'juegos_infantiles', 'zonas_verdes'
    ].includes(f)).length;

    if (cuenta >= 4) factor += 0.08;
    else if (cuenta >= 2) factor += 0.05;
    else if (cuenta >= 1) factor += 0.02;

    // Ascensor es indispensable en edificios altos
    if (features.includes('ascensor')) factor += 0.02;
    else factor -= 0.03; // Penalización si NO tiene ascensor y el edificio tiene +3 pisos

    // Seguridad premium
    if (features.includes('porteria_24h') || features.includes('vigilancia_privada')) factor += 0.02;

    return Math.min(1.12, factor);
  },

  // ── Zona de uso del suelo ──
  zona: {
    residencial:      1.00,
    comercial:        1.05,   // Comercial en zona comercial = premium
    industrial:       0.90,   // Industrial en zona industrial
    mixta:            1.02,   // Mixta permite más usos
    campestre:        0.95,   // Campestre / rural
    rural:            0.85,   // Rural puro
  },
};

// ============================================================================
// VALORES FIJOS AGREGADOS (en COP)
// ============================================================================

const VALORES_FIJOS = {
  parqueadero: {
    privado_cubierto:   50000000,   // +$50M
    privado_descubierto: 30000000,   // +$30M
    comunal_cubierto:    15000000,   // +$15M
    comunal_descubierto:  5000000,   // +$5M
    no_tiene:                     0,   // $0
  },
  // Administración sugerida por estrato + amenities
  administracion: (estrato, tiene_piscina_gym = false) => {
    const base = {
      6: 600000, 5: 450000, 4: 350000,
      3: 250000, 2: 150000, 1: 80000
    };
    const extra = tiene_piscina_gym ? 100000 : 0;
    return { min: base[estrato], max: base[estrato] + extra + 50000 };
  }
};

// ============================================================================
// FUNCIÓN PRINCIPAL: calcularPrecioSugerido()
// ============================================================================

// Redondea a números "limpios" según la magnitud:
// >= 10M → a la unidad de millón | >= 1M → a la centena de mil
// >= 100k → a la decena de mil | >= 10k → a la mil | resto → a la centena
function redondear(valor) {
  if (valor === null || valor === undefined || isNaN(valor)) return valor;
  if (valor >= 10000000) return Math.round(valor / 1000000) * 1000000;
  if (valor >= 1000000) return Math.round(valor / 100000) * 100000;
  if (valor >= 100000) return Math.round(valor / 10000) * 10000;
  if (valor >= 10000) return Math.round(valor / 1000) * 1000;
  return Math.round(valor / 100) * 100;
}

/**
 * Calcula el precio sugerido de una propiedad basado en datos de mercado colombiano.
 * @param {Object} datos - Datos de la propiedad
 * @returns {Object} { precio_min, precio_max, precio_promedio, price_per_sqm, mensaje, nivel }
 */
function calcularPrecioSugerido(datos) {
  const {
    ciudad = 'nacional',           // slug de la ciudad
    estrato = 4,                   // 1-6
    private_area = 0,              // m² área privada
    constructed_area = 0,          // m² construida (para price_per_sqm alternativo)
    condition_type_code = 'usado', // code de condition_types
    construction_year = null,      // AAAA
    floor_type = 'medio',          // 'ph', 'alto_vista', 'alto', 'medio', 'bajo', 'bajo_sin_asc', 'sotano'
    features = [],                 // Array de codes de feature_catalog
    parqueadero_tipo = null,       // 'cubierto', 'descubierto', null
    parqueadero_modo = null,       // 'privado', 'comunal', null
    zona = 'residencial',          // 'residencial', 'comercial', etc.
  } = datos;

  // 1. Precio base por m²
  const ciudadSlug = ciudad.toLowerCase().replace(/\s+/g, '_');
  const preciosCiudad = PRECIOS_M2_PRIVADO[ciudadSlug] || PRECIOS_M2_PRIVADO.nacional;
  const precioM2Base = preciosCiudad[estrato] || preciosCiudad[4] || 2900000;

  // 2. Área a usar (privada preferida, fallback a construida)
  const area = private_area > 0 ? private_area : (constructed_area > 0 ? constructed_area : 0);
  if (area === 0) {
    return { error: 'Se requiere área privada o construida para calcular el precio' };
  }

  // 3. Precio base total
  let precio = precioM2Base * area;

  // 4. Multiplicador de estado
  const factorEstado = MULTIPLICADORES.estado[condition_type_code] || 1.00;
  precio *= factorEstado;

  // 5. Multiplicador de antigüedad
  if (construction_year) {
    const anios = new Date().getFullYear() - construction_year;
    const factorAntiguedad = MULTIPLICADORES.antiguedad(anios);
    precio *= factorAntiguedad;
  }

  // 6. Multiplicador de piso
  const factorPiso = MULTIPLICADORES.piso[floor_type] || 1.00;
  precio *= factorPiso;

  // 7. Multiplicador de amenities
  const factorAmenities = MULTIPLICADORES.amenities(features);
  precio *= factorAmenities;

  // 8. Multiplicador de zona
  const factorZona = MULTIPLICADORES.zona[zona] || 1.00;
  precio *= factorZona;

  // 9. Valor fijo de parqueadero
  let valorParqueadero = 0;
  if (parqueadero_tipo && parqueadero_modo) {
    const key = `${parqueadero_modo}_${parqueadero_tipo}`;
    valorParqueadero = VALORES_FIJOS.parqueadero[key] || 0;
  }
  precio += valorParqueadero;

  // 10. Rango de sugerencia (±10%) redondeado a números limpios
  const precioPromedio = redondear(precio);
  const precioMin = redondear(precio * 0.90);
  const precioMax = redondear(precio * 1.10);
  const pricePerSqm = redondear(precioPromedio / area);

  // 11. Administración sugerida
  const tienePiscinaGym = features.includes('piscina') || features.includes('gimnasio');
  const adminSugerida = VALORES_FIJOS.administracion(estrato, tienePiscinaGym);

  return {
    precio_sugerido_min: precioMin,
    precio_sugerido_max: precioMax,
    precio_sugerido_promedio: precioPromedio,
    price_per_sqm_sugerido: pricePerSqm,
    factor_estrato: 1.00, // ya está en el precio base
    factor_estado: factorEstado,
    factor_antiguedad: construction_year ? MULTIPLICADORES.antiguedad(new Date().getFullYear() - construction_year) : 1.00,
    factor_piso: factorPiso,
    factor_amenities: factorAmenities,
    factor_zona: factorZona,
    valor_parqueadero: redondear(valorParqueadero),
    administracion_sugerida: {
      min: redondear(adminSugerida.min),
      max: redondear(adminSugerida.max),
    },
    mensaje: null,
    nivel: 'calculado'
  };
}

/**
 * Compara el precio del usuario contra el precio sugerido y devuelve indicador.
 * @param {number} precioUsuario - Precio que puso el usuario
 * @param {Object} sugerido - Resultado de calcularPrecioSugerido()
 * @returns {Object} { mensaje, nivel, diferencia_porcentaje }
 */
function validarPrecioUsuario(precioUsuario, sugerido) {
  const promedio = sugerido.precio_sugerido_promedio;
  const diff = ((precioUsuario - promedio) / promedio) * 100;

  if (diff > 25) {
    return {
      mensaje: `⚠️ Tu precio está ${Math.round(diff)}% sobre el mercado. Considera ajustar para vender/arrendar más rápido.`,
      nivel: 'sobrevalorado',
      diferencia_porcentaje: Math.round(diff)
    };
  }
  if (diff > 15) {
    return {
      mensaje: `🟡 Tu precio está ${Math.round(diff)}% sobre el mercado. Aún aceptable si tiene diferenciadores únicos.`,
      nivel: 'alto',
      diferencia_porcentaje: Math.round(diff)
    };
  }
  if (diff < -25) {
    return {
      mensaje: `🔥 Tu precio está ${Math.round(Math.abs(diff))}% bajo el mercado. ¡Muy atractivo para compradores!`,
      nivel: 'oportunidad',
      diferencia_porcentaje: Math.round(diff)
    };
  }
  if (diff < -15) {
    return {
      mensaje: `✅ Tu precio está ${Math.round(Math.abs(diff))}% bajo el mercado. Competitivo.`,
      nivel: 'bueno',
      diferencia_porcentaje: Math.round(diff)
    };
  }
  return {
    mensaje: `✅ Tu precio está dentro del rango de mercado.`,
    nivel: 'optimo',
    diferencia_porcentaje: Math.round(diff)
  };
}

// ============================================================================
// EXPORTACIÓN
// ============================================================================

export {
  PRECIOS_M2_PRIVADO,
  MULTIPLICADORES,
  VALORES_FIJOS,
  calcularPrecioSugerido,
  validarPrecioUsuario
};

// ============================================================================
// EJEMPLOS DE USO
// ============================================================================

/*
// Apartamento en Bogotá, estrato 4, 78m², para estrenar, piso 8, piscina+gym
const resultado = calcularPrecioSugerido({
  ciudad: 'bogota',
  estrato: 4,
  private_area: 78,
  condition_type_code: 'para_estrenar',
  construction_year: 2024,
  floor_type: 'alto_vista',
  features: ['piscina', 'gimnasio', 'ascensor', 'porteria_24h'],
  parqueadero_tipo: 'cubierto',
  parqueadero_modo: 'privado',
  zona: 'residencial'
});
// Resultado esperado: ~$480M - $550M

const validacion = validarPrecioUsuario(520000000, resultado);
// Resultado: "🟡 Tu precio está 8% sobre el mercado..."
*/
