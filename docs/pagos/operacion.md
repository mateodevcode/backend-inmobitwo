# Operación y monitoreo

## Señales a vigilar

| Señal | Consulta / log | Acción |
|---|---|---|
| Pagos aprobados sin aplicar | `estado='approved' AND aplicado_at IS NULL` | Reconciliar (`sincronizarPago`) |
| `requiere_reembolso=true` | tabla `pagos` | Revisar nota y reembolsar en MP |
| Intentos viejos bloqueando | `iniciado` con `created_at` > 10 min | Esperar cron / ejecutar caducidad |
| Errores 4xx repetidos | `estado_detalle='error_validacion_mp'` | Revisar `nota` (payload/credenciales) |
| Webhook 401 | logs `[pagos] webhook sin MP_WEBHOOK_SECRET` | Configurar secreto |
| Cron | log `[pagos] reconciliados: N` / `intentos expirados: N` | Normal si es bajo |

## Consultas útiles

```sql
-- Embudo por estado (últimos 30 días)
SELECT estado, COUNT(*)
FROM pagos
WHERE created_at > NOW() - INTERVAL '30 days'
GROUP BY estado ORDER BY 2 DESC;

-- Ingresos aprobados por producto
SELECT tipo, COUNT(*), SUM(monto) AS total
FROM pagos
WHERE estado = 'approved' AND aplicado_at IS NOT NULL
  AND created_at > NOW() - INTERVAL '30 days'
GROUP BY tipo;

-- Reembolsos pendientes
SELECT id, tipo, propiedad_id, monto, nota
FROM pagos WHERE requiere_reembolso = TRUE AND estado <> 'refunded';
```

## Idempotencia y doble cobro

- Cada intento inserta una fila con `mp_idempotency_key` (UUID v4) **antes**
  de llamar a MP; un reintento de red del mismo intento reutiliza la key.
- El índice parcial `idx_pagos_un_pago_en_curso` impide dos pagos activos por
  `(propiedad_id, tipo)`; una carrera devuelve 409.
- El webhook y el cron pueden ejecutarse a la vez: la activación está
  protegida por `verificado_at` y `FOR UPDATE`.

## Privacidad

- El punto público se calcula una sola vez (150–400 m) y no se recalcula.
- `ubicacion_oculta` con coordenadas públicas `NULL` devuelve **sin**
  coordenadas (nunca la real). Si aparece un caso así, corregir los datos con
  operación asistida, no relajar el fallback.
- Los filtros espaciales usan `geom_publica` para las ocultas.
