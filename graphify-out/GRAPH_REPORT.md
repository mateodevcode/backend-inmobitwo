# Graph Report - backend-inmobitwo  (2026-10-17)

## Corpus Check
- 166 files · ~664,333 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1141 nodes · 2743 edges · 54 communities (48 shown, 6 thin omitted)
- Extraction: 92% EXTRACTED · 8% INFERRED · 0% AMBIGUOUS · INFERRED: 221 edges (avg confidence: 0.79)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `8fcb34d5`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- propiedades.controllers.js
- config.js
- dependencies
- geo.controllers.js
- Documentación del Esquema de Base de Datos
- auth.controllers.js
- rust-media-service/src/handlers.rs
- tracking.controllers.js
- organizaciones.routes.js
- rust-tracking-service/src/handlers.rs
- db.js
- crm.routes.js
- Plan: Documentación Swagger/OpenAPI
- backend-inmobitwo
- vista_decision.rs
- vista_api.rs
- vista_estado.rs
- seed-geo.js
- AppState
- AppState
- MediaResponse
- (a) Lectura/escritura de columnas de `propiedades`
- calcular_peso_evento
- chat.routes.js
- dominios.controllers.js
- index.js
- procesador.js
- vista_token.rs
- rateLimit.js
- MICRO-SERVICIO: Generador de Descripciones con IA (DeepSeek)
- password.recovery.controllers.js
- room_seeker.routes.js
- ia.controllers.js
- Algoritmo de precio sugerido — venta de vivienda en Colombia
- Contrato de endpoints
- catalogos.routes.js
- portada.routes.js
- package.json
- descartados.routes.js
- escapeHtml
- cors
- Dominios propios con ejecución remota (módulo Dominios del CRM)
- scripts
- agregar-dominio.sh
- quitar-dominio.sh
- cookieInterno.js
- Migraciones de vistas de detalle (`src/database/migrations/`)
- vistas.agregados.controllers.js
- bcryptjs
- cookie-parser
- express
- form-data
- nodemailer

## God Nodes (most connected - your core abstractions)
1. `decidir_vista()` - 57 edges
2. `estado_base()` - 46 edges
3. `cfg()` - 46 edges
4. `evento_base()` - 45 edges
5. `pool` - 42 edges
6. `Documentación del Esquema de Base de Datos` - 30 edges
7. `aplicar_estado()` - 23 edges
8. `iniciar_escritor_log()` - 21 edges
9. `createRateLimitMiddleware()` - 19 edges
10. `sembrar()` - 17 edges

## Surprising Connections (you probably didn't know these)
- `procesar_vista()` --calls--> `decidir_vista()`  [INFERRED]
  services/rust-tracking-service/src/vista_api.rs → services/rust-tracking-service/src/vista_decision.rs
- `procesar_vista()` --calls--> `aplicar_estado()`  [INFERRED]
  services/rust-tracking-service/src/vista_api.rs → services/rust-tracking-service/src/vista_estado.rs
- `procesar_vista()` --calls--> `verificar_view_token()`  [INFERRED]
  services/rust-tracking-service/src/vista_api.rs → services/rust-tracking-service/src/vista_token.rs
- `evento_demasiado_pronto_es_tiempo_insuficiente()` --calls--> `decidir_vista()`  [INFERRED]
  services/rust-tracking-service/src/vista_token.rs → services/rust-tracking-service/src/vista_decision.rs
- `token_de_otro_inmueble_es_token_invalido()` --calls--> `decidir_vista()`  [INFERRED]
  services/rust-tracking-service/src/vista_token.rs → services/rust-tracking-service/src/vista_decision.rs

## Import Cycles
- None detected.

## Communities (54 total, 6 thin omitted)

### Community 0 - "propiedades.controllers.js"
Cohesion: 0.05
Nodes (99): MATRIZ_OPERACIONES, MAX_PRECIO, OPERACIONES_SOPORTADAS, getGeocode(), buildVersionRows(), calcularPrecioSugeridoPropiedad(), calcularPricePerSqm(), cambiarOperacionPropiedad() (+91 more)

### Community 1 - "config.js"
Cohesion: 0.11
Nodes (22): APIKEY, AWS_ACCESS_KEY_ID, AWS_BUCKET, AWS_DEFAULT_REGION, AWS_SECRET_ACCESS_KEY, AWS_URL, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET (+14 more)

### Community 2 - "dependencies"
Cohesion: 0.11
Nodes (19): @aws-sdk/client-s3, axios, ioredis, jsonwebtoken, morgan, multer, node-cron, openai (+11 more)

