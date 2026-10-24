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

## Webhooks: firma, app y secreto

### Manifiesto

`x-signature` trae `ts=<ms>,v1=<hmac>`. El manifiesto oficial es:

```text
id:<data.id>;request-id:<x-request-id>;ts:<ts>;
```

- `data.id` se toma del query param `data.id`; si el emisor no lo manda, se
  usa `body.data.id`. El id usado para firmar es el mismo que se consulta en
  `GET /v1/orders/{id}`.
- La doc de MP para Orders pide `data.id` en **minúsculas** en el manifiesto.
  El SDK oficial de Node lo usa tal cual. Para cubrir ambos, `firma.js`
  calcula `asis` y `lower` y acepta la que coincida; el log indica
  `variante=asis|lower`.
- Si falta `x-request-id`, se omite del manifiesto.
- Se hace `trim` de `data.id`/`x-request-id` y la comparación es en tiempo
  constante.
- `ts` se acepta en ms o segundos; tolerancia de 7 días por los reintentos
  de MP.

### De quién es el secreto (importante)

El secreto **no es del comprador**. Es de la **aplicación de Mercado Pago
del vendedor** que crea/procesa la order:

1. El backend crea la order con `MP_ACCESS_TOKEN` de la app del vendedor.
2. El comprador paga con su tarjeta; no tiene app, access token ni secreto.
3. MP firma el webhook con la **Clave secreta de Webhooks** de esa app.
4. El backend valida con `MP_WEBHOOK_SECRET`.

Por eso `MP_ACCESS_TOKEN`, `NEXT_PUBLIC_MP_PUBLIC_KEY` y
`MP_WEBHOOK_SECRET` deben pertenecer a la **misma app** y al **mismo
ambiente** (prueba/producción). Si el token es de una app y el secreto de
otra, el webhook responde 401 aunque el pago exista.

El body del webhook identifica:

- `application_id`: app que generó la order.
- `user_id`: cuenta de MP del vendedor.

Si `application_id` no coincide con la app de la que salió
`MP_WEBHOOK_SECRET`, la firma no valida.

### Prueba vs producción

- **Prueba:** la order la crea el usuario vendedor de prueba y su app. El
  secreto debe salir de esa app de prueba.
- **Producción:** la order la crea la app de producción del
  vendedor/plataforma. El secreto debe salir de esa app de producción.
- El comprador (real o de prueba) **nunca** entrega la clave.
- Si cada organización usa su propia cuenta/app de MP, el backend debe
  guardar el secreto por organización y elegirlo según `application_id` o
  `user_id`. Hoy hay un único `MP_WEBHOOK_SECRET` (una sola cuenta/app).

### Idempotencia: `accion=activado` vs `accion=repetido`

El handler responde **200** en cuanto la firma es válida y luego llama a
`sincronizarPago(dataId)`. El resultado se registra como:

- `accion=activado`: aplicó el derecho en esa llamada.
- `accion=repetido`: el pago ya tenía `verificado_at` (lo aplicó un webhook
  anterior, el cron o la reconciliación perezosa). **No es un error**; no se
  reactiva ni se reembolsa por eso.
- `accion=ignorado`: la order no corresponde a una fila local.
- `accion=sin_estado` / `sin_resultado`: la order aún no tiene estado
  terminal; el cron la reconcilia.

### Cómo probar sin esperar 15 minutos

MP reintenta cada 15 min, pero un pago nuevo genera una notificación
inmediata. Para probar en Colombia (MCO):

- Vendedor: Seller Test User (el backend usa su access token/app).
- Comprador: Buyer Test User (recomendado para simular un cliente real; la
  firma no depende de él).
- Tarjeta aprobada: Mastercard `5254 1336 7440 3564`, CVV `123`,
  vencimiento `11/30`, titular `APRO`, documento `123456789`.
- No hace falta un pago nuevo para reintentar una notificación: MP la
  reenvía sola.

### Caso validado (20/10/2026)

- Order: `ORDTST01M5C3QAMR3YZD2D2ZKWHF3NGA`
- `application_id`: `7695549805450285` (app del Seller Test User)
- `user_id`: `3769393095` (Seller Test User)
- Logs: `firma ok variante=lower`, `webhook 200`, `accion=repetido`.
- Verificación local:

  ```sql
  SELECT id, estado, estado_detalle, mp_payment_id, verificado_at,
         aplicado_at, requiere_reembolso, nota
  FROM pagos
  WHERE mp_payment_id = 'ORDTST01M5C3QAMR3YZD2D2ZKWHF3NGA'
     OR external_reference = 'pocu-45-a77e3ad03ac56813';
  ```

  Debe quedar `estado='approved'`, `aplicado_at` no nulo y
  `requiere_reembolso=false`.
- Causa de los 401 anteriores: el secreto configurado era de la app
  `Inmobitwo-pagos-orders` (cuenta real), pero la order la generaba la app
  del vendedor de prueba. Al usar el secreto de la app correcta, validó.
- CORS no interviene: el webhook es servidor a servidor y no lleva `Origin`.

## Documentos

- [nuevo-producto.md](./nuevo-producto.md) — agregar un producto pagable.
- [variables-entorno.md](./variables-entorno.md) — variables y valores.
- [runbook.md](./runbook.md) — incidentes y webhooks perdidos.
- [operacion.md](./operacion.md) — consultas, reembolsos y monitoreo.
- [checklist-produccion.md](./checklist-produccion.md) — antes de cobrar real.
- [suscripciones.md](./suscripciones.md) — diseño para el siguiente producto.
