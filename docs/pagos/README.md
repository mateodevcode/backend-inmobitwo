# Módulo de pagos (Mercado Pago Colombia — Orders API)

Cobros únicos con **Payment Brick** + **Orders API** (`POST /v1/orders`).
El cliente nunca envía el monto: el precio lo fija el servidor por producto.
La fuente de verdad es siempre la API de Mercado Pago; la base local solo
registra el intento y el derecho aplicado.

## Arquitectura

```
backend-inmobitwo/src/
├── lib/pagos/
│   ├── mp.client.js          HTTP crudo de MP + payload de /v1/orders + errores
│   ├── mp.estados.js         mapeo de estados MP → estados locales (puro)
│   ├── firma.js              manifiesto + HMAC del webhook (puro)
│   ├── pago.service.js       flujo genérico: crear, sincronizar, caducar, reconciliar
│   └── productos/
│       ├── index.js          registro (slug ↔ tipo, config pública)
│       └── ubicacionOculta.js producto "ocultar ubicación"
├── controllers/pagos.controllers.js   handlers HTTP genéricos
├── routes/pagos.routes.js             rutas
└── jobs/pagos.job.js                  reconciliación cada 10 min
```

Frontend:

```
web-inmobitwo/src/
├── lib/pagos/productos.js                 config de productos (textos/endpoints)
├── hooks/usePago.js                       estado del pago (genérico)
├── hooks/usePagoUbicacionOculta.js        wrapper de compatibilidad
├── components/pagos/PagoModal.jsx         modal + Brick (genérico)
└── components/pagos/PagoUbicacionOculta.jsx wrapper de compatibilidad
```

Para agregar un producto ver [nuevo-producto.md](./nuevo-producto.md).

## Flujo de un cobro

1. El frontend pide `GET /pagos/config` (precio, moneda, cuotas, habilitado).
2. El Brick tokeniza la tarjeta (el token es de un solo uso).
3. `POST /pagos/:producto` con `{ <campoContexto>, token, payment_method_id,
   payment_type, installments, payer }`.
4. El backend valida propiedad/autorización, inserta `pagos` en `iniciado`
   **antes** de llamar a MP y hace `POST /v1/orders` con `X-Idempotency-Key`.
5. El estado de la orden se persiste (`mp_payment_id`, `mp_transaction_id`,
   `estado`, `estado_detalle`).
6. Si la orden quedó `processed + accredited`, se activa de inmediato; si no,
   el webhook o el cron de reconciliación la confirman.
7. Al aprobarse se aplica el derecho del producto (aquí: punto público
   desplazado 150–400 m) dentro de una transacción, una sola vez.

## Endpoints

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | `/pagos/config` | token | Config pública (`productos.*`) |
| POST | `/pagos/:producto` | token | Inicia el cobro |
| GET | `/pagos/:producto/:contextoId/estado` | token + dueño | Último pago + reconciliación perezosa |
| POST | `/pagos/mp/webhook` | firma HMAC | Notificaciones de MP |

Rutas con el mismo formato que antes del refactor:
`/pagos/ubicacion-oculta` y `/pagos/ubicacion-oculta/:propiedadId/estado`
(las resuelve el parámetro `:producto`; no hay cambios para el frontend).

## Estados locales (`pagos.estado`)

| Estado | Significado |
|---|---|
| `iniciado` | Fila creada; aún sin orden de MP confirmada |
| `pending` | `action_required` (espera acción del usuario) |
| `in_process` | `processing` / `created` |
| `approved` | `processed + accredited`; puede faltar aplicar el derecho |
| `rejected` | `failed` o error 4xx de validación (sin cobro) |
| `cancelled` | Orden cancelada |
| `expirado` | Intento sin id de MP, mayor a 10 min, sin orden hallada |
| `refunded` / `charged_back` | Reembolso/contracargo; **nunca** activan |

Reglas clave:

- `5xx`/timeout **no** se marcan `rejected`: la fila queda `iniciado` con su
  idempotency key y la reconciliación decide. Nunca se cobra dos veces.
- La búsqueda por `external_reference` solo expira si la consulta fue
  confiable (2xx). Un `5xx`/401 deja el intento intacto.
- `409` al crear orden: hay un pago en curso (doble pestaña) o idempotencia;
  se devuelve el estado, no se cobra de nuevo.
- La activación es idempotente por `verificado_at`; un webhook repetido no
  vuelve a aplicar el derecho.

## Documentos

- [nuevo-producto.md](./nuevo-producto.md) — agregar un producto pagable.
- [variables-entorno.md](./variables-entorno.md) — variables y valores.
- [runbook.md](./runbook.md) — incidentes y webhooks perdidos.
- [operacion.md](./operacion.md) — consultas, reembolsos y monitoreo.
- [checklist-produccion.md](./checklist-produccion.md) — antes de cobrar real.
- [suscripciones.md](./suscripciones.md) — diseño para el siguiente producto.
