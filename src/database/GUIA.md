# Documentación del Esquema de Base de Datos
## Plataforma Inmobiliaria — Versión Colombia 5.0

---

## ⚡ PASO A PASO DE EJECUCIÓN (orden.sql)

Orden de ejecución de los scripts en `src/database/`.

### Instalación desde cero / Reset total

| # | Script | Comando | Qué hace |
|---|--------|---------|----------|
| 1 | `drop_all.sql` | `psql -f src/database/drop_all.sql` | Borra TODO: vistas, triggers, funciones, tablas y extensiones (PostGIS, pg_trgm, unaccent). Deja la DB limpia. |
| 2 | `db.sql` | `psql -f src/database/db.sql` | **Archivo madre.** Crea extensiones, las 21 tablas, catálogos (incluye `habitacion` y los features N:M de habitación), índices, funciones, triggers y vistas (`v_property_summary`, `v_recent_price_changes`). |
| 3 | `seed-geo.js` | `npm run seed:geo` (o `node --env-file .env src/database/seed-geo.js`) | Importa Colombia: países, regiones, departamentos, ciudades y barrios con códigos DANE y geometría PostGIS, desde `src/database/data/`. Requiere `db.sql`. |
| 4 | `schema.tracking.sql` | `psql -f src/database/schema.tracking.sql` | Crea el sistema de tracking y leads: `sesiones_tracking`, `eventos_tracking`, `leads`. Depende de `usuarios` y `propiedades` (ya creados en `db.sql`). |

### Reset parcial (solo tracking, conserva datos de negocio)

| # | Script | Qué hace |
|---|--------|----------|
| 1 | `drop_tracking.sql` | Borra solo `leads`, `eventos_tracking`, `sesiones_tracking`. No toca el core. |
| 2 | `schema.tracking.sql` | Vuelve a crear el sistema de tracking. |

> **Regla de oro:** `db.sql` es la fuente de verdad única (schema + catálogos + vistas).
> Si agregas un catálogo, columna o feature nuevo, se actualiza **solo** en `db.sql`.
> `drop_all.sql` solo necesita revisión si cambia la estructura de tablas/vistas/funciones.

---

## Índice de Tablas

| # | Tabla | Propósito |
|---|-------|-----------|
| 0 | Extensiones | PostGIS, búsqueda difusa, sin tildes |
| 1 | `operation_types` | Catálogo de tipos de operación |
| 2 | `rental_types` | Catálogo de tipos de alquiler |
| 3 | `property_types` | Catálogo de tipos de inmueble |
| 4 | `condition_types` | Catálogo de estado de conservación |
| 5 | `heating_types` | Catálogo de tipos de calefacción |
| 6 | `feature_catalog` | Catálogo de características adicionales |
| 7 | `usuarios` | Usuarios registrados de la plataforma |
| 8 | `organizaciones` | Inmobiliarias, promotoras, constructoras |
| 9 | `organizacion_miembros` | Relación usuarios ↔ organizaciones con roles |
| 10 | `countries` | Países |
| 11 | `regions` | Regiones geográficas dentro de un país |
| 12 | `states` | Departamentos / provincias |
| 13 | `cities` | Ciudades / municipios |
| 14 | `barrios` | Barrios / sectores / urbanizaciones |
| 15 | `propiedades` | Ficha principal del inmueble |
| 16 | `propiedades_galeria` | Fotografías en múltiples tamaños |
| 17 | `propiedades_planos` | Planos arquitectónicos en múltiples tamaños |
| 18 | `property_features` | Características N:M de cada propiedad |
| 19 | `price_history` | Historial de cambios de precio |
| 20 | `related_units` | Relación entre unidades del mismo edificio/complejo |
| 21 | `usuario_favoritos` | Propiedades guardadas por cada usuario |
| 22 | `refresh_tokens` | Tokens para renovar sesión sin re-login |
| 23 | Vistas | Resúmenes pre-calculados para dashboards |

---

## 0. Extensiones

### `postgis`
Permite almacenar y consultar datos geoespaciales (puntos, polígonos). Usado en `geom` de propiedades, ciudades, barrios, etc.

