# FASE 0 — Auditoría (solo lectura) — ofertas por operación
Rama: `feature/ofertas-por-operacion` (sin commits). Nada ejecutado contra BD.
Nota: el árbol ya traía cambios sin commitear de una sesión anterior (ver §i.0);
las líneas citadas corresponden al árbol actual.

## (h) Scripts test/lint
`package.json` scripts: `start`, `dev`, `seed:geo`. **NO hay test ni lint** en backend
(sin config eslint). Verificación posible: `node --check`.

## (a) Lectura/escritura de columnas de `propiedades`

### operation_type_id
- `src/constants/api/fields.js:38` `CAMPOS_PROPIEDAD` — read — `"operation_type_id"`
- `propiedades.controllers.js:36` `parseCamposPropiedad` — read — `operation_type_id: toInt(raw.operation_type_id)`
- `propiedades.controllers.js:135` `joinsCatalogo` — read — `LEFT JOIN operation_types ot ON ...operation_type_id=ot.id`
- `propiedades.controllers.js:561,605` `createPropiedades` — write — INSERT + values
- `propiedades.controllers.js:1321` `updatePropiedades` — write — en `camposActualizables`
- `propiedades.controllers.js:1684,1749,1800,1843` `publicarAnuncios` — read/read/write/write
- `propiedades.controllers.js:2497,2894` `getPropertiesBySlugs/searchVivienda` — read (JOIN)
- `propiedades.controllers.js:2971` `getInmueblesEnBbox` — read (JOIN)
- `geo.controllers.js:158,520,737,849` — read — `p.operation_type_id IN (SELECT id FROM operation_types WHERE LOWER(code)=...)`
- `lib/locations.js:41` `getOperationTypeLabel` — read
- `validations/propiedad_validate.js:41-42` `publicar_anuncio_validate` — read (requerido)
- `db.sql:259,573,607,614-618` — DDL + vista `v_property_summary` + índices

### precio
- `fields.js:57,105` — read (permitidos + default)
- `propiedades.controllers.js:57` `parseCamposPropiedad` — read — `precio: toInt(raw.precio)`
- `propiedades.controllers.js:91-93` `calcularPricePerSqm` — read — `Math.round(precio/constructedArea)`
- `propiedades.controllers.js:566,625,1805,1863` create/publicar — write INSERT + values
- `propiedades.controllers.js:655` create — read — `campos.precio!==null?"active":"inactive"` (listing_status derivado)
- `propiedades.controllers.js:669,1907` — write `price_history` 'initial'
- `propiedades.controllers.js:1303-1314,1400,1433` update — write + read para recalc/historial
- `propiedades.controllers.js:2293-2294` slugs — read — `p.precio>=${minPrecio}` (¡interpolado!)
- `propiedades.controllers.js:2717,2721` searchVivienda — read — parametrizado `$idx`
- `propiedades.controllers.js:2474,2870,2965` + `geo.controllers.js:754` — read en SELECTs
- `ia.controllers.js:23,74`, `lib/promptBuilder.js:37`, `lib/precios_referencia_colombia.js:317-451` — read (IA/sugerido)
- `validations/propiedad_validate.js:68-71` — read (positivo en publicar)
- `db.sql:290,542,611,614-618` — `precio INTEGER` + vista + índices

### price_per_sqm
- `fields.js:58,106` — read
- `propiedades.controllers.js:557,1790` create/publicar — write vía `calcularPricePerSqm`
- `propiedades.controllers.js:1391-1410` update — write si cambió precio o área
- `propiedades.controllers.js:2474,2870`, `geo.controllers.js:755`, `ia.controllers.js:75` — read
- `db.sql:291,543` — `DECIMAL(10,2)` + vista. `price_history` NO lo guarda.

### rental_type_id
- `fields.js:42`, controller `:40` (`toInt`), `:136` (JOIN), `:576,659,1815,1897` (INSERTs),
  `:1325` (update dinámico), `:1688` (publicar destructure) — verbatim en §(b)
- Filtros: `:2321` slugs `AND p.rental_type_id IN (${rentalList})` (interpolado),
  `:2739` searchVivienda `=ANY($::int[])`, `propertyFilters.js:46` (vacacional)
- `db.sql:263` — `SMALLINT REFERENCES rental_types(id)`. Sin validación.

### parking_space_price
- `fields.js:74`, controller `:73` (`toInt`), `:571,642,1810,1880` (INSERTs),
  `:1357` (update dinámico), `:1715` (publicar). `db.sql:313` INTEGER. Sin otros usos.

### listing_status
- `fields.js:87` — read
- Controller `:575,655` create (`precio!==null?"active":"inactive"`), `:1385-1387` update
  (solo si llega explícito), `:1793,1814,1893` publicar (`raw.listing_status||"active"`)
- `db.sql:339-347` — `VARCHAR(20) DEFAULT 'active' CHECK IN(active,inactive,sold,rented,expired)`
- `db.sql:559,581` — vista lo lee y filtra `='active'`. `db.sql:612` índice.

### published_at / expires_at
- `fields.js:88,89` — solo whitelist `?fields=`
- `db.sql:348,349` — `published_at TIMESTAMPTZ`, `expires_at TIMESTAMPTZ`
- `publicarAnuncios:1814` escribe `published_at` (valor `CURRENT_TIMESTAMP` fijo en el
  INSERT, no del body). `expires_at`: **cero escrituras/lecturas en todo el código**.
