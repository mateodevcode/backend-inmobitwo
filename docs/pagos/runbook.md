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
   el panel y **recrear** el backend (`docker compose up -d --force-recreate
   backend`); un `restart` no recarga el `.env`.

## Webhook 401 `firma_invalida`

Síntoma: MP muestra "Falla en entrega - 401" y el backend registra:

```text
[pagos] firma mismatch id=ORD... rid=... ts=...
[pagos] webhook 401 firma_invalida tipo=order data.id=ORD... x-request-id=...
```

La petición **sí llegó** al backend; esto **no es CORS** (MP llama servidor a
servidor, sin `Origin`). El 401 lo genera la validación HMAC.

Pasos:

1. Copiar el `application_id` y el `user_id` del body de la notificación.
2. Verificar que `MP_ACCESS_TOKEN`, `NEXT_PUBLIC_MP_PUBLIC_KEY` y
   `MP_WEBHOOK_SECRET` sean de la **misma app** y ambiente.
3. Si la order es de un usuario de prueba, el secreto debe salir de la app
   de ese usuario de prueba, no de la cuenta real.
4. Entrar al panel de MP con la app correcta:
   **Webhooks > Configurar notificaciones > Clave secreta**. Copiarla (no el
   Client Secret).
5. Actualizar `.env` y recrear el backend:
   `docker compose up -d --force-recreate backend`. Un `restart` no recarga
   el `.env`.
6. Esperar el reintento de MP (cada 15 min) o hacer un pago nuevo.
7. Confirmar en logs `[pagos] firma ok variante=...` y
   `webhook 200 ... accion=activado|repetido`.

Si `firma ok` no aparece, el problema es el secreto/app, no el manifiesto: el
código ya prueba `id` tal cual y en minúsculas. No agregar el dominio de MP al
CORS: no participa.

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