### `pg_trgm`
Habilita búsqueda eficiente de subcadenas (`ILIKE '%texto%'`). Crítico para el autocompletado de ciudades y barrios.

### `unaccent`
Elimina tildes para búsquedas insensibles. Ej: buscar `"malaga"` encuentra `"Málaga"`.

### `f_unaccent(text)`
Función wrapper `IMMUTABLE` de `unaccent()` para poder crear índices GIN sobre textos sin tildes.

---

## 1. operation_types

**Propósito:** Normalizar los tipos de operación (venta, arriendo). Evita que en la base existan `"venta"`, `"Venta"` y `"VENTA"` como valores distintos.

| Columna | Tipo | Descripción |
|---------|------|-------------|
| `id` | SMALLSERIAL | PK autoincremental |
| `code` | VARCHAR(20) | Código estable (`venta`, `arriendo`) |
| `label_es` | VARCHAR(50) | Texto visible para el usuario |

**Ejemplo:**
```sql
SELECT * FROM operation_types;
-- id | code           | label_es
-- 1  | venta          | Venta
-- 2  | arriendo       | Arriendo
-- 3  | arriendo_venta | Arriendo con opción a compra
```

**Uso en propiedad:**
```sql
SELECT p.titulo, ot.label_es AS operacion
FROM propiedades p
JOIN operation_types ot ON p.operation_type_id = ot.id;
```

---

## 2. rental_types

**Propósito:** Subtipo de arriendo. Indica qué tipo de alquiler es: residencial habitual, temporada o vacacional.

| Columna | Tipo | Descripción |
|---------|------|-------------|
| `id` | SMALLSERIAL | PK |
| `code` | VARCHAR(30) | Código estable (`residencial`, `temporada`, `vacacional`) |
| `label_es` | VARCHAR(100) | Texto visible |

**Valores:** `residencial` (vivienda habitual), `temporada` (periodos limitados: lectivos, trabajo temporal, mudanzas), `vacacional` (estancias turísticas).

**Uso en propiedad:**
```sql
SELECT p.titulo, ot.label_es AS operacion, rt.label_es AS tipo_alquiler
FROM propiedades p
JOIN operation_types ot ON p.operation_type_id = ot.id
LEFT JOIN rental_types rt ON p.rental_type_id = rt.id;
```

---

## 3. property_types

**Propósito:** Catálogo de tipos de inmueble adaptados al mercado colombiano.

| Columna | Tipo | Descripción |
|---------|------|-------------|
| `id` | SMALLSERIAL | PK |
| `code` | VARCHAR(30) | Código estable |
| `label_es` | VARCHAR(50) | Nombre en español |
| `label_en` | VARCHAR(50) | Nombre en inglés (opcional) |
| `category` | VARCHAR(30) | Clasificación: `residential`, `commercial`, `industrial`, `land`, `rural`, `parking`, `storage` |

**Ejemplo:**
```sql
INSERT INTO property_types (code, label_es, category) VALUES
('apartamento', 'Apartamento', 'residential'),
('local', 'Local comercial', 'commercial'),
('lote', 'Lote / Terreno', 'land');
```

---

## 4. condition_types

**Propósito:** Estado de conservación del inmueble. Terminología colombiana.

| Columna | Tipo | Descripción |
|---------|------|-------------|
| `id` | SMALLSERIAL | PK |
| `code` | VARCHAR(30) | Código |
| `label_es` | VARCHAR(50) | Texto visible |

**Valores:** `nuevo`, `para_estrenar`, `usado`, `remodelado`, `para_remodelar`, `obra_negra`, `obra_gris`, `en_construccion`.

**Ejemplo de uso:**
```sql
SELECT titulo, ct.label_es AS estado
FROM propiedades p
JOIN condition_types ct ON p.condition_type_id = ct.id
WHERE ct.code = 'para_estrenar';
```

---

## 5. heating_types

**Propósito:** Tipos de calefacción. Relevante principalmente en Bogotá y zonas de altura.

| Columna | Tipo | Descripción |
|---------|------|-------------|
| `id` | SMALLSERIAL | PK |
| `code` | VARCHAR(30) | Código |
| `label_es` | VARCHAR(50) | Texto visible |

**Valores:** `gas_natural`, `electrica`, `lena`, `sin_calefaccion`.