### Community 3 - "geo.controllers.js"
Cohesion: 0.08
Nodes (48): actualizarBusqueda(), bajaPorToken(), crearBusqueda(), eliminarBusqueda(), err(), FRECUENCIAS, listarBusquedas(), MAX (+40 more)

### Community 4 - "Documentación del Esquema de Base de Datos"
Cohesion: 0.05
Nodes (41): 0. Extensiones, 10. countries, 11. regions, 12. states, 13. cities, 14. barrios, 15. propiedades, 16. propiedades_galeria (+33 more)

### Community 5 - "auth.controllers.js"
Cohesion: 0.16
Nodes (24): checkEmail(), cookieOpciones, crearSesion(), emitirSesion(), enviarOtpLogin(), generarAccessToken(), generarOtp(), generarRefreshToken() (+16 more)

### Community 6 - "rust-media-service/src/handlers.rs"
Cohesion: 0.09
Nodes (35): DynamicImage, Multipart, Send, health_check(), procesar_una_imagen(), AppState, Data, Responder (+27 more)

### Community 7 - "tracking.controllers.js"
Cohesion: 0.17
Nodes (16): RUST_TRACKING_URL, VIEW_INTERNAL_SECRET, actualizarContactoLead(), crearLeadDirecto(), notificarLead(), registrarEvento(), registrarVista(), resolverOperationLead() (+8 more)

### Community 8 - "organizaciones.routes.js"
Cohesion: 0.06
Nodes (46): AWS_BUCKET_SUBFOLDER, CAMPOS_LEAD, CAMPOS_MIEMBRO, CAMPOS_ORGANIZACION, CAMPOS_PROPIEDAD, CAMPOS_USUARIO, me(), desactivarVerificacionEmail() (+38 more)

### Community 9 - "rust-tracking-service/src/handlers.rs"
Cohesion: 0.20
Nodes (17): health_check(), obtener_score(), registrar_evento(), registrar_sesion(), AppState, Data, HttpResponse, Json (+9 more)

### Community 10 - "db.js"
Cohesion: 0.13
Nodes (18): sql, DB_HOST, DB_NAME, DB_PASSWORD, DB_PORT, DB_USER, getLeads(), updateLeadEstado() (+10 more)

### Community 11 - "crm.routes.js"
Cohesion: 0.08
Nodes (64): getCrmLeads(), getCrmPropiedades(), getDashboard(), portada(), actualizarContacto(), actualizarTarea(), archivarContacto(), asignarContacto() (+56 more)

### Community 12 - "Plan: Documentación Swagger/OpenAPI"
Cohesion: 0.14
Nodes (13): 10. Comandos útiles post-implementación, 1. Dependencias a instalar, 2. Archivo de configuración Swagger, 3. Integración en `src/index.js`, 4. Cómo anotar cada ruta, 5. Template base para copiar/pegar en cada ruta, 6. Orden de trabajo por archivo (prioridad), 7. Schemas reutilizables (`components.schemas`) (+5 more)

### Community 13 - "backend-inmobitwo"
Cohesion: 0.17
Nodes (11): backend-inmobitwo, Búsquedas guardadas con alertas, Chat en tiempo real (vía socket-core), Deploy, Endpoints principales, Estructura, Requisitos, Scripts (+3 more)

### Community 14 - "vista_decision.rs"
Cohesion: 0.15
Nodes (52): acepta_en_borde_tolerancia(), anon_id_solo_no_es_debil(), borde_bfcache_no_duplica_por_token_unico(), borde_borrado_cookies_genera_identidad_nueva(), borde_caida_redis_es_error_sistema(), borde_despublicado_entre_carga_y_evento(), borde_interno_sin_sesion_cubierto_por_flag(), borde_multi_pestana_solo_cuenta_una() (+44 more)

### Community 15 - "vista_api.rs"
Cohesion: 0.07
Nodes (78): AtomicI64, AtomicU64, HttpRequest, IpNet, JoinHandle, NaiveDate, Receiver, RwLock (+70 more)

### Community 16 - "vista_estado.rs"
Cohesion: 0.11
Nodes (37): Default, HashMap, from_env_respeta_variables(), mapa_env(), MotivoRechazo, Self, String, VistaConfig (+29 more)

### Community 17 - "seed-geo.js"
Cohesion: 0.31
Nodes (7): CITY_NAME_OVERRIDES, DB_TO_GEOJSON_NAME, __dirname, generateSlug(), normalizeName(), readJSON(), seed()

### Community 18 - "AppState"
Cohesion: 0.39
Nodes (7): DashMap, AppState, Arc, MultiplexedConnection, Option, PgPool, String

### Community 19 - "AppState"
Cohesion: 0.40
Nodes (4): AppState, Client, Self, String

