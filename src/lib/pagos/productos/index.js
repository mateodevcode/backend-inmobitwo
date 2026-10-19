// src/lib/pagos/productos/index.js
// Registro de productos pagables. Para agregar uno nuevo:
//   1. Implementar el contrato de productos/ubicacionOculta.js.
//   2. Registrarlo aquí (por tipo y por slug de ruta).
//   3. (Opcional) declarar su columna de contexto en el body/ruta.
// El servicio y el controlador son genéricos: no conocen productos concretos.

import { ubicacionOculta } from "./ubicacionOculta.js";

const PRODUCTOS = [ubicacionOculta];

export const productoPorSlug = (slug) =>
  PRODUCTOS.find((p) => p.slug === slug) ?? null;

export const productoPorTipo = (tipo) =>
  PRODUCTOS.find((p) => p.tipo === tipo) ?? null;

export const productosPublicos = () =>
  Object.fromEntries(
    PRODUCTOS.map((p) => [
      p.tipo,
      {
        slug: p.slug,
        precio: p.precio(),
        moneda: p.moneda,
        max_cuotas: p.maxCuotas(),
      },
    ]),
  );