---

## 6. feature_catalog

**Propósito:** Catálogo maestro de características adicionales. Es la pieza clave del sistema N:M flexible.

| Columna | Tipo | Descripción |
|---------|------|-------------|
| `id` | SMALLSERIAL | PK |
| `code` | VARCHAR(50) | Código único y estable |
| `label_es` | VARCHAR(100) | Texto visible |
| `category` | VARCHAR(30) | Agrupación: `security`, `comfort`, `leisure`, `accessibility`, `technology`, `sustainability`, `views`, `rules`, `services` |
| `data_type` | VARCHAR(20) | `boolean`, `numeric` o `text` |

**Ventaja:** Añadir `"Cargador vehículo eléctrico"` no requiere migración. Solo se inserta una fila aquí.

**Ejemplo:**
```sql
INSERT INTO feature_catalog (code, label_es, category, data_type)
VALUES ('carga_electrica', 'Cargador vehículo eléctrico', 'technology', 'boolean');
```

**Categorías incluidas:**
- `security`: Portería, cámaras, cerca eléctrica, conjunto cerrado
- `comfort`: Ascensor, terraza, balcón, cocina integral, closets
- `leisure`: Piscina, gimnasio, salón social, zona BBQ, canchas
- `views`: Vista a la ciudad, montaña, panorámica
- `rules`: Se admiten mascotas, no fumadores, solo estudiantes
- `services`: Red de gas, agua, luz, servicios incluidos
- `technology`: Internet, línea telefónica, TV por cable

**Features específicos de habitación (`category`):**
- `comfort`: `bano_privado`, `bano_compartido`, `habitacion_amoblada`, `acceso_independiente`, `parqueo_bicicleta`, `escritorio`, `closet_empotrado`, `ventilador`, `nevera_propio`
- `services`: `servicios_incluidos`, `internet_incluido`, `alimentacion_incluida`
- `rules`: `uso_cocina`, `uso_sala`, `uso_lavadora`, `solo_estudiantes`, `solo_mujeres`, `solo_hombres`, `no_mascotas`, `no_fumadores`
- `technology`: `tv_cable`

---

## 7. usuarios

**Propósito:** Cualquier persona que se registra en la plataforma. Puede ser comprador, arrendatario, agente o superadmin.

| Columna | Tipo | Descripción |
|---------|------|-------------|
| `id` | SERIAL | PK |
| `name` | VARCHAR(255) | Nombre completo |
| `email` | VARCHAR(255) | Email único |
| `password` | VARCHAR(255) | Hash de contraseña (nullable para auth social) |
| `telefono` | VARCHAR(20) | Teléfono de contacto (primario) |
| `telefonos` | VARCHAR[] | Array de teléfonos del usuario (múltiples) |
| `rol` | VARCHAR(50) | `user` o `superadmin` |
| `provider` | VARCHAR(50) | `local`, `google`, `github` |
| `provider_id` | VARCHAR(255) | ID externo del proveedor OAuth |
| `image_url` | VARCHAR(500) | Foto de perfil |
| `public_id` | VARCHAR(255) | ID en servicio de imágenes (Cloudinary, etc.) |
| `email_verificado` | BOOLEAN | ¿Confirmó su email? |
| `bloqueado` | BOOLEAN | Cuenta suspendida |
| `intentos_fallidos` | INTEGER | Intentos de login fallidos |
| `ultimo_login` | TIMESTAMP | Último acceso |

**Ejemplo:**
```sql
INSERT INTO usuarios (name, email, password, rol)
VALUES ('Juan Pérez', 'juan@email.com', '$2b$10$...', 'user');
```

---

## 8. organizaciones

**Propósito:** Inmobiliarias, constructoras o promotoras que publican bajo su marca. Soporta multi-tenant (subdominios y dominios propios).

