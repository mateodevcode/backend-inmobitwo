// Fuente única de verdad para el modelo de ofertas por operación.
// arriendo_venta: solo lectura/heredado (no se crea ni se combina).
export const OPERACIONES_SOPORTADAS = ["venta", "arriendo"]; // arriendo_venta: solo lectura/heredado
export const MATRIZ_OPERACIONES = {
  venta: {
    requeridos: ["precio"],
    permitidos: ["precio", "parking_space_price", "listing_status", "expires_at"],
    derivados: ["price_per_sqm"],
    estados: ["active", "inactive", "sold", "expired"],
  },
  arriendo: {
    requeridos: ["precio", "rental_type_id"],
    permitidos: ["precio", "rental_type_id", "parking_space_price", "listing_status", "expires_at"],
    derivados: [],
    estados: ["active", "inactive", "rented", "expired"],
  },
};
export const MAX_PRECIO = 2147483647; // TODO: subir al migrar propiedades.precio a BIGINT