- `db.sql:560,613` — vista + índice de published_at.

### titulo
- `fields.js:47,103` — read
- `createPropiedades:306,325` — read body → valida → `:566,623` INSERT verbatim (**cliente gana**)
- `createPropiedades:457,494,534` — read para nombres de archivo S3
- `updatePropiedades:886,888,890` — read opcional → `:1290-1292` UPDATE si llega (**cliente gana**)
- `updatePropiedades:1083,1119,1156` — fallback `"imagen"` para S3
- `publicarAnuncios:1787-1788` — **backend genera** `tituloFinal`, `:1861` INSERT (**cliente pierde**, se ignora su titulo)
- Lecturas: `:2474,2870,2965`, `geo:754` (SELECTs), `tracking:38,73,85,555,592,640,667`,
  `organizaciones:625`, `leads:10` (`propiedad_titulo`)
- `geo.controllers.js:26-31` `getTituloSugerido` — compone sin persistir
- `propiedad_validate.js:6-11` — titulo 3-500 si llega; requerido si `requerirPublicador`
- `db.sql:288,541,584` — `VARCHAR(255)` + vistas

### description
- `fields.js:48`, controller `:56` (`raw.description||null`), `:566,624,1805,1862` INSERTs,
  `:1341` update dinámico. `db.sql:289` TEXT.
- IA la genera (`ia.controllers:151,181,230,252`, `promptBuilder`) pero no persiste sola.
- Sin validación ni filtros.

### estado (propiedades)
- `fields.js:86` — read
- Controller `:306,325,575,654` create; `:886,1295-1297` update; `:1792,1814,1892` publicar
- Lecturas con filtro `p.estado='publicado'`: `:2519,2561,2589,2627,2703,2941`,
  `geo:189,196,202,223,228,233,239,262,266,271,276,282,511,728,795,881,907,936,963`
- OJO: `?estado=` en search-slugs/searchVivienda mapea a `condition_types` (estadoGrupos),
  NO a `p.estado` (`:2398,2813`).
- `organizaciones:606-607` conteos por estado. `validations:18-22` (publicado/no_publicado).
- `db.sql:338` — `DEFAULT 'publicado' CHECK IN(publicado,no_publicado)`.

## (b) Código verbatim

### `src/validations/propiedad_validate.js` (completo, 85 líneas)
```js
const ESTADOS_PERMITIDOS = ["publicado", "no_publicado"];

export function propiedad_validate(datos, { requerirPublicador = true } = {}) {
  const errores = [];

  if (datos.titulo !== undefined) {
    if (!datos.titulo) {
      errores.push("El título es requerido.");
    } else if (datos.titulo.length < 3) {
      errores.push("El título debe tener al menos 3 caracteres.");
    } else if (datos.titulo.length > 500) {
      errores.push("El título no puede exceder los 500 caracteres.");
    }
  } else if (requerirPublicador) {
    errores.push("El título es requerido.");
  }

  if (datos.estado && !ESTADOS_PERMITIDOS.includes(datos.estado)) {
    errores.push(
      `El estado debe ser uno de: ${ESTADOS_PERMITIDOS.join(", ")}.`,
    );
  }

  if (requerirPublicador) {
    if (!datos.publicado_por_id) {
      errores.push("publicado_por_id es requerido.");
    } else {
      const publicadorId = Number(datos.publicado_por_id);
      if (!Number.isInteger(publicadorId) || publicadorId <= 0) {
        errores.push("publicado_por_id debe ser un número válido.");
      }
    }
  }

  return errores;
}

export function publicar_anuncio_validate(datos) {
  const errores = [];

  if (!datos.operation_type_id) {
    errores.push("operation_type_id es requerido.");
  }

  if (!datos.property_type_id) {
    errores.push("property_type_id es requerido.");
  }

  if (!datos.direccion) {
    errores.push("La dirección es requerida.");
  }

  if (!datos.city_id || !datos.state_id) {
    errores.push("city_id y state_id son requeridos.");
  }

  if (!datos.country_id) {
    errores.push("country_id es requerido.");
  }

  if (datos.estrato !== undefined && datos.estrato !== null && datos.estrato !== "") {
    const estrato = Number(datos.estrato);
    if (!Number.isInteger(estrato) || estrato < 1 || estrato > 6) {
      errores.push("El estrato debe ser un número entre 1 y 6.");
    }
  }

  if (datos.precio !== undefined && datos.precio !== null && datos.precio !== "") {
    const precio = Number(datos.precio);
    if (isNaN(precio) || precio <= 0) {
      errores.push("El precio debe ser un número positivo.");
    }
  }

  if (!datos.publicado_por_id) {
    errores.push("publicado_por_id es requerido.");
  } else {
    const publicadorId = Number(datos.publicado_por_id);
    if (!Number.isInteger(publicadorId) || publicadorId <= 0) {
      errores.push("publicado_por_id debe ser un número válido.");
    }
  }

  return errores;
}
```

### `getPropiedadesById` (740-832) — PK + catálogos + galería/planos/features
Compone `SELECT ${selectBase}` (?fields=, default todas) + portada + `camposCatalogoSelect`
(`operacion`, `operacion_slug`, `tipo_alquiler`, `tipo_inmueble`, `tipo_slug`,
`estado_conservacion`, `tipo_calefaccion`, `ciudad`, `departamento`, `barrio`,
`usuario_nombre`) + `joinsCatalogo` + `JOIN usuarios u ON p.publicado_por_id = u.id`,
`WHERE p.id = $1`; luego galería (`id, url, public_id, orden, tamaño, es_portada`),
planos, y `caracteristicas` agrupadas por categoría (`bool_value = TRUE`).
Cache `propiedad:${id}:${fields||"default"}` TTL 30s. 404 si no hay fila.