| Columna | Tipo | Descripción |
|---------|------|-------------|
| `id` | SERIAL | PK |
| `nombre` | VARCHAR(255) | Nombre comercial |
| `email` | VARCHAR(255) | Email de contacto |
| `telefono` | VARCHAR(20) | Teléfono |
| `website` | VARCHAR(255) | Sitio web externo |
| `descripcion` | TEXT | Descripción de la empresa |
| `logo_url` | VARCHAR(500) | URL del logo |
| `slug` | VARCHAR(150) | Identificador para subdominio (`inmobiliaria-xyz.inmobitwo.com`) |
| `custom_domain` | VARCHAR(255) | Dominio propio (`www.inmobiliaria-xyz.com`) |
| `dominio_estado` | VARCHAR(50) | `sin_dominio`, `pendiente_dns`, `activo` |
| `plan` | VARCHAR(50) | `free` o `premium` |
| `estado` | VARCHAR(50) | `pendiente`, `aprobada`, `suspendida` |
| `tema` | VARCHAR(50) | Plantilla visual del escaparate: `tema1` a `tema4` |
| `creada_por_id` | INTEGER | FK a `usuarios`. Quién solicitó crear la organización |

**Ejemplo:**
```sql
INSERT INTO organizaciones (nombre, slug, ciudad, creada_por_id, estado)
VALUES ('Inmobiliaria Bogotá', 'inmobiliaria-bogota', 'Bogotá', 1, 'aprobada');
```

---

## 9. organizacion_miembros

**Propósito:** Un usuario puede pertenecer a varias organizaciones con distintos roles.

| Columna | Tipo | Descripción |
|---------|------|-------------|
| `id` | SERIAL | PK |
| `usuario_id` | INTEGER | FK a `usuarios` |
| `organizacion_id` | INTEGER | FK a `organizaciones` |
| `rol_en_org` | VARCHAR(50) | `agent` (publica propiedades) o `agency_admin` (gestiona la inmo) |
| `estado` | VARCHAR(50) | `activo` o `suspendido` |

**Ejemplo:**
```sql
-- Juan es agente de Inmobiliaria Bogotá
INSERT INTO organizacion_miembros (usuario_id, organizacion_id, rol_en_org)
VALUES (1, 1, 'agent');
```

---

## 10. countries

**Propósito:** Países del mundo. Colombia tendría `iso2 = 'CO'`.

| Columna | Tipo | Descripción |
|---------|------|-------------|
| `id` | SERIAL | PK |
| `name` | VARCHAR(100) | Nombre del país |
| `iso2` | VARCHAR(2) | Código ISO (único) |
| `phonecode` | VARCHAR(10) | Prefijo telefónico (+57) |
| `flag_emoji` | VARCHAR(10) | 🇨🇴 |
| `latitude`, `longitude` | DECIMAL | Coordenadas aproximadas |

**Ejemplo:**
```sql
INSERT INTO countries (name, iso2, phonecode, flag_emoji)
VALUES ('Colombia', 'CO', '+57', '🇨🇴');
```

---

## 11. regions

**Propósito:** Grandes regiones dentro de un país (ej: Andina, Caribe, Pacífica, Orinoquía, Amazonía).

| Columna | Tipo | Descripción |
|---------|------|-------------|
| `id` | SERIAL | PK |
| `country_id` | INTEGER | FK a `countries` |
| `name` | VARCHAR(150) | Nombre de la región |
| `slug` | VARCHAR(150) | URL-friendly |
| `geom` | GEOMETRY | Polígono MultiPolygon de la región |

---

## 12. states

**Propósito:** Departamentos en Colombia (Cundinamarca, Antioquia, Valle del Cauca...).

| Columna | Tipo | Descripción |
|---------|------|-------------|
| `id` | SERIAL | PK |
| `country_id` | INTEGER | FK a `countries` |
| `region_id` | INTEGER | FK a `regions` (nullable) |
| `name` | VARCHAR(150) | Nombre del departamento |
| `slug` | VARCHAR(150) | URL-friendly |
| `dane_code` | VARCHAR(5) | Código DANE oficial |
| `latitude`, `longitude` | DECIMAL | Coordenadas aproximadas |
| `geom` | GEOMETRY | Polígono del departamento |

**Ejemplo:**
```sql
INSERT INTO states (country_id, name, slug, dane_code)
VALUES (1, 'Cundinamarca', 'cundinamarca', '25');
```

---

## 13. cities

**Propósito:** Ciudades / municipios (Bogotá, Medellín, Cali, Barranquilla...).

