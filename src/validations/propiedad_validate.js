import { validarOferta } from "./ofertas_validate.js";
import { getOperationCode, getPropertyTypeCode } from "../lib/catalogos.js";

const ESTADOS_PERMITIDOS = ["publicado", "no_publicado"];

export function propiedad_validate(datos, { requerirPublicador = true } = {}) {
  const errores = [];

  // El título lo genera el backend: si el cliente lo manda se valida el
  // formato, pero nunca es obligatorio.
  if (datos.titulo !== undefined && datos.titulo !== null && datos.titulo !== "") {
    if (datos.titulo.length < 3) {
      errores.push("El título debe tener al menos 3 caracteres.");
    } else if (datos.titulo.length > 500) {
      errores.push("El título no puede exceder los 500 caracteres.");
    }
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

export async function publicar_anuncio_validate(datos) {
  const errores = [];

  if (!datos.property_type_id) {
    errores.push("property_type_id es requerido.");
  }

  if (!datos.direccion) {
    errores.push("La dirección es requerida.");
  }

  if (!datos.city_id || !datos.state_id) {
    errores.push("city_id y state_id son requeridos.");
  }

  if (!datos.country_id) {
    errores.push("country_id es requerido.");
  }

  if (datos.estrato !== undefined && datos.estrato !== null && datos.estrato !== "") {
    const estrato = Number(datos.estrato);
    if (!Number.isInteger(estrato) || estrato < 1 || estrato > 6) {
      errores.push("El estrato debe ser un número entre 1 y 6.");
    }
  }

  const tipoCode = datos.property_type_id
    ? await getPropertyTypeCode(datos.property_type_id)
    : null;

  // Formato nuevo: array de ofertas [{ operation|operation_type_id, precio, ... }]
  if (Array.isArray(datos.ofertas)) {
    if (datos.ofertas.length === 0) {
      errores.push("Debe incluir al menos una oferta.");
    }
    for (const oferta of datos.ofertas) {
      const code = oferta.operation
        ? String(oferta.operation).toLowerCase()
        : await getOperationCode(oferta.operation_type_id);
      errores.push(
        ...(await validarOferta(code, oferta, { tipoInmuebleCode: tipoCode })),
      );
    }
  } else {
    // Formato antiguo: operation_type_id + precio + rental_type_id sueltos
    const code = await getOperationCode(datos.operation_type_id);
    if (!code) {
      errores.push("operation_type_id es requerido.");
    } else {
      errores.push(
        ...(await validarOferta(
          code,
          {
            precio: datos.precio,
            rental_type_id: datos.rental_type_id,
            parking_space_price: datos.parking_space_price,
            listing_status: datos.listing_status,
            expires_at: datos.expires_at,
          },
          { tipoInmuebleCode: tipoCode },
        )),
      );
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
