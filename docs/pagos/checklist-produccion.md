# Checklist antes de cobrar en producción

## Credenciales

- [ ] `MP_ACCESS_TOKEN` de **producción** (app homologada), no de prueba.
- [ ] `NEXT_PUBLIC_MP_PUBLIC_KEY` de la **misma** app que el access token.
- [ ] `MP_WEBHOOK_SECRET` es la **Clave secreta de Webhooks** de esa misma
      app y ambiente (no el Client Secret, no la de otra app).
- [ ] El `application_id` de una notificación real coincide con la app de la
      que salió `MP_WEBHOOK_SECRET`.
- [ ] No se agregó el dominio de MP al CORS (el webhook es servidor a
      servidor; CORS no participa).
- [ ] `MP_NOTIFICATION_URL` apunta a `https://<backend>/pagos/mp/webhook`.
- [ ] Rotar cualquier token que se haya compartido por chat/correo.

## Mercado Pago

- [ ] Aplicación con Orders API habilitada y país Colombia (COP).
- [ ] Webhook suscrito al tópico **order** (y `payment` si hay legacy) en la
      app correcta.
- [ ] Probar un pago aprobado, uno rechazado (`OTHE`) y uno pendiente
      (`CONT`) con usuarios/tarjetas de prueba.
- [ ] Verificar que el webhook real llega con firma válida (no 401) y que
      `application_id` corresponde a la app configurada.
- [ ] `accion=repetido` se interpreta como pago ya aplicado, no como fallo.
- [ ] Revisar la calidad de integración en el panel de MP.

## Base de datos

- [ ] Migraciones aplicadas: `npm run db:check` sin faltantes.
- [ ] `pagos.tipo` admite los productos activos.
- [ ] Índices `idx_pagos_mp_idempotency_key` e `idx_pagos_un_pago_en_curso`.
- [ ] No hay pagos `iniciado` viejos bloqueando propiedades.

## Código

- [ ] `npm run test:unit` en verde.
- [ ] `npm run test:integration` en verde (BD local).
- [ ] `npx eslint` sin errores en los archivos del módulo.
- [ ] `node --check` de los archivos backend modificados.
- [ ] Precio del producto correcto en la config del servidor.
- [ ] `MP_MAX_INSTALLMENTS` coincide con lo que se muestra en el Brick.

## Privacidad

- [ ] Propiedad oculta: `GET /propiedades/:id` sin token solo devuelve el
      punto público (nunca dirección ni coordenada real).
- [ ] Búsqueda/bbox/polígono usan `geom_publica` para ocultas.
- [ ] Filas ocultas sin coordenadas públicas no filtran la real.

## Operación

- [ ] Cron `PAGOS_CRON_ENABLED=true` y logs visibles.
- [ ] Persona responsable de revisar `requiere_reembolso`.
- [ ] Runbook compartido con el equipo.
- [ ] Un solo intento real controlado antes de abrir al público.