| Columna | Tipo | Descripción |
|---------|------|-------------|
| `id` | SERIAL | PK |
| `state_id` | INTEGER | FK a `states` |
| `name` | VARCHAR(150) | Nombre del municipio |
| `slug` | VARCHAR(150) | URL-friendly |
| `dane_code` | VARCHAR(8) | Código DANE del municipio |
| `latitude`, `longitude` | DECIMAL | Coordenadas del centro |
| `geom` | GEOMETRY | Polígono del municipio |

**Ejemplo:**
```sql
INSERT INTO cities (state_id, name, slug, dane_code, latitude, longitude)
VALUES (1, 'Bogotá', 'bogota', '11001', 4.60971, -74.08175);
```

---

## 14. barrios

**Propósito:** Barrios, urbanizaciones o sectores dentro de una ciudad. Ej: Chapinero, El Poblado, Ciudad Jardín.

| Columna | Tipo | Descripción |
|---------|------|-------------|
| `id` | SERIAL | PK |
| `city_id` | INTEGER | FK a `cities` |
| `name` | VARCHAR(150) | Nombre del barrio |
| `slug` | VARCHAR(150) | URL-friendly |
| `dane_code` | VARCHAR(100) | Código de barrio si existe |
| `latitude`, `longitude` | DECIMAL | Coordenadas aproximadas |
| `geom` | GEOMETRY | Polígono del barrio |

**Ejemplo:**
```sql
INSERT INTO barrios (city_id, name, slug)
VALUES (1, 'Chapinero', 'chapinero');
```

---

## 15. propiedades

**Propósito:** Tabla central. La ficha completa de cada inmueble. Contiene ~50 campos entre identificación, ubicación, áreas, distribución, precios, servicios y metadatos del anuncio.

### Campos clave por categoría:

**Catálogos (FKs):**
- `operation_type_id` → `operation_types`
- `rental_type_id` → `rental_types` (subtipo de alquiler)
- `property_type_id` → `property_types`
- `condition_type_id` → `condition_types`
- `heating_type_id` → `heating_types`

**Geografía (FKs):**
- `country_id`, `state_id`, `city_id`, `barrio_id`

**Identificación Colombia:**
- `estrato` (1-6): Clasificación socioeconómica. Filtro obligatorio en búsquedas.
- `cedula_catastral`: Identificador catastral.
- `matricula_inmobiliaria`: Registro público.

**Ubicación textual:**
- `direccion`, `numero_direccion`, `floor`, `interior_apartment_number`, `postal_code`

**Precios:**
- `precio`: Precio total en COP.
- `price_per_sqm`: Precio por m² (calculado o generado).
- `administracion`: Valor de la cuota de administración del conjunto.

**Áreas:**
- `constructed_area`: m² construidos.
- `private_area`: m² de área privada (lo que realmente compras).
- `plot_area`: m² del lote (casas, fincas).

**Distribución:**
- `room_count`: Total de ambientes.
- `bedroom_count`: Número de alcobas.
- `bathroom_count`: Baños completos.
- `social_bathroom_count`: Baño social (sin ducha).

**Parqueadero:**
- `parqueadero_tipo`: `cubierto` / `descubierto`
- `parqueadero_modo`: `privado` / `comunal`
- `parking_space_count`, `parking_space_included`, `parking_space_price`

**Servicios públicos (crítico para lotes):**
- `tiene_agua`, `tiene_luz`, `tiene_gas`, `tiene_alcantarillado`

**Amenities (flags rápidos para filtros):**
- `has_elevator`, `has_swimming_pool`, `has_gym`, `has_security_24h`, `has_air_conditioning`, `is_furnished`

**Estado del anuncio:**
- `estado`: `publicado` / `no_publicado` (control interno del publicador).
- `listing_status`: `active`, `inactive`, `sold`, `rented`, `expired` (ciclo de vida comercial).

**Publicador:**
- `publicado_por_id` → FK a `usuarios`
- `organizacion_id` → FK a `organizaciones` (nullable si es particular)
- `es_de_organizacion`: Flag booleano para queries rápidas.

**Contacto por anuncio:**
- `how_to_contact`: canal de contacto elegido por el publicador (`telefono_chat` = ambos, `solo_chat`, `solo_telefono`).
- `telefono_contacto`: qué número del usuario se usa en este anuncio (`null` = usar el primario).