### `getPropiedadResumen` (3010-3052)
```sql
SELECT p.latitude, p.longitude,
 (SELECT COUNT(DISTINCT pg.orden) FROM propiedades_galeria pg
   WHERE pg.propiedad_id = p.id AND pg.es_portada = false)::int AS galeria_count,
 (SELECT COUNT(DISTINCT pp.orden) FROM propiedades_planos pp
   WHERE pp.propiedad_id = p.id)::int AS planos_count
FROM propiedades p WHERE p.id = $1
```
404 si no hay fila. Sin caché.

### `getHistorialPrecios` (3055-3087)
```sql
SELECT id, old_price, new_price, price_change, change_percent,
       change_type, detected_at, source
FROM price_history WHERE propiedad_id = $1 ORDER BY detected_at DESC
```
Sin caché. (OJO: lee `price_change`, `change_percent`, `detected_at` — existen como
GENERATED/STORED en `db.sql:440-449`; ver §(c).)

### `getPropiedadCaracteristicas` (3091-3138)
```sql
SELECT fc.id, fc.code, fc.label_es, fc.category, fc.data_type,
       pf.bool_value, pf.numeric_value, pf.text_value
FROM property_features pf
JOIN feature_catalog fc ON pf.feature_id = fc.id
WHERE pf.propiedad_id = $1 AND pf.bool_value = TRUE
ORDER BY fc.category ASC, fc.id ASC
```
Agrupa por `category` en JS. Sin caché, sin auth.

### `guardarPropiedadCaracteristicas` (3143-3225)
Permiso: 404 si no existe; 403 si `publicado_por_id !== req.usuario.id`
(solo dueño, sin bypass de org/superadmin). Luego `DELETE FROM property_features
WHERE propiedad_id = $1` y loop `INSERT INTO property_features
(propiedad_id, feature_id, bool_value, numeric_value, text_value)
VALUES ($1,$2,$3,$4,$5)` con `bool_value === undefined ? true : bool_value`.
`cacheInvalidate("propiedad*")`. Responde `{ propiedad_id, features_guardados }`.

### `calcularPrecioSugeridoPropiedad` (3324-3373) y `validarPrecioPropiedad` (3377-3427)
Resuelven `city_id → cities.slug` (fallback `"nacional"`) y
`condition_type_id → condition_types.code` (fallback `"usado"`), derivan
`floor_type` de `floor` (`derivarFloorType`), llaman a `calcularPrecioSugerido`
de `lib/precios_referencia_colombia.js`. **NO distinguen venta de arriendo**
(siempre precio de venta; reportado para Fase 4).

### `createPropiedades` (293-737), `updatePropiedades` (834-1563), `publicarAnuncios` (1678-1929)
Verbatim completo en el Anexo A al final de este archivo (funciones largas;
se copian íntegras para no perder detalle).

## (c) price_history: escrituras y price_per_sqm
- `calcularPricePerSqm(precio, constructedArea)` (controller:91-96, única definición):
  `if (precio > 0 && constructedArea > 0) return Math.round(precio / constructedArea); return null;`
  Llamadas: create:557, update recalc:1407, publicar:1790. `price_history` NO guarda price_per_sqm.
- 3 INSERTs (todos `source='user_update'`):
  1. `createPropiedades:668-674` — `(propiedad_id, NULL, precio, 'initial')` si precio !== null.
  2. `updatePropiedades:1428-1445` — lee precio actual; si cambia: 'initial' (old null),
     'increase'/'decrease'; NO escribe si es igual.
  3. `publicarAnuncios:1906-1912` — igual que (1).
- `'relisted'` existe en el CHECK (`db.sql:450-452`) pero **cero escrituras** en JS/Rust.
- Recalc en update (1391-1411): si cambia precio o área, relee base y recalcula; escribe
  `price_per_sqm` (posible NULL).
- DDL `price_history` (`db.sql:435-453`): `old_price INTEGER`, `new_price INTEGER NOT NULL`,
  `price_change INTEGER GENERATED ALWAYS AS (new_price - COALESCE(old_price,0)) STORED`,
  `change_percent DECIMAL(5,2) GENERATED ... STORED`, `change_type CHECK
  (increase,decrease,initial,relisted)`. **NO tiene `operation_type_id`** (lo añade la migración).

## (d) Título y descripción
- Título solo lo compone `publicarAnuncios:1783-1788`:
  `"${Venta|Alquiler} de ${tipoLabel} en ${direccion}, ${city}, ${state}"`
  (OJO: "Alquiler", no "Arriendo"). `getTituloSugerido` (`geo:24-29`) replica la plantilla sin persistir.
- `createPropiedades` (body `titulo`, línea 306) y `updatePropiedades` (opcional, 886-890/1290)
  aceptan título del cliente y **gana el cliente**. `publicarAnuncios` lo ignora.
- `description` nunca se genera en create/update (pasa directo, `parseCamposPropiedad:56`);
  la IA (`ia.controllers:19`, `promptBuilder`) es endpoint aparte sin persistencia.

