import { AWS_BUCKET_SUBFOLDER, RUST_MEDIA_URL } from "../config.js";
import { pool } from "../db.js";
import { cacheGet, cacheInvalidate } from "../lib/redis.js";
import { deleteFromS3, uploadToS3 } from "../lib/s3AWS.js";
import { tiempoRelativo } from "../utils/tiempoRelativo.js";
import { getCityById, getStateById, getPropertyTypeLabel } from "../lib/locations.js";
import {
  propiedad_validate,
  publicar_anuncio_validate,
} from "../validations/propiedad_validate.js";
import {
  calcularPrecioSugerido,
  validarPrecioUsuario,
} from "../lib/precios_referencia_colombia.js";
import { buildTipoFilter, esTipoVacacional } from "../lib/propertyFilters.js";

const TAMANOS = ["thumbnail", "small", "medium", "large", "xlarge"];

// Normaliza los campos del schema v5.0 (Colombia) que llegan desde el frontend.
// En multipart/form-data todo llega como string; en JSON llegan como tipos reales.
function toBool(valor) {
  return valor === "true" || valor === true;
}

function toInt(valor) {
  if (valor === undefined || valor === null || valor === "") return null;
  const n = parseInt(valor);
  return isNaN(n) ? null : n;
}

// Extrae y normaliza los campos nuevos de propiedad a partir del body.
function parseCamposPropiedad(raw) {
  return {
    operation_type_id: toInt(raw.operation_type_id),
    property_type_id: toInt(raw.property_type_id),
    condition_type_id: toInt(raw.condition_type_id),
    heating_type_id: toInt(raw.heating_type_id),
    rental_type_id: toInt(raw.rental_type_id),
    country_id: toInt(raw.country_id),
    state_id: toInt(raw.state_id),
    city_id: toInt(raw.city_id),
    barrio_id: toInt(raw.barrio_id),
    barrio_nombre: raw.barrio_nombre || null,
    direccion: raw.direccion || null,
    numero_direccion: raw.numero_direccion || null,
    floor: raw.floor || null,
    interior_apartment_number: raw.interior_apartment_number || null,
    postal_code: raw.postal_code || null,
    latitude: raw.latitude,
    longitude: raw.longitude,
    estrato: toInt(raw.estrato),
    cedula_catastral: raw.cedula_catastral || null,
    matricula_inmobiliaria: raw.matricula_inmobiliaria || null,
    description: raw.description || null,
    precio: toInt(raw.precio),
    administracion: toInt(raw.administracion),
    constructed_area: toInt(raw.constructed_area),
    private_area: toInt(raw.private_area),
    plot_area: toInt(raw.plot_area),
    room_count: toInt(raw.room_count),
    bedroom_count: toInt(raw.bedroom_count),
    bathroom_count: toInt(raw.bathroom_count),
    social_bathroom_count: toInt(raw.social_bathroom_count),
    construction_year: toInt(raw.construction_year),
    antiguedad_anios: toInt(raw.antiguedad_anios),
    is_new_construction: toBool(raw.is_new_construction),
    parqueadero_tipo: raw.parqueadero_tipo || null,
    parqueadero_modo: raw.parqueadero_modo || null,
    parking_space_count: toInt(raw.parking_space_count),
    parking_space_included: toBool(raw.parking_space_included),
    parking_space_price: toInt(raw.parking_space_price),
    tiene_agua: toBool(raw.tiene_agua),
    tiene_luz: toBool(raw.tiene_luz),
    tiene_gas: toBool(raw.tiene_gas),
    tiene_alcantarillado: toBool(raw.tiene_alcantarillado),
    has_elevator: toBool(raw.has_elevator),
    has_swimming_pool: toBool(raw.has_swimming_pool),
    has_gym: toBool(raw.has_gym),
    has_security_24h: toBool(raw.has_security_24h),
    has_air_conditioning: toBool(raw.has_air_conditioning),
    is_furnished: toBool(raw.is_furnished),
    zona: raw.zona || null,
    how_to_contact: raw.how_to_contact || null,
    telefono_contacto: raw.telefono_contacto || null,
  };
}

// Calcula el precio por m² según el precio y el área construida.
function calcularPricePerSqm(precio, constructedArea) {
  if (precio > 0 && constructedArea > 0) {
    return Math.round(precio / constructedArea);
  }
  return null;
}

function portadaSubquery(alias = "propiedades") {
  return `COALESCE(
    (SELECT pg.url FROM propiedades_galeria pg 
     WHERE pg.propiedad_id = ${alias}.id AND pg.es_portada = true AND pg.tamaño = 'medium'
     LIMIT 1),
    NULL
  ) as imagen_principal_url`;
}

function portadaPublicIdSubquery(alias = "propiedades") {
  return `COALESCE(
    (SELECT pg.public_id FROM propiedades_galeria pg 
     WHERE pg.propiedad_id = ${alias}.id AND pg.es_portada = true AND pg.tamaño = 'medium'
     LIMIT 1),
    NULL
  ) as imagen_principal_public_id`;
}

// Campos de los catálogos (schema v5.0) que se agregan a los SELECT de
// propiedades para que el frontend reciba labels en vez de solo IDs.
function camposCatalogoSelect(alias = "p") {
  return `
    ot.label_es AS operacion,
    ot.code AS operacion_slug,
    rt.label_es AS tipo_alquiler,
    pt.label_es AS tipo_inmueble,
    pt.code AS tipo_slug,
    ct.label_es AS estado_conservacion,
    ht.label_es AS tipo_calefaccion,
    c.name AS ciudad,
    s.name AS departamento,
    b.name AS barrio
  `;
}

function joinsCatalogo(alias = "p") {
  return `
    LEFT JOIN operation_types ot ON ${alias}.operation_type_id = ot.id
    LEFT JOIN rental_types rt ON ${alias}.rental_type_id = rt.id
    LEFT JOIN property_types pt ON ${alias}.property_type_id = pt.id
    LEFT JOIN condition_types ct ON ${alias}.condition_type_id = ct.id
    LEFT JOIN heating_types ht ON ${alias}.heating_type_id = ht.id
    LEFT JOIN cities c ON ${alias}.city_id = c.id
    LEFT JOIN states s ON ${alias}.state_id = s.id
    LEFT JOIN barrios b ON ${alias}.barrio_id = b.id
  `;
}