**Ejemplo completo:**
```sql
INSERT INTO propiedades (
    operation_type_id, property_type_id, condition_type_id,
    city_id, barrio_id,
    direccion, numero_direccion, floor, interior_apartment_number,
    latitude, longitude,
    estrato, cedula_catastral,
    titulo, description, precio, administracion,
    constructed_area, private_area,
    bedroom_count, bathroom_count, social_bathroom_count,
    construction_year, antiguedad_anios,
    parqueadero_tipo, parqueadero_modo, parking_space_count,
    tiene_agua, tiene_luz, tiene_gas, tiene_alcantarillado,
    has_elevator, has_swimming_pool, has_gym, has_air_conditioning,
    zona, publicado_por_id, organizacion_id, es_de_organizacion
) VALUES (
    1, 1, 3,                    -- venta, apartamento, usado
    1, 5,                       -- Bogotá, Chapinero
    'Calle 45', '12-34', '3', '301',
    4.635, -74.065,
    4, '1234567890',
    'Apartamento amplio en Chapinero',
    'Hermoso apartamento con vista panorámica...',
    450000000, 350000,          -- $450M COP, admin $350k
    85, 78,                     -- 85m² construidos, 78m² privados
    3, 2, 1,                    -- 3 alcobas, 2 baños, 1 social
    2015, 11,
    'cubierto', 'privado', 1,
    TRUE, TRUE, TRUE, TRUE,
    TRUE, TRUE, TRUE, TRUE,
    'residencial', 1, 1, TRUE
);
```

---

## 16. propiedades_galeria

**Propósito:** Almacena cada foto de una propiedad en **5 tamaños diferentes**. Cada foto subida genera 5 filas (una por tamaño).

| Columna | Tipo | Descripción |
|---------|------|-------------|
| `id` | SERIAL | PK |
| `propiedad_id` | INTEGER | FK a `propiedades` |
| `orden` | INTEGER | Orden de visualización (0 = primera) |
| `tamaño` | VARCHAR(20) | `thumbnail`, `small`, `medium`, `large`, `xlarge` |
| `es_portada` | BOOLEAN | ¿Es la imagen principal? Solo una por tamaño. |
| `url` | VARCHAR(500) | URL de la imagen |
| `public_id` | VARCHAR(255) | ID en Cloudinary/S3 |
| `width_px`, `height_px` | SMALLINT | Dimensiones originales |
| `file_size_kb` | INTEGER | Peso en KB |
| `mime_type` | VARCHAR(30) | `image/jpeg`, `image/webp` |

**Regla de negocio:** Solo puede existir una portada por tamaño por propiedad (índice único parcial).

**Ejemplo:**
```sql
-- Foto 0 (portada) en todos los tamaños
INSERT INTO propiedades_galeria (propiedad_id, orden, tamaño, es_portada, url)
VALUES
(1, 0, 'thumbnail', TRUE, 'https://cdn.com/img_1_thumb.jpg'),
(1, 0, 'small', TRUE, 'https://cdn.com/img_1_small.jpg'),
(1, 0, 'medium', TRUE, 'https://cdn.com/img_1_medium.jpg'),
(1, 0, 'large', TRUE, 'https://cdn.com/img_1_large.jpg'),
(1, 0, 'xlarge', TRUE, 'https://cdn.com/img_1_xlarge.jpg');
```

---

## 17. propiedades_planos

**Propósito:** Igual estructura que `propiedades_galeria` pero para planos arquitectónicos. No tiene concepto de `es_portada`.

| Columna | Tipo | Descripción |
|---------|------|-------------|
| `id` | SERIAL | PK |
| `propiedad_id` | INTEGER | FK |
| `orden` | INTEGER | Orden |
| `tamaño` | VARCHAR(20) | `thumbnail` a `xlarge` |
| `url` | VARCHAR(500) | URL |
| `public_id` | VARCHAR(255) | ID en CDN |

**Ejemplo:**
```sql
INSERT INTO propiedades_planos (propiedad_id, orden, tamaño, url)
VALUES (1, 0, 'large', 'https://cdn.com/plano_1_large.jpg');
```