## (e/f) Lecturas por operación/precio + caché Redis
Forma canónica del filtro: `LOWER(ot.code) = LOWER($n)` (slugs, vivienda, bbox) o
`operation_type_id IN (SELECT id FROM operation_types WHERE LOWER(code)=...)`
(polígono, location-info, geo-count, suggest). `vacacional` fuerza `operation="arriendo"`
(slugs, bbox, polígono, location-info, geo-count, suggest) pero **NO en searchVivienda**.
Precio min/max en millones ×1e6: slugs **interpolado** en SQL (riesgo inyección, :2293-2294),
searchVivienda parametrizado. Solo 2 lecturas cacheadas: `propiedades:all:${fields}` (30s)
y `propiedad:${id}:${fields}` (30s); invalidación única `propiedad*` (cubre ambas).
`mis-anuncios`, `count`, home, organización, bbox, polígono, favoritos: sin caché.
`v_property_summary` filtra `listing_status='active'`.

## (g) Leads
DDL `schema.tracking.sql:67-106`: `propiedad_id INTEGER NOT NULL` (SÍ existe, FK CASCADE),
`sesion_id UUID`, `usuario_id`, `nombre/email/telefono`, `score DEFAULT 0`,
`origen CHECK IN ('formulario_directo','scoring_comportamiento')`,
`estado DEFAULT 'nuevo' CHECK IN ('nuevo','contactado','en_negociacion','cerrado','descartado')`,
`UNIQUE (sesion_id, propiedad_id)`.
Writers Node (`tracking.controllers.js`): `registrarEvento` fallback (:270-284,
'origen scoring_comportamiento', `ON CONFLICT DO NOTHING`) y `crearLeadDirecto`
(:434-439, score 20, 'formulario_directo'). **Rust también escribe**:
`services/rust-tracking-service/src/handlers.rs:50 registrar_evento` (:99-109) con
`origen='automatico'` → **VIOLA el CHECK** de la tabla (fallaría en BD con ese constraint).

## (i) Puntos donde el diseño choca con el código real
(i.0) El árbol trae cambios sin commitear de sesión anterior (en esta rama):
`propiedades.controllers.js` (bloque swap `portada_orden`, invalidación `propiedad*`,
`getPropiedadStats`), `routes/propiedades.routes.js` (ruta `:id/stats`),
`lib/redis.js` + `lib/rateLimit.js` (resiliencia y límites por usuario), más
cambios de frontend fuera del alcance. Nada commiteado.
(i.1) Permisos: `updatePropiedades:857-862` y `guardarPropiedadCaracteristicas` exigen
**solo dueño** (`publicado_por_id !== req.usuario.id` → 403). El prompt (regla 6) pide
reutilizar "dueño o miembro / superadmin": ese rol extendido **no existe** en el código.
(i.2) `titulo`: el prompt dice que el backend lo ignora; hoy `create` y `PATCH` aceptan
el del cliente (gana). Solo `publicarAnuncios` genera.
(i.3) `expires_at`: columna muerta (cero lecturas/escrituras); la migración la usa en backfill.
(i.4) `getPropertiesBySlugs:2293-2294` interpola min/max en SQL (inyección si no es número).
(i.5) `updatePropiedades` NO es transaccional ( docenas de queries sueltas); Fase 3 exige
transacción para ofertas (nuevo servicio sí, pero el PATCH actual seguirá sin serlo).
(i.6) `searchVivienda` no aplica el override vacacional→arriendo (las demás sí).
(i.7) `publicarAnuncios` NO procesa imágenes (sin `req.files`); `createPropiedades` sí exige portada.
(i.8) `?estado=` en búsquedas mapea a `condition_types`, no a `p.estado` (confuso para Fase 5).
(i.9) `calcularPrecioSugerido/validarPrecio` no distinguen venta/arriendo (Fase 4 los deja igual:
ok con el prompt, pero el algoritmo solo sirve para venta).
(i.10) Rust escribe leads con `origen='automatico'` que viola el CHECK (ver (g)).

**PARADA 1**: informe entregado. Espero "continuar" antes de Fase 1.

## ANEXO A — Verbatim funciones largas

