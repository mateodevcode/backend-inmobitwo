// Servicio de ofertas por operación. Todas las funciones reciben un `client`
// de pg YA dentro de una transacción (BEGIN lo abre la ruta, que hace
// COMMIT/ROLLBACK). Devuelven datos o lanzan HttpError { status, error }.
import {
  MATRIZ_OPERACIONES,
  MAX_PRECIO,
  OPERACIONES_SOPORTADAS,
} from "../constants/operaciones.js";
import { validarOferta } from "../validations/ofertas_validate.js";
import {
  getOperationCode,
  getOperationId,
  getPropertyTypeCode,
} from "./catalogos.js";
import { regenerarTitulo } from "./tituloPropiedad.js";

export class HttpError extends Error {
  constructor(status, error) {
    super(Array.isArray(error) ? error[0] : error);
    this.status = status;
    this.error = error;
  }
}

// Misma fórmula que calcularPricePerSqm del controlador (no se importa el
// controlador desde lib para no invertir dependencias).
function precioPorM2(precio, area) {
  if (precio > 0 && area > 0) return Math.round(precio / area);
  return null;
}

// Permiso: igual que updatePropiedades (solo dueño).
export async function verificarPropiedad(client, propiedadId, usuarioId) {
  const { rows } = await client.query(
    "SELECT id, publicado_por_id, property_type_id, constructed_area, private_area FROM propiedades WHERE id = $1",
    [propiedadId],
  );
  if (rows.length === 0) {
    throw new HttpError(404, "Propiedad no encontrada.");
  }
  if (rows[0].publicado_por_id !== usuarioId) {
    throw new HttpError(403, "No autorizado para editar esta propiedad.");
  }
  return rows[0];
}

export async function obtenerOfertas(client, propiedadId) {
  const { rows } = await client.query(
    `SELECT l.id, ot.code AS operation, l.operation_type_id, l.precio,
            l.price_per_sqm, l.rental_type_id, l.parking_space_price,
            l.listing_status, l.published_at, l.expires_at
     FROM property_listings l
     JOIN operation_types ot ON ot.id = l.operation_type_id
     WHERE l.propiedad_id = $1
     ORDER BY (ot.code = 'venta') DESC, l.updated_at DESC`,
    [propiedadId],
  );
  return rows;
}

function formaOferta(fila) {
  return {
    id: fila.id,
    operation: fila.operation,
    operation_type_id: fila.operation_type_id,
    precio: fila.precio === null ? null : Number(fila.precio),
    price_per_sqm:
      fila.price_per_sqm === null ? null : Number(fila.price_per_sqm),
    rental_type_id: fila.rental_type_id,
    parking_space_price: fila.parking_space_price,
    listing_status: fila.listing_status,
    published_at: fila.published_at,
    expires_at: fila.expires_at,
  };
}

async function marcarDescripcion(client, propiedadId) {
  await client.query(
    "UPDATE propiedades SET description_needs_review = TRUE WHERE id = $1",
    [propiedadId],
  );
}

// Tras borrar una oferta: si ya no queda arriendo se van las 'rent';
// si ya no queda venta, las 'sale'. Devuelve los códigos eliminados.
async function limpiarFeaturesNoAplicables(client, propiedadId) {
  // Al quedar sin arriendo se van las 'rent'; al quedar sin venta, las 'sale'.
  const { rows: restantes } = await client.query(
    `SELECT DISTINCT ot.code FROM property_listings l
     JOIN operation_types ot ON ot.id = l.operation_type_id
     WHERE l.propiedad_id = $1`,
    [propiedadId],
  );
  const codes = restantes.map((r) => String(r.code).toLowerCase());
  const quitar = [];
  if (!codes.includes("arriendo")) quitar.push("rent");
  if (!codes.includes("venta")) quitar.push("sale");
  if (quitar.length === 0) return [];
  const { rows: borradas } = await client.query(
    `DELETE FROM property_features pf
     USING feature_catalog fc
     WHERE pf.feature_id = fc.id
       AND pf.propiedad_id = $1
       AND fc.applies_to = ANY($2::text[])
     RETURNING fc.code`,
    [propiedadId, quitar],
  );
  return borradas.map((r) => r.code);
}

async function escribirHistorialOferta(client, { propiedadId, operationId, action, snapshot, usuarioId }) {
  await client.query(
    `INSERT INTO property_listing_history
       (propiedad_id, operation_type_id, action, snapshot, changed_by)
     VALUES ($1, $2, $3, $4, $5)`,
    [propiedadId, operationId, action, JSON.stringify(snapshot), usuarioId],
  );
}

