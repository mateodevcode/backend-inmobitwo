# Suscripciones (diseño, no implementado)

El refactor deja la base lista para un segundo producto. **No** hay código de
suscripciones todavía.

## Qué se reutiliza tal cual

- `mp.client.js` (fetch, headers, timeout, parseo de errores).
- `mp.estados.js` y `firma.js`.
- Tabla `pagos`, job de reconciliación, webhook y rate limiting.
- `PagoModal` + `usePago` (cambiando textos/config del producto).
- Patrón de idempotencia: fila local antes de llamar a MP + `X-Idempotency-Key`.

## Qué cambia

1. **API de MP**: `POST /preapproval` (suscripción) y
   `POST /preapproval/{id}` para pausar/cancelar; el cobro recurrente llega
   como `authorized_payment`.
2. **Webhook**: tópicos `subscription_preapproval`,
   `subscription_authorized_payment` y `subscription_preapproval_plan`.
3. **Modelo de datos** (migración nueva, requiere aprobación):
   - `pagos.tipo` debe admitir el nuevo valor (CHECK actual solo tiene
     `ubicacion_oculta`).
   - Tabla `suscripciones` (`preapproval_id`, `estado`, `plan`, `payer_id`,
     `next_payment_date`, `propiedad_id`/`usuario_id`, etc.).
   - Relación `pagos.suscripcion_id` (o `contexto_id` genérico) para conciliar
     cada `authorized_payment`.
4. **Contrato de producto**: el producto de suscripción no aplica un derecho
   único; debe:
   - `activar` al aprobarse el preapproval;
   - `renovar` al llegar cada pago autorizado;
   - `suspender` si el pago falla o se cancela.
5. **Idempotencia**: `authorized_payment.id` como clave única por cobro;
   no reutilizar `mp_payment_id` de la order.

## Consideraciones

- El precio del plan se define en MP (`preapproval_plan`) y debe validarse
  contra la config local antes de activar.
- Los estados locales necesitan al menos `activa`, `pausada`, `cancelada`,
  `morosa` (fuera del CHECK de `pagos`; van en `suscripciones`).
- La UI necesita un listado de suscripciones y un botón de cancelar; el modal
  de pago se reutiliza solo para el alta.
- No implementar hasta definir: plan, periodicidad, prorrateo, política de
  impagos y quién puede cancelar.
