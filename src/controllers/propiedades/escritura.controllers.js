// src/controllers/propiedades/escritura.controllers.js — crear, editar, borrar y publicar anuncios (incluye subida de imágenes).
import { AWS_BUCKET_SUBFOLDER, RUST_MEDIA_URL } from "../../config.js";
import { pool } from "../../db.js";
import { cacheInvalidate } from "../../lib/redis.js";
import { deleteFromS3, uploadToS3 } from "../../lib/s3AWS.js";
import { getCityById, getStateById, getPropertyTypeLabel } from "../../lib/locations.js";
import { propiedad_validate, publicar_anuncio_validate } from "../../validations/propiedad_validate.js";
import {
  HttpError,
  actualizarOferta,
  crearOferta,
  obtenerOfertas,
} from "../../lib/ofertas.service.js";
import { regenerarTitulo } from "../../lib/tituloPropiedad.js";
import { getOperationCode } from "../../lib/catalogos.js";
import { puedeGestionarPropiedad } from "../../lib/propiedadPermisos.js";
import { calcularPuntoPublico, distanciaMetros } from "../../lib/ubicacion.service.js";
import {
  toBool,
  parseCamposPropiedad,
  calcularPricePerSqm,
  portadaSubquery,
  portadaPublicIdSubquery,
  buildVersionRows,
} from "./_comun.js";

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

    // Igual que en publicarAnuncios: parking_space_price es INTEGER en BD.
    const topeParking = 199_999_999;
    if (
      campos.parking_space_price != null &&
      (campos.parking_space_price > topeParking || campos.parking_space_price < 0)
    ) {
      return res.status(400).json({
        success: false,
        error: `La tarifa del parqueadero excede el tope de $${topeParking.toLocaleString("es-CO")} COP.`,
      });
    }

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
        ubicacion_oculta_solicitada,
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
        $59,
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
      // Informativo: no oculta nada (la ocultación la aplica pagos.service).
      campos.ubicacion_oculta_solicitada,
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

    // Ofertas (Fase 4): formato nuevo `ofertas` o una del formato antiguo.
    // Ante fallo se responde 500 con el id (recuperable con PUT ofertas/upsert).
    let ofertasBodyCreate = req.body.ofertas;
    if (typeof ofertasBodyCreate === "string" && ofertasBodyCreate.trim() !== "") {
      try {
        ofertasBodyCreate = JSON.parse(ofertasBodyCreate);
      } catch {
        return res.status(400).json({
          success: false,
          error: "El campo ofertas debe ser un JSON válido.",
        });
      }
    }
    if (ofertasBodyCreate !== undefined || campos.operation_type_id) {
      const ofertasACrear = Array.isArray(ofertasBodyCreate)
        ? ofertasBodyCreate.map((o) => ({
            operation: o.operation,
            operation_type_id: o.operation_type_id,
            datos: o,
          }))
        : [
            {
              operation: undefined,
              operation_type_id: campos.operation_type_id,
              datos: {
                precio: campos.precio,
                rental_type_id: campos.rental_type_id,
                parking_space_price: campos.parking_space_price,
              },
            },
          ];
      const clientOfertasCreate = await pool.connect();
      try {
        await clientOfertasCreate.query("BEGIN");
        for (const item of ofertasACrear) {
          const code = item.operation
            ? String(item.operation).toLowerCase()
            : await getOperationCode(item.operation_type_id);
          await crearOferta(clientOfertasCreate, {
            propiedadId: nuevaPropiedad.id,
            operation: code,
            datos: item.datos,
            usuarioId: req.usuario.id,
          });
        }
        await clientOfertasCreate.query("COMMIT");
      } catch (errorOfertas) {
        await clientOfertasCreate.query("ROLLBACK");
        if (errorOfertas instanceof HttpError) {
          return res.status(errorOfertas.status).json({
            success: false,
            error: errorOfertas.error,
            data: { propiedad_id: nuevaPropiedad.id },
          });
        }
        throw errorOfertas;
      } finally {
        clientOfertasCreate.release();
      }
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
      `SELECT publicado_por_id, organizacion_id, ubicacion_oculta,
              ubicacion_oculta_at, latitude, longitude,
              latitude_publica, longitude_publica
       FROM propiedades WHERE id = $1`,
      [id],
    );

    if (propiedadResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Propiedad no encontrada.",
      });
    }

    if (!(await puedeGestionarPropiedad(req.usuario, propiedadResult.rows[0]))) {
      return res.status(403).json({
        success: false,
        error: "No autorizado para editar esta propiedad.",
      });
    }

    const propiedadAntes = propiedadResult.rows[0];

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

    // Campos protegidos del sistema de pagos: nunca se aceptan del cliente
    // (la ocultación real solo la aplica pagos.service tras verificar el pago).
    delete formDataObj.ubicacion_oculta;
    delete formDataObj.ubicacion_oculta_at;
    delete formDataObj.latitude_publica;
    delete formDataObj.longitude_publica;
    delete formDataObj.geom_publica;

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

    // ========================================
    // COMPAT OFERTAS (Fase 4): el precio vive en property_listings.
    // - operation_type_id distinto al principal → 400 (usar cambiar-operacion).
    // - precio/rental_type_id/parking_space_price a secas: con UNA oferta se
    //   aplican vía actualizarOferta (sin duplicar price_history); con dos → 400.
    // ========================================
    const CLAVES_OFERTA = ["precio", "rental_type_id", "parking_space_price"];
    const traeClavesOferta = CLAVES_OFERTA.filter(
      (k) =>
        formDataObj[k] !== undefined &&
        formDataObj[k] !== null &&
        formDataObj[k] !== "",
    );
    let ofertaAplicadaPorServicio = false;
    const { rows: ofertasActuales } = await pool.query(
      `SELECT l.*, ot.code FROM property_listings l
       JOIN operation_types ot ON ot.id = l.operation_type_id
       WHERE l.propiedad_id = $1`,
      [id],
    );
    const ofertaPrincipal = [...ofertasActuales].sort(
      (a, b) =>
        Number(b.listing_status === "active") -
          Number(a.listing_status === "active") ||
        Number(String(b.code).toLowerCase() === "venta") -
          Number(String(a.code).toLowerCase() === "venta"),
    )[0];

    if (
      formDataObj.operation_type_id !== undefined &&
      formDataObj.operation_type_id !== null &&
      formDataObj.operation_type_id !== "" &&
      ofertaPrincipal &&
      Number(formDataObj.operation_type_id) !== ofertaPrincipal.operation_type_id
    ) {
      return res.status(400).json({
        success: false,
        error:
          "Para cambiar la operación usa POST /propiedades/:id/cambiar-operacion.",
      });
    }

    if (traeClavesOferta.length > 0 && ofertasActuales.length > 1) {
      return res.status(400).json({
        success: false,
        error:
          "La propiedad tiene varias ofertas: usa PUT /propiedades/:id/ofertas/:operacion.",
      });
    }

    if (traeClavesOferta.length > 0 && ofertasActuales.length === 1) {
      const unica = ofertasActuales[0];
      const datosOferta = {};
      for (const k of traeClavesOferta) datosOferta[k] = formDataObj[k];
      const clientOferta = await pool.connect();
      try {
        await clientOferta.query("BEGIN");
        await actualizarOferta(clientOferta, {
          propiedadId: id,
          operation: unica.code,
          datos: datosOferta,
          usuarioId: req.usuario.id,
        });
        await clientOferta.query("COMMIT");
      } catch (errorOferta) {
        await clientOferta.query("ROLLBACK");
        if (errorOferta instanceof HttpError) {
          return res.status(errorOferta.status).json({
            success: false,
            error: errorOferta.error,
          });
        }
        throw errorOferta;
      } finally {
        clientOferta.release();
      }
      // Ya aplicado vía ofertas: la ruta genérica los ignora (sin duplicar historial).
      for (const k of traeClavesOferta) delete formDataObj[k];
      ofertaAplicadaPorServicio = true;
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
    // SWAP DE PORTADA: promover una foto de galería (por `orden`) a portada.
    // La portada anterior pasa a la galería ocupando el orden liberado.
    // Todo es UPDATE (sin re-subir ni tocar S3). Si además subieron archivo
    // de portada, el archivo manda y este parámetro se ignora.
    // ========================================
    let huboSwapPortada = false;
    const rawPortadaOrden = formDataObj.portada_orden;
    const quiereSwap =
      rawPortadaOrden !== undefined &&
      rawPortadaOrden !== null &&
      rawPortadaOrden !== "";
    if (quiereSwap && !(file && file.size > 0)) {
      const ordenObjetivo = parseInt(rawPortadaOrden);
      if (isNaN(ordenObjetivo) || ordenObjetivo < 0) {
        return res.status(400).json({
          success: false,
          error: "portada_orden inválido.",
        });
      }
      const { rows: objetivo } = await pool.query(
        `SELECT 1 FROM propiedades_galeria
          WHERE propiedad_id = $1 AND orden = $2 AND es_portada = false LIMIT 1`,
        [id, ordenObjetivo],
      );
      if (objetivo.length === 0) {
        return res.status(400).json({
          success: false,
          error: "La foto indicada no existe en la galería.",
        });
      }
      // 1. Aparcar la portada actual (evita violar el índice único de portada)
      await pool.query(
        `UPDATE propiedades_galeria SET es_portada = false, orden = -2
          WHERE propiedad_id = $1 AND es_portada = true`,
        [id],
      );
      // 2. Promover la foto elegida
      await pool.query(
        `UPDATE propiedades_galeria SET es_portada = true, orden = -1
          WHERE propiedad_id = $1 AND orden = $2 AND es_portada = false`,
        [id, ordenObjetivo],
      );
      // 3. La portada anterior ocupa el orden liberado en la galería
      await pool.query(
        `UPDATE propiedades_galeria SET es_portada = false, orden = $2
          WHERE propiedad_id = $1 AND orden = -2`,
        [id, ordenObjetivo],
      );
      huboSwapPortada = true;
    }

    // ========================================
    // ACTUALIZAR CAMPOS
    // ========================================
    const updates = [];
    const values = [];
    let paramCount = 1;

    // El título lo genera el backend (Fase 4): el del cliente se valida
    // arriba pero nunca se persiste; se regenera si cambia tipo/barrio/ciudad.
    if (estado) {
      updates.push(`estado = $${paramCount}`);
      values.push(estado);
      paramCount++;
    }
    const tocoDescripcion =
      formDataObj.description !== undefined &&
      formDataObj.description !== null &&
      formDataObj.description !== "";

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

    // parking_space_price es INTEGER en BD: 400 legible en vez de 500 pg.
    const topeParkingEdicion = 199_999_999;
    if (
      campos.parking_space_price != null &&
      (campos.parking_space_price > topeParkingEdicion ||
        campos.parking_space_price < 0)
    ) {
      return res.status(400).json({
        success: false,
        error: `La tarifa del parqueadero excede el tope de $${topeParkingEdicion.toLocaleString("es-CO")} COP.`,
      });
    }

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
      // Solo informativo (intención). NUNCA: ubicacion_oculta, *_at, *_publica.
      "ubicacion_oculta_solicitada",
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
      !ofertaAplicadaPorServicio &&
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

      // Título derivado (Fase 4): si cambió tipo, barrio o ciudad, se regenera.
      const tocoTitulo = updates.some((u) =>
        /^(property_type_id|barrio_id|barrio_nombre|city_id|state_id) =/.test(u),
      );
      if (tocoTitulo) {
        await regenerarTitulo(pool, id);
      }
      // Editar la descripción levanta la marca de revisión pendiente.
      if (tocoDescripcion) {
        await pool.query(
          "UPDATE propiedades SET description_needs_review = FALSE WHERE id = $1",
          [id],
        );
      }

      // ANTI-TRIANGULACIÓN: si el anuncio está oculto y el usuario cambia las
      // coordenadas reales, el punto público SOLO se regenera si el salto es
      // grande (> ~1 km). Ediciones pequeñas NO mueven el punto público
      // (si cambiara en cada edición, se podría triangular la ubicación real).
      const nuevoLat =
        formDataObj.latitude !== undefined ? campos.latitude : propiedadAntes?.latitude;
      const nuevoLng =
        formDataObj.longitude !== undefined
          ? campos.longitude
          : propiedadAntes?.longitude;
      if (
        propiedadAntes?.ubicacion_oculta === true &&
        (formDataObj.latitude !== undefined || formDataObj.longitude !== undefined) &&
        Number.isFinite(Number(nuevoLat)) &&
        Number.isFinite(Number(nuevoLng))
      ) {
        const salto = distanciaMetros(
          Number(nuevoLat),
          Number(nuevoLng),
          Number(propiedadAntes.latitude),
          Number(propiedadAntes.longitude),
        );
        if (salto > 1000) {
          const punto = calcularPuntoPublico(Number(nuevoLat), Number(nuevoLng));
          await pool.query(
            `UPDATE propiedades SET
               latitude_publica = $2,
               longitude_publica = $3,
               geom_publica = ST_SetSRID(
                 ST_MakePoint($3::double precision, $2::double precision), 4326)
             WHERE id = $1`,
            [id, punto.lat, punto.lng],
          );
        }
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
    await cacheInvalidate("propiedad*");
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
      "SELECT id, publicado_por_id, organizacion_id FROM propiedades WHERE id = $1",
      [id],
    );

    if (propiedadResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Propiedad no encontrada",
      });
    }

    const propiedad = propiedadResult.rows[0];

    if (!(await puedeGestionarPropiedad(req.usuario, propiedad))) {
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
    await cacheInvalidate("propiedad*");
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
    // VALIDACIONES (acepta formato antiguo y nuevo `ofertas`)
    // ========================================
    let ofertasBody = raw.ofertas;
    if (typeof ofertasBody === "string" && ofertasBody.trim() !== "") {
      try {
        ofertasBody = JSON.parse(ofertasBody);
      } catch {
        return res.status(400).json({
          success: false,
          error: "El campo ofertas debe ser un JSON válido.",
        });
      }
    }
    const data = {
      operation_type_id,
      property_type_id,
      direccion,
      country_id,
      city_id,
      state_id,
      estrato,
      precio,
      rental_type_id,
      parking_space_price,
      listing_status: raw.listing_status,
      expires_at: raw.expires_at,
      publicado_por_id: req.usuario.id,
      ...(ofertasBody !== undefined ? { ofertas: ofertasBody } : {}),
    };
    const errores = await publicar_anuncio_validate(data);
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
    // how_to_contact es NOT NULL en BD: default al canal completo.
    const contactoFinal = how_to_contact || "telefono_chat";

    // parking_space_price es INTEGER en BD (precio del anuncio hoy es BIGINT):
    // si el valor se pasa de rango, responders 400 legible en vez de 500 pg.
    const topeParking = 199_999_999;
    if (
      parking_space_price != null &&
      (parking_space_price > topeParking || parking_space_price < 0)
    ) {
      return res.status(400).json({
        success: false,
        error: `La tarifa del parqueadero excede el tope de $${topeParking.toLocaleString("es-CO")} COP. Revisa el paso 2 (tarifa mensual).`,
      });
    }

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
        ubicacion_oculta_solicitada,
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
        $59,
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
      contactoFinal,
      telefono_contacto,
      barrio_nombre,
      // Informativo: no oculta nada (la ocultación la aplica pagos.service).
      toBool(raw.ubicacion_oculta_solicitada),
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

    // Ofertas (Fase 4): formato nuevo `ofertas` o una oferta del formato antiguo.
    // Todo en una transacción; ante fallo se responde 500 con el id para
    // recuperar con PUT /propiedades/:id/ofertas/:operacion (upsert).
    const ofertasACrear = Array.isArray(ofertasBody)
      ? ofertasBody.map((o) => ({
          operation: o.operation,
          operation_type_id: o.operation_type_id,
          datos: o,
        }))
      : [
          {
            operation: undefined,
            operation_type_id,
            datos: {
              precio,
              rental_type_id,
              parking_space_price,
            },
          },
        ];
    const clientOfertas = await pool.connect();
    try {
      await clientOfertas.query("BEGIN");
      for (const item of ofertasACrear) {
        const code = item.operation
          ? String(item.operation).toLowerCase()
          : await getOperationCode(item.operation_type_id);
        await crearOferta(clientOfertas, {
          propiedadId: nuevaPropiedad.id,
          operation: code,
          datos: item.datos,
          usuarioId: req.usuario.id,
        });
      }
      await clientOfertas.query("COMMIT");
    } catch (errorOfertas) {
      await clientOfertas.query("ROLLBACK");
      if (errorOfertas instanceof HttpError) {
        return res.status(errorOfertas.status).json({
          success: false,
          error: errorOfertas.error,
          data: { propiedad_id: nuevaPropiedad.id },
        });
      }
      throw errorOfertas;
    } finally {
      clientOfertas.release();
    }

    const tituloOfertas = await regenerarTitulo(pool, nuevaPropiedad.id);

    await cacheInvalidate("propiedad*");
    return res.status(201).json({
      success: true,
      message: "Propiedad creada.",
      data: {
        ...nuevaPropiedad,
        titulo: tituloOfertas ?? nuevaPropiedad.titulo,
        ofertas: await obtenerOfertas(pool, nuevaPropiedad.id),
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