// Añadir una operación a una propiedad (la propiedad queda en "ambas").
export async function crearOferta(client, { propiedadId, operation, datos = {}, usuarioId }) {
  const code = String(operation || "").toLowerCase();
  if (!OPERACIONES_SOPORTADAS.includes(code)) {
    throw new HttpError(
      400,
      `La operación debe ser una de: ${OPERACIONES_SOPORTADAS.join(", ")}.`,
    );
  }
  const propiedad = await verificarPropiedad(client, propiedadId, usuarioId);
  const operationId = await getOperationId(code);

  const { rows: existentes } = await client.query(
    "SELECT id FROM property_listings WHERE propiedad_id = $1 AND operation_type_id = $2",
    [propiedadId, operationId],
  );
  if (existentes.length > 0) {
    throw new HttpError(409, `La propiedad ya tiene oferta de ${code}.`);
  }

  const tipoCode = propiedad.property_type_id
    ? await getPropertyTypeCode(propiedad.property_type_id)
    : null;
  const errores = await validarOferta(code, datos, { tipoInmuebleCode: tipoCode });
  if (errores.length > 0) {
    throw new HttpError(400, errores);
  }

  const precio = parseInt(datos.precio, 10);
  const esVenta = code === "venta";
  const area =
    Number(propiedad.private_area) || Number(propiedad.constructed_area) || 0;
  const pricePerSqm = esVenta ? precioPorM2(precio, area) : null;

  const { rows: insertadas } = await client.query(
    `INSERT INTO property_listings
       (propiedad_id, operation_type_id, precio, price_per_sqm, rental_type_id,
        parking_space_price, listing_status, published_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     RETURNING *`,
    [
      propiedadId,
      operationId,
      precio,
      pricePerSqm,
      esVenta ? null : Number(datos.rental_type_id),
      datos.parking_space_price !== undefined &&
      datos.parking_space_price !== null &&
      datos.parking_space_price !== ""
        ? parseInt(datos.parking_space_price, 10)
        : null,
      datos.listing_status || "active",
    ],
  );

  await client.query(
    `INSERT INTO price_history (propiedad_id, old_price, new_price, change_type, source, operation_type_id)
     VALUES ($1, NULL, $2, 'initial', 'user_update', $3)`,
    [propiedadId, precio, operationId],
  );

  await marcarDescripcion(client, propiedadId);
  await regenerarTitulo(client, propiedadId);
  const { rows: titRows } = await client.query(
    'SELECT titulo FROM propiedades WHERE id = $1',
    [propiedadId],
  );
  const ofertas = await obtenerOfertas(client, propiedadId);
  return {
    propiedad_id: Number(propiedadId),
    titulo: titRows[0]?.titulo ?? null,
    description_needs_review: true,
    ofertas: ofertas.map(formaOferta),
  };
}