// Extrae el key real de S3 a partir de la URL completa que devuelve Rust.
// Esto es lo que se guarda como public_id de cada fila, para que el borrado
// en S3 funcione con el archivo real (no con un id inventado).
function extractS3Key(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    return decodeURIComponent(u.pathname.replace(/^\//, ""));
  } catch {
    return null;
  }
}

// Convierte la respuesta de Rust (array de objetos {thumbnail, small, medium,
// large, xlarge}) en filas planas listas para insertar en
// propiedades_galeria / propiedades_planos. Cada foto genera hasta 5 filas
// (una por tamaño que Rust haya devuelto). Todas comparten el mismo `orden`
// (identifica que son la MISMA foto), pero cada una tiene su propio
// public_id real, extraído de su URL.
function buildVersionRows(imagenesRust, startOrden = 0) {
  const rows = [];
  imagenesRust.forEach((img, i) => {
    const orden = startOrden + i;
    TAMANOS.forEach((tamano) => {
      const url = img[tamano];
      if (!url) return;
      rows.push({ url, public_id: extractS3Key(url), orden, tamaño: tamano });
    });
  });
  return rows;
}

// ok
export const getPropiedades = async (req, res) => {
  try {
    const propiedadesConDatos = await cacheGet(
      "propiedades:all",
      30,
      async () => {
        const { rows: propiedades } = await pool.query(
          `SELECT p.*, ${portadaSubquery("p")}, ${portadaPublicIdSubquery("p")},
                  ${camposCatalogoSelect("p")}
         FROM propiedades p
         ${joinsCatalogo("p")}
         ORDER BY p.created_at DESC`,
        );

        return Promise.all(
          propiedades.map(async (propiedad) => {
            // Galería (incluye portada: es_portada=true, orden=-1)
            const { rows: galeria } = await pool.query(
              `SELECT id, url, public_id, orden, tamaño, es_portada
           FROM propiedades_galeria 
           WHERE propiedad_id = $1 
           ORDER BY orden ASC, tamaño ASC`,
              [propiedad.id],
            );

            // Planos
            const { rows: planos } = await pool.query(
              `SELECT id, url, public_id, orden, tamaño
           FROM propiedades_planos 
           WHERE propiedad_id = $1 
           ORDER BY orden ASC, tamaño ASC`,
              [propiedad.id],
            );

            // Publicador
            let publicador = null;

            if (propiedad.es_de_organizacion) {
              // 👉 Trae la organización + el usuario que la creó
              const { rows } = await pool.query(
                `SELECT 
              o.id,
              o.nombre,
              o.logo_url,
              o.telefono,
              o.ciudad,
              o.provincia
            FROM organizaciones o
            WHERE o.id = $1`,
                [propiedad.organizacion_id],
              );
              publicador = rows[0]
                ? { tipo: "organizacion", ...rows[0] }
                : null;
            } else {
              // 👉 Trae el usuario directamente
              const { rows } = await pool.query(
                `SELECT 
              id,
              name,
              image_url,
              telefono
            FROM usuarios
            WHERE id = $1`,
                [propiedad.publicado_por_id],
              );
              publicador = rows[0] ? { tipo: "usuario", ...rows[0] } : null;
            }

            return {
              ...propiedad,
              galeria: galeria || [],
              planos: planos || [],
              publicador,
              tiempo_relativo: tiempoRelativo(propiedad.created_at),
            };
          }),
        );
      },
    );

    res.status(200).json({
      success: true,
      message: "propiedades obtenidas.",
      data: propiedadesConDatos,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

// ok
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
        $1, $2, $3, $4,
        $5, $6, $7, $8,
        $9, $10, $11, $12, $13,
        $14, $15,
        $16, $17, $18,
        $19, $20, $21, $22, $23,
        $24, $25, $26,
        $27, $28, $29, $30,
        $31, $32, $33,
        $34, $35, $36,
        $37, $38,
        $39, $40, $41, $42,
        $43, $44, $45, $46,
        $47, $48, $49,
        $50, $51,
        $52, $53, $54, $55,
        $56, $57,
        $58,
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
      RETURNING *;
    `;

    const values = [
      campos.operation_type_id,
      campos.property_type_id,
      campos.condition_type_id,
      campos.heating_type_id,
      campos.country_id,
      campos.state_id,
      campos.city_id,
      campos.barrio_id,
      campos.direccion,
      campos.numero_direccion,
      campos.floor,
      campos.interior_apartment_number,
      campos.postal_code,
      campos.latitude,
      campos.longitude,
      campos.estrato,
      campos.cedula_catastral,
      campos.matricula_inmobiliaria,
      titulo,
      campos.description,
      campos.precio,
      price_per_sqm,
      campos.administracion,
      campos.constructed_area,
      campos.private_area,
      campos.plot_area,
      campos.room_count,
      campos.bedroom_count,
      campos.bathroom_count,
      campos.social_bathroom_count,
      campos.construction_year,
      campos.antiguedad_anios,
      campos.is_new_construction,
      campos.parqueadero_tipo,
      campos.parqueadero_modo,
      campos.parking_space_count,
      campos.parking_space_included,
      campos.parking_space_price,
      campos.tiene_agua,
      campos.tiene_luz,
      campos.tiene_gas,
      campos.tiene_alcantarillado,
      campos.has_elevator,
      campos.has_swimming_pool,
      campos.has_gym,
      campos.has_security_24h,
      campos.has_air_conditioning,
      campos.is_furnished,
      campos.zona,
      estado || "publicado",
      campos.precio !== null ? "active" : "inactive",
      es_de_organizacion || false,
      organizacion_id,
      req.usuario.id,
      campos.rental_type_id,
      campos.how_to_contact,
      campos.telefono_contacto,
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
            [
              nuevaPropiedad.id,
              imagen.orden,
              imagen.tamaño,
              imagen.es_portada,
              imagen.url,
              imagen.public_id,
            ],
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
            [
              nuevaPropiedad.id,
              imagen.orden,
              imagen.tamaño,
              imagen.url,
              imagen.public_id,
            ],
          ),
        ),
      );
    }

    const portadaFila = imagenesGaleria.find(
      (r) => r.es_portada && r.tamaño === "medium",
    );
    await cacheInvalidate("propiedades:*");
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

// ok
export const getPropiedadesById = async (req, res) => {
  try {
    const { id } = req.params;

    const data = await cacheGet(`propiedad:${id}`, 30, async () => {
      const { rows } = await pool.query(
        `SELECT 
          p.*,
          ${portadaSubquery("p")},
          ${portadaPublicIdSubquery("p")},
          ${camposCatalogoSelect("p")},
          u.name AS usuario_nombre,
          u.email AS usuario_email
        FROM propiedades p
        ${joinsCatalogo("p")}
        JOIN usuarios u 
          ON p.publicado_por_id = u.id
        WHERE p.id = $1`,
        [id],
      );
      const propiedad = rows[0];
      if (!propiedad) {
        return null;
      }

      const { rows: galeria } = await pool.query(
        `SELECT id, url, public_id, orden, tamaño, es_portada
         FROM propiedades_galeria 
         WHERE propiedad_id = $1 
         ORDER BY orden ASC, tamaño ASC`,
        [id],
      );
      const { rows: planos } = await pool.query(
        `SELECT id, url, public_id, orden, tamaño
         FROM propiedades_planos 
         WHERE propiedad_id = $1 
         ORDER BY orden ASC, tamaño ASC`,
        [id],
      );

      // Características N:M activas (agrupadas por categoría)
      const { rows: features } = await pool.query(
        `SELECT fc.id, fc.code, fc.label_es, fc.category, fc.data_type,
                pf.bool_value, pf.numeric_value, pf.text_value
         FROM property_features pf
         JOIN feature_catalog fc ON pf.feature_id = fc.id
         WHERE pf.propiedad_id = $1 AND pf.bool_value = TRUE
         ORDER BY fc.category ASC, fc.id ASC`,
        [id],
      );
      const caracteristicas = features.reduce((acc, fila) => {
        if (!acc[fila.category]) acc[fila.category] = [];
        acc[fila.category].push({
          id: fila.id,
          code: fila.code,
          label_es: fila.label_es,
          data_type: fila.data_type,
        });
        return acc;
      }, {});

      return {
        ...propiedad,
        galeria: galeria || [],
        planos: planos || [],
        caracteristicas,
      };
    });

    if (!data) {
      return res.status(404).json({
        success: false,
        error: "Propiedad no encontrada",
      });
    }

    res.status(200).json({
      success: true,
      message: "Propiedad obtenida.",
      data,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};
// ok
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

    let uploadResponse = null;
    let imagenesGaleria = [];
    let imagenesPlanos = [];

    // ========================================
    // VALIDACIONES BÁSICAS (antes de intentar Rust o el fallback)
    // ========================================
    let oldPortadaRows = [];
    if (file && file.size > 0) {
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

      const propiedadExiste = await pool.query(
        "SELECT id FROM propiedades WHERE id = $1",
        [id],
      );

      if (propiedadExiste.rows.length === 0) {
        return res
          .status(404)
          .json({ success: false, error: "Propiedad no encontrada." });
      }

      const { rows } = await pool.query(
        "SELECT id, public_id FROM propiedades_galeria WHERE propiedad_id = $1 AND es_portada = true",
        [id],
      );
      oldPortadaRows = rows;
    }

    let usarRustMedia =
      !!RUST_MEDIA_URL &&
      ((file && file.size > 0) || files.length > 0 || planosFiles.length > 0);

    // ========================================
    // RUTA RÁPIDA: Delegar procesamiento de imágenes a Rust
    // ========================================
    if (usarRustMedia) {
      try {
        const FormData = (await import("form-data")).default;
        const axios = (await import("axios")).default;
        const formData = new FormData();

        if (file && file.size > 0) {
          formData.append("imagenPrincipal", file.buffer, {
            filename: file.originalname,
            contentType: file.mimetype,
          });
        }

        files.forEach((f) => {
          formData.append("galeria", f.buffer, {
            filename: f.originalname,
            contentType: f.mimetype,
          });
        });

        planosFiles.forEach((f) => {
          formData.append("planos", f.buffer, {
            filename: f.originalname,
            contentType: f.mimetype,
          });
        });

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
          let idx = 0;

          // El orden de las imágenes en la respuesta sigue el mismo orden
          // en que se agregaron al FormData: principal -> galería -> planos
          if (file && file.size > 0) {
            const portadaRows = buildVersionRows([images[idx++]], -1).map(
              (r) => ({ ...r, es_portada: true }),
            );
            imagenesGaleria.push(...portadaRows);
          }

          if (files.length > 0) {
            const { rows } = await pool.query(
              `SELECT COALESCE(MAX(orden), -1) + 1 AS siguiente_orden
               FROM propiedades_galeria
               WHERE propiedad_id = $1 AND es_portada = false`,
              [id],
            );
            const siguienteOrdenGaleria = rows[0].siguiente_orden;
            const nuevasGaleriaImgs = images.slice(idx, idx + files.length);
            idx += files.length;
            const galeriaRows = buildVersionRows(
              nuevasGaleriaImgs,
              siguienteOrdenGaleria,
            ).map((r) => ({ ...r, es_portada: false }));
            imagenesGaleria.push(...galeriaRows);
          }

          if (planosFiles.length > 0) {
            const { rows } = await pool.query(
              `SELECT COALESCE(MAX(orden), -1) + 1 AS siguiente_orden
               FROM propiedades_planos
               WHERE propiedad_id = $1`,
              [id],
            );
            const siguienteOrdenPlanos = rows[0].siguiente_orden;
            const nuevosPlanosImgs = images.slice(
              idx,
              idx + planosFiles.length,
            );
            imagenesPlanos.push(
              ...buildVersionRows(nuevosPlanosImgs, siguienteOrdenPlanos),
            );
          }

          console.log("Imagenes procesadas via Rust media service (update)");
        } else {
          throw new Error("Respuesta invalida del servicio Rust de media");
        }
      } catch (rustError) {
        console.warn(
          "Rust media no disponible en update, usando subida directa:",
          rustError.message,
        );
        usarRustMedia = false; // caer al fallback
        uploadResponse = null;
        imagenesGaleria = [];
        imagenesPlanos = [];
      }
    }

    // ========================================
    // FALLBACK: Subida directa a S3 desde Express
    // ========================================
    if (!usarRustMedia) {
      const carpeta = AWS_BUCKET_SUBFOLDER || "inmobitwo";

      // PROCESAR IMAGEN PRINCIPAL (fallback: 1 sola versión, tamaño 'medium')
      if (file && file.size > 0) {
        const fileNamePrincipal = `${carpeta}/propiedades/imagenes_principal/propiedad_${(
          titulo || "imagen"
        )
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
      }

      // PROCESAR GALERÍA NUEVAS
      if (files.length > 0) {
        const { rows } = await pool.query(
          `SELECT COALESCE(MAX(orden), -1) + 1 AS siguiente_orden
           FROM propiedades_galeria
           WHERE propiedad_id = $1 AND es_portada = false`,
          [id],
        );
        let siguienteOrden = rows[0].siguiente_orden;

        for (let i = 0; i < files.length; i++) {
          const imageFile = files[i];

          if (!imageFile.mimetype.startsWith("image/")) continue;
          if (imageFile.size > 10 * 1024 * 1024) continue;

          const fileName = `${carpeta}/propiedades/galeria/propiedad_${(
            titulo || "imagen"
          )
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
            orden: siguienteOrden++,
            tamaño: "medium",
            es_portada: false,
          });
        }
      }

      // PROCESAR PLANOS NUEVOS
      if (planosFiles.length > 0) {
        const { rows } = await pool.query(
          `SELECT COALESCE(MAX(orden), -1) + 1 AS siguiente_orden
           FROM propiedades_planos
           WHERE propiedad_id = $1`,
          [id],
        );
        let siguienteOrdenPlanos = rows[0].siguiente_orden;

        for (let i = 0; i < planosFiles.length; i++) {
          const imageFile = planosFiles[i];

          if (!imageFile.mimetype.startsWith("image/")) continue;
          if (imageFile.size > 10 * 1024 * 1024) continue;

          const fileName = `${carpeta}/propiedades/planos/propiedad_${(
            titulo || "imagen"
          )
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
            orden: siguienteOrdenPlanos++,
            tamaño: "medium",
          });
        }
      }
    }

    // ========================================
    // ELIMINAR FOTOS DE GALERÍA MARCADAS
    // ========================================
    // IMPORTANTE: imagesToDelete ahora contiene valores de `orden` (identifica
    // la FOTO), no ids de fila individual — cada foto ocupa hasta 5 filas
    // (una por tamaño). Se borran las 5 filas + sus 5 objetos en S3.
    // Se excluye es_portada=true a propósito: la portada solo se reemplaza
    // subiendo una nueva imagen principal, no se borra por esta vía.
    if (imagesToDelete.length > 0) {
      for (const orden of imagesToDelete) {
        const { rows: filas } = await pool.query(
          `SELECT id, public_id FROM propiedades_galeria
           WHERE propiedad_id = $1 AND orden = $2 AND es_portada = false`,
          [id, orden],
        );
        for (const fila of filas) {
          try {
            await deleteFromS3(fila.public_id);
          } catch (err) {
            console.warn(`⚠️ No se pudo eliminar de S3: ${err.message}`);
          }
        }
        await pool.query(
          `DELETE FROM propiedades_galeria
           WHERE propiedad_id = $1 AND orden = $2 AND es_portada = false`,
          [id, orden],
        );
      }
    }

    // ========================================
    // ELIMINAR PLANOS MARCADOS
    // ========================================
    // Mismo cambio: planosToDelete contiene valores de `orden`.
    if (planosToDelete.length > 0) {
      for (const orden of planosToDelete) {
        const { rows: filas } = await pool.query(
          `SELECT id, public_id FROM propiedades_planos
           WHERE propiedad_id = $1 AND orden = $2`,
          [id, orden],
        );
        for (const fila of filas) {
          try {
            await deleteFromS3(fila.public_id);
          } catch (err) {
            console.warn(`⚠️ No se pudo eliminar plano de S3: ${err.message}`);
          }
        }
        await pool.query(
          `DELETE FROM propiedades_planos WHERE propiedad_id = $1 AND orden = $2`,
          [id, orden],
        );
      }
    }

    // ========================================
    // ACTUALIZAR CAMPOS
    // ========================================
    const updates = [];
    const values = [];
    let paramCount = 1;

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
      "operation_type_id",
      "property_type_id",
      "condition_type_id",
      "heating_type_id",
      "rental_type_id",
      "country_id",
      "state_id",
      "city_id",
      "barrio_id",
      "barrio_nombre",
      "direccion",
      "numero_direccion",
      "floor",
      "interior_apartment_number",
      "postal_code",
      "latitude",
      "longitude",
      "estrato",
      "cedula_catastral",
      "matricula_inmobiliaria",
      "description",
      "administracion",
      "constructed_area",
      "private_area",
      "plot_area",
      "room_count",
      "bedroom_count",
      "bathroom_count",
      "social_bathroom_count",
      "construction_year",
      "antiguedad_anios",
      "is_new_construction",
      "parqueadero_tipo",
      "parqueadero_modo",
      "parking_space_count",
      "parking_space_included",
      "parking_space_price",
      "tiene_agua",
      "tiene_luz",
      "tiene_gas",
      "tiene_alcantarillado",
      "has_elevator",
      "has_swimming_pool",
      "has_gym",
      "has_security_24h",
      "has_air_conditioning",
      "is_furnished",
      "zona",
      "how_to_contact",
      "telefono_contacto",
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
      planosToDelete.length === 0
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

    // ========================================
    // SI HAY PORTADA NUEVA: borrar la portada anterior (todas sus filas/
    // tamaños) antes de insertar la nueva, para no violar el índice único
    // (propiedad_id, tamaño) WHERE es_portada = true.
    // ========================================
    const hayPortadaNueva = imagenesGaleria.some((img) => img.es_portada);
    if (hayPortadaNueva && oldPortadaRows.length > 0) {
      for (const fila of oldPortadaRows) {
        try {
          await deleteFromS3(fila.public_id);
        } catch (err) {
          console.warn(
            "⚠️ No se pudo eliminar imagen principal antigua de S3:",
            err.message,
          );
        }
      }
      await pool.query(
        "DELETE FROM propiedades_galeria WHERE propiedad_id = $1 AND es_portada = true",
        [id],
      );
    }

    // ========================================
    // AGREGAR NUEVAS IMÁGENES A GALERÍA
    // ========================================
    if (imagenesGaleria.length > 0) {
      await Promise.all(
        imagenesGaleria.map((imagen) =>
          pool.query(
            `INSERT INTO propiedades_galeria (propiedad_id, orden, tamaño, es_portada, url, public_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)`,
            [
              id,
              imagen.orden,
              imagen.tamaño,
              imagen.es_portada,
              imagen.url,
              imagen.public_id,
            ],
          ),
        ),
      );
    }

    // ========================================
    // AGREGAR NUEVOS PLANOS
    // ========================================
    if (imagenesPlanos.length > 0) {
      await Promise.all(
        imagenesPlanos.map((imagen) =>
          pool.query(
            `INSERT INTO propiedades_planos (propiedad_id, orden, tamaño, url, public_id, created_at)
           VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)`,
            [id, imagen.orden, imagen.tamaño, imagen.url, imagen.public_id],
          ),
        ),
      );
    }

    // ========================================
    // RETORNAR PROPIEDAD ACTUALIZADA
    // ========================================
    const propiedadActualizada = await pool.query(
      `SELECT p.*, ${portadaSubquery("p")}, ${portadaPublicIdSubquery("p")}
       FROM propiedades p WHERE p.id = $1`,
      [id],
    );
    const galeriaActualizada = await pool.query(
      `SELECT id, url, public_id, orden, tamaño, es_portada FROM propiedades_galeria
       WHERE propiedad_id = $1 ORDER BY orden ASC, tamaño ASC`,
      [id],
    );
    const planosActualizados = await pool.query(
      `SELECT id, url, public_id, orden, tamaño FROM propiedades_planos
       WHERE propiedad_id = $1 ORDER BY orden ASC, tamaño ASC`,
      [id],
    );
    await cacheInvalidate("propiedades:*");
    return res.status(200).json({
      success: true,
      message: "Propiedad actualizada.",
      data: {
        ...propiedadActualizada.rows[0],
        galeria: galeriaActualizada.rows,
        planos: planosActualizados.rows,
      },
    });
  } catch (error) {
    console.error("❌ Error en PATCH /propiedades/:id:", error);
    res.status(500).json({
      success: false,
      error: "Error interno del servidor.",
      details: error.message,
    });
  }
};

// ok
export const deletePropiedades = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        error: "ID de propiedad requerido",
      });
    }

    const propiedadResult = await pool.query(
      "SELECT id, publicado_por_id FROM propiedades WHERE id = $1",
      [id],
    );

    if (propiedadResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Propiedad no encontrada",
      });
    }

    const propiedad = propiedadResult.rows[0];

    if (propiedad.publicado_por_id !== req.usuario.id) {
      return res.status(403).json({
        success: false,
        error: "No autorizado para eliminar esta propiedad",
      });
    }

    const galeriaResult = await pool.query(
      "SELECT id, public_id FROM propiedades_galeria WHERE propiedad_id = $1",
      [id],
    );

    const galeriaImgs = galeriaResult.rows;

    let imagenesEliminadasS3 = 0;
    for (const img of galeriaImgs) {
      try {
        await deleteFromS3(img.public_id);
        imagenesEliminadasS3++;
      } catch (err) {
        console.warn(
          `⚠️ No se pudo eliminar imagen de galería de S3: ${err.message}`,
        );
      }
    }

    const planosResult = await pool.query(
      "SELECT id, public_id FROM propiedades_planos WHERE propiedad_id = $1",
      [id],
    );
    const planosImgs = planosResult.rows;

    let planosEliminadosS3 = 0;
    for (const img of planosImgs) {
      try {
        await deleteFromS3(img.public_id);
        planosEliminadosS3++;
      } catch (err) {
        console.warn(`⚠️ No se pudo eliminar plano de S3: ${err.message}`);
      }
    }

    const galeriaDeleteResult = await pool.query(
      "DELETE FROM propiedades_galeria WHERE propiedad_id = $1",
      [id],
    );

    const planosDeleteResult = await pool.query(
      "DELETE FROM propiedades_planos WHERE propiedad_id = $1",
      [id],
    );

    const propiedadDeleteResult = await pool.query(
      "DELETE FROM propiedades WHERE id = $1",
      [id],
    );

    if (propiedadDeleteResult.rowCount === 0) {
      return res.status(500).json({
        success: false,
        error: "No se pudo eliminar la propiedad",
      });
    }
    await cacheInvalidate("propiedades:*");
    res.status(200).json({
      success: true,
      message: "Propiedad eliminada",
      data: {
        propiedadId: id,
        imagenesGaleriaEliminadas: imagenesEliminadasS3,
        totalImagenesGaleria: galeriaImgs.length,
        planosEliminados: planosEliminadosS3,
        totalPlanos: planosImgs.length,
      },
    });
  } catch (error) {
    console.error("❌ Error en DELETE /propiedades/:id:", error);
    res.status(500).json({
      success: false,
      error: "Error al eliminar la propiedad",
      details: error.message,
    });
  }
};

