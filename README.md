# backend-inmobitwo

API REST (Express 5 + ESM) para la plataforma inmobiliaria multi-tenant: auth JWT, propiedades con PostGIS, organizaciones con dominios propios, leads/tracking, catálogos, IA (DeepSeek), uploads a S3 y email Brevo. Microservicios Rust + Redis como apoyo.

## Stack

- **Runtime**: Node.js 20+ · Express 5 · `pg` (pool PostgreSQL/PostGIS)
- **Auth**: JWT access (header) + refresh (cookie httpOnly)
- **Apoyo**: Redis (ioredis, caché) + 3 servicios Rust (`tracking :3002`, `media :3003`, `websocket :3004`)
- **Externos**: AWS S3 (fotos/planos), Brevo SMTP, DeepSeek

## Requisitos

- Node.js >= 20 · Docker Desktop (redis + rust en local) · acceso al PostgreSQL (en local se usa el remoto del VPS)

## Setup local

```bash
# 1. Stack de apoyo (redis + rust; la DB es la remota del VPS según .env)
./dev-up.sh            # sube redis + rust (./dev-down.sh para apagar)

# 2. Backend Node con reload
npm run dev            # http://localhost:3001 (node --env-file .env --watch src/index.js)

# 3. Solo si la DB está vacía: schemas + seed geográfico (Colombia)
psql -U adminst -h <host> -d inmobitwo -f src/database/db.sql
npm run seed:geo
```

(O levanta todo junto con `bash dev.sh` desde la carpeta padre `inmobitwo/`.)

## Scripts

| Comando | Descripción |
|---|---|
| `npm run dev` | Desarrollo con `--watch` |
| `npm start` | Producción (`node --env-file .env src/index.js`) |
| `npm run seed:geo` | Países, regiones, deptos, ciudades y barrios (Colombia, PostGIS) |
| `npm run job:busquedas -- <frecuencia>` | Ejecuta el procesador de alertas una vez (`inmediata`/`diaria`/`semanal`) |
| `./dev-up.sh` / `./dev-down.sh` | Sube/baja redis + rust en local |

## Variables de entorno

`.env` (gitignored, manual) — plantilla commiteable en `.env.example`. Las que mandan en cada entorno:

| Variable | Descripción |
|---|---|
| `PORT` / `NODE_ENV` | `3001` · `production` en VPS (activa cookie `Secure`) |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | Local: IP remota `:5435` · VPS: `postgres_central:5432` (red `central_network`) |
| `FRONTEND_URL` | Orígenes CORS (coma-separados). Prod: `https://inmobitwo.seventwo.tech`. Los dominios propios de orgs se validan contra DB (caché 60s) |
| `JWT_SECRET`, `JWT_REFRESH_SECRET`, `API_SECRET_KEY` | Firmas de tokens + API key |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_DEFAULT_REGION`, `AWS_BUCKET`, `AWS_URL`, `AWS_BUCKET_SUBFOLDER` | S3 (`seventwo` / subcarpeta `inmobitwo`) |
| `BREVO_SMTP_EMAIL`, `BREVO_SMTP_PASS`, `BREVO_EMAIL_INFO/SUPPORT/NO_REPLY/JOBS` | SMTP + remitentes |
| `REDIS_PASSWORD`, `REDIS_URL` | OJO: dentro de docker debe apuntar al servicio (`redis://:PASS@inmobitwo-redis:6379`), nunca `localhost` |
| `RUST_TRACKING_URL`, `RUST_MEDIA_URL`, `RUST_WEBSOCKET_URL` | En VPS los pisa el compose (`http://inmobitwo-rust-*:300x`); el websocket apunta al socket-core del host (`ws://host.docker.internal:3005`) |
| `DEEPSEEK_API_KEY`, `DEEPSEEK_BASE_URL` | IA descripciones |
| `CRON_BUSQUEDAS_ENABLED` | `true` = arranca node-cron con el servidor (apagado en local) |
| `ALERTAS_DRY_RUN` | `true` = el procesador solo loguea, no envía ni marca |
| `ALERTAS_MAX_BUSQUEDAS_USUARIO`, `ALERTAS_MAX_ITEMS_EMAIL` | Topes (defecto `10`/`10`) |
| `PUSH_ENABLED`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Push web (apagado por defecto; sin `web-push` instalado hasta activarlo) |

> Claves con `#` o `@`: quotear con comillas simples en el `.env` (`DB_PASSWORD='...'`), si no compose las trunca.

## Estructura