// Actualizar una oferta existente (solo campos permitidos de su operación).
export async function actualizarOferta(client, { propiedadId, operation, datos = {}, usuarioId }) {
  const code = String(operation || "").toLowerCase();
  if (!OPERACIONES_SOPORTADAS.includes(code)) {
    throw new HttpError(
      400,
      `La operación debe ser una de: ${OPERACIONES_SOPORTADAS.join(", ")}.`,
    );
  }
  const propiedad = await verificarPropiedad(client, propiedadId, usuarioId);
  const operationId = await getOperationId(code);
  const matriz = MATRIZ_OPERACIONES[code];

  const { rows: actuales } = await client.query(
    "SELECT * FROM property_listings WHERE propiedad_id = $1 AND operation_type_id = $2",
    [propiedadId, operationId],
  );
  if (actuales.length === 0) {
    throw new HttpError(404, `La propiedad no tiene oferta de ${code}.`);
  }
  const actual = actuales[0];

  const cambios = {};
  if (datos.precio !== undefined && datos.precio !== null && datos.precio !== "") {
    const precio = parseInt(datos.precio, 10);
    if (!Number.isInteger(precio) || precio <= 0 || precio > MAX_PRECIO) {
      throw new HttpError(
        400,
        `El precio debe ser un entero mayor a 0 y menor o igual a ${MAX_PRECIO}.`,
      );
    }
    cambios.precio = precio;
  }
  if (code === "arriendo" && datos.rental_type_id !== undefined && datos.rental_type_id !== null && datos.rental_type_id !== "") {
    cambios.rental_type_id = Number(datos.rental_type_id);
  }
  if (code === "venta" && datos.rental_type_id) {
    cambios.rental_type_id = null; // en venta se ignora/guarda NULL
  }
  if (datos.parking_space_price !== undefined) {
    cambios.parking_space_price =
      datos.parking_space_price === null || datos.parking_space_price === ""
        ? null
        : parseInt(datos.parking_space_price, 10);
  }
  if (datos.listing_status !== undefined && datos.listing_status !== null && datos.listing_status !== "") {
    if (!matriz.estados.includes(datos.listing_status)) {
      throw new HttpError(
        400,
        `El estado debe ser uno de: ${matriz.estados.join(", ")} para ${code}.`,
      );
    }
    cambios.listing_status = datos.listing_status;
  }
  if (datos.expires_at !== undefined) {
    cambios.expires_at = datos.expires_at || null;
  }

  if (Object.keys(cambios).length === 0) {
    throw new HttpError(400, "No hay campos de la oferta para actualizar.");
  }

  // Cambio de precio → historial + price_per_sqm (solo venta).
  if (cambios.precio !== undefined && cambios.precio !== Number(actual.precio)) {
    const changeType =
      actual.precio === null
        ? "initial"
        : cambios.precio > Number(actual.precio)
          ? "increase"
          : "decrease";
    await client.query(
      `INSERT INTO price_history (propiedad_id, old_price, new_price, change_type, source, operation_type_id)
       VALUES ($1, $2, $3, $4, 'user_update', $5)`,
      [propiedadId, actual.precio, cambios.precio, changeType, operationId],
    );
    if (code === "venta") {
      const area =
        Number(propiedad.private_area) || Number(propiedad.constructed_area) || 0;
      cambios.price_per_sqm = precioPorM2(cambios.precio, area);
    }
  }

  // Cambio de estado → historial + reglas entre ofertas.
  if (cambios.listing_status && cambios.listing_status !== actual.listing_status) {
    await escribirHistorialOferta(client, {
      propiedadId,
      operationId,
      action: "status_changed",
      snapshot: { antes: actual, despues: { ...actual, ...cambios } },
      usuarioId,
    });
    if (code === "venta" && cambios.listing_status === "sold") {
      await client.query(
        "UPDATE property_listings SET listing_status = 'inactive' WHERE propiedad_id = $1 AND operation_type_id <> $2",
        [propiedadId, operationId],
      );
    }
    // Arriendo a 'rented': la venta NO se toca (regla de negocio).
  }

  const columnas = Object.keys(cambios);
  const sets = columnas.map((c, i) => `${c} = $${i + 1}`).join(", ");
  const { rows: actualizadas } = await client.query(
    `UPDATE property_listings SET ${sets}, updated_at = CURRENT_TIMESTAMP
     WHERE propiedad_id = $${columnas.length + 1} AND operation_type_id = $${columnas.length + 2}
     RETURNING *`,
    [...columnas.map((c) => cambios[c]), propiedadId, operationId],
  );

  const ofertas = await obtenerOfertas(client, propiedadId);
  return {
    propiedad_id: Number(propiedadId),
    description_needs_review: false,
    ofertas: ofertas.map(formaOferta),
  };
}

// Quitar una oferta (rechaza si es la única).
export async function quitarOferta(client, { propiedadId, operation, usuarioId }) {
  const code = String(operation || "").toLowerCase();
  if (!OPERACIONES_SOPORTADAS.includes(code)) {
    throw new HttpError(
      400,
      `La operación debe ser una de: ${OPERACIONES_SOPORTADAS.join(", ")}.`,
    );
  }
  await verificarPropiedad(client, propiedadId, usuarioId);
  const operationId = await getOperationId(code);

  const { rows: todas } = await client.query(
    "SELECT * FROM property_listings WHERE propiedad_id = $1",
    [propiedadId],
  );
  const objetivo = todas.find((o) => o.operation_type_id === operationId);
  if (!objetivo) {
    throw new HttpError(404, `La propiedad no tiene oferta de ${code}.`);
  }
  if (todas.length <= 1) {
    throw new HttpError(
      409,
      "No se puede quitar la única oferta: para dejar de publicar usa estado no_publicado.",
    );
  }

  await client.query(
    "DELETE FROM property_listings WHERE propiedad_id = $1 AND operation_type_id = $2",
    [propiedadId, operationId],
  );

  // Tras borrar: si ya no queda arriendo, fuera características solo-rent;
  // si ya no queda venta, fuera las solo-sale.
  const eliminadas = await limpiarFeaturesNoAplicables(client, propiedadId);

  await escribirHistorialOferta(client, {
    propiedadId,
    operationId,
    action: "removed",
    snapshot: { oferta: objetivo, caracteristicas_eliminadas: eliminadas },
    usuarioId,
  });

  await marcarDescripcion(client, propiedadId);
  await regenerarTitulo(client, propiedadId);
  const { rows: titRows } = await client.query(
    'SELECT titulo FROM propiedades WHERE id = $1',
    [propiedadId],
  );
  const ofertas = await obtenerOfertas(client, propiedadId);
  return {
    propiedad_id: Number(propiedadId),
    titulo: titRows[0]?.titulo ?? null,
    description_needs_review: true,
    ofertas: ofertas.map(formaOferta),
  };
}