### A.1 `createPropiedades` (293-532)
```js
export const createPropiedades = async (req, res) => {
  try {
    let file = null;
    let files = [];

    if (req.files?.imagenPrincipal?.[0]) {
      file = req.files.imagenPrincipal[0];
    }

    if (req.files?.galeria) {
      files = req.files.galeria;
    }

    const { titulo, estado } = req.body;
    const es_de_organizacion =
      req.body.es_de_organizacion === "true" ||
      req.body.es_de_organizacion === true;

    let organizacion_id = req.body.organizacion_id;
    if (
      !organizacion_id ||
      organizacion_id === "null" ||
      organizacion_id === "undefined"
    ) {
      organizacion_id = null;
    } else {
      organizacion_id = parseInt(organizacion_id);
    }

    // ========================================
    // VALIDACIONES
    // ========================================
    const data = { titulo, estado, publicado_por_id: req.usuario.id };
    const errores = propiedad_validate(data);
    if (errores.length > 0) {
      return res.status(400).json({
        success: false,
        error: errores[0],
      });
    }

    if (!file) {
      return res
        .status(400)
        .json({ success: false, error: "La imagen principal es requerida." });
    }

    // ========================================
    // RUTA RÁPIDA: Delegar procesamiento de imágenes a Rust
    // ========================================
    let imagenesGaleria = [];
    let imagenesPlanos = [];

    let usarRustMedia = !!RUST_MEDIA_URL && file && file.buffer;

    if (usarRustMedia) {
      try {
        const FormData = (await import("form-data")).default;
        const axios = (await import("axios")).default;
        const formData = new FormData();

        formData.append("imagenPrincipal", file.buffer, {
          filename: file.originalname,
          contentType: file.mimetype,
        });

        if (req.files?.galeria) {
          req.files.galeria.forEach((f) => {
            formData.append("galeria", f.buffer, {
              filename: f.originalname,
              contentType: f.mimetype,
            });
          });
        }

        if (req.files?.planos) {
          req.files.planos.forEach((f) => {
            formData.append("planos", f.buffer, {
              filename: f.originalname,
              contentType: f.mimetype,
            });
          });
        }

        const mediaResponse = await axios.post(
          `${RUST_MEDIA_URL}/media/upload/imagen`,
          formData,
          {
            headers: { ...formData.getHeaders() },
            timeout: 90000,
          },
        );

        if (
          mediaResponse.data?.success &&
          mediaResponse.data?.data?.length > 0
        ) {
          const images = mediaResponse.data.data;

          // Portada: primera imagen del array. orden fijo = -1 para que
          // nunca choque con el orden de las fotos de galería (empiezan en 0).
          const portadaRows = buildVersionRows([images[0]], -1).map((r) => ({
            ...r,
            es_portada: true,
          }));
          imagenesGaleria.push(...portadaRows);

          // Galería adicional (orden empieza en 0)
          const galeriaImgs = images.slice(
            1,
            1 + (req.files.galeria?.length || 0),
          );
          const galeriaRows = buildVersionRows(galeriaImgs, 0).map((r) => ({
            ...r,
            es_portada: false,
          }));
          imagenesGaleria.push(...galeriaRows);

          // Planos (sin concepto de portada)
          if (req.files?.planos) {
            const planosStartIdx = 1 + (req.files.galeria?.length || 0);
            const planosImgs = images.slice(planosStartIdx);
            imagenesPlanos.push(...buildVersionRows(planosImgs, 0));
          }

          console.log(
            "Imagenes procesadas via Rust media service (multi-tamaño)",
          );
        } else {
          throw new Error("Respuesta invalida del servicio Rust de media");
        }
      } catch (rustError) {
        console.warn(
          "Rust media no disponible, usando subida directa:",
          rustError.message,
        );
        usarRustMedia = false;
        imagenesGaleria = [];
        imagenesPlanos = [];
      }
    }

    // ========================================
    // FALLBACK: Subida directa a S3 desde Express
    // ========================================
    if (!usarRustMedia) {
      const carpeta = AWS_BUCKET_SUBFOLDER || "inmobitwo";

      // ========================================
      // PROCESAR IMAGEN PRINCIPAL (fallback: 1 sola versión, tamaño 'medium')
      // ========================================
      if (!file.mimetype.startsWith("image/")) {
        return res.status(400).json({
          success: false,
          error: "Solo se permiten imágenes (tipo: image/*).",
        });
      }
      if (file.size > 10 * 1024 * 1024) {
        return res.status(400).json({
          success: false,
          error: "La imagen debe pesar menos de 10MB.",
        });
      }

      const fileNamePrincipal = `${carpeta}/propiedades/imagenes_principal/propiedad_${titulo
        .toLowerCase()
        .replace(/\s+/g, "-")}_${Date.now()}.jpg`;

      const urlPrincipal = await uploadToS3(
        file.buffer,
        fileNamePrincipal,
        file.mimetype,
      );
      imagenesGaleria.push({
        url: urlPrincipal,
        public_id: fileNamePrincipal,
        orden: -1,
        tamaño: "medium",
        es_portada: true,
      });

      // ========================================
      // PROCESAR GALERÍA
      // ========================================
      if (files.length > 0) {
        for (let i = 0; i < files.length; i++) {
          const imageFile = files[i];

          if (!imageFile.mimetype.startsWith("image/")) {
            console.warn(
              `⚠️ Archivo ${imageFile.originalname} no es imagen, saltando...`,
            );
            continue;
          }
          if (imageFile.size > 10 * 1024 * 1024) {
            console.warn(
              `⚠️ Archivo ${imageFile.originalname} supera 10MB, saltando...`,
            );
            continue;
          }

          const fileName = `${carpeta}/propiedades/galeria/propiedad_${titulo
            .toLowerCase()
            .replace(/\s+/g, "-")}_${Date.now()}_${i}.jpg`;

          const url = await uploadToS3(
            imageFile.buffer,
            fileName,
            imageFile.mimetype,
          );
          imagenesGaleria.push({
            url,
            public_id: fileName,
            orden: i,
            tamaño: "medium",
            es_portada: false,
          });
        }
      }

      // ========================================
      // PROCESAR PLANOS
      // ========================================
      if (req.files?.planos) {
        const planosFiles = req.files.planos;
        for (let i = 0; i < planosFiles.length; i++) {
          const imageFile = planosFiles[i];

          if (!imageFile.mimetype.startsWith("image/")) {
            console.warn(
              `⚠️ Archivo ${imageFile.originalname} no es imagen, saltando...`,
            );
            continue;
          }
          if (imageFile.size > 10 * 1024 * 1024) {
            console.warn(
              `⚠️ Archivo ${imageFile.originalname} supera 10MB, saltando...`,
            );
            continue;
          }

          const fileName = `${carpeta}/propiedades/planos/propiedad_${titulo
            .toLowerCase()
            .replace(/\s+/g, "-")}_${Date.now()}_${i}.jpg`;

          const url = await uploadToS3(
            imageFile.buffer,
            fileName,
            imageFile.mimetype,
          );
          imagenesPlanos.push({
            url,
            public_id: fileName,
            orden: i,
            tamaño: "medium",
          });
        }
      }
    } // fin fallback S3 directo
```