// Crear propiedades desde publicar anuncios
// ok
export const publicarAnuncios = async (req, res) => {
  try {
    const raw = req.body;

    const campos = parseCamposPropiedad(raw);
    const {
      operation_type_id,
      property_type_id,
      condition_type_id,
      heating_type_id,
      rental_type_id,
      country_id,
      state_id,
      city_id,
      barrio_id,
      barrio_nombre,
      direccion,
      numero_direccion,
      latitude,
      longitude,
      estrato,
      precio,
      administracion,
      constructed_area,
      private_area,
      plot_area,
      room_count,
      bedroom_count,
      bathroom_count,
      social_bathroom_count,
      construction_year,
      antiguedad_anios,
      is_new_construction,
      parqueadero_tipo,
      parqueadero_modo,
      parking_space_count,
      parking_space_included,
      parking_space_price,
      tiene_agua,
      tiene_luz,
      tiene_gas,
      tiene_alcantarillado,
      has_elevator,
      has_swimming_pool,
      has_gym,
      has_security_24h,
      has_air_conditioning,
      is_furnished,
      zona,
      how_to_contact,
      telefono_contacto,
    } = campos;

    const es_de_organizacion =
      raw.es_de_organizacion === "true" || raw.es_de_organizacion === true;

    let organizacion_id = raw.organizacion_id;
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
    const data = {
      operation_type_id,
      property_type_id,
      direccion,
      country_id,
      city_id,
      state_id,
      estrato,
      precio,
      publicado_por_id: req.usuario.id,
    };
    const errores = publicar_anuncio_validate(data);
    if (errores.length > 0) {
      return res.status(400).json({
        success: false,
        error: errores[0],
      });
    }

    // ========================================
    // OBTENER NOMBRES PARA EL TÍTULO
    // ========================================
    const city = await getCityById(city_id);
    const state = await getStateById(state_id);

    if (!city || !state) {
      return res.status(400).json({
        success: false,
        error: "Ciudad o estado no encontrado.",
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

    // ========================================
    // INSERTAR EN BD
    // ========================================
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
        estado, listing_status, published_at,
        es_de_organizacion, organizacion_id, publicado_por_id, rental_type_id,
        how_to_contact, telefono_contacto,
        barrio_nombre,
        created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4,
        $5, $6, $7, $8,
        $9, $10, $11, $12, $13,
        $14, $15,
        $16, $17, $18,
        $19, $20, $21, $22, $23,
        $24, $25, $26,
        $27, $28, $29, $30,
        $31, $32, $33,
        $34, $35, $36,
        $37, $38,
        $39, $40, $41, $42,
        $43, $44, $45, $46,
        $47, $48, $49,
        $50, $51, CURRENT_TIMESTAMP,
        $52, $53, $54, $55,
        $56, $57,
        $58,
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
      RETURNING *;
    `;
    const values = [
      operation_type_id,
      property_type_id,
      condition_type_id,
      heating_type_id,
      country_id,
      state_id,
      city_id,
      barrio_id,
      direccion,
      numero_direccion,
      campos.floor,
      campos.interior_apartment_number,
      campos.postal_code,
      latitude,
      longitude,
      estrato,
      campos.cedula_catastral,
      campos.matricula_inmobiliaria,
      tituloFinal,
      campos.description,
      precio,
      price_per_sqm,
      administracion,
      constructed_area,
      private_area,
      plot_area,
      room_count,
      bedroom_count,
      bathroom_count,
      social_bathroom_count,
      construction_year,
      antiguedad_anios,
      is_new_construction,
      parqueadero_tipo,
      parqueadero_modo,
      parking_space_count,
      parking_space_included,
      parking_space_price,
      tiene_agua,
      tiene_luz,
      tiene_gas,
      tiene_alcantarillado,
      has_elevator,
      has_swimming_pool,
      has_gym,
      has_security_24h,
      has_air_conditioning,
      is_furnished,
      zona,
      estadoFinal,
      listingStatusFinal,
      es_de_organizacion || false,
      organizacion_id,
      req.usuario.id,
      rental_type_id,
      how_to_contact,
      telefono_contacto,
      barrio_nombre,
    ];

    const result = await pool.query(query, values);
    const nuevaPropiedad = result.rows[0];

    // Historial de precios inicial (si hay precio)
    if (precio !== null) {
      await pool.query(
        `INSERT INTO price_history (propiedad_id, old_price, new_price, change_type, source)
         VALUES ($1, NULL, $2, 'initial', 'user_update')`,
        [nuevaPropiedad.id, precio],
      );
    }

    await cacheInvalidate("propiedades:*");
    return res.status(201).json({
      success: true,
      message: "Propiedad creada.",
      data: nuevaPropiedad,
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

/// Rutas especificas para frontend inmobitwo red social

// Raiz ---> https://inmobitwo.com

export const getPropiedadesHome = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const cursor = req.query.cursor || null; // created_at de la última propiedad que ya vio el front

    // Armamos la query dinámicamente según si hay cursor o no
    const params = [limit];
    let whereClause = "";

    if (cursor) {
      whereClause = "WHERE p.created_at < $2";
      params.push(cursor);
    }

    const { rows: propiedades } = await pool.query(
      `SELECT p.*, ${portadaSubquery("p")}, ${portadaPublicIdSubquery("p")},
              ${camposCatalogoSelect("p")}
       FROM propiedades p
       ${joinsCatalogo("p")}
       ${whereClause}
       ORDER BY p.created_at DESC 
       LIMIT $1`,
      params,
    );

    const propiedadesConDatos = await Promise.all(
      propiedades.map(async (propiedad) => {
        const { rows: galeria } = await pool.query(
          `SELECT id, url, public_id, orden, tamaño, es_portada
           FROM propiedades_galeria 
           WHERE propiedad_id = $1 
           ORDER BY orden ASC, tamaño ASC`,
          [propiedad.id],
        );

        const { rows: planos } = await pool.query(
          `SELECT id, url, public_id, orden, tamaño
           FROM propiedades_planos 
           WHERE propiedad_id = $1 
           ORDER BY orden ASC, tamaño ASC`,
          [propiedad.id],
        );

        let publicador = null;
        if (propiedad.es_de_organizacion) {
          const { rows } = await pool.query(
            `SELECT id, nombre, logo_url, telefono, ciudad, provincia
             FROM organizaciones WHERE id = $1`,
            [propiedad.organizacion_id],
          );
          publicador = rows[0] ? { tipo: "organizacion", ...rows[0] } : null;
        } else {
          const { rows } = await pool.query(
            `SELECT id, name, image_url, telefono
             FROM usuarios WHERE id = $1`,
            [propiedad.publicado_por_id],
          );
          publicador = rows[0] ? { tipo: "usuario", ...rows[0] } : null;
        }

        return {
          ...propiedad,
          galeria: galeria || [],
          planos: planos || [],
          publicador,
          tiempo_relativo: tiempoRelativo(propiedad.created_at),
        };
      }),
    );

    // El cursor para la próxima llamada es el created_at del último item de esta tanda
    const ultimaPropiedad = propiedades[propiedades.length - 1];
    const nextCursor = ultimaPropiedad ? ultimaPropiedad.created_at : null;

    res.status(200).json({
      success: true,
      message: "propiedades obtenidas.",

      data: {
        data: propiedadesConDatos,
        pagination: {
          nextCursor,
          hasMore: propiedades.length === limit, // si trajo menos de "limit", ya no hay más
        },
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

export const getPropiedadesMisAnuncios = async (req, res) => {
  try {
    const id = req.usuario.id;

    const { rows: propiedades } = await pool.query(
      `SELECT p.*, ${portadaSubquery("p")}, ${portadaPublicIdSubquery("p")},
              ${camposCatalogoSelect("p")}
       FROM propiedades p
       ${joinsCatalogo("p")}
       WHERE p.publicado_por_id = $1
       ORDER BY p.created_at DESC`,
      [id],
    );

    const propiedadesConDatos = await Promise.all(
      propiedades.map(async (propiedad) => {
        // Galería (incluye portada: es_portada=true, orden=-1)
        const { rows: galeria } = await pool.query(
          `SELECT id, url, public_id, orden, tamaño, es_portada
           FROM propiedades_galeria
           WHERE propiedad_id = $1
           ORDER BY orden ASC, tamaño ASC`,
          [propiedad.id],
        );

        // Planos
        const { rows: planos } = await pool.query(
          `SELECT id, url, public_id, orden, tamaño
           FROM propiedades_planos
           WHERE propiedad_id = $1
           ORDER BY orden ASC, tamaño ASC`,
          [propiedad.id],
        );

        // Publicador
        let publicador = null;

        if (propiedad.es_de_organizacion) {
          const { rows } = await pool.query(
            `SELECT
              id,
              nombre,
              logo_url,
              telefono,
              ciudad,
              provincia
            FROM organizaciones
            WHERE id = $1`,
            [propiedad.organizacion_id],
          );

          publicador = rows[0] ? { tipo: "organizacion", ...rows[0] } : null;
        } else {
          const { rows } = await pool.query(
            `SELECT
              id,
              name,
              image_url,
              telefono
            FROM usuarios
            WHERE id = $1`,
            [propiedad.publicado_por_id],
          );

          publicador = rows[0] ? { tipo: "usuario", ...rows[0] } : null;
        }

        return {
          ...propiedad,
          galeria: galeria || [],
          planos: planos || [],
          publicador,
          tiempo_relativo: tiempoRelativo(propiedad.created_at),
        };
      }),
    );

    res.status(200).json({
      success: true,
      message: "propiedades obtenidas.",
      data: propiedadesConDatos,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

// ============================================================================
// COUNT — Contador ligero de mis anuncios (para el modal de usuario)
// GET /propiedades/mis-anuncios/count
// Solo hace COUNT(*) en propiedades, sin joins de catálogo/galería/planos.
// ============================================================================
export const countPropiedadesMisAnuncios = async (req, res) => {
  try {
    const id = req.usuario.id;

    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS total
       FROM propiedades
       WHERE publicado_por_id = $1`,
      [id],
    );

    res.status(200).json({
      success: true,
      message: "count obtenido.",
      data: rows[0]?.total ?? 0,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

// ============================================================================
// NUEVO — Vista de organización (tenant)
// Raiz ---> https://www.inmobiliariaoviedo.com  o  inmobitwo.com/inmobiliarias/:slug
// ============================================================================
// GET /propiedades/organizacion/:slug?limit=10&cursor=...
// Trae solo los inmuebles publicados bajo el sello de esa organización.
// Usa la misma paginación por cursor que getPropiedadesHome para que el
// frontend pueda reutilizar el mismo componente de scroll infinito.
// ============================================================================
export const getPropiedadesByOrganizacion = async (req, res) => {
  try {
    const { slug } = req.params;
    const limit = parseInt(req.query.limit) || 10;
    const cursor = req.query.cursor || null;

    // 1. Resolver la organización por slug (solo si está aprobada)
    const { rows: orgRows } = await pool.query(
      `SELECT id, nombre, logo_url, telefono, ciudad, provincia, slug, custom_domain
       FROM organizaciones 
       WHERE slug = $1 AND estado = 'aprobada'`,
      [slug],
    );
    const organizacion = orgRows[0];

    if (!organizacion) {
      return res.status(404).json({
        success: false,
        error: "Organización no encontrada.",
      });
    }

    // 2. Traer sus propiedades con paginación por cursor
    const params = [organizacion.id, limit];
    let whereClause =
      "WHERE p.organizacion_id = $1 AND p.es_de_organizacion = true";

    if (cursor) {
      whereClause += " AND p.created_at < $3";
      params.push(cursor);
    }

    const { rows: propiedades } = await pool.query(
      `SELECT p.*, ${portadaSubquery("p")}, ${portadaPublicIdSubquery("p")},
              ${camposCatalogoSelect("p")}
       FROM propiedades p
       ${joinsCatalogo("p")}
       ${whereClause}
       ORDER BY p.created_at DESC 
       LIMIT $2`,
      params,
    );

    const propiedadesConDatos = await Promise.all(
      propiedades.map(async (propiedad) => {
        const { rows: galeria } = await pool.query(
          `SELECT id, url, public_id, orden, tamaño, es_portada
           FROM propiedades_galeria 
           WHERE propiedad_id = $1 
           ORDER BY orden ASC, tamaño ASC`,
          [propiedad.id],
        );

        const { rows: planos } = await pool.query(
          `SELECT id, url, public_id, orden, tamaño
           FROM propiedades_planos 
           WHERE propiedad_id = $1 
           ORDER BY orden ASC, tamaño ASC`,
          [propiedad.id],
        );

        return {
          ...propiedad,
          galeria: galeria || [],
          planos: planos || [],
          publicador: { tipo: "organizacion", ...organizacion },
          tiempo_relativo: tiempoRelativo(propiedad.created_at),
        };
      }),
    );

    const ultimaPropiedad = propiedades[propiedades.length - 1];
    const nextCursor = ultimaPropiedad ? ultimaPropiedad.created_at : null;

    res.status(200).json({
      success: true,
      message: "Propiedades de la organización obtenidas.",
      data: {
        organizacion,
        data: propiedadesConDatos,
        pagination: {
          nextCursor,
          hasMore: propiedades.length === limit,
        },
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

export const getPropertiesBySlugs = async (req, res) => {
  const { type, city, dept } = req.query;
  let { operation } = req.query;

  if (!operation || !type || !dept) {
    return res.status(400).json({
      success: false,
      message: "Faltan parámetros requeridos de geolocalización o negocio.",
      data: null,
      error: null,
    });
  }

  try {
    const params = [operation.toLowerCase()];

    const { sql: tipoFilterSql, params: tipoFilterParams } = buildTipoFilter(
      type,
      { alias: "p", startIdx: params.length + 1 },
    );
    tipoFilterParams.forEach((t) => params.push(t));
    const typeCondition = tipoFilterSql ? `AND ${tipoFilterSql}` : "";

    // Filtro por rango de precio (min/max, en millones COP → ×1.000.000). Saneado.
    const minPrecio = parseFloat(req.query.min) * 1000000;
    const maxPrecio = parseFloat(req.query.max) * 1000000;
    const precioCondiciones = [
      !isNaN(minPrecio) ? `p.precio >= ${minPrecio}` : null,
      !isNaN(maxPrecio) ? `p.precio <= ${maxPrecio}` : null,
    ].filter(Boolean);
    const precioWhere = precioCondiciones.length
      ? `AND ${precioCondiciones.join(" AND ")}`
      : "";

    // Filtro por tamaño (área privada, con fallback a construida). Saneado a enteros.
    const minTam = parseInt(req.query.tamMin, 10);
    const maxTam = parseInt(req.query.tamMax, 10);
    const tamCondiciones = [
      !isNaN(minTam)
        ? `COALESCE(p.private_area, p.constructed_area) >= ${minTam}`
        : null,
      !isNaN(maxTam)
        ? `COALESCE(p.private_area, p.constructed_area) <= ${maxTam}`
        : null,
    ].filter(Boolean);
    const tamWhere = tamCondiciones.length
      ? `AND ${tamCondiciones.join(" AND ")}`
      : "";

    // Filtro por tipo de alquiler (rental_type_id). Saneado a enteros.
    const rentalList = (req.query.rental ?? "")
      .split(",")
      .map(Number)
      .filter(Boolean);
    const rentalWhere = rentalList.length
      ? `AND p.rental_type_id IN (${rentalList.join(",")})`
      : "";

    // Filtro por fecha de publicación (created_at). Saneado a valores fijos.
    const fechaIntervals = {
      "24h": "24 HOURS",
      semana: "7 DAYS",
      mes: "30 DAYS",
    };
    const fechaWhere = fechaIntervals[req.query.fecha]
      ? `AND p.created_at >= NOW() - INTERVAL '${fechaIntervals[req.query.fecha]}'`
      : "";

    // Filtro por tipo de anunciante (es_de_organizacion). Saneado a valores fijos.
    const anunciantesValidos = new Set(["persona", "inmobiliaria"]);
    const anuncianteList = (req.query.anunciante ?? "")
      .split(",")
      .map((a) => a.trim().toLowerCase())
      .filter((a) => anunciantesValidos.has(a));
    const anuncianteConds = [];
    if (anuncianteList.includes("inmobiliaria"))
      anuncianteConds.push("p.es_de_organizacion = true");
    if (anuncianteList.includes("persona"))
      anuncianteConds.push("p.es_de_organizacion = false");
    const anuncianteWhere = anuncianteConds.length
      ? `AND (${anuncianteConds.join(" OR ")})`
      : "";

    // Filtro por multimedia. Solo "plano" implementado (video_3d/video pendientes).
    const multimediaValidos = new Set(["plano", "video_3d", "video"]);
    const multimediaList = (req.query.multimedia ?? "")
      .split(",")
      .map((m) => m.trim().toLowerCase())
      .filter((m) => multimediaValidos.has(m));
    const multimediaConds = [];
    if (multimediaList.includes("plano"))
      multimediaConds.push(
        "EXISTS (SELECT 1 FROM propiedades_planos pp WHERE pp.propiedad_id = p.id)",
      );
    // TODO: implementar filtros de video_3d y video cuando exista el campo en la DB.
    const multimediaWhere = multimediaConds.length
      ? `AND ${multimediaConds.join(" AND ")}`
      : "";

    // Filtro por alcobas (bedroom_count). Saneado a enteros.
    const habList = (req.query.hab ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s !== "")
      .map(Number)
      .filter((n) => Number.isInteger(n) && n >= 0);
    const habConds = [];
    if (habList.includes(4)) habConds.push("p.bedroom_count >= 4");
    habList.filter((n) => n < 4).forEach((n) =>
      habConds.push(`p.bedroom_count = ${n}`),
    );
    const habWhere = habConds.length ? `AND (${habConds.join(" OR ")})` : "";

    // Filtro por baños (bathroom_count). Saneado a enteros.
    const banosList = (req.query.banos ?? "")
      .split(",")
      .map(Number)
      .filter((n) => Number.isInteger(n) && n >= 1);
    const banosConds = [];
    if (banosList.includes(3)) banosConds.push("p.bathroom_count >= 3");
    banosList.filter((n) => n < 3).forEach((n) =>
      banosConds.push(`p.bathroom_count = ${n}`),
    );
    const banosWhere = banosConds.length ? `AND (${banosConds.join(" OR ")})` : "";

    // Filtro por estado (agrupado → códigos de condition_types).
    const estadoGrupos = {
      obra_nueva: ["nuevo", "para_estrenar", "en_construccion", "obra_negra", "obra_gris"],
      usado: ["usado"],
      remodelado: ["remodelado"],
      para_remodelar: ["para_remodelar"],
    };
    const estadoList = (req.query.estado ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter((e) => estadoGrupos[e]);
    const estadoConds = [];
    if (estadoList.length)
      estadoConds.push(
        `p.condition_type_id IN (SELECT id FROM condition_types WHERE code IN (${estadoList
          .flatMap((e) => estadoGrupos[e])
          .map((c) => `'${c}'`)
          .join(", ")}))`,
      );
    const estadoWhere = estadoConds.length ? `AND (${estadoConds.join(" OR ")})` : "";

    // Filtro por características (flags rápidos de la tabla propiedades).
    const caractFlags = {
      ascensor: "has_elevator",
      piscina: "has_swimming_pool",
      gimnasio: "has_gym",
      seguridad_24h: "has_security_24h",
      aire_acondicionado: "has_air_conditioning",
      amoblado: "is_furnished",
      parqueadero: "parking_space_count",
    };
    const caractList = (req.query.caract ?? "")
      .split(",")
      .map((c) => c.trim().toLowerCase())
      .filter((c) => caractFlags[c]);
    const caractConds = [];
    caractList.forEach((c) => {
      const col = caractFlags[c];
      caractConds.push(
        col === "parking_space_count"
          ? `p.parking_space_count > 0`
          : `p.${col} = true`,
      );
    });
    const caractWhere = caractConds.length
      ? `AND (${caractConds.join(" AND ")})`
      : "";

    // Vacacional solo aplica a arriendo (por temporada).
    if (esTipoVacacional(type)) {
      params[0] = "arriendo";
    }

    const galeriaSubquery = `
      COALESCE(
        (SELECT json_agg(json_build_object(
          'id', pg.id,
          'url', pg.url,
          'orden', pg.orden,
          'tamaño', pg.tamaño,
          'es_portada', pg.es_portada
        ) ORDER BY pg.orden, pg.tamaño)
        FROM propiedades_galeria pg
        WHERE pg.propiedad_id = p.id),
        '[]'::json
      ) as galeria
    `;

    const planosSubquery = `
      COALESCE(
        (SELECT json_agg(json_build_object(
          'id', pp.id,
          'url', pp.url,
          'orden', pp.orden,
          'tamaño', pp.tamaño
        ) ORDER BY pp.orden, pp.tamaño)
        FROM propiedades_planos pp
        WHERE pp.propiedad_id = p.id),
        '[]'::json
      ) as planos
    `;

    const selectFields = `
      p.id, p.titulo, p.direccion, p.precio, p.price_per_sqm, p.estrato,
      p.private_area, p.constructed_area, p.bedroom_count, p.bathroom_count,
      p.created_at,
      ot.code as operacion_slug,
      pt.code as tipo_slug,
      ot.label_es as operacion,
      pt.label_es as tipo_inmueble,
      ct.label_es as estado_conservacion,
      ${portadaSubquery("p")},
      ${portadaPublicIdSubquery("p")},
      p.es_de_organizacion,
      ${galeriaSubquery},
      ${planosSubquery},
      c.name as city_name,
      s.name as state_name,
      o.nombre as organizacion_nombre,
      o.logo_url as organizacion_logo_url,
      p.longitude::float as longitude, 
      p.latitude::float as latitude
    `;

    const orgJoin = `LEFT JOIN organizaciones o ON p.organizacion_id = o.id`;
    const catalogosJoin = `
      INNER JOIN operation_types ot ON p.operation_type_id = ot.id
      INNER JOIN property_types pt ON p.property_type_id = pt.id
      LEFT JOIN condition_types ct ON p.condition_type_id = ct.id
    `;

    let query;
    if (city) {
      params.push(city.toLowerCase(), dept.toLowerCase());
      const cityIdx = params.length - 1;
      const deptIdx = params.length;

      query = `
        SELECT ${selectFields}
        FROM propiedades p
        ${catalogosJoin}
        INNER JOIN cities c ON p.city_id = c.id
        INNER JOIN states s ON c.state_id = s.id 
        ${orgJoin}
        WHERE LOWER(ot.code) = $1
          ${typeCondition}
          AND c.slug = $${cityIdx}
          AND s.slug = $${deptIdx}
          AND p.estado = 'publicado'
          ${precioWhere}
          ${tamWhere}
          ${rentalWhere}
          ${fechaWhere}
          ${anuncianteWhere}
          ${multimediaWhere}
          ${habWhere}
          ${banosWhere}
          ${estadoWhere}
          ${caractWhere}
        ORDER BY p.id DESC
        LIMIT 100;
      `;

      const { rows: cityRows } = await pool.query(query, params);

      if (cityRows.length > 0) {
        return res.json({
          success: true,
          message: null,
          data: cityRows,
          error: null,
        });
      }

      // Fallback: El "city" podria ser parte de un depto con guion (ej: "la" + "guajira")
      params.splice(-2);
      const fullSlug = `${city.toLowerCase()}-${dept.toLowerCase()}`;
      params.push(fullSlug);
      const fallbackIdx = params.length;

      query = `
        SELECT ${selectFields}
        FROM propiedades p
        ${catalogosJoin}
        INNER JOIN cities c ON p.city_id = c.id
        INNER JOIN states s ON c.state_id = s.id 
        ${orgJoin}
        WHERE LOWER(ot.code) = $1
          ${typeCondition}
          AND s.slug = $${fallbackIdx}
          AND p.estado = 'publicado'
          ${precioWhere}
          ${tamWhere}
          ${rentalWhere}
          ${fechaWhere}
          ${anuncianteWhere}
          ${multimediaWhere}
          ${habWhere}
          ${banosWhere}
          ${estadoWhere}
          ${caractWhere}
        ORDER BY p.id DESC
        LIMIT 100;
      `;
    } else if (dept) {
      params.push(dept.toLowerCase());
      const geoIdx = params.length;

      query = `
        SELECT ${selectFields}
        FROM propiedades p
        ${catalogosJoin}
        INNER JOIN cities c ON p.city_id = c.id
        INNER JOIN states s ON c.state_id = s.id 
        ${orgJoin}
        WHERE LOWER(ot.code) = $1
          ${typeCondition}
          AND s.slug = $${geoIdx}
          AND p.estado = 'publicado'
          ${precioWhere}
          ${tamWhere}
          ${rentalWhere}
          ${fechaWhere}
          ${anuncianteWhere}
          ${multimediaWhere}
          ${habWhere}
          ${banosWhere}
          ${estadoWhere}
          ${caractWhere}
        ORDER BY p.id DESC
        LIMIT 100;
      `;

      const { rows: deptRows } = await pool.query(query, params);

      if (deptRows.length > 0) {
        return res.json({
          success: true,
          message: null,
          data: deptRows,
          error: null,
        });
      }

      // No encontró como depto, intentar como región (mismo índice)
      query = `
        SELECT ${selectFields}
        FROM propiedades p
        ${catalogosJoin}
        INNER JOIN cities c ON p.city_id = c.id
        INNER JOIN states s ON c.state_id = s.id
        INNER JOIN regions r ON s.region_id = r.id
        ${orgJoin}
        WHERE LOWER(ot.code) = $1
          ${typeCondition}
          AND r.slug = $${geoIdx}
          AND p.estado = 'publicado'
          ${precioWhere}
          ${tamWhere}
          ${rentalWhere}
          ${fechaWhere}
          ${anuncianteWhere}
          ${multimediaWhere}
          ${habWhere}
          ${banosWhere}
          ${estadoWhere}
          ${caractWhere}
        ORDER BY p.id DESC
        LIMIT 100;
      `;
    }

    const { rows } = await pool.query(query, params);

    // Enviamos la respuesta estructurada respetando tu firma estándar del apiBackend
    return res.json({
      success: true,
      message:
        rows.length === 0 ? "No se encontraron inmuebles en esta zona" : null,
      data: rows,
      error: null,
    });
  } catch (error) {
    console.error("Error crítico en getPropertiesBySlugs:", error.message);

    return res.status(500).json({
      success: false,
      message: "Error interno al procesar la búsqueda geográfica",
      data: null,
      error: error.message,
    });
  }
};

// NUEVO: Búsqueda por múltiples tipos de vivienda (agrupados).
// Endpoint separado para no modificar getPropertiesBySlugs.
// GET /propiedades/search-vivienda?operation=&tipos=casa,casa_lote&city=&dept=&min=&max=&tamMin=&tamMax=
export const searchVivienda = async (req, res) => {
  const { operation, tipos, city, dept, min, max, tamMin, tamMax } = req.query;

  if (!operation || !tipos || !dept) {
    return res.status(400).json({
      success: false,
      message: "Faltan parámetros requeridos (operation, tipos, dept).",
      data: null,
      error: null,
    });
  }

  try {
    const tipoLista = tipos
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
    if (tipoLista.length === 0) {
      return res.status(400).json({
        success: false,
        message: "tipos inválido.",
        data: null,
        error: null,
      });
    }

    const minPrecio = parseFloat(min) * 1000000;
    const maxPrecio = parseFloat(max) * 1000000;
    const minTamNum = parseInt(tamMin, 10);
    const maxTamNum = parseInt(tamMax, 10);

    const params = [operation.toLowerCase(), tipoLista];
    const conds = [
      "LOWER(ot.code) = $1",
      "LOWER(pt.code) = ANY($2::text[])",
      "p.estado = 'publicado'",
    ];
    let idx = 3;

    if (city) {
      params.push(city.toLowerCase(), dept.toLowerCase());
      conds.push(`c.slug = $${idx++}`, `s.slug = $${idx++}`);
    } else {
      params.push(dept.toLowerCase());
      conds.push(`s.slug = $${idx++}`);
    }

    if (!isNaN(minPrecio)) {
      params.push(minPrecio);
      conds.push(`p.precio >= $${idx++}`);
    }
    if (!isNaN(maxPrecio)) {
      params.push(maxPrecio);
      conds.push(`p.precio <= $${idx++}`);
    }
    if (!isNaN(minTamNum)) {
      params.push(minTamNum);
      conds.push(`COALESCE(p.private_area, p.constructed_area) >= $${idx++}`);
    }
    if (!isNaN(maxTamNum)) {
      params.push(maxTamNum);
      conds.push(`COALESCE(p.private_area, p.constructed_area) <= $${idx++}`);
    }

    // Filtro por tipo de alquiler (rental_type_id)
    const rentalList = (req.query.rental ?? "")
      .split(",")
      .map(Number)
      .filter(Boolean);
    if (rentalList.length) {
      params.push(rentalList);
      conds.push(`p.rental_type_id = ANY($${idx++}::int[])`);
    }

    // Filtro por fecha de publicación (created_at). Saneado a valores fijos.
    const fechaIntervals = {
      "24h": "24 HOURS",
      semana: "7 DAYS",
      mes: "30 DAYS",
    };
    if (fechaIntervals[req.query.fecha]) {
      conds.push(
        `p.created_at >= NOW() - INTERVAL '${fechaIntervals[req.query.fecha]}'`,
      );
    }

    // Filtro por tipo de anunciante (es_de_organizacion). Saneado a valores fijos.
    const anunciantesValidos = new Set(["persona", "inmobiliaria"]);
    const anuncianteList = (req.query.anunciante ?? "")
      .split(",")
      .map((a) => a.trim().toLowerCase())
      .filter((a) => anunciantesValidos.has(a));
    const anuncianteConds = [];
    if (anuncianteList.includes("inmobiliaria"))
      anuncianteConds.push("p.es_de_organizacion = true");
    if (anuncianteList.includes("persona"))
      anuncianteConds.push("p.es_de_organizacion = false");
    if (anuncianteConds.length)
      conds.push(`(${anuncianteConds.join(" OR ")})`);

    // Filtro por multimedia. Solo "plano" implementado (video_3d/video pendientes).
    const multimediaValidos = new Set(["plano", "video_3d", "video"]);
    const multimediaList = (req.query.multimedia ?? "")
      .split(",")
      .map((m) => m.trim().toLowerCase())
      .filter((m) => multimediaValidos.has(m));
    if (multimediaList.includes("plano"))
      conds.push(
        "EXISTS (SELECT 1 FROM propiedades_planos pp WHERE pp.propiedad_id = p.id)",
      );
    // TODO: implementar filtros de video_3d y video cuando exista el campo en la DB.

    // Filtro por alcobas (bedroom_count). Saneado a enteros.
    const habList = (req.query.hab ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s !== "")
      .map(Number)
      .filter((n) => Number.isInteger(n) && n >= 0);
    const habConds = [];
    if (habList.includes(4)) habConds.push("p.bedroom_count >= 4");
    habList.filter((n) => n < 4).forEach((n) =>
      habConds.push(`p.bedroom_count = ${n}`),
    );
    if (habConds.length) conds.push(`(${habConds.join(" OR ")})`);

    // Filtro por baños (bathroom_count). Saneado a enteros.
    const banosList = (req.query.banos ?? "")
      .split(",")
      .map(Number)
      .filter((n) => Number.isInteger(n) && n >= 1);
    const banosConds = [];
    if (banosList.includes(3)) banosConds.push("p.bathroom_count >= 3");
    banosList.filter((n) => n < 3).forEach((n) =>
      banosConds.push(`p.bathroom_count = ${n}`),
    );
    if (banosConds.length) conds.push(`(${banosConds.join(" OR ")})`);

    // Filtro por estado (agrupado → códigos de condition_types).
    const estadoGrupos = {
      obra_nueva: ["nuevo", "para_estrenar", "en_construccion", "obra_negra", "obra_gris"],
      usado: ["usado"],
      remodelado: ["remodelado"],
      para_remodelar: ["para_remodelar"],
    };
    const estadoList = (req.query.estado ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter((e) => estadoGrupos[e]);
    if (estadoList.length)
      conds.push(
        `p.condition_type_id IN (SELECT id FROM condition_types WHERE code IN (${estadoList
          .flatMap((e) => estadoGrupos[e])
          .map((c) => `'${c}'`)
          .join(", ")}))`,
      );

    // Filtro por características (flags rápidos de la tabla propiedades).
    const caractFlags = {
      ascensor: "has_elevator",
      piscina: "has_swimming_pool",
      gimnasio: "has_gym",
      seguridad_24h: "has_security_24h",
      aire_acondicionado: "has_air_conditioning",
      amoblado: "is_furnished",
      parqueadero: "parking_space_count",
    };
    const caractList = (req.query.caract ?? "")
      .split(",")
      .map((c) => c.trim().toLowerCase())
      .filter((c) => caractFlags[c]);
    const caractConds = [];
    caractList.forEach((c) => {
      const col = caractFlags[c];
      caractConds.push(
        col === "parking_space_count"
          ? `p.parking_space_count > 0`
          : `p.${col} = true`,
      );
    });
    if (caractConds.length) conds.push(`(${caractConds.join(" AND ")})`);

    const galeriaSubquery = `
      COALESCE(
        (SELECT json_agg(json_build_object(
          'id', pg.id, 'url', pg.url, 'orden', pg.orden, 'tamaño', pg.tamaño, 'es_portada', pg.es_portada
        ) ORDER BY pg.orden, pg.tamaño)
        FROM propiedades_galeria pg WHERE pg.propiedad_id = p.id),
        '[]'::json
      ) as galeria
    `;
    const planosSubquery = `
      COALESCE(
        (SELECT json_agg(json_build_object(
          'id', pp.id, 'url', pp.url, 'orden', pp.orden, 'tamaño', pp.tamaño
        ) ORDER BY pp.orden, pp.tamaño)
        FROM propiedades_planos pp WHERE pp.propiedad_id = p.id),
        '[]'::json
      ) as planos
    `;

    const selectFields = `
      p.id, p.titulo, p.direccion, p.precio, p.price_per_sqm, p.estrato,
      p.private_area, p.constructed_area, p.bedroom_count, p.bathroom_count,
      p.created_at,
      ot.code as operacion_slug,
      pt.code as tipo_slug,
      ot.label_es as operacion,
      pt.label_es as tipo_inmueble,
      ct.label_es as estado_conservacion,
      ${portadaSubquery("p")},
      ${portadaPublicIdSubquery("p")},
      p.es_de_organizacion,
      ${galeriaSubquery},
      ${planosSubquery},
      c.name as city_name,
      s.name as state_name,
      o.nombre as organizacion_nombre,
      o.logo_url as organizacion_logo_url,
      p.longitude::float as longitude,
      p.latitude::float as latitude
    `;

    const query = `
      SELECT ${selectFields}
      FROM propiedades p
      INNER JOIN operation_types ot ON p.operation_type_id = ot.id
      INNER JOIN property_types pt ON p.property_type_id = pt.id
      LEFT JOIN condition_types ct ON p.condition_type_id = ct.id
      LEFT JOIN cities c ON p.city_id = c.id
      LEFT JOIN states s ON c.state_id = s.id
      LEFT JOIN organizaciones o ON p.organizacion_id = o.id
      WHERE ${conds.join(" AND ")}
      ORDER BY p.id DESC
      LIMIT 100;
    `;

    const { rows } = await pool.query(query, params);

    return res.json({
      success: true,
      message:
        rows.length === 0 ? "No se encontraron inmuebles en esta zona" : null,
      data: rows,
      error: null,
    });
  } catch (error) {
    console.error("Error en searchVivienda:", error.message);
    return res.status(500).json({
      success: false,
      message: "Error interno al buscar por tipo de vivienda",
      data: null,
      error: error.message,
    });
  }
};

// NUEVO v3.6: Inmuebles dentro de un bounding box (para MapaInmuebles)
export const getInmueblesEnBbox = async (req, res) => {
  const { minLat, minLng, maxLat, maxLng, tipoInmueble } = req.query;
  let { operation } = req.query;

  if (!minLat || !minLng || !maxLat || !maxLng) {
    return res.status(400).json({
      success: false,
      message: "minLat, minLng, maxLat, maxLng son requeridos",
      data: null,
      error: null,
    });
  }

  try {
    const params = [];
    const filters = ["p.estado = 'publicado'", "p.geom IS NOT NULL"];

    if (esTipoVacacional(tipoInmueble)) {
      operation = "arriendo";
    }

    if (operation) {
      params.push(operation.toLowerCase());
      filters.push(`LOWER(ot.code) = LOWER($${params.length})`);
    }

    if (tipoInmueble) {
      const { sql, params: tipoParams } = buildTipoFilter(tipoInmueble, {
        alias: "p",
        startIdx: params.length + 1,
      });
      tipoParams.forEach((t) => params.push(t));
      if (sql) filters.push(sql);
    }

    params.push(minLng, minLat, maxLng, maxLat);
    const bboxParamIdx = params.length - 3;

    const query = `
      SELECT p.id, p.titulo, p.precio, p.estrato,
             ot.label_es as operacion, ot.code as operacion_slug,
             pt.label_es as tipo_inmueble, pt.code as tipo_slug,
             ${portadaSubquery("p")},
             ST_Y(p.geom) AS lat, ST_X(p.geom) AS lng
      FROM propiedades p
      LEFT JOIN operation_types ot ON p.operation_type_id = ot.id
      LEFT JOIN property_types pt ON p.property_type_id = pt.id
      WHERE ST_Intersects(
        p.geom,
        ST_MakeEnvelope(
          $${bboxParamIdx}::float,
          $${bboxParamIdx + 1}::float,
          $${bboxParamIdx + 2}::float,
          $${bboxParamIdx + 3}::float,
          4326
        )
      )
      AND ${filters.join(" AND ")}
      LIMIT 1000
    `;

    const { rows } = await pool.query(query, params);

    res.json({
      success: true,
      message: null,
      data: rows.map((r) => ({
        ...r,
        lat: parseFloat(r.lat),
        lng: parseFloat(r.lng),
      })),
      error: null,
    });
  } catch (error) {
    console.error("Error en getInmueblesEnBbox:", error);
    res.status(500).json({
      success: false,
      message: "Error al obtener inmuebles",
      data: null,
      error: error.message,
    });
  }
};

export const getPropiedadResumen = async (req, res) => {
  const { id } = req.params;

  if (!id) {
    return res.status(400).json({
      success: false,
      message: "id es requerido",
      data: null,
      error: null,
    });
  }

  try {
    const { rows } = await pool.query(
      `SELECT
         p.latitude, p.longitude,
         (SELECT COUNT(DISTINCT pg.orden) FROM propiedades_galeria pg WHERE pg.propiedad_id = p.id AND pg.es_portada = false)::int AS galeria_count,
         (SELECT COUNT(DISTINCT pp.orden) FROM propiedades_planos pp WHERE pp.propiedad_id = p.id)::int AS planos_count
       FROM propiedades p
       WHERE p.id = $1`,
      [id],
    );

    if (!rows.length) {
      return res.status(404).json({
        success: false,
        message: "Propiedad no encontrada",
        data: null,
        error: null,
      });
    }

    res.json({ success: true, message: null, data: rows[0], error: null });
  } catch (error) {
    console.error("Error en getPropiedadResumen:", error);
    res.status(500).json({
      success: false,
      message: "Error al obtener resumen",
      data: null,
      error: error.message,
    });
  }
};

// GET /propiedades/:id/historial-precios
export const getHistorialPrecios = async (req, res) => {
  const { id } = req.params;

  if (!id) {
    return res.status(400).json({
      success: false,
      message: "id es requerido",
      data: null,
      error: null,
    });
  }

  try {
    const { rows } = await pool.query(
      `SELECT id, old_price, new_price, price_change, change_percent,
              change_type, detected_at, source
       FROM price_history
       WHERE propiedad_id = $1
       ORDER BY detected_at DESC`,
      [id],
    );

    res.json({ success: true, message: null, data: rows, error: null });
  } catch (error) {
    console.error("Error en getHistorialPrecios:", error);
    res.status(500).json({
      success: false,
      message: "Error al obtener historial de precios",
      data: null,
      error: error.message,
    });
  }
};

// GET /propiedades/:id/caracteristicas
// Devuelve las características activas de la propiedad agrupadas por categoría.
export const getPropiedadCaracteristicas = async (req, res) => {
  const { id } = req.params;

  if (!id) {
    return res.status(400).json({
      success: false,
      message: "id es requerido",
      data: null,
      error: null,
    });
  }

  try {
    const { rows } = await pool.query(
      `SELECT fc.id, fc.code, fc.label_es, fc.category, fc.data_type,
              pf.bool_value, pf.numeric_value, pf.text_value
       FROM property_features pf
       JOIN feature_catalog fc ON pf.feature_id = fc.id
       WHERE pf.propiedad_id = $1 AND pf.bool_value = TRUE
       ORDER BY fc.category ASC, fc.id ASC`,
      [id],
    );

    const agrupado = rows.reduce((acc, fila) => {
      if (!acc[fila.category]) acc[fila.category] = [];
      acc[fila.category].push({
        id: fila.id,
        code: fila.code,
        label_es: fila.label_es,
        data_type: fila.data_type,
        bool_value: fila.bool_value,
        numeric_value: fila.numeric_value,
        text_value: fila.text_value,
      });
      return acc;
    }, {});

    res.json({ success: true, message: null, data: agrupado, error: null });
  } catch (error) {
    console.error("Error en getPropiedadCaracteristicas:", error);
    res.status(500).json({
      success: false,
      message: "Error al obtener características",
      data: null,
      error: error.message,
    });
  }
};

// POST /propiedades/:id/caracteristicas
// Body: { features: [{ feature_id, bool_value?, numeric_value?, text_value? }] }
// Borra las existentes y reinserta las enviadas.
export const guardarPropiedadCaracteristicas = async (req, res) => {
  const { id } = req.params;
  const { features } = req.body;

  if (!id) {
    return res.status(400).json({
      success: false,
      message: "id es requerido",
      data: null,
      error: null,
    });
  }

  if (!Array.isArray(features)) {
    return res.status(400).json({
      success: false,
      message: "El campo features debe ser un array.",
      data: null,
      error: null,
    });
  }

  try {
    const propiedadResult = await pool.query(
      "SELECT id, publicado_por_id FROM propiedades WHERE id = $1",
      [id],
    );
    if (propiedadResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Propiedad no encontrada",
        data: null,
        error: null,
      });
    }
    if (propiedadResult.rows[0].publicado_por_id !== req.usuario.id) {
      return res.status(403).json({
        success: false,
        message: "No autorizado para modificar esta propiedad.",
        data: null,
        error: null,
      });
    }

    // 1. Borrar características existentes de esa propiedad
    await pool.query("DELETE FROM property_features WHERE propiedad_id = $1", [
      id,
    ]);

    // 2. Insertar las nuevas
    for (const f of features) {
      if (!f.feature_id) continue;
      await pool.query(
        `INSERT INTO property_features
           (propiedad_id, feature_id, bool_value, numeric_value, text_value)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          id,
          f.feature_id,
          f.bool_value === undefined ? true : f.bool_value,
          f.numeric_value ?? null,
          f.text_value ?? null,
        ],
      );
    }

    await cacheInvalidate("propiedades:*");
    res.json({
      success: true,
      message: "Características guardadas.",
      data: { propiedad_id: id, features_guardados: features.length },
      error: null,
    });
  } catch (error) {
    console.error("Error en guardarPropiedadCaracteristicas:", error);
    res.status(500).json({
      success: false,
      message: "Error al guardar características",
      data: null,
      error: error.message,
    });
  }
};

// ============================================================================
// ALGORITMO DE PRECIO SUGERIDO (Fase 1)
// ============================================================================

// Deriva la categoría de piso (floor_type) a partir del texto libre de `floor`.
// "PH"/"Penthouse" → ph | "Sótano" → sotano | "Bajo"/"Entreplanta" → bajo_sin_asc
// 7+ → alto_vista | 5-6 → alto | 2-4 → medio | 1 → bajo
function derivarFloorType(floor) {
  if (!floor) return "medio";
  const f = String(floor).toLowerCase().trim();
  if (f.includes("ph") || f.includes("penthouse") || f.includes("ultima") || f.includes("final")) return "ph";
  if (f.includes("sotan") || f.includes("semisotan")) return "sotano";
  if (f.includes("bajo") || f.includes("entresuelo") || f.includes("entreplanta") || f === "1" || f === "0" || f === "-1") return "bajo_sin_asc";
  const num = parseInt(f, 10);
  if (!isNaN(num) && num >= 7) return "alto_vista";
  if (!isNaN(num) && num >= 5) return "alto";
  if (!isNaN(num) && num >= 2) return "medio";
  return "bajo";
}

// POST /propiedades/calcular-precio-sugerido
// Resuelve city_id → slug y condition_type_id → code, y deriva floor_type.
export const calcularPrecioSugeridoPropiedad = async (req, res) => {
  try {
    const raw = req.body;

    let ciudad = raw.ciudad || "nacional";
    if (raw.city_id) {
      const { rows } = await pool.query("SELECT slug FROM cities WHERE id = $1", [
        raw.city_id,
      ]);
      if (rows[0]?.slug) ciudad = rows[0].slug;
    }

    let conditionTypeCode = raw.condition_type_code || "usado";
    if (raw.condition_type_id && !raw.condition_type_code) {
      const { rows } = await pool.query(
        "SELECT code FROM condition_types WHERE id = $1",
        [raw.condition_type_id],
      );
      if (rows[0]?.code) conditionTypeCode = rows[0].code;
    }

    const resultado = calcularPrecioSugerido({
      ciudad,
      estrato: raw.estrato,
      private_area: raw.private_area,
      constructed_area: raw.constructed_area,
      condition_type_code: conditionTypeCode,
      construction_year: raw.construction_year,
      floor_type: derivarFloorType(raw.floor),
      features: raw.features || [],
      parqueadero_tipo: raw.parqueadero_tipo,
      parqueadero_modo: raw.parqueadero_modo,
      zona: raw.zona,
    });

    if (resultado.error) {
      return res.status(400).json({ success: false, error: resultado.error, data: null });
    }

    res.json({
      success: true,
      message: "Precio calculado correctamente",
      data: resultado,
      error: null,
    });
  } catch (error) {
    console.error("Error en calcular-precio-sugerido:", error);
    res.status(500).json({ success: false, error: error.message, data: null });
  }
};

// POST /propiedades/validar-precio
// Body: { precio_usuario, datos_propiedad }
export const validarPrecioPropiedad = async (req, res) => {
  try {
    const { precio_usuario, datos_propiedad = {} } = req.body;

    if (precio_usuario === undefined || precio_usuario === null || precio_usuario === "") {
      return res.status(400).json({
        success: false,
        error: "precio_usuario es requerido.",
        data: null,
      });
    }

    let ciudad = datos_propiedad.ciudad || "nacional";
    if (datos_propiedad.city_id) {
      const { rows } = await pool.query(
        "SELECT slug FROM cities WHERE id = $1",
        [datos_propiedad.city_id],
      );
      if (rows[0]?.slug) ciudad = rows[0].slug;
    }

    const sugerido = calcularPrecioSugerido({
      ciudad,
      estrato: datos_propiedad.estrato,
      private_area: datos_propiedad.private_area,
      constructed_area: datos_propiedad.constructed_area,
      condition_type_code: datos_propiedad.condition_type_code || "usado",
      construction_year: datos_propiedad.construction_year,
      floor_type: derivarFloorType(datos_propiedad.floor),
      features: datos_propiedad.features || [],
      parqueadero_tipo: datos_propiedad.parqueadero_tipo,
      parqueadero_modo: datos_propiedad.parqueadero_modo,
      zona: datos_propiedad.zona,
    });

    const validacion = validarPrecioUsuario(Number(precio_usuario), sugerido);

    res.json({
      success: true,
      message: "Precio validado correctamente",
      data: {
        ...validacion,
        precio_sugerido_promedio: sugerido.precio_sugerido_promedio,
      },
      error: null,
    });
  } catch (error) {
    console.error("Error en validar-precio:", error);
    res.status(500).json({ success: false, error: error.message, data: null });
  }
};
