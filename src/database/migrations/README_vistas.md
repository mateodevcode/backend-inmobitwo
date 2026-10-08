# Migraciones de vistas de detalle (`src/database/migrations/`)

Orden de aplicación (después de `db.sql`, `schema.tracking.sql` y `001`):

```bash
for f in 002_vistas_detalle.sql 003_vistas_log_sin_fk.sql \
         004_vistas_log_tope_ip.sql 005_vistas_log_visible_incoherente.sql \
         007_vistas_bot_ips.sql 008_vistas_log_counted_idx.sql; do
  psql -v ON_ERROR_STOP=1 -f "src/database/migrations/$f"
done
```

Comando exacto (una sola línea, desde la raíz del repo, con `PGPASSWORD` o
`~/.pgpass` configurado):

```bash
export PGPASSWORD=<clave>; for f in 002_vistas_detalle.sql 003_vistas_log_sin_fk.sql 004_vistas_log_tope_ip.sql 005_vistas_log_visible_incoherente.sql 007_vistas_bot_ips.sql 008_vistas_log_counted_idx.sql; do psql -h <host> -p 5432 -U <usuario> -d inmobitwo -v ON_ERROR_STOP=1 -f "backend-inmobitwo/src/database/migrations/$f" || exit 1; done
```

Todas son idempotentes (`CREATE TABLE/INDEX IF NOT EXISTS`,
`DROP CONSTRAINT IF EXISTS`) y transaccionales (`BEGIN; … COMMIT;`): se
pueden reaplicar sin romper nada.

## Por qué falta el 006

El número 006 quedó reservado y sin usar: la consolidación del resumen se
implementó como job de Rust (`consolidar_resumen` cada 5 min) en vez de
función SQL, así que nunca hizo falta una migración 006. Se dejó el hueco
para no renumerar las ya aplicadas (003–005).

## Prueba de humo en el VPS (paso9 punto 3)

Con los servicios arriba y secretos configurados:

1. **Verificar `/health`** (ambos deben dar `vistas_habilitado: true`):
   ```bash
   curl -s https://api.inmobitwo.seventwo.tech/health
   docker exec inmobitwo-backend node -e "fetch('http://inmobitwo-rust-tracking:3002/health').then(r=>r.text()).then(t=>console.log(t))"
   ```
2. **Abrir una ficha** en la web y esperar 3 s visibles. Pedir el token a mano
   también vale:
   ```bash
   curl -s -X POST https://api.inmobitwo.seventwo.tech/propiedades/<id>/view-token
   ```
3. **Ver la fila en `vistas_log`** (motivo `counted`):
   ```bash
   docker exec postgres_central psql -U adminst -d inmobitwo -c \
     "SELECT event_id, reason, identidad_debil FROM vistas_log ORDER BY event_id DESC LIMIT 3;"
   ```
4. **Recargar y ver duplicado**: recarga la misma ficha, espera y repite el
   SELECT — la nueva fila debe decir `duplicado` (ventana de 30 min).
5. **Claves `rate_limit:ip:*` en Redis y comprobar que son IPs reales**
   (de `X-Real-IP`, nunca internas de Docker):
   ```bash
   docker exec inmobitwo-redis redis-cli -a "$REDIS_PASSWORD" --scan --pattern 'vistas:ratelimit:ip:*'
   ```
   Los segmentos de IP deben ser públicas de visitantes, no `172.x`/`10.x`
   de la red `central_network`. (Ojo: este patrón usa SCAN, apto en prod;
   nunca KEYS.)
6. **`docker stop` con conteo antes y después**: el `stop_grace_period: 35s`
   de rust-tracking deja vaciar el lote; compara
   `SELECT COUNT(*) FROM vistas_log;` antes y después de
   `docker stop inmobitwo-rust-tracking` — no debe perderse ninguna fila
   confirmada por el endpoint (las en vuelo <1 s pueden reintentarse
   desde el frontend).
