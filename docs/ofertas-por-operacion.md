# Ofertas por operación — backend (base para el prompt del frontend)

## Modelo de datos
- `property_listings` (una fila por operación): `propiedad_id`, `operation_type_id`
  UNIQUE(propiedad_id, operation_type_id), `precio` BIGINT (tope temporal 2147483647),
  `price_per_sqm`, `rental_type_id`, `parking_space_price`, `listing_status`
  (active/inactive/sold/rented/expired), `published_at`, `expires_at`.
- `property_listing_history`: `removed|switched|status_changed` + snapshot JSONB + `changed_by`.
- `feature_catalog.applies_to`: both|rent|sale (12 códigos en 'rent').
- `price_history.operation_type_id` (backfill desde propiedades).
- `propiedades.description_needs_review` BOOL. `leads.operation_type_id` (nullable).
- Espejo: trigger `trg_property_listings_sync` → `sync_property_from_listings()`
  (activa primero, venta antes que arriendo). `propiedades` conserva su forma.

## Matriz (`src/constants/operaciones.js`)
- venta: requiere `precio`; permite precio, parking_space_price, listing_status,
  expires_at; deriva price_per_sqm; estados active/inactive/sold/expired.
- arriendo: requiere `precio` + `rental_type_id`; mismos permitidos + rental;
  estados active/inactive/rented/expired. `rental_type_id` en venta → NULL.
- `habitacion` solo admite arriendo. `arriendo_venta` heredado (no crear/combinar).
- Venta `sold` ⇒ demás ofertas a `inactive`. Arriendo `rented` ⇒ venta intacta.
- Precio nunca se hereda al cambiar de operación.

## Contrato de endpoints
Auth: Bearer (dueño de la propiedad; 403 ajeno). Errores: validación 400 con `error`
array o string, 404, 409 conflicto, 500.

### GET /propiedades/:id/ofertas
→ `{ success, data: [{ id, operation, operation_type_id, precio, price_per_sqm,
rental_type_id, parking_space_price, listing_status, published_at, expires_at }] }`

### PUT /propiedades/:id/ofertas/:operacion (upsert)
Body parcial, ej. arriendo: `{ "precio": 2000000, "rental_type_id": 1 }`
→ 200/201 `{ propiedad_id, titulo, description_needs_review, ofertas: [...] }`
409 si... (upsert: nunca 409 por existencia; 404 si :operacion inválida).

### DELETE /propiedades/:id/ofertas/:operacion
409 si es la única ("usa estado no_publicado"). Limpia features no aplicables,
marca descripción, regenera título.

### POST /propiedades/:id/cambiar-operacion
Body: `{ "desde": "venta", "hacia": "arriendo",
"datos": { "precio": 2500000, "rental_type_id": 1 } }`
→ reemplazo atómico + `price_history` 'relisted' (old NULL) + título regenerado.
400 sin precio/rental; 404 sin oferta `desde`; 409 si ya existe `hacia`.

### Compatibilidad (sin romper clientes actuales)
- `PATCH /propiedades/:id` con `precio|parking_space_price` (+`rental_type_id` en
  Filter arriendo): 1 oferta → se aplica a ella; 2 ofertas → 400
  ("usa PUT /propiedades/:id/ofertas/:operacion"); `operation_type_id` distinto
  al principal → 400 ("usa cambiar-operacion"); `titulo` del cliente se ignora y
  se regenera si cambia tipo/barrio/ciudad; editar `description` → needs_review FALSE.
- `POST /publicar-anuncios` y `POST /propiedades`: formato antiguo (una oferta) y
  nuevo `ofertas: [{ operation?, operation_type_id?, precio, ... }]` (en multipart
  como string JSON). Título siempre derivado. `how_to_contact` default
  'telefono_chat' (fix: era 500 por NOT NULL).
- `GET /propiedades/:id/historial-precios[?operacion=]` añade `operation_type_id`.
- `GET /propiedades/:id/caracteristicas` añade `applies_to`; POST rechaza 400
  códigos 'rent' sin oferta de arriendo.
- Búsquedas con filtro de operación (search-slugs, search-vivienda, bbox):
  JOIN a la oferta activa + precio/rental de la oferta + campo `ofertas` en cada item.
  Sin filtro: valores del espejo + `ofertas`. `byId/resumen/mis-anuncios/home/
  organizacion/lista` añaden `ofertas` (+ `description_needs_review` en byId y
  mis-anuncios). Geo-conteos, polígono, favoritos: sin cambios (usan espejo).
- Leads Node aceptan `operation` ("venta"|"arriendo") o espejo; Rust intacto.

## Plan de pruebas manuales (curl, copia de BD)
Base: `B=http://localhost:3001`, `H="Authorization: Bearer $TOKEN"` (dueño).
```bash
# (a) crear solo venta (antiguo)
curl -X POST $B/publicar-anuncios -H "$H" -H 'Content-Type: application/json' \
 -d '{"operation_type_id":1,"property_type_id":1,"direccion":"Calle X 1",
"city_id":8485,"state_id":52,"country_id":2,"precio":500000000,"how_to_contact":"telefono_chat"}'
# → 201, ofertas ["venta"], título "Venta de ..."
# (b) añadir arriendo → ambas + título "Venta y arriendo de..."
curl -X PUT $B/propiedades/:id/ofertas/arriendo -H "$H" -H 'Content-Type: application/json' \
 -d '{"precio":2000000,"rental_type_id":1}'
# (c) PATCH precio en ambas → 400
curl -X PATCH $B/propiedades/:id -H "$H" -H 'Content-Type: application/json' \
 -d '{"precio":1}'
# (d) PATCH precio en una sola oferta → 200 y persiste
# (e) cambiar-operacion sin precio → 400; con datos → 200 + 'relisted'
curl -X POST $B/propiedades/:id/cambiar-operacion -H "$H" -H 'Content-Type: application/json' \
 -d '{"desde":"venta","hacia":"arriendo","datos":{"precio":2500000,"rental_type_id":1}}'
# (f) quitar la única oferta → 409
curl -X DELETE $B/propiedades/:id/ofertas/venta -H "$H"
# (g) característica rent en venta sola → 400 (ej. feature_id de 'mascotas')
curl -X POST $B/propiedades/:id/caracteristicas -H "$H" -H 'Content-Type: application/json' \
 -d '{"features":[{"feature_id":ID_MASCOTAS}]}'
# (h) venta a sold → arriendo inactive; arriendo a rented → venta intacta
curl -X PUT $B/propiedades/:id/ofertas/venta -H "$H" -H 'Content-Type: application/json' \
 -d '{"listing_status":"sold"}'
# (i) search-slugs/search-vivienda operation=venta y arriendo → aparece en ambas con su precio
curl "$B/propiedades/search-vivienda?operation=arriendo&tipos=apartamento&dept=antioquia&min=1&max=3"
# (j) token ajeno → 403/404
# (k) precio 2147483648 → 400
# (l) habitacion + venta → 400 (validarOferta: requiere property_type_id de habitación;
#     resuélvelo con GET /catalogos/tipos-inmueble para el id real)
# (m) DELETE propiedad con ofertas → 200 (CASCADE + trigger DELETE sin error)
# (n) psql -f src/database/migrations/001_verificacion.sql (sin_oferta=0)
```
IDs reales: `operation_type_id` venta=1 (verificar con `GET /catalogos/operaciones`),
`rental_type_id` con `GET /catalogos/tipos-alquiler`, `feature_id` mascotas con
`GET /catalogos/caracteristicas`.