```
src/
├── index.js              # App Express (trust proxy, CORS, cookies, JSON 5mb, rutas, errorHandler)
├── config.js             # Lee process.env
├── db.js                 # Pool pg
├── cors.config.js        # CORS dinámico: FRONTEND_URL + custom_domain activos en DB
├── controllers/          # Lógica de negocio (auth, usuarios, propiedades, organizaciones, miembros, favoritos, tracking, leads, geo, geocode, catalogos, ia, busquedas.guardadas, push…)
├── routes/               # Una por módulo (ver tabla)
├── jobs/                 # busquedasGuardadas.job.js (cron), run-once.js (ejecución manual)
├── middleware/           # auth (verificarToken/Rol), tenant (resolverTenant), organización, errores
├── lib/                  # redis, S3, geocode, scoring, rateLimit, promptBuilder, permisos org, busquedasGuardadas/…
├── utils/                # Emails (incl. alertaBusqueda.js), transporte Brevo, sanitización
├── validations/          # Validadores por módulo
├── constants/            # Campos API permitidos por recurso
└── database/             # db.sql, schema.tracking.sql, seed-geo.js + data/
services/                 # rust-tracking-service, rust-media-service, rust-websocket-service
```

## Endpoints principales

| Módulo | Prefijo | Auth |
|---|---|---|
| Auth | `/auth/registro`, `/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/me`, `/auth/check-email` | Mixto (refresh/logout por cookie) |
| Usuarios | `/usuarios` | JWT |
| Propiedades | `/propiedades` (+ `/inicio`, `/search-*`, `/inmuebles-en-bbox`) | Mixto |
| Organizaciones | `/organizaciones` (+ `/publicas`, `/slug/:slug`, `/resolve-tenant`, aprobar/suspender, dominio/activar…) | Mixto (`superadmin` para gestión) |
| Miembros | `/organizaciones/:orgId/miembros`, `/organizaciones/miembros/:id` | JWT (`agency_admin` o `superadmin`) |
| Favoritos | `/favoritos/toggle`, `/favoritos/mis-favoritos` | JWT |
| Tracking | `/tracking` (+ `/lead`, `/logs`) | Mixto |
| Leads | `/leads` | JWT |
| Geografía | `/api/countries|states|cities|barrios|location-info|suggest-cities|*-geojson|inmuebles-en-poligono` | No |
| Geocoding | `/api/geocode` | No |
| Catálogos | `/catalogos/operaciones|tipos-alquiler|tipos-inmueble|estados|calefaccion|caracteristicas` | No |
| IA | `/ia/*` (descripciones DeepSeek) | JWT |
| Búsquedas guardadas | `/busquedas-guardadas` (CRUD + `/verificar`), `/busquedas-guardadas/baja/:token[/reactivar]` (públicas), `/busquedas-guardadas/push/*` (503 si push apagado) | Mixto |

Roles: `user` (registro), `superadmin` (se asigna por SQL: `UPDATE usuarios SET rol='superadmin' …`; el token lo incluye, re-login requerido), `agency_admin`/`agent` (por organización en `organizacion_miembros`).

## Búsquedas guardadas con alertas

El usuario guarda una búsqueda (`filtros` JSONB con los mismos params de `/propiedades/search-slugs` + hash anti-duplicado) y recibe un email agrupado ante vivienda nueva, bajada de precio o disponibilidad recuperada.

- **Migración** `src/database/migrations/009_busquedas_guardadas.sql` (también en `db.sql`/`orden.sql`): `saved_searches` (filtros, frecuencia inmediata/diaria/semanal, canales, `last_checked_at`, `unsubscribe_token`, consentimiento Habeas Data), `property_events` (`created`/`price_drop`/`relisted` con `clock_timestamp()`), `saved_search_notifications` (anti-duplicado), `push_subscriptions` (lista, sin uso).
- **Eventos por triggers** (sin tocar controladores): `trg_property_events_listings` (INSERT/UPDATE en `property_listings`) y `trg_property_events_publicar` (`no_publicado`→`publicado`). En backfills masivos, desactivarlos antes.
- **Match** `src/lib/busquedasGuardadas/filtros.js`: replica el WHERE de `getPropertiesBySlugs` (usa el `buildTipoFilter` real + fallback a `regions.slug`).
- **Cron** `src/jobs/busquedasGuardadas.job.js`: cada 15 min (`inmediata`), diario 8:00 y lunes 8:00 (`America/Bogota`), con `pg_advisory_lock` + corte a `NOW()-30s` + auto-pausa a los 5 fallos. Plantilla `alertaBusqueda.js` (logo, tarjetas Nuevo/Bajó/Disponible, baja por token, header `List-Unsubscribe`, 3 reintentos).
- **Probar sin esperar**: `ALERTAS_DRY_RUN=true npm run job:busquedas -- diaria` (solo loguea).

## Deploy

Push a `main` → GitHub Actions (`.github/workflows/deploy.yml`, secrets `VPS_HOST/VPS_USER/VPS_SSH_KEY`):
1. Clona/actualiza en `/srv/infra/inmobitwo/backend-inmobitwo` (preserva `.env`, falla si no existe).
2. Verifica DB `inmobitwo` (no seed: ya poblada), `docker compose build` (secuencial) + `up -d`.
3. Certbot `--nginx` para `api.inmobitwo.seventwo.tech` (independiente, solo si no existe) + copia `nginx/inmobitwo-api.conf` y `reload`. Health-check final contra `/auth/check-email`.

Red docker en VPS: `central_network` (externa, la del postgres central). En local el `docker-compose.override.yml` (gitignored) la sustituye por una propia.
