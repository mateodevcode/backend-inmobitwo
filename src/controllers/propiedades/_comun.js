// src/controllers/propiedades/_comun.js — helpers compartidos por los
// controladores de propiedades (normalización de campos, subqueries SQL
// reutilizables, utilidades de imágenes).
import { sanitizarHtml } from "../../lib/sanitizarHtml.js";
import { pool } from "../../db.js";
import { selectFields } from "../../lib/fieldSelection.helper.js";
import { CAMPOS_PROPIEDAD } from "../../constants/api/fields.js";

export const TAMANOS = ["thumbnail", "small", "medium", "large", "xlarge"];

// Normaliza los campos del schema v5.0 (Colombia) que llegan desde el frontend.
// En multipart/form-data todo llega como string; en JSON llegan como tipos reales.
export function toBool(valor) {
  return valor === "true" || valor === true;
}

export function toInt(valor) {
  if (valor === undefined || valor === null || valor === "") return null;
  const n = parseInt(valor);
  return isNaN(n) ? null : n;
}

// Extrae y normaliza los campos nuevos de propiedad a partir del body.
export function parseCamposPropiedad(raw) {
  return {
    operation_type_id: toInt(raw.operation_type_id),
    property_type_id: toInt(raw.property_type_id),
    condition_type_id: toInt(raw.condition_type_id),
    heating_type_id: toInt(raw.heating_type_id),
    rental_type_id: toInt(raw.rental_type_id),
    country_id: toInt(raw.country_id),
    state_id: toInt(raw.state_id),
    city_id: toInt(raw.city_id),
    barrio_id: toInt(raw.barrio_id),
    barrio_nombre: raw.barrio_nombre || null,
    direccion: raw.direccion || null,
    numero_direccion: raw.numero_direccion || null,
    floor: raw.floor || null,
    interior_apartment_number: raw.interior_apartment_number || null,
    postal_code: raw.postal_code || null,
    latitude: raw.latitude,
    longitude: raw.longitude,
    estrato: toInt(raw.estrato),
    cedula_catastral: raw.cedula_catastral || null,
    matricula_inmobiliaria: raw.matricula_inmobiliaria || null,
    description: raw.description ? sanitizarHtml(raw.description) : null,
    precio: toInt(raw.precio),
    administracion: toInt(raw.administracion),
    constructed_area: toInt(raw.constructed_area),
    private_area: toInt(raw.private_area),
    plot_area: toInt(raw.plot_area),
    room_count: toInt(raw.room_count),
    bedroom_count: toInt(raw.bedroom_count),
    bathroom_count: toInt(raw.bathroom_count),
    social_bathroom_count: toInt(raw.social_bathroom_count),
    construction_year: toInt(raw.construction_year),
    antiguedad_anios: toInt(raw.antiguedad_anios),
    is_new_construction: toBool(raw.is_new_construction),
    parqueadero_tipo: raw.parqueadero_tipo || null,
    parqueadero_modo: raw.parqueadero_modo || null,
    parking_space_count: toInt(raw.parking_space_count),
    parking_space_included: toBool(raw.parking_space_included),
    parking_space_price: toInt(raw.parking_space_price),
    tiene_agua: toBool(raw.tiene_agua),
    tiene_luz: toBool(raw.tiene_luz),
    tiene_gas: toBool(raw.tiene_gas),
    tiene_alcantarillado: toBool(raw.tiene_alcantarillado),
    has_elevator: toBool(raw.has_elevator),
    has_swimming_pool: toBool(raw.has_swimming_pool),
    has_gym: toBool(raw.has_gym),
    has_security_24h: toBool(raw.has_security_24h),
    has_air_conditioning: toBool(raw.has_air_conditioning),
    is_furnished: toBool(raw.is_furnished),
    zona: raw.zona || null,
    how_to_contact: raw.how_to_contact || null,
    telefono_contacto: raw.telefono_contacto || null,
    // Informativo (intención de pagar para ocultar). NUNCA activa nada:
    // la ocultación real solo la aplica pagos.service tras verificar el pago.
    ubicacion_oculta_solicitada: toBool(raw.ubicacion_oculta_solicitada),
  };
}

// Calcula el precio por m² según el precio y el área construida.
export function calcularPricePerSqm(precio, constructedArea) {
  if (precio > 0 && constructedArea > 0) {
    return Math.round(precio / constructedArea);
  }
  return null;
}

export function portadaSubquery(alias = "propiedades") {
  return `COALESCE(
    (SELECT pg.url FROM propiedades_galeria pg 
     WHERE pg.propiedad_id = ${alias}.id AND pg.es_portada = true AND pg.tamaño = 'medium'
     LIMIT 1),
    NULL
  ) as imagen_principal_url`;
}