---

## 18. property_features

**Propósito:** Tabla puente N:M que asigna características del `feature_catalog` a cada propiedad. Es el corazón del sistema flexible.

| Columna | Tipo | Descripción |
|---------|------|-------------|
| `id` | BIGSERIAL | PK |
| `propiedad_id` | INTEGER | FK a `propiedades` |
| `feature_id` | SMALLINT | FK a `feature_catalog` |
| `bool_value` | BOOLEAN | Valor si el feature es booleano |
| `numeric_value` | DECIMAL(10,2) | Valor si es numérico (ej: metros de terraza) |
| `text_value` | VARCHAR(255) | Valor si es texto |

**Restricción:** Una propiedad no puede tener el mismo feature duplicado (`UNIQUE(propiedad_id, feature_id)`).

**Ejemplo:**
```sql
-- Propiedad 1 tiene piscina, gimnasio y vista panorámica
INSERT INTO property_features (propiedad_id, feature_id, bool_value) VALUES
(1, (SELECT id FROM feature_catalog WHERE code = 'piscina'), TRUE),
(1, (SELECT id FROM feature_catalog WHERE code = 'gimnasio'), TRUE),
(1, (SELECT id FROM feature_catalog WHERE code = 'vista_panoramica'), TRUE);
```

**Consultar features de una propiedad:**
```sql
SELECT fc.label_es, pf.bool_value
FROM property_features pf
JOIN feature_catalog fc ON pf.feature_id = fc.id
WHERE pf.propiedad_id = 1 AND pf.bool_value = TRUE;
```

---

## 19. price_history

**Propósito:** Trazabilidad completa de cada cambio de precio. Permite mostrar al usuario "Este inmueble bajó $20M hace 3 días".

| Columna | Tipo | Descripción |
|---------|------|-------------|
| `id` | BIGSERIAL | PK |
| `propiedad_id` | INTEGER | FK a `propiedades` |
| `old_price` | INTEGER | Precio anterior (NULL si es el primer registro) |
| `new_price` | INTEGER | Precio nuevo |
| `price_change` | INTEGER | **GENERATED**: `new_price - old_price` |
| `change_percent` | DECIMAL(5,2) | **GENERATED**: `% de cambio` |
| `change_type` | VARCHAR(20) | `increase`, `decrease`, `initial`, `relisted` |
| `detected_at` | TIMESTAMPTZ | Fecha del cambio |
| `source` | VARCHAR(50) | Origen: `user_update`, `api`, `scraper` |

**Ejemplo:**
```sql
-- El agente cambia el precio de 500M a 480M
INSERT INTO price_history (propiedad_id, old_price, new_price, change_type)
VALUES (1, 500000000, 480000000, 'decrease');

-- Resultado automático:
-- price_change = -20000000
-- change_percent = -4.00
```

**Lógica en backend (pseudocódigo):**
```
function actualizarPrecio(propiedadId, nuevoPrecio):
    propiedad = SELECT * FROM propiedades WHERE id = propiedadId
    INSERT INTO price_history (propiedad_id, old_price, new_price, change_type)
    VALUES (propiedadId, propiedad.precio, nuevoPrecio, calcularTipoCambio(...))
    UPDATE propiedades SET precio = nuevoPrecio WHERE id = propiedadId
```

---

## 20. related_units

**Propósito:** Relaciona propiedades que pertenecen al mismo edificio, conjunto o desarrollo. Útil para mostrar "Otros apartamentos en este edificio".

| Columna | Tipo | Descripción |
|---------|------|-------------|
| `id` | BIGSERIAL | PK |
| `parent_property_id` | INTEGER | FK a `propiedades` (el "origen") |
| `child_property_id` | INTEGER | FK a `propiedades` (la "relacionada") |
| `relationship_type` | VARCHAR(30) | `same_building`, `same_complex`, `same_development`, `similar` |

**Ejemplo:**
```sql
-- El apartamento 101 y el 102 están en el mismo edificio
INSERT INTO related_units (parent_property_id, child_property_id, relationship_type)
VALUES (1, 2, 'same_building');
```

---

## 21. usuario_favoritos