### Community 20 - "MediaResponse"
Cohesion: 0.40
Nodes (4): MediaResponse, Option, String, Value

### Community 21 - "(a) Lectura/escritura de columnas de `propiedades`"
Cohesion: 0.06
Nodes (33): A.1 `createPropiedades` (293-532), A.1 `createPropiedades` (cont. 553-737), A.2 `updatePropiedades` (834-953: cabecera, permiso, multipart, validación), A.2 `updatePropiedades` (cont. 1238-1445: campos, precio, historial), A.3 `publicarAnuncios` (1678-1794: parse + validación + título), (a) Lectura/escritura de columnas de `propiedades`, ANEXO A — Verbatim funciones largas, (b) Código verbatim (+25 more)

### Community 22 - "calcular_peso_evento"
Cohesion: 0.50
Nodes (3): calcular_peso_evento(), Option, Value

### Community 23 - "chat.routes.js"
Cohesion: 0.13
Nodes (30): SOCKET_CORE_API_KEY, SOCKET_CORE_ORIGIN, SOCKET_CORE_URL, SOCKET_CORE_WS_PUBLIC_URL, borradaPara(), contarNoLeidos(), conversacionDe(), crearObtenerConversacion() (+22 more)

### Community 24 - "dominios.controllers.js"
Cohesion: 0.17
Nodes (20): DOMINIOS_SCRIPT_DIR, DOMINIOS_SERVER_IP, DOMINIOS_SSH_HOST, DOMINIOS_SSH_KEY_PATH, DOMINIOS_SSH_USER, agregarDominio(), anexarLog(), crearJob() (+12 more)

### Community 25 - "index.js"
Cohesion: 0.11
Nodes (18): PORT, cacheDominios, corsOptions, app, MIN_SECRET_LEN, requiereVistas(), validarSecretoArranque(), validarSecretosArranque() (+10 more)

### Community 26 - "procesador.js"
Cohesion: 0.17
Nodes (17): iniciarCronBusquedas(), enviarEmailAlerta(), esperar(), cargar(), enviarPushUsuario(), LOCK_KEYS, MAX_ITEMS, procesarBusquedas() (+9 more)

### Community 27 - "vista_token.rs"
Cohesion: 0.23
Nodes (21): acepta_vector_generado_por_node(), cfg(), DatosViewToken, ErrorViewToken, evento_demasiado_pronto_es_tiempo_insuficiente(), evento_desde_token(), firmar(), PayloadToken (+13 more)

### Community 28 - "rateLimit.js"
Cohesion: 0.18
Nodes (14): getMisFavoritos(), toggleFavorito(), getLogsTracking(), registrarSesion(), createRateLimitMiddleware(), defaultLimiter, verificarRol(), verificarToken() (+6 more)

### Community 29 - "MICRO-SERVICIO: Generador de Descripciones con IA (DeepSeek)"
Cohesion: 0.10
Nodes (19): ARQUITECTURA, Backend, CHECKLIST DE IMPLEMENTACION, COSTO ESTIMADO POR GENERACION (DeepSeek), Despues de elegir un formato:, Despues de hacer clic en "Generar con IA":, En el backend (`.env`):, En el codigo del endpoint: (+11 more)

### Community 30 - "password.recovery.controllers.js"
Cohesion: 0.18
Nodes (13): BREVO_EMAIL_NO_REPLY, BREVO_SMTP_EMAIL, BREVO_SMTP_PASS, FRONTEND_URL, confirmarCodigoVerificacion(), enviarCodigoVerificacion(), generarCodigo(), resetPassword() (+5 more)

### Community 31 - "room_seeker.routes.js"
Cohesion: 0.24
Nodes (11): CAMPOS_EDITABLES, deleteMiPerfilBuscador(), getMiPerfilBuscador(), upsertMiPerfilBuscador(), rateLimit, router, BUSCA_CON, esEnteroPositivo() (+3 more)

### Community 32 - "ia.controllers.js"
Cohesion: 0.22
Nodes (10): DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL, deepseek, generarDescripcion(), mejorarDescripcion(), refinarDescripcion(), construirPrompt(), createRateLimiter() (+2 more)

### Community 33 - "Algoritmo de precio sugerido — venta de vivienda en Colombia"
Cohesion: 0.18
Nodes (10): 1. Idea general, 2. Precio base por m² privado, 3. Multiplicadores (objeto `MULTIPLICADORES`), 4. Valores fijos (`VALORES_FIJOS`, en COP), 5. Rango y redondeo, 6. Validación del precio del usuario (`validarPrecioUsuario`), 7. Endpoints, 8. Ejemplo (+2 more)

