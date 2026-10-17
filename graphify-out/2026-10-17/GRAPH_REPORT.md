# Graph Report - backend-inmobitwo  (2026-08-07)

## Corpus Check
- 85 files · ~593,749 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 512 nodes · 936 edges · 23 communities
- Extraction: 90% EXTRACTED · 10% INFERRED · 0% AMBIGUOUS · INFERRED: 91 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `f95dca6a`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- propiedades.controllers.js
- config.js
- dependencies
- index.js
- Documentación del Esquema de Base de Datos
- rateLimit.js
- rust-media-service/src/handlers.rs
- tracking.controllers.js
- organizaciones.routes.js
- obtener_score
- pool
- WebSocketSession
- Plan: Documentación Swagger/OpenAPI
- Inmobitwo Backend
- resize_and_optimize
- broadcast_message
- AppState
- seed-geo.js
- AppState
- AppState
- MediaResponse
- WsMessage
- calcular_peso_evento

## God Nodes (most connected - your core abstractions)
1. `Documentación del Esquema de Base de Datos` - 30 edges
2. `pool` - 19 edges
3. `WebSocketSession` - 14 edges
4. `Plan: Documentación Swagger/OpenAPI` - 12 edges
5. `updatePropiedades()` - 11 edges
6. `createRateLimitMiddleware()` - 11 edges
7. `defaultLimiter` - 10 edges
8. `resize_and_optimize()` - 9 edges
9. `AppState` - 9 edges
10. `portadaSubquery()` - 9 edges

## Surprising Connections (you probably didn't know these)
- `registro()` --calls--> `usuario_validate()`  [EXTRACTED]
  src/controllers/auth.controllers.js → src/validations/usuario_validate.js
- `enviarCodigoVerificacion()` --calls--> `codigoVerificacion()`  [EXTRACTED]
  src/controllers/codigos.verificacion.controllers.js → src/utils/emails/codigoVerificacion.js
- `notificarLead()` --calls--> `createTransporter()`  [EXTRACTED]
  src/controllers/tracking.controllers.js → src/utils/createTransporter.js
- `geocodeAddress()` --calls--> `cacheGet()`  [EXTRACTED]
  src/lib/geocode.js → src/lib/redis.js
- `registrar_sesion()` --references--> `SesionTracking`  [EXTRACTED]
  services/rust-tracking-service/src/handlers.rs → services/rust-tracking-service/src/models.rs

## Import Cycles
- None detected.

## Communities (23 total, 0 thin omitted)

### Community 0 - "propiedades.controllers.js"
Cohesion: 0.09
Nodes (50): buildVersionRows(), calcularPrecioSugeridoPropiedad(), calcularPricePerSqm(), camposCatalogoSelect(), createPropiedades(), deletePropiedades(), derivarFloorType(), extractS3Key() (+42 more)

### Community 1 - "config.js"
Cohesion: 0.07
Nodes (36): APIKEY, AWS_ACCESS_KEY_ID, AWS_BUCKET, AWS_BUCKET_SUBFOLDER, AWS_DEFAULT_REGION, AWS_SECRET_ACCESS_KEY, AWS_URL, BREVO_EMAIL_NO_REPLY (+28 more)

### Community 2 - "dependencies"
Cohesion: 0.04
Nodes (45): @aws-sdk/client-s3, axios, bcryptjs, cookie-parser, cors, express, form-data, ioredis (+37 more)

### Community 3 - "index.js"
Cohesion: 0.07
Nodes (37): PORT, getConditionTypes(), getFeatureCatalog(), getHeatingTypes(), getOperationTypes(), getPropertyTypes(), getRentalTypes(), getBarrios() (+29 more)

### Community 4 - "Documentación del Esquema de Base de Datos"
Cohesion: 0.05
Nodes (41): 0. Extensiones, 10. countries, 11. regions, 12. states, 13. cities, 14. barrios, 15. propiedades, 16. propiedades_galeria (+33 more)

### Community 5 - "rateLimit.js"
Cohesion: 0.09
Nodes (28): JWT_REFRESH_SECRET, JWT_SECRET, checkEmail(), cookieOpciones, generarAccessToken(), generarRefreshToken(), login(), logout() (+20 more)

### Community 6 - "rust-media-service/src/handlers.rs"
Cohesion: 0.12
Nodes (25): Multipart, health_check(), procesar_una_imagen(), AppState, Data, Responder, Result, String (+17 more)

### Community 7 - "tracking.controllers.js"
Cohesion: 0.14
Nodes (19): FRONTEND_URL, RUST_TRACKING_URL, actualizarContactoLead(), crearLeadDirecto(), getLogsTracking(), notificarLead(), registrarEvento(), registrarSesion() (+11 more)