### A.1 `createPropiedades` (cont. 553-737)
```js
    // ========================================
    // INSERTAR EN BD
    // ========================================
    const campos = parseCamposPropiedad(req.body);
    const price_per_sqm = calcularPricePerSqm(campos.precio, campos.constructed_area);

    const query = `
      INSERT INTO propiedades (
        operation_type_id, property_type_id, condition_type_id, heating_type_id,
        country_id, state_id, city_id, barrio_id,
        direccion, numero_direccion, floor, interior_apartment_number, postal_code,
        latitude, longitude,
        estrato, cedula_catastral, matricula_inmobiliaria,
        titulo, description, precio, price_per_sqm, administracion,
        constructed_area, private_area, plot_area,
        room_count, bedroom_count, bathroom_count, social_bathroom_count,
        construction_year, antiguedad_anios, is_new_construction,
        parqueadero_tipo, parqueadero_modo, parking_space_count,
        parking_space_included, parking_space_price,
        tiene_agua, tiene_luz, tiene_gas, tiene_alcantarillado,
        has_elevator, has_swimming_pool, has_gym, has_security_24h,
        has_air_conditioning, is_furnished, zona,
        estado, listing_status,
        es_de_organizacion, organizacion_id, publicado_por_id, rental_type_id,
        how_to_contact, telefono_contacto,
        barrio_nombre,
        created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
        $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30,
        $31, $32, $33, $34, $35, $36, $37, $38, $39, $40, $41, $42, $43, $44, $45, $46,
        $47, $48, $49, $50, $51, $52, $53, $54, $55, $56, $57, $58,
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
      RETURNING *;
    `;

    const values = [
      campos.operation_type_id, campos.property_type_id, campos.condition_type_id,
      campos.heating_type_id, campos.country_id, campos.state_id, campos.city_id,
      campos.barrio_id, campos.direccion, campos.numero_direccion, campos.floor,
      campos.interior_apartment_number, campos.postal_code, campos.latitude,
      campos.longitude, campos.estrato, campos.cedula_catastral,
      campos.matricula_inmobiliaria, titulo, campos.description, campos.precio,
      price_per_sqm, campos.administracion, campos.constructed_area,
      campos.private_area, campos.plot_area, campos.room_count, campos.bedroom_count,
      campos.bathroom_count, campos.social_bathroom_count, campos.construction_year,
      campos.antiguedad_anios, campos.is_new_construction, campos.parqueadero_tipo,
      campos.parqueadero_modo, campos.parking_space_count,
      campos.parking_space_included, campos.parking_space_price, campos.tiene_agua,
      campos.tiene_luz, campos.tiene_gas, campos.tiene_alcantarillado,
      campos.has_elevator, campos.has_swimming_pool, campos.has_gym,
      campos.has_security_24h, campos.has_air_conditioning, campos.is_furnished,
      campos.zona, estado || "publicado",
      campos.precio !== null ? "active" : "inactive",
      es_de_organizacion || false, organizacion_id, req.usuario.id,
      campos.rental_type_id, campos.how_to_contact, campos.telefono_contacto,
      campos.barrio_nombre,
    ];

    const result = await pool.query(query, values);
    const nuevaPropiedad = result.rows[0];

    // Historial de precios inicial (si hay precio)
    if (campos.precio !== null) {
      await pool.query(
        `INSERT INTO price_history (propiedad_id, old_price, new_price, change_type, source)
         VALUES ($1, NULL, $2, 'initial', 'user_update')`,
        [nuevaPropiedad.id, campos.precio],
      );
    }

    if (imagenesGaleria.length > 0) {
      await Promise.all(
        imagenesGaleria.map((imagen) =>
          pool.query(
            `INSERT INTO propiedades_galeria (propiedad_id, orden, tamaño, es_portada, url, public_id, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)`,
            [nuevaPropiedad.id, imagen.orden, imagen.tamaño, imagen.es_portada, imagen.url, imagen.public_id],
          ),
        ),
      );
    }

    if (imagenesPlanos.length > 0) {
      await Promise.all(
        imagenesPlanos.map((imagen) =>
          pool.query(
            `INSERT INTO propiedades_planos (propiedad_id, orden, tamaño, url, public_id, created_at)
             VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)`,
            [nuevaPropiedad.id, imagen.orden, imagen.tamaño, imagen.url, imagen.public_id],
          ),
        ),
      );
    }

    const portadaFila = imagenesGaleria.find(
      (r) => r.es_portada && r.tamaño === "medium",
    );
    await cacheInvalidate("propiedad*");
    return res.status(201).json({
      success: true,
      message: "Propiedad creada.",
      data: {
        ...nuevaPropiedad,
        imagen_principal_url: portadaFila?.url || null,
        imagen_principal_public_id: portadaFila?.public_id || null,
        galeria: imagenesGaleria,
        planos: imagenesPlanos,
      },
    });
  } catch (error) {
    console.error("❌ Error en POST /propiedades:", error);
    res.status(500).json({
      success: false,
      error: "Error interno del servidor.",
      details: error.message,
    });
  }
};
```