### Community 34 - "Contrato de endpoints"
Cohesion: 0.18
Nodes (10): Compatibilidad (sin romper clientes actuales), Contrato de endpoints, DELETE /propiedades/:id/ofertas/:operacion, GET /propiedades/:id/ofertas, Matriz (`src/constants/operaciones.js`), Modelo de datos, Ofertas por operación — backend (base para el prompt del frontend), Plan de pruebas manuales (curl, copia de BD) (+2 more)

### Community 35 - "catalogos.routes.js"
Cohesion: 0.33
Nodes (8): getConditionTypes(), getFeatureCatalog(), getHeatingTypes(), getOperationTypes(), getPropertyTypes(), getRentalTypes(), rateLimit, router

### Community 36 - "portada.routes.js"
Cohesion: 0.33
Nodes (8): buscarPortada(), formatoCOP(), getPortada(), portadaMedium(), putPortada(), rateLimit, router, soloSuperadmin

### Community 37 - "package.json"
Cohesion: 0.22
Nodes (8): author, description, keywords, license, main, name, type, version

### Community 38 - "descartados.routes.js"
Cohesion: 0.39
Nodes (7): descartarPropiedad(), getIdsDescartados(), getMisDescartados(), parseId(), restaurarPropiedad(), rateLimit, router

### Community 39 - "escapeHtml"
Cohesion: 0.39
Nodes (5): codigoOtpLogin(), nuevoLead(), resetPassword(), escapeHtml(), HTML_ENTITIES

### Community 40 - "cors"
Cohesion: 0.25
Nodes (6): cors, cors, main(), Result, main(), Result

### Community 41 - "Dominios propios con ejecución remota (módulo Dominios del CRM)"
Cohesion: 0.40
Nodes (4): Dominios propios con ejecución remota (módulo Dominios del CRM), En local, Instalación única en el VPS (como root o con sudo), Reglas del módulo

### Community 42 - "scripts"
Cohesion: 0.40
Nodes (5): scripts, dev, job:busquedas, seed:geo, start

### Community 43 - "agregar-dominio.sh"
Cohesion: 0.60
Nodes (3): log_error(), log_ok(), agregar-dominio.sh script

### Community 44 - "quitar-dominio.sh"
Cohesion: 0.70
Nodes (4): log_aviso(), log_error(), log_ok(), quitar-dominio.sh script

### Community 45 - "cookieInterno.js"
Cohesion: 0.50
Nodes (4): INTERNO_COOKIE_SECRET, COOKIE_INTERNO, esInternoPorCookie(), verificarInterno()

### Community 46 - "Migraciones de vistas de detalle (`src/database/migrations/`)"
Cohesion: 0.50
Nodes (3): Migraciones de vistas de detalle (`src/database/migrations/`), Por qué falta el 006, Prueba de humo en el VPS (paso9 punto 3)

## Knowledge Gaps
- **211 isolated node(s):** `name`, `version`, `description`, `main`, `type` (+206 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **6 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `pool` connect `db.js` to `propiedades.controllers.js`, `config.js`, `geo.controllers.js`, `auth.controllers.js`, `tracking.controllers.js`, `organizaciones.routes.js`, `crm.routes.js`, `seed-geo.js`, `chat.routes.js`, `dominios.controllers.js`, `index.js`, `procesador.js`, `rateLimit.js`, `password.recovery.controllers.js`, `room_seeker.routes.js`, `ia.controllers.js`, `catalogos.routes.js`, `portada.routes.js`, `descartados.routes.js`, `vistas.agregados.controllers.js`?**
  _High betweenness centrality (0.071) - this node is a cross-community bridge._
- **Why does `dependencies` connect `dependencies` to `package.json`, `cors`, `bcryptjs`, `cookie-parser`, `express`, `form-data`, `nodemailer`?**
  _High betweenness centrality (0.011) - this node is a cross-community bridge._
- **Are the 5 inferred relationships involving `decidir_vista()` (e.g. with `procesar_vista()` and `evento_demasiado_pronto_es_tiempo_insuficiente()`) actually correct?**
  _`decidir_vista()` has 5 INFERRED edges - model-reasoned connections that need verification._
- **What connects `name`, `version`, `description` to the rest of the system?**
  _211 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `propiedades.controllers.js` be split into smaller, more focused modules?**
  _Cohesion score 0.05172413793103448 - nodes in this community are weakly interconnected._
- **Should `config.js` be split into smaller, more focused modules?**
  _Cohesion score 0.10804597701149425 - nodes in this community are weakly interconnected._
- **Should `dependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.10526315789473684 - nodes in this community are weakly interconnected._