### Community 8 - "organizaciones.routes.js"
Cohesion: 0.14
Nodes (21): activarDominioPropio(), aprobarOrganizacion(), createOrganizacion(), deleteOrganizacion(), desactivarDominioPropio(), generarSlugBase(), generarSlugUnico(), getEstadisticasOrganizacion() (+13 more)

### Community 9 - "obtener_score"
Cohesion: 0.19
Nodes (18): health_check(), obtener_score(), registrar_evento(), registrar_sesion(), AppState, Data, Json, Path (+10 more)

### Community 10 - "pool"
Cohesion: 0.23
Nodes (11): sql, actualizarMiembro(), crearMiembro(), eliminarMiembro(), getMiembros(), pool, esMiembroDeOrganizacion(), puedeAdministrarOrganizacion() (+3 more)

### Community 11 - "WebSocketSession"
Cohesion: 0.22
Nodes (12): Actor, Context, Handler, Message, ProtocolError, BroadcastMessage, Client, Result (+4 more)

### Community 12 - "Plan: Documentación Swagger/OpenAPI"
Cohesion: 0.14
Nodes (13): 10. Comandos útiles post-implementación, 1. Dependencias a instalar, 2. Archivo de configuración Swagger, 3. Integración en `src/index.js`, 4. Cómo anotar cada ruta, 5. Template base para copiar/pegar en cada ruta, 6. Orden de trabajo por archivo (prioridad), 7. Schemas reutilizables (`components.schemas`) (+5 more)

### Community 13 - "Inmobitwo Backend"
Cohesion: 0.17
Nodes (11): Configuración de país para sugerencias de ciudades, Deploy, Endpoints principales, Estructura, Filtrado insensible a tildes, Inmobitwo Backend, Requisitos, Scripts (+3 more)

### Community 14 - "resize_and_optimize"
Cohesion: 0.33
Nodes (10): DynamicImage, Send, ImageVersions, process_image(), resize_and_optimize(), Box, Error, Result (+2 more)

### Community 15 - "broadcast_message"
Cohesion: 0.27
Nodes (10): HttpRequest, Payload, broadcast_message(), health_check(), AppState, Data, Json, Responder (+2 more)

### Community 16 - "AppState"
Cohesion: 0.29
Nodes (9): AppState, Arc, Client, DashMap, MultiplexedConnection, PgPool, String, Uuid (+1 more)

### Community 17 - "seed-geo.js"
Cohesion: 0.31
Nodes (7): CITY_NAME_OVERRIDES, DB_TO_GEOJSON_NAME, __dirname, generateSlug(), normalizeName(), readJSON(), seed()

### Community 18 - "AppState"
Cohesion: 0.48
Nodes (6): AppState, Arc, DashMap, MultiplexedConnection, PgPool, String

### Community 19 - "AppState"
Cohesion: 0.40
Nodes (4): Self, AppState, Client, String

### Community 20 - "MediaResponse"
Cohesion: 0.40
Nodes (4): MediaResponse, Option, String, Value

### Community 21 - "WsMessage"
Cohesion: 0.50
Nodes (4): BroadcastMessage, String, Value, WsMessage

### Community 22 - "calcular_peso_evento"
Cohesion: 0.50
Nodes (3): calcular_peso_evento(), Option, Value

## Knowledge Gaps
- **108 isolated node(s):** `name`, `version`, `description`, `main`, `type` (+103 more)
  These have ≤1 connection - possible missing edges or undocumented components.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `pool` connect `pool` to `propiedades.controllers.js`, `config.js`, `index.js`, `rateLimit.js`, `tracking.controllers.js`, `organizaciones.routes.js`, `seed-geo.js`?**
  _High betweenness centrality (0.044) - this node is a cross-community bridge._
- **Why does `createRateLimitMiddleware()` connect `rateLimit.js` to `propiedades.controllers.js`, `config.js`, `index.js`, `tracking.controllers.js`, `organizaciones.routes.js`?**
  _High betweenness centrality (0.008) - this node is a cross-community bridge._
- **What connects `name`, `version`, `description` to the rest of the system?**
  _108 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `propiedades.controllers.js` be split into smaller, more focused modules?**
  _Cohesion score 0.09059029807130334 - nodes in this community are weakly interconnected._
- **Should `config.js` be split into smaller, more focused modules?**
  _Cohesion score 0.06938775510204082 - nodes in this community are weakly interconnected._
- **Should `dependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.04081632653061224 - nodes in this community are weakly interconnected._
- **Should `index.js` be split into smaller, more focused modules?**
  _Cohesion score 0.06648936170212766 - nodes in this community are weakly interconnected._