### A.2 `updatePropiedades` (834-953: cabecera, permiso, multipart, validación)
```js
export const updatePropiedades = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id || id === "null" || id === "undefined" || isNaN(parseInt(id))) {
      return res.status(400).json({
        success: false,
        error: "ID de propiedad inválido o requerido",
      });
    }

    const propiedadResult = await pool.query(
      "SELECT publicado_por_id FROM propiedades WHERE id = $1",
      [id],
    );

    if (propiedadResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Propiedad no encontrada.",
      });
    }

    if (propiedadResult.rows[0].publicado_por_id !== req.usuario.id) {
      return res.status(403).json({
        success: false,
        error: "No autorizado para editar esta propiedad.",
      });
    }

    let formDataObj = {};
    let file = null;
    let files = [];
    let planosFiles = [];

    const contentType = req.headers["content-type"] || "";

    if (contentType.includes("multipart/form-data")) {
      if (req.files?.imagenPrincipal?.[0]) {
        file = req.files.imagenPrincipal[0];
      }
      if (req.files?.galeria) {
        files = req.files.galeria;
      }
      if (req.files?.planos) {
        planosFiles = req.files.planos;
      }
      formDataObj = req.body;
    } else {
      formDataObj = req.body;
    }

    const { titulo, estado } = formDataObj;

    if (titulo !== undefined || estado !== undefined) {
      const errores = propiedad_validate(
        { titulo, estado },
        { requerirPublicador: false },
      );
      if (errores.length > 0) {
        return res.status(400).json({
          success: false,
          error: errores[0],
        });
      }
    }

    let imagesToDelete = [];
    if (formDataObj.imagesToDelete) {
      try {
        imagesToDelete =
          typeof formDataObj.imagesToDelete === "string"
            ? JSON.parse(formDataObj.imagesToDelete)
            : formDataObj.imagesToDelete;
      } catch (err) {
        imagesToDelete = [];
      }
    }

    let planosToDelete = [];
    if (formDataObj.planosToDelete) {
      try {
        planosToDelete =
          typeof formDataObj.planosToDelete === "string"
            ? JSON.parse(formDataObj.planosToDelete)
            : formDataObj.planosToDelete;
      } catch (err) {
        planosToDelete = [];
      }
    }
    // ... sigue validación de imagen (image/*, 10MB), lectura de portada actual,
    // ruta Rust media / fallback S3 (misma estructura que create), borrado de
    // galería/planos por `orden`, swap de portada `portada_orden` (cambios de
    // sesión anterior, ver §i.0), y a continuación:
```

### A.2 `updatePropiedades` (cont. 1238-1445: campos, precio, historial)
```js
    if (titulo) {
      updates.push(`titulo = $${paramCount}`);
      values.push(titulo);
      paramCount++;
    }
    if (estado) {
      updates.push(`estado = $${paramCount}`);
      values.push(estado);
      paramCount++;
    }

    // --- PRECIO: detectar cambio ANTES del UPDATE para registrar price_history
    let nuevoPrecio = null;
    const rawPrecio = formDataObj.precio;
    if (rawPrecio !== undefined && rawPrecio !== null && rawPrecio !== "") {
      const precioParsed = parseInt(rawPrecio);
      if (isNaN(precioParsed)) {
        return res.status(400).json({
          success: false,
          error: "El precio debe ser un número válido.",
        });
      }
      nuevoPrecio = precioParsed;
      updates.push(`precio = $${paramCount}`);
      values.push(precioParsed);
      paramCount++;
    }

    // --- CAMPOS NUEVOS (schema v5.0 Colombia)
    const campos = parseCamposPropiedad(formDataObj);
    const camposActualizables = [
      "operation_type_id", "property_type_id", "condition_type_id",
      "heating_type_id", "rental_type_id", "country_id", "state_id", "city_id",
      "barrio_id", "barrio_nombre", "direccion", "numero_direccion", "floor",
      "interior_apartment_number", "postal_code", "latitude", "longitude",
      "estrato", "cedula_catastral", "matricula_inmobiliaria", "description",
      "administracion", "constructed_area", "private_area", "plot_area",
      "room_count", "bedroom_count", "bathroom_count", "social_bathroom_count",
      "construction_year", "antiguedad_anios", "is_new_construction",
      "parqueadero_tipo", "parqueadero_modo", "parking_space_count",
      "parking_space_included", "parking_space_price", "tiene_agua", "tiene_luz",
      "tiene_gas", "tiene_alcantarillado", "has_elevator", "has_swimming_pool",
      "has_gym", "has_security_24h", "has_air_conditioning", "is_furnished",
      "zona", "how_to_contact", "telefono_contacto",
    ];
    for (const campo of camposActualizables) {
      if (
        formDataObj[campo] !== undefined &&
        formDataObj[campo] !== null &&
        formDataObj[campo] !== ""
      ) {
        updates.push(`${campo} = $${paramCount}`);
        values.push(campos[campo]);
        paramCount++;
      }
    }

    // --- LISTING_STATUS: solo se actualiza si llega explícitamente
    if (formDataObj.listing_status !== undefined) {
      updates.push(`listing_status = $${paramCount}`);
      values.push(formDataObj.listing_status);
      paramCount++;
    }

    // --- PRICE_PER_SQM: recalcular si cambió precio o área construida
    const recalcPrecio =
      rawPrecio !== undefined && rawPrecio !== null && rawPrecio !== "";
    const recalcArea =
      formDataObj.constructed_area !== undefined &&
      formDataObj.constructed_area !== null &&
      formDataObj.constructed_area !== "";
    if (recalcPrecio || recalcArea) {
      const { rows: current } = await pool.query(
        "SELECT precio, constructed_area FROM propiedades WHERE id = $1",
        [id],
      );
      const precioBase = recalcPrecio ? nuevoPrecio : current[0]?.precio;
      const areaBase = recalcArea
        ? campos.constructed_area
        : current[0]?.constructed_area;
      const pricePerSqm = calcularPricePerSqm(precioBase, areaBase);
      updates.push(`price_per_sqm = $${paramCount}`);
      values.push(pricePerSqm);
      paramCount++;
    }

    if (
      updates.length === 0 &&
      imagenesGaleria.length === 0 &&
      imagesToDelete.length === 0 &&
      imagenesPlanos.length === 0 &&
      planosToDelete.length === 0 &&
      !huboSwapPortada
    ) {
      return res.status(400).json({
        success: false,
        error: "No hay campos o imágenes para actualizar.",
      });
    }

    // --- Registrar cambio de precio en price_history (ANTES del UPDATE)
    if (nuevoPrecio !== null) {
      const { rows: current } = await pool.query(
        "SELECT precio FROM propiedades WHERE id = $1",
        [id],
      );
      const oldPrice = current[0]?.precio ?? null;
      if (oldPrice !== nuevoPrecio) {
        const changeType =
          oldPrice === null
            ? "initial"
            : nuevoPrecio > oldPrice
              ? "increase"
              : "decrease";
        await pool.query(
          `INSERT INTO price_history (propiedad_id, old_price, new_price, change_type, source)
           VALUES ($1, $2, $3, $4, 'user_update')`,
          [id, oldPrice, nuevoPrecio, changeType],
        );
      }
    }

    if (updates.length > 0) {
      updates.push(`updated_at = CURRENT_TIMESTAMP`);
      values.push(id);

      const query = `
        UPDATE propiedades SET ${updates.join(", ")}
        WHERE id = $${paramCount} RETURNING *;
      `;

      const result = await pool.query(query, values);

      if (result.rows.length === 0) {
        return res
          .status(404)
          .json({ success: false, error: "Propiedad no encontrada." });
      }
    }
    // ... borrado de portada anterior si hay nueva, inserts de galería/planos,
    // SELECT final (p.* + portada + galeria + planos), cacheInvalidate("propiedad*"),
    // 200 { data: {..., galeria, planos} }, catch → 500.
```

