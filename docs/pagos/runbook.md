# Runbook de pagos

## Diagnóstico rápido

```sql
-- Últimos intentos
SELECT id, tipo, propiedad_id, monto, estado, estado_detalle,
       mp_payment_id, mp_transaction_id, requiere_reembolso,
       created_at, verificado_at, aplicado_at
FROM pagos
ORDER BY id DESC
LIMIT 20;

-- Aprobados sin aplicar (job/webhook pendiente)
SELECT * FROM pagos
WHERE estado = 'approved' AND aplicado_at IS NULL;

-- Bloqueos "pago en curso"
SELECT * FROM pagos
WHERE estado IN ('iniciado','pending','in_process')
   OR (estado = 'approved' AND aplicado_at IS NULL);
```

La consulta de una orden en MP (solo lectura):

```
GET https://api.mercadopago.com/v1/orders/{ORD...}
Authorization: Bearer $MP_ACCESS_TOKEN
```

## Webhook no llega (local o caída)

1. `GET /pagos/:producto/:id/estado` con sesión del dueño: hace reconciliación
   perezosa y devuelve el estado actualizado.
2. Esperar el cron (`*/10 min`) o ejecutarlo a mano:
   `import { reconciliarPagosPendientes } from "./src/lib/pagos/pago.service.js"`
3. Si `MP_WEBHOOK_SECRET` está vacío, el webhook responde 401: configurarlo en
   el panel y reiniciar.

## Pago aprobado pero el derecho no se aplicó

Revisar `UPDATE ... WHERE verificado_at IS NULL` (idempotencia) y:

- `requiere_reembolso = true` con nota `pago_duplicado` o `propiedad_borrada`:
  el cobro existe pero no debía aplicarse. Gestionar reembolso en MP.
- `requiere_reembolso = true` con nota `pago_mp_invalido: monto_ok=…`: los
  datos no coinciden con la fila local. **No aplicar a mano**; investigar y
  reembolsar.
- `verificado_at` null: reintentar `sincronizarPago(mp_payment_id)`.

## Intento `iniciado` que bloquea (409)

- Si tiene `mp_payment_id`: el webhook/cron lo reconciliará.
- Si no lo tiene y tiene más de 10 min: `expirarIntentosSinOrden()` busca la
  orden por `external_reference`. Solo expira si la búsqueda fue confiable.
- **Nunca** marcar `rejected` a mano: podría existir un cobro.

## Errores 4xx al crear la orden

Se marcan `rejected` + `error_validacion_mp` (no hubo cobro). Revisar
`nota` para el detalle de MP. Causas típicas:

- `total_amount` con decimales (COP exige entero);
- `payment_method.type` ausente;
- token de tarjeta vencido/reutilizado;
- credenciales inválidas (401/403).

## 423 / 409 de idempotencia

- `423 resource_locked`: se reintenta automáticamente una vez (1,2 s).
- `409 idempotency_key_already_used`: el servicio busca la orden por
  `external_reference` y la persiste; si no la encuentra, responde 502.

## Reembolsos

No hay automatización. El estado `requiere_reembolso` es una bandera para
operación. Reembolsar en el panel de MP y registrar el resultado en `nota`.
Los estados `refunded`/`charged_back` se sincronizan y **nunca** activan.