// Reemplazo atómico venta<->arriendo: el precio y rental NUNCA se heredan.
export async function cambiarOperacion(client, { propiedadId, desde, hacia, datos = {}, usuarioId }) {
  const desdeCode = String(desde || "").toLowerCase();
  const haciaCode = String(hacia || "").toLowerCase();
  for (const code of [desdeCode, haciaCode]) {
    if (!OPERACIONES_SOPORTADAS.includes(code)) {
      throw new HttpError(
        400,
        `La operación debe ser una de: ${OPERACIONES_SOPORTADAS.join(", ")}.`,
      );
    }
  }
  if (desdeCode === haciaCode) {
    throw new HttpError(400, "La operación de origen y destino deben diferir.");
  }
  const propiedad = await verificarPropiedad(client, propiedadId, usuarioId);
  const desdeId = await getOperationId(desdeCode);
  const haciaId = await getOperationId(haciaCode);

  const { rows: existeDesde } = await client.query(
    "SELECT * FROM property_listings WHERE propiedad_id = $1 AND operation_type_id = $2",
    [propiedadId, desdeId],
  );
  if (existeDesde.length === 0) {
    throw new HttpError(404, `La propiedad no tiene oferta de ${desdeCode}.`);
  }
  const { rows: existeHacia } = await client.query(
    "SELECT id FROM property_listings WHERE propiedad_id = $1 AND operation_type_id = $2",
    [propiedadId, haciaId],
  );
  if (existeHacia.length > 0) {
    throw new HttpError(409, `La propiedad ya tiene oferta de ${haciaCode}.`);
  }

  const tipoCode = propiedad.property_type_id
    ? await getPropertyTypeCode(propiedad.property_type_id)
    : null;
  const errores = await validarOferta(haciaCode, datos, { tipoInmuebleCode: tipoCode });
  if (errores.length > 0) {
    throw new HttpError(400, errores);
  }

  await escribirHistorialOferta(client, {
    propiedadId,
    operationId: desdeId,
    action: "switched",
    snapshot: { desde: desdeCode, hacia: haciaCode, oferta_anterior: existeDesde[0] },
    usuarioId,
  });

  await client.query(
    "DELETE FROM property_listings WHERE propiedad_id = $1 AND operation_type_id = $2",
    [propiedadId, desdeId],
  );

  const precio = parseInt(datos.precio, 10);
  const esVenta = haciaCode === "venta";
  const area =
    Number(propiedad.private_area) || Number(propiedad.constructed_area) || 0;

  const { rows: creadas } = await client.query(
    `INSERT INTO property_listings
       (propiedad_id, operation_type_id, precio, price_per_sqm, rental_type_id,
        parking_space_price, listing_status, published_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     RETURNING *`,
    [
      propiedadId,
      haciaId,
      precio,
      esVenta ? precioPorM2(precio, area) : null,
      esVenta
        ? null
        : datos.rental_type_id !== undefined && datos.rental_type_id !== null && datos.rental_type_id !== ""
          ? Number(datos.rental_type_id)
          : null,
      datos.parking_space_price !== undefined &&
      datos.parking_space_price !== null &&
      datos.parking_space_price !== ""
        ? parseInt(datos.parking_space_price, 10)
        : null,
      datos.listing_status || "active",
    ],
  );

  await client.query(
    `INSERT INTO price_history (propiedad_id, old_price, new_price, change_type, source, operation_type_id)
     VALUES ($1, NULL, $2, 'relisted', 'user_update', $3)`,
    [propiedadId, precio, haciaId],
  );

  await limpiarFeaturesNoAplicables(client, propiedadId);
  await marcarDescripcion(client, propiedadId);
  await regenerarTitulo(client, propiedadId);
  const { rows: titRows } = await client.query(
    "SELECT titulo FROM propiedades WHERE id = $1",
    [propiedadId],
  );
  const ofertas = await obtenerOfertas(client, propiedadId);
  return {
    propiedad_id: Number(propiedadId),
    titulo: titRows[0]?.titulo ?? null,
    description_needs_review: true,
    ofertas: ofertas.map(formaOferta),
  };
}