### A.3 `publicarAnuncios` (1678-1794: parse + validación + título)
```js
export const publicarAnuncios = async (req, res) => {
  try {
    const raw = req.body;

    const campos = parseCamposPropiedad(raw);
    const {
      operation_type_id, property_type_id, /* ... (todos los campos) ... */
      how_to_contact, telefono_contacto,
    } = campos;

    const es_de_organizacion =
      raw.es_de_organizacion === "true" || raw.es_de_organizacion === true;

    let organizacion_id = raw.organizacion_id;
    if (!organizacion_id || organizacion_id === "null" || organizacion_id === "undefined") {
      organizacion_id = null;
    } else {
      organizacion_id = parseInt(organizacion_id);
    }

    // VALIDACIONES
    const data = {
      operation_type_id, property_type_id, direccion, country_id, city_id,
      state_id, estrato, precio, publicado_por_id: req.usuario.id,
    };
    const errores = publicar_anuncio_validate(data);
    if (errores.length > 0) {
      return res.status(400).json({ success: false, error: errores[0] });
    }

    // NOMBRES PARA EL TÍTULO
    const city = await getCityById(city_id);
    const state = await getStateById(state_id);
    if (!city || !state) {
      return res.status(400).json({
        success: false, error: "Ciudad o estado no encontrado.",
      });
    }

    const tipoLabel = await getPropertyTypeLabel(property_type_id);
    // El título lo genera el backend (mismo formato para todos los anuncios):
    // "{Operación} de {Tipo} en {direccion}, {ciudad}, {departamento}"
    const operacionLabel =
      String(raw.operacion || "venta").toLowerCase() === "venta"
        ? "Venta"
        : "Alquiler";
    const titulo = `${operacionLabel} de ${tipoLabel || "Propiedad"} en ${direccion}, ${city.name}, ${state.name}`;
    const tituloFinal = titulo.charAt(0).toUpperCase() + titulo.slice(1);

    const price_per_sqm = calcularPricePerSqm(precio, constructed_area);

    const estadoFinal = raw.estado || "publicado";
    const listingStatusFinal = raw.listing_status || "active";

    // INSERT (1798-1841): columnas = las 58 de create + published_at CURRENT_TIMESTAMP.
    // values con tituloFinal, precio, price_per_sqm, estadoFinal, listingStatusFinal,
    // req.usuario.id como publicado_por_id. RETURNING *.
    // price_history 'initial' si precio !== null (1906-1913).
    // cacheInvalidate("propiedad*"). 201 { data: nuevaPropiedad }.
    // OJO: publicarAnuncios NO procesa imágenes (sin req.files) y NO valida
    // rental_type_id ni resto de campos opcionales.
```

*Fin del informe Fase 0. PARADA 1.*

<!-- ANEXO-A3 -->