export function portadaPublicIdSubquery(alias = "propiedades") {
  return `COALESCE(
    (SELECT pg.public_id FROM propiedades_galeria pg 
    WHERE pg.propiedad_id = ${alias}.id AND pg.es_portada = true AND pg.tamaño = 'medium'
    LIMIT 1),
    NULL
  ) as imagen_principal_public_id`;
}

// Fase 5 — ofertas por propiedad (misma forma que el servicio, sin N+1).
export function ofertasSubquery(alias = "p") {
  return `COALESCE(
    (SELECT json_agg(json_build_object(
      'id', l.id,
      'operation', ot2.code,
      'operation_type_id', l.operation_type_id,
      'precio', l.precio,
      'price_per_sqm', l.price_per_sqm,
      'rental_type_id', l.rental_type_id,
      'parking_space_price', l.parking_space_price,
      'listing_status', l.listing_status,
      'published_at', l.published_at,
      'expires_at', l.expires_at
    ) ORDER BY (ot2.code = 'venta') DESC, l.updated_at DESC)
    FROM property_listings l
    JOIN operation_types ot2 ON ot2.id = l.operation_type_id
    WHERE l.propiedad_id = ${alias}.id),
    '[]'::json
  ) as ofertas`;
}

// Fase 5 — JOIN a la oferta ACTIVA de la operación filtrada. opId proviene de
// nuestra propia consulta (entero saneado), igual que rentalList existente.
export function joinOfertaActiva(opId) {
  const id = Number(opId);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("Operación inválida para el filtro de ofertas.");
  }
  return `INNER JOIN property_listings l ON l.propiedad_id = p.id AND l.operation_type_id = ${id} AND l.listing_status = 'active'`;
}

// Resuelve el id de operation_types por code (para los filtros de búsqueda).
export async function operationIdPorCode(code) {
  const { rows } = await pool.query(
    "SELECT id FROM operation_types WHERE LOWER(code) = LOWER($1)",
    [String(code)],
  );
  return rows[0]?.id ?? null;
}

// Campos de los catálogos (schema v5.0) que se agregan a los SELECT de
// propiedades para que el frontend reciba labels en vez de solo IDs.
export function camposCatalogoSelect(alias = "p") {
  return `
    ot.label_es AS operacion,
    ot.code AS operacion_slug,
    rt.label_es AS tipo_alquiler,
    pt.label_es AS tipo_inmueble,
    pt.code AS tipo_slug,
    ct.label_es AS estado_conservacion,
    ht.label_es AS tipo_calefaccion,
    c.name AS ciudad,
    s.name AS departamento,
    b.name AS barrio
  `;
}

export function joinsCatalogo(alias = "p") {
  return `
    LEFT JOIN operation_types ot ON ${alias}.operation_type_id = ot.id
    LEFT JOIN rental_types rt ON ${alias}.rental_type_id = rt.id
    LEFT JOIN property_types pt ON ${alias}.property_type_id = pt.id
    LEFT JOIN condition_types ct ON ${alias}.condition_type_id = ct.id
    LEFT JOIN heating_types ht ON ${alias}.heating_type_id = ht.id
    LEFT JOIN cities c ON ${alias}.city_id = c.id
    LEFT JOIN states s ON ${alias}.state_id = s.id
    LEFT JOIN barrios b ON ${alias}.barrio_id = b.id
  `;
}

// Resuelve las columnas base de `propiedades` para Sparse Fieldsets (?fields=).
// El default es TODAS las permitidas (equivale al `p.*` actual pero sin `geom`),
// manteniendo backward compatibility con los formularios de edición.
export function resolverColumnasPropiedad(fields) {
  const { columnas, error } = selectFields(
    fields,
    CAMPOS_PROPIEDAD.permitidos,
    CAMPOS_PROPIEDAD.permitidos,
  );
  if (error) return { error };
  return { selectBase: columnas.map((c) => `p.${c}`).join(", "), error: null };
}

// Extrae el key real de S3 a partir de la URL completa que devuelve Rust.
// Esto es lo que se guarda como public_id de cada fila, para que el borrado
// en S3 funcione con el archivo real (no con un id inventado).
export function extractS3Key(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    return decodeURIComponent(u.pathname.replace(/^\//, ""));
  } catch {
    return null;
  }
}

// Convierte la respuesta de Rust (array de objetos {thumbnail, small, medium,
// large, xlarge}) en filas planas listas para insertar en
// propiedades_galeria / propiedades_planos. Cada foto genera hasta 5 filas
// (una por tamaño que Rust haya devuelto). Todas comparten el mismo `orden`
// (identifica que son la MISMA foto), pero cada una tiene su propio
// public_id real, extraído de su URL.
export function buildVersionRows(imagenesRust, startOrden = 0) {
  const rows = [];
  imagenesRust.forEach((img, i) => {
    const orden = startOrden + i;
    TAMANOS.forEach((tamano) => {
      const url = img[tamano];
      if (!url) return;
      rows.push({ url, public_id: extractS3Key(url), orden, tamaño: tamano });
    });
  });
  return rows;
}
