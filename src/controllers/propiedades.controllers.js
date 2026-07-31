import { AWS_BUCKET_SUBFOLDER } from "../config.js";
import { pool } from "../db.js";
import { deleteFromS3, uploadToS3 } from "../lib/s3AWS.js";
import { tiempoRelativo } from "../utils/tiempoRelativo.js";
import { getCityById, getStateById } from "../lib/locations.js";
import {
  propiedad_validate,
  publicar_anuncio_validate,
} from "../validations/propiedad_validate.js";

const RUST_MEDIA_URL = process.env.RUST_MEDIA_URL || "http://localhost:3003";

// ok
export const getPropiedades = async (req, res) => {
  try {
    const { rows: propiedades } = await pool.query(
      "SELECT * FROM propiedades ORDER BY created_at DESC",
    );

    const propiedadesConDatos = await Promise.all(
      propiedades.map(async (propiedad) => {
        // Galería
        const { rows: galeria } = await pool.query(
          `SELECT id, url, public_id, orden 
           FROM propiedades_galeria 
           WHERE propiedad_id = $1 
           ORDER BY orden ASC`,
          [propiedad.id],
        );

        // Planos
        const { rows: planos } = await pool.query(
          `SELECT id, url, public_id, orden 
           FROM propiedades_planos 
           WHERE propiedad_id = $1 
           ORDER BY orden ASC`,
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
          publicador = rows[0] ? { tipo: "organizacion", ...rows[0] } : null;
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
    let uploadResponse = null;
    let imagenesGaleria = [];
    let imagenesPlanos = [];

    let usarRustMedia = !!process.env.RUST_MEDIA_URL && file && file.buffer;

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
            timeout: 30000,
          },
        );

        if (
          mediaResponse.data?.success &&
          mediaResponse.data?.data?.length > 0
        ) {
          const images = mediaResponse.data.data;
          uploadResponse = {
            fileId: `rust_${Date.now()}`,
            url: images[0].original || images[0].thumbnail,
          };

          images.slice(1).forEach((img, i) => {
            imagenesGaleria.push({
              url: img.thumbnail || img.medium,
              public_id: `rust_galeria_${Date.now()}_${i}`,
              orden: i,
            });
          });

          // Fotos de planos se procesan igual que galería por ahora
          if (
            req.files?.planos &&
            images.length > 1 + (req.files.galeria?.length || 0)
          ) {
            const planosStartIdx = 1 + (req.files.galeria?.length || 0);
            images.slice(planosStartIdx).forEach((img, i) => {
              imagenesPlanos.push({
                url: img.thumbnail || img.medium,
                public_id: `rust_planos_${Date.now()}_${i}`,
                orden: i,
              });
            });
          }

          console.log("Imagenes procesadas via Rust media service");
        } else {
          throw new Error("Respuesta invalida del servicio Rust de media");
        }
      } catch (rustError) {
        console.warn(
          "Rust media no disponible, usando subida directa:",
          rustError.message,
        );
        usarRustMedia = false; // caer al fallback
      }
    }

    // ========================================
    // FALLBACK: Subida directa a S3 desde Express
    // ========================================
    if (!usarRustMedia) {
      // ========================================
      // PROCESAR IMAGEN PRINCIPAL
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

      const carpeta = AWS_BUCKET_SUBFOLDER || "inmobitwo";
      const fileName = `${carpeta}/propiedades/imagenes_principal/propiedad_${titulo
        .toLowerCase()
        .replace(/\s+/g, "-")}_${Date.now()}.jpg`;

      const url = await uploadToS3(file.buffer, fileName, file.mimetype);
      uploadResponse = { fileId: fileName, url };

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
          imagenesGaleria.push({ url, public_id: fileName, orden: i });
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
          imagenesPlanos.push({ url, public_id: fileName, orden: i });
        }
      }
    } // fin fallback S3 directo

    // ========================================
    // INSERTAR EN BD
    // ========================================
    const query = `
      INSERT INTO propiedades (
        titulo, imagen_principal_url, imagen_principal_public_id,
        estado, es_de_organizacion, organizacion_id, publicado_por_id,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING *;
    `;

    const values = [
      titulo,
      uploadResponse.url,
      uploadResponse.fileId,
      estado || "disponible",
      es_de_organizacion || false,
      organizacion_id,
      req.usuario.id,
    ];

    const result = await pool.query(query, values);
    const nuevaPropiedad = result.rows[0];

    if (imagenesGaleria.length > 0) {
      for (const imagen of imagenesGaleria) {
        await pool.query(
          `INSERT INTO propiedades_galeria (propiedad_id, url, public_id, orden, created_at)
           VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)`,
          [nuevaPropiedad.id, imagen.url, imagen.public_id, imagen.orden],
        );
      }
    }

    if (imagenesPlanos.length > 0) {
      for (const imagen of imagenesPlanos) {
        await pool.query(
          `INSERT INTO propiedades_planos (propiedad_id, url, public_id, orden, created_at)
           VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)`,
          [nuevaPropiedad.id, imagen.url, imagen.public_id, imagen.orden],
        );
      }
    }

    return res.status(201).json({
      success: true,
      message: "Propiedad creada.",
      data: {
        ...nuevaPropiedad,
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

    const { rows } = await pool.query(
      `SELECT 
        p.*,
        u.name AS usuario_nombre,
        u.email AS usuario_email
      FROM propiedades p
      JOIN usuarios u 
        ON p.publicado_por_id = u.id
      WHERE p.id = $1`,
      [id],
    );

    const propiedad = rows[0];

    if (!propiedad) {
      return res.status(404).json({
        success: false,
        error: "Propiedad no encontrada",
      });
    }

    const { rows: galeria } = await pool.query(
      `SELECT id, url, public_id, orden 
       FROM propiedades_galeria 
       WHERE propiedad_id = $1 
       ORDER BY orden ASC`,
      [id],
    );

    const { rows: planos } = await pool.query(
      `SELECT id, url, public_id, orden 
       FROM propiedades_planos 
       WHERE propiedad_id = $1 
       ORDER BY orden ASC`,
      [id],
    );

    res.status(200).json({
      success: true,
      message: "Propiedad obtenida.",
      data: {
        ...propiedad,
        galeria: galeria || [],
        planos: planos || [],
      },
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
    let oldPublicId = null;
    let imagenesGaleria = [];
    let imagenesPlanos = [];

    // ========================================
    // VALIDACIONES BÁSICAS (antes de intentar Rust o el fallback)
    // ========================================
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

      const result = await pool.query(
        "SELECT imagen_principal_public_id FROM propiedades WHERE id = $1",
        [id],
      );

      if (result.rows.length === 0) {
        return res
          .status(404)
          .json({ success: false, error: "Propiedad no encontrada." });
      }

      oldPublicId = result.rows[0].imagen_principal_public_id;
    }

    let usarRustMedia =
      !!process.env.RUST_MEDIA_URL &&
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
            timeout: 30000,
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
            const img = images[idx++];
            uploadResponse = {
              fileId: `rust_${Date.now()}`,
              url: img.original || img.thumbnail,
            };
          }

          files.forEach((_, i) => {
            const img = images[idx++];
            imagenesGaleria.push({
              url: img.thumbnail || img.medium,
              public_id: `rust_galeria_${Date.now()}_${i}`,
              orden: i,
            });
          });

          planosFiles.forEach((_, i) => {
            const img = images[idx++];
            imagenesPlanos.push({
              url: img.thumbnail || img.medium,
              public_id: `rust_planos_${Date.now()}_${i}`,
              orden: i,
            });
          });

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
      // PROCESAR IMAGEN PRINCIPAL
      if (file && file.size > 0) {
        const carpeta = AWS_BUCKET_SUBFOLDER || "inmobitwo";
        const fileName = `${carpeta}/propiedades/imagenes_principal/propiedad_${(
          titulo || "imagen"
        )
          .toLowerCase()
          .replace(/\s+/g, "-")}_${Date.now()}.jpg`;

        const url = await uploadToS3(file.buffer, fileName, file.mimetype);
        uploadResponse = { fileId: fileName, url };
      }

      // PROCESAR GALERÍA NUEVAS
      if (files.length > 0) {
        const carpeta = AWS_BUCKET_SUBFOLDER || "inmobitwo";
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
          imagenesGaleria.push({ url, public_id: fileName, orden: i });
        }
      }

      // PROCESAR PLANOS NUEVOS
      if (planosFiles.length > 0) {
        const carpeta = AWS_BUCKET_SUBFOLDER || "inmobitwo";
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
          imagenesPlanos.push({ url, public_id: fileName, orden: i });
        }
      }
    }

    // ========================================
    // ELIMINAR IMÁGENES DE GALERÍA MARCADAS
    // ========================================
    if (imagesToDelete.length > 0) {
      for (const imagenId of imagesToDelete) {
        const img = await pool.query(
          "SELECT public_id FROM propiedades_galeria WHERE id = $1",
          [imagenId],
        );
        if (img.rows.length > 0) {
          try {
            await deleteFromS3(img.rows[0].public_id);
          } catch (err) {
            console.warn(`⚠️ No se pudo eliminar de S3: ${err.message}`);
          }
        }
        await pool.query("DELETE FROM propiedades_galeria WHERE id = $1", [
          imagenId,
        ]);
      }
    }

    // ========================================
    // ELIMINAR PLANOS MARCADOS
    // ========================================
    if (planosToDelete.length > 0) {
      for (const planoId of planosToDelete) {
        const img = await pool.query(
          "SELECT public_id FROM propiedades_planos WHERE id = $1",
          [planoId],
        );
        if (img.rows.length > 0) {
          try {
            await deleteFromS3(img.rows[0].public_id);
          } catch (err) {
            console.warn(`⚠️ No se pudo eliminar plano de S3: ${err.message}`);
          }
        }
        await pool.query("DELETE FROM propiedades_planos WHERE id = $1", [
          planoId,
        ]);
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
    const rawPrecio = formDataObj.precio;
    if (rawPrecio !== undefined && rawPrecio !== null && rawPrecio !== "") {
      const precioParsed = parseInt(rawPrecio);
      if (isNaN(precioParsed)) {
        return res.status(400).json({
          success: false,
          error: "El precio debe ser un número válido.",
        });
      }
      updates.push(`precio = $${paramCount}`);
      values.push(precioParsed);
      paramCount++;
    }
    if (uploadResponse) {
      updates.push(`imagen_principal_url = $${paramCount}`);
      values.push(uploadResponse.url);
      paramCount++;
      updates.push(`imagen_principal_public_id = $${paramCount}`);
      values.push(uploadResponse.fileId);
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

      if (uploadResponse && oldPublicId) {
        try {
          await deleteFromS3(oldPublicId);
        } catch (err) {
          console.warn(
            "⚠️ No se pudo eliminar imagen principal antigua:",
            err.message,
          );
        }
      }
    }

    // ========================================
    // AGREGAR NUEVAS IMÁGENES A GALERÍA
    // ========================================
    if (imagenesGaleria.length > 0) {
      for (const imagen of imagenesGaleria) {
        await pool.query(
          `INSERT INTO propiedades_galeria (propiedad_id, url, public_id, orden, created_at)
           VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)`,
          [id, imagen.url, imagen.public_id, imagen.orden],
        );
      }
    }

    // ========================================
    // AGREGAR NUEVOS PLANOS
    // ========================================
    if (imagenesPlanos.length > 0) {
      for (const imagen of imagenesPlanos) {
        await pool.query(
          `INSERT INTO propiedades_planos (propiedad_id, url, public_id, orden, created_at)
           VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)`,
          [id, imagen.url, imagen.public_id, imagen.orden],
        );
      }
    }

    // ========================================
    // RETORNAR PROPIEDAD ACTUALIZADA
    // ========================================
    const propiedadActualizada = await pool.query(
      "SELECT * FROM propiedades WHERE id = $1",
      [id],
    );
    const galeriaActualizada = await pool.query(
      `SELECT id, url, public_id, orden FROM propiedades_galeria
       WHERE propiedad_id = $1 ORDER BY orden ASC`,
      [id],
    );
    const planosActualizados = await pool.query(
      `SELECT id, url, public_id, orden FROM propiedades_planos
       WHERE propiedad_id = $1 ORDER BY orden ASC`,
      [id],
    );

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
      "SELECT id, imagen_principal_public_id, publicado_por_id FROM propiedades WHERE id = $1",
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

    const imagenPrincipalPublicId = propiedad.imagen_principal_public_id;

    const galeriaResult = await pool.query(
      "SELECT id, public_id FROM propiedades_galeria WHERE propiedad_id = $1",
      [id],
    );

    const galeriaImgs = galeriaResult.rows;

    if (imagenPrincipalPublicId) {
      try {
        await deleteFromS3(imagenPrincipalPublicId);
      } catch (err) {
        console.warn(
          `⚠️ No se pudo eliminar imagen principal de S3: ${err.message}`,
        );
      }
    }

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

    res.status(200).json({
      success: true,
      message: "Propiedad eliminada",
      data: {
        propiedadId: id,
        imagenPrincipalEliminada: !!imagenPrincipalPublicId,
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

    const operacion = raw.operacion || "venta";

    const {
      tipo,
      country_id,
      state_id,
      city_id,
      direccion,
      numero_direccion,
      latitude,
      longitude,
      estado,
      precio,
    } = raw;

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
      tipo,
      operacion,
      direccion,
      country_id,
      city_id,
      state_id,
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

    const titulo = `${tipo || "Propiedad"} en ${direccion}, ${city.name}, ${state.name}`;
    const tituloFinal = titulo.charAt(0).toUpperCase() + titulo.slice(1);

    // ========================================
    // INSERTAR EN BD
    // ========================================
    const query = `
      INSERT INTO propiedades (
        tipo, operacion, country_id, state_id, city_id, direccion, numero_direccion, latitude, longitude,
        titulo, precio, estado, es_de_organizacion, organizacion_id, publicado_por_id,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING *;
    `;
    const values = [
      tipo,
      operacion,
      country_id,
      state_id,
      city_id,
      direccion,
      numero_direccion,
      latitude,
      longitude,
      tituloFinal,
      precio ? parseInt(precio) : null,
      estado || "disponible",
      es_de_organizacion || false,
      organizacion_id,
      req.usuario.id,
    ];

    const result = await pool.query(query, values);
    const nuevaPropiedad = result.rows[0];

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
      whereClause = "WHERE created_at < $2";
      params.push(cursor);
    }

    const { rows: propiedades } = await pool.query(
      `SELECT * FROM propiedades 
       ${whereClause}
       ORDER BY created_at DESC 
       LIMIT $1`,
      params,
    );

    const propiedadesConDatos = await Promise.all(
      propiedades.map(async (propiedad) => {
        const { rows: galeria } = await pool.query(
          `SELECT id, url, public_id, orden 
           FROM propiedades_galeria 
           WHERE propiedad_id = $1 
           ORDER BY orden ASC`,
          [propiedad.id],
        );

        const { rows: planos } = await pool.query(
          `SELECT id, url, public_id, orden 
           FROM propiedades_planos 
           WHERE propiedad_id = $1 
           ORDER BY orden ASC`,
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
      `SELECT *
       FROM propiedades
       WHERE publicado_por_id = $1
       ORDER BY created_at DESC`,
      [id],
    );

    const propiedadesConDatos = await Promise.all(
      propiedades.map(async (propiedad) => {
        // Galería
        const { rows: galeria } = await pool.query(
          `SELECT id, url, public_id, orden
           FROM propiedades_galeria
           WHERE propiedad_id = $1
           ORDER BY orden ASC`,
          [propiedad.id],
        );

        // Planos
        const { rows: planos } = await pool.query(
          `SELECT id, url, public_id, orden
           FROM propiedades_planos
           WHERE propiedad_id = $1
           ORDER BY orden ASC`,
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

    return res.status(200).json({
      success: true,
      message: "Propiedades obtenidas.",
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
      "WHERE organizacion_id = $1 AND es_de_organizacion = true";

    if (cursor) {
      whereClause += " AND created_at < $3";
      params.push(cursor);
    }

    const { rows: propiedades } = await pool.query(
      `SELECT * FROM propiedades 
       ${whereClause}
       ORDER BY created_at DESC 
       LIMIT $2`,
      params,
    );

    const propiedadesConDatos = await Promise.all(
      propiedades.map(async (propiedad) => {
        const { rows: galeria } = await pool.query(
          `SELECT id, url, public_id, orden 
           FROM propiedades_galeria 
           WHERE propiedad_id = $1 
           ORDER BY orden ASC`,
          [propiedad.id],
        );

        const { rows: planos } = await pool.query(
          `SELECT id, url, public_id, orden 
           FROM propiedades_planos 
           WHERE propiedad_id = $1 
           ORDER BY orden ASC`,
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
  const { operation, type, city, dept } = req.query;

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

    let typeCondition;
    if (type.includes(",")) {
      const types = type
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean);
      types.forEach((t) => params.push(t));
      const placeholders = types.map((_, i) => `$${i + 2}`);
      typeCondition = `AND LOWER(p.tipo) IN (${placeholders.join(", ")})`;
    } else {
      params.push(type.toLowerCase());
      typeCondition = `AND LOWER(p.tipo) = $2`;
    }

    const galeriaSubquery = `
      COALESCE(
        (SELECT json_agg(json_build_object(
          'id', pg.id,
          'url', pg.url,
          'orden', pg.orden
        ) ORDER BY pg.orden)
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
          'orden', pp.orden
        ) ORDER BY pp.orden)
        FROM propiedades_planos pp
        WHERE pp.propiedad_id = p.id),
        '[]'::json
      ) as planos
    `;

    const selectFields = `
      p.id, p.tipo, p.operacion, p.titulo, p.direccion, p.precio,
      p.imagen_principal_url,
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

    let query;
    if (city) {
      params.push(city.toLowerCase(), dept.toLowerCase());
      const cityIdx = params.length - 1;
      const deptIdx = params.length;

      query = `
        SELECT ${selectFields}
        FROM propiedades p
        INNER JOIN cities c ON p.city_id = c.id
        INNER JOIN states s ON c.state_id = s.id 
        ${orgJoin}
        WHERE LOWER(p.operacion) = $1
          ${typeCondition}
          AND c.slug = $${cityIdx}
          AND s.slug = $${deptIdx}
          AND p.estado = 'publicado'
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
        INNER JOIN cities c ON p.city_id = c.id
        INNER JOIN states s ON c.state_id = s.id 
        ${orgJoin}
        WHERE LOWER(p.operacion) = $1
          ${typeCondition}
          AND s.slug = $${fallbackIdx}
          AND p.estado = 'publicado'
        ORDER BY p.id DESC
        LIMIT 100;
      `;
    } else if (dept) {
      params.push(dept.toLowerCase());
      const geoIdx = params.length;

      query = `
        SELECT ${selectFields}
        FROM propiedades p
        INNER JOIN cities c ON p.city_id = c.id
        INNER JOIN states s ON c.state_id = s.id 
        ${orgJoin}
        WHERE LOWER(p.operacion) = $1
          ${typeCondition}
          AND s.slug = $${geoIdx}
          AND p.estado = 'publicado'
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
        INNER JOIN cities c ON p.city_id = c.id
        INNER JOIN states s ON c.state_id = s.id
        INNER JOIN regions r ON s.region_id = r.id
        ${orgJoin}
        WHERE LOWER(p.operacion) = $1
          ${typeCondition}
          AND r.slug = $${geoIdx}
          AND p.estado = 'publicado'
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

// NUEVO v3.6: Inmuebles dentro de un bounding box (para MapaInmuebles)
export const getInmueblesEnBbox = async (req, res) => {
  const { minLat, minLng, maxLat, maxLng, operation, tipoInmueble } = req.query;

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

    if (operation) {
      params.push(operation.toLowerCase());
      filters.push(`LOWER(p.operacion) = LOWER($${params.length})`);
    }

    if (tipoInmueble) {
      const tipos = tipoInmueble
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean);
      if (tipos.length === 1) {
        params.push(tipos[0]);
        filters.push(`LOWER(p.tipo) = LOWER($${params.length})`);
      } else if (tipos.length > 1) {
        const startIdx = params.length + 1;
        tipos.forEach((t) => params.push(t));
        const placeholders = tipos.map((_, i) => `$${startIdx + i}`);
        filters.push(`LOWER(p.tipo) IN (${placeholders.join(", ")})`);
      }
    }

    params.push(minLng, minLat, maxLng, maxLat);
    const bboxParamIdx = params.length - 3;

    const query = `
      SELECT p.id, p.titulo, p.precio, p.operacion, p.tipo,
             p.imagen_principal_url,
             ST_Y(p.geom) AS lat, ST_X(p.geom) AS lng
      FROM propiedades p
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
         (SELECT COUNT(*) FROM propiedades_galeria pg WHERE pg.propiedad_id = p.id)::int AS galeria_count,
         (SELECT COUNT(*) FROM propiedades_planos pp WHERE pp.propiedad_id = p.id)::int AS planos_count
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
