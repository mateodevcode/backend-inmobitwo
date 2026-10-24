# Variables de entorno del módulo de pagos

## Backend (`backend-inmobitwo/.env`)

| Variable | Requerida | Descripción |
|---|---|---|
| `MP_ACCESS_TOKEN` | sí (para cobrar) | Access token de la app del vendedor/plataforma (Orders API). Debe ser la **misma app** que `MP_WEBHOOK_SECRET` y la public key. Sin él, `pagosHabilitados()` es `false`, `/pagos/config` devuelve `habilitado:false` y el Brick se oculta. Nunca se loguea. |
| `MP_WEBHOOK_SECRET` | sí (webhook) | **Clave secreta de Webhooks** de la misma app y ambiente que `MP_ACCESS_TOKEN` (panel MP > Webhooks > Configurar notificaciones). No es del comprador ni el Client Secret. Sin él, `POST /pagos/mp/webhook` responde **401**. |
| `MP_NOTIFICATION_URL` | no | URL pública del backend para configurar notificaciones en el panel. Orders API **no** acepta `notification_url` en el body. |
| `PRECIO_UBICACION_OCULTA_COP` | no (default 22000) | Precio único del producto "ocultar ubicación", en COP entero. El servidor lo ignora si el cliente lo envía. |
| `MP_MAX_INSTALLMENTS` | no (default 1) | Tope de cuotas que el servidor impone en el payload (`Math.min`). El Brick pide el mismo tope en `initialization.maxInstallments`. |
| `PAGOS_CRON_ENABLED` | no (default true) | `false` apaga el cron de reconciliación (útil en local). |

`MP_ACCESS_TOKEN`, `NEXT_PUBLIC_MP_PUBLIC_KEY` y `MP_WEBHOOK_SECRET` deben
ser de la **misma aplicación** y del **mismo ambiente**. En prueba, si la
order la genera el usuario vendedor de prueba, el secreto sale de la app de
ese usuario; en producción, de la app de producción del vendedor/plataforma.
El comprador nunca provee la clave. Si se soportan varias cuentas/apps, hay
que guardar el secreto por organización y elegirlo según `application_id` o
`user_id` del webhook.

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
