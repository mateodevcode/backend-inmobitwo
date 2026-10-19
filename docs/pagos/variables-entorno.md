# Variables de entorno del módulo de pagos

## Backend (`backend-inmobitwo/.env`)

| Variable | Requerida | Descripción |
|---|---|---|
| `MP_ACCESS_TOKEN` | sí (para cobrar) | Access token de la app (Orders API). Sin él, `pagosHabilitados()` es `false`, `/pagos/config` devuelve `habilitado:false` y el Brick se oculta. Nunca se loguea. |
| `MP_WEBHOOK_SECRET` | sí (webhook) | Secreto de firma (panel MP > Webhooks > Configurar notificaciones). Sin él, `POST /pagos/mp/webhook` responde **401**. |
| `MP_NOTIFICATION_URL` | no | URL pública del backend para configurar notificaciones en el panel. Orders API **no** acepta `notification_url` en el body. |
| `PRECIO_UBICACION_OCULTA_COP` | no (default 22000) | Precio único del producto "ocultar ubicación", en COP entero. El servidor lo ignora si el cliente lo envía. |
| `MP_MAX_INSTALLMENTS` | no (default 1) | Tope de cuotas que el servidor impone en el payload (`Math.min`). El Brick pide el mismo tope en `initialization.maxInstallments`. |
| `PAGOS_CRON_ENABLED` | no (default true) | `false` apaga el cron de reconciliación (útil en local). |

`MP_ACCESS_TOKEN` de prueba empieza por `APP_USR-` o `TEST-`, según el
producto de la app. No cambiar el prefijo: lo define Mercado Pago.

## Frontend (`web-inmobitwo/.env.*`)

| Variable | Descripción |
|---|---|
| `NEXT_PUBLIC_MP_PUBLIC_KEY` | Public key de la misma aplicación de MP. Sin ella, el modal muestra "pago no disponible". Se expone al navegador: **nunca** poner el access token aquí. |

## Reglas

- No imprimir tokens en logs ni en respuestas. Los errores de MP se registran
  con `x-request-id`, código HTTP y cuerpo de error (sin credenciales).
- El precio y la moneda reales salen del backend; los valores del frontend son
  solo visuales.
- Tras rotar credenciales, reiniciar el backend y verificar
  `GET /pagos/config` con un usuario autenticado.
