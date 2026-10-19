# Agregar un producto de pago

El módulo es genérico: el servicio y el controlador no conocen productos.
Cada producto define **precio**, **contexto**, **validaciones** y **qué se
aplica** al aprobarse el pago.

## 1. Backend: definición del producto

Crear `src/lib/pagos/productos/<nombre>.js` implementando el contrato:

```js
export const miProducto = {
  tipo: "mi_producto",              // CHECK de pagos.tipo (requiere migración)
  slug: "mi-producto",              // ruta POST /pagos/mi-producto
  campoContexto: "propiedad_id",    // nombre en el body
  campoContextoDb: "propiedad_id",  // columna en pagos
  prefijoReferencia: "mip",         // external_reference: mip-<id>-<hex>
  descripcion: "Texto para MP",
  moneda: "COP",
  mensajeYaAplicado: "…",
  datosYaAplicado: { /* respuesta 409 */ },

  precio: () => PRECIO_MI_PRODUCTO,
  maxCuotas: () => MP_MAX_INSTALLMENTS,

  async cargarContexto(id) { /* SELECT sin lock; null si no existe */ },
  async cargarContextoParaAplicar(client, id) {
    /* SELECT ... FOR UPDATE dentro de la transacción */
  },
  yaAplicado: (ctx) => Boolean(ctx?.mi_flag),

  async aplicar(client, { pago, ctx }) {
    /* UPDATE del derecho + UPDATE pagos SET aplicado_at = NOW() */
  },

  async estadoPublico(id) {
    /* campos que consume el frontend en /estado */
  },

  invalidarCache: () => "miClave*", // o null
};
```

Registrarlo en `productos/index.js`:

```js
import { miProducto } from "./miProducto.js";
const PRODUCTOS = [ubicacionOculta, miProducto];
```

`productosPublicos()` lo expone automáticamente en `GET /pagos/config`.

### Migración (solo si el CHECK no lo admite)

La tabla `pagos.tipo` tiene un `CHECK`. Para un tipo nuevo:

1. `src/database/migrations/0NN_pagos_tipo_<producto>.sql` (idempotente).
2. Replicar en `db.sql` (sección de migraciones).
3. Actualizar `drop_all.sql` si aplica.
4. `npm run db:check`.

No crear la migración sin confirmación explícita: la BD de desarrollo es
producción.

## 2. Frontend: configuración

En `web-inmobitwo/src/lib/pagos/productos.js`:

```js
export const PAGO_MI_PRODUCTO = {
  tipo: "mi_producto",
  slug: "mi-producto",
  campoContexto: "propiedad_id",
  titulo: "…",
  precioDefault: 12345,
  monedaDefault: "COP",
  maxCuotasDefault: 1,
  avisoVisible: "…",          // null para ocultar el aviso
  textoContinuar: "Continuar",
  textoContinuarSinPagar: "…",
  mensajes: { aprobado, reintento, sinConfirmar, pendiente, … },
  estaAplicado: (data) => Boolean(data?.mi_flag),
};
```

Registrarlo en `PRODUCTOS_PAGO` y usar:

```jsx
<PagoModal
  producto={PAGO_MI_PRODUCTO}
  abierto={abierto}
  contextoId={id}
  onClose={cerrar}
  onAprobado={recargar}
/>
```

`usePago(producto, contextoId)` ya maneja: config, envío, 409, 5xx,
reconciliación perezosa y estados de UI.

## 3. Pruebas mínimas

Agregar a `test/pagos.core.test.js` (puro) y
`test/pagos.integration.test.js`:

- payload y monto del producto;
- aprobado aplica el derecho;
- duplicado → `requiere_reembolso`;
- contexto borrado → `requiere_reembolso`;
- moneda/monto alterados → `requiere_reembolso`;
- 4xx → `rejected` (no bloquea reintento);
- 5xx/timeout → `iniciado`;
- webhook repetido no re-aplica;
- permisos (no dueño → 403) e inyección de campos ignorada.

## 4. Checklist

- [ ] `npm run test:unit`
- [ ] `npm run test:integration` (BD local, nunca producción)
- [ ] `npm run db:check`
- [ ] `node --check` de los archivos nuevos
- [ ] `npx eslint` del frontend
- [ ] Documentar precio/contexto en este directorio
- [ ] `graphify update .`