**Propósito:** Propiedades guardadas por cada usuario para revisarlas después.

| Columna | Tipo | Descripción |
|---------|------|-------------|
| `id` | SERIAL | PK |
| `usuario_id` | INTEGER | FK a `usuarios` |
| `propiedad_id` | INTEGER | FK a `propiedades` |
| `created_at` | TIMESTAMP | Fecha de guardado |

**Restricción:** Un usuario no puede guardar la misma propiedad dos veces (`UNIQUE(usuario_id, propiedad_id)`).

**Ejemplo:**
```sql
INSERT INTO usuario_favoritos (usuario_id, propiedad_id) VALUES (1, 5);
```

---

## 22. refresh_tokens

**Propósito:** Permite renovar el `access_token` JWT sin pedir al usuario que vuelva a loguearse.

| Columna | Tipo | Descripción |
|---------|------|-------------|
| `id` | SERIAL | PK |
| `usuario_id` | INTEGER | FK a `usuarios` |
| `token` | VARCHAR(512) | Token único y largo (hash) |
| `expira_en` | TIMESTAMP | Fecha de expiración |
| `revocado` | BOOLEAN | ¿Fue invalidado manualmente? |

**Ejemplo:**
```sql
INSERT INTO refresh_tokens (usuario_id, token, expira_en)
VALUES (1, 'abc123...xyz', NOW() + INTERVAL '7 days');
```

---

## 23. Vistas

### `v_property_summary`
**Propósito:** Resumen rápido para listados, dashboards y APIs. Une propiedades con sus catálogos, ubicación, publicador e imagen principal.

**Columnas destacadas:**
- `titulo`, `precio`, `price_per_sqm`
- `ciudad`, `departamento`, `barrio`
- `operacion`, `tipo_inmueble`, `estado_conservacion`
- `estrato`, `listing_status`
- `main_image_url`: URL de la portada en tamaño `medium`

**Ejemplo:**
```sql
SELECT * FROM v_property_summary
WHERE ciudad = 'Bogotá' AND operacion = 'Venta' AND estrato >= 4;
```

### `v_recent_price_changes`
**Propósito:** Últimos cambios de precio en los últimos 30 días. Ideal para notificaciones o badges de "Bajó de precio".

**Columnas:**
- `propiedad_id`, `titulo`, `ciudad`
- `old_price`, `new_price`, `price_change`, `change_percent`
- `change_type`, `detected_at`

**Ejemplo:**
```sql
SELECT * FROM v_recent_price_changes WHERE ciudad = 'Medellín';
```

---

## Funciones y Triggers

### `update_updated_at_column()`
Actualiza automáticamente la columna `updated_at` cada vez que se hace `UPDATE` en `usuarios`, `organizaciones`, `organizacion_miembros` o `propiedades`.

### `sync_geom_from_lat_lng()`
Cada vez que se inserta o actualiza una propiedad con `latitude` y `longitude`, calcula automáticamente el punto PostGIS en `geom`. Evita inconsistencias entre coordenadas y geometría.

---

## Convenciones del Esquema

| Convención | Descripción |
|------------|-------------|
| `SMALLSERIAL` / `SMALLINT` | IDs de catálogos pequeños y contadores (ahorro de espacio e índices más rápidos). |
| `SERIAL` / `INTEGER` | IDs principales de tablas con crecimiento moderado. |
| `BIGSERIAL` / `BIGINT` | IDs de tablas que crecerán mucho (`property_features`, `price_history`, `related_units`). |
| `GENERATED ALWAYS AS (...) STORED` | Columnas calculadas automáticamente por PostgreSQL (`price_change`, `change_percent`, `price_per_sqm`). |
| `CHECK` | Restricciones de dominio para garantizar integridad (estrato 1-6, estados válidos). |
| `ON DELETE CASCADE` | Si borras una propiedad, se borran sus fotos, planos, features e historial de precios. |
| `ON DELETE SET NULL` | Si borras una ciudad, la propiedad conserva sus datos pero pierde la referencia. |
| `GIN` + `pg_trgm` | Índices para búsqueda difusa y autocompletado de nombres geográficos. |
| `GIST` + `postgis` | Índices espaciales para búsquedas por proximidad y mapas. |
