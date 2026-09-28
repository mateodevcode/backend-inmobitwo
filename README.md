# Inmobitwo Backend **

API REST para plataforma SaaS inmobiliaria con multi-tenancy, tracking de leads y notificaciones.

## Stack

- **Runtime**: Node.js 20+ (ESM)
- **Framework**: Express 5
- **Base de datos**: PostgreSQL
- **Auth**: JWT (access + refresh tokens)
- **Almacenamiento**: AWS S3
- **Email**: Brevo SMTP (Nodemailer)

## Requisitos

- Node.js >= 20
- PostgreSQL >= 14

## Setup

```bash
# 1. Instalar dependencias
npm install

# 2. Configurar variables de entorno
cp .env.example .env
# Editar .env con tus credenciales

# 3. Crear base de datos y aplicar schemas
psql -U postgres -c "CREATE DATABASE inmobitwo;"
psql -U postgres -d inmobitwo -f src/database/db.sql
psql -U postgres -d inmobitwo -f src/database/schema.tracking.sql

# 4. Cargar datos geográficos (España + Colombia)
npm run seed:geo
```

## Scripts

| Comando | Descripción |
|---------|-------------|
| `npm run dev` | Modo desarrollo con hot reload (`--watch`) |
| `npm start` | Producción |
| `npm run seed:geo` | Carga países, provincias y ciudades |

## Variables de entorno

| Variable | Descripción |
|----------|-------------|
| `PORT` | Puerto del servidor (default: 3001) |
| `FRONTEND_URL` | URLs del frontend separadas por coma |
| `DB_USER`, `DB_PASSWORD`, `DB_HOST`, `DB_PORT`, `DB_NAME` | Conexión PostgreSQL |
| `JWT_SECRET` | Secreto para access tokens |
| `JWT_REFRESH_SECRET` | Secreto para refresh tokens |
| `AWS_BUCKET_NAME`, `AWS_BUCKET_REGION`, `AWS_ACCESS_KEY`, `AWS_SECRET_KEY` | Credenciales S3 |
| `AWS_BUCKET_SUBFOLDER` | Subcarpeta en el bucket (ej: `inmobitwo`) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | Brevo SMTP |

## Estructura

```
src/
├── index.js              # Entry point - Express app
├── config.js             # Variables de entorno
├── db.js                 # Pool PostgreSQL
├── cors.config.js        # CORS dinámico con dominios custom
├── controllers/          # Lógica de negocio
├── routes/               # Definición de rutas
├── middleware/            # Auth, tenant, organización
├── lib/                  # Utilidades (S3, geocode, scoring, rateLimit)
├── utils/                # Emails, sanitización
├── validations/          # Validadores
└── database/             # Schemas SQL y seeds
```

## Endpoints principales

| Módulo | Prefijo | Auth |
|--------|---------|------|
| Auth | `/auth` | Mixto |
| Usuarios | `/usuarios` | JWT |
| Propiedades | `/propiedades` | Mixto |
| Organizaciones | `/organizaciones` | Mixto |
| Miembros | `/organizaciones/:orgId/miembros` | JWT |
| Favoritos | `/favoritos` | JWT |
| Tracking | `/tracking` | Mixto |
| Leads | `/leads` | JWT |
| Geografía | `/api/countries`, `/api/states`, `/api/cities` | No |
| Geocoding | `/api/geocode` | No |
| Sugerencias | `/api/suggest-cities?q=` | No |

### Configuración de país para sugerencias de ciudades

El endpoint `/api/suggest-cities` filtra ciudades por país. El país se define en `src/controllers/geo.controllers.js:94`:

```js
const countryId = 2; // Colombia
```

IDs de países disponibles en la tabla `countries`:

| ID | País |
|----|------|
| 1 | Spain |
| 2 | Colombia |

Para cambiar el país, editar la variable `countryId` en esa línea y reiniciar el servidor.

### Filtrado insensible a tildes

La búsqueda usa la extensión `unaccent` de PostgreSQL, por lo que escribir "medellin" encuentra "Medellín", "malaga" encuentra "Málaga", etc. El índice `idx_cities_name_unaccent` en la BD asegura buen rendimiento.

## Deploy

El servidor se despliega vía GitHub Actions con PM2 (`inmobitwo-api`). Al hacer push a `main` se ejecuta `git pull`, `npm install` y `pm2 restart`.
