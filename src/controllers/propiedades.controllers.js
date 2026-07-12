import { AWS_BUCKET_SUBFOLDER } from "../config.js";
import { pool } from "../db.js";
import { deleteFromS3, uploadToS3 } from "../lib/s3AWS.js";
import { tiempoRelativo } from "../utils/tiempoRelativo.js";
import { getCityById, getStateById } from "../lib/locations.js";

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
      error: error,
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

    const { titulo, estado, publicado_por_id } = req.body;
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
    if (!titulo) {
      return res
        .status(400)
        .json({ success: false, error: "El título es requerido." });
    }
    if (!publicado_por_id) {
      return res
        .status(400)
        .json({ success: false, error: "publicado_por_id es requerido." });
    }
    if (!file) {
      return res
        .status(400)
        .json({ success: false, error: "La imagen principal es requerida." });
    }

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
      return res
        .status(400)
        .json({ success: false, error: "La imagen debe pesar menos de 10MB." });
    }

    const carpeta = AWS_BUCKET_SUBFOLDER || "inmobitwo";
    const fileName = `${carpeta}/propiedades/imagenes_principal/propiedad_${titulo
      .toLowerCase()
      .replace(/\s+/g, "-")}_${Date.now()}.jpg`;

    const url = await uploadToS3(file.buffer, fileName, file.mimetype);
    const uploadResponse = { fileId: fileName, url };

    // ========================================
    // PROCESAR GALERÍA
    // ========================================
    let imagenesGaleria = [];
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
      parseInt(publicado_por_id),
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

    return res.status(201).json({
      success: true,
      message: "Propiedad creada.",
      data: { ...nuevaPropiedad, galeria: imagenesGaleria },
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

    res.status(200).json({
      success: true,
      message: "Propiedad obtenida.",
      data: {
        ...propiedad,
        galeria: galeria || [],
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

    if (!id) {
      return res.status(400).json({
        success: false,
        error: "ID de propiedad requerido",
      });
    }

    let formDataObj = {};
    let file = null;
    let files = [];

    const contentType = req.headers["content-type"] || "";

    if (contentType.includes("multipart/form-data")) {
      if (req.files?.imagenPrincipal?.[0]) {
        file = req.files.imagenPrincipal[0];
      }
      if (req.files?.galeria) {
        files = req.files.galeria;
      }
      formDataObj = req.body;
    } else {
      formDataObj = req.body;
    }

    const { titulo, estado } = formDataObj;

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

    let uploadResponse = null;
    let oldPublicId = null;

    // ========================================
    // PROCESAR IMAGEN PRINCIPAL
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

      const carpeta = AWS_BUCKET_SUBFOLDER || "inmobitwo";
      const fileName = `${carpeta}/propiedades/imagenes_principal/propiedad_${(
        titulo || "imagen"
      )
        .toLowerCase()
        .replace(/\s+/g, "-")}_${Date.now()}.jpg`;

      const url = await uploadToS3(file.buffer, fileName, file.mimetype);
      uploadResponse = { fileId: fileName, url };
    }

    // ========================================
    // PROCESAR GALERÍA NUEVAS
    // ========================================
    let imagenesGaleria = [];
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
      imagesToDelete.length === 0
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

    return res.status(200).json({
      success: true,
      message: "Propiedad actualizada.",
      data: {
        ...propiedadActualizada.rows[0],
        galeria: galeriaActualizada.rows,
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
    const { id_usuario } = req.body;

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

    if (propiedad.publicado_por_id !== id_usuario) {
      return res.status(404).json({
        success: false,
        error: "Usuario no autorizado para eliminar la propiedad",
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

    const galeriaDeleteResult = await pool.query(
      "DELETE FROM propiedades_galeria WHERE propiedad_id = $1",
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
    const {
      tipo,
      operacion,
      country_id,
      state_id,
      city_id,
      direccion,
      numero_direccion,
      latitude,
      longitude,
      estado,
      publicado_por_id,
    } = req.body;

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
    if (!publicado_por_id) {
      return res
        .status(400)
        .json({ success: false, error: "publicado_por_id es requerido." });
    }
    if (!city_id || !state_id) {
      return res
        .status(400)
        .json({ success: false, error: "city_id y state_id son requeridos." });
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
        titulo, estado, es_de_organizacion, organizacion_id, publicado_por_id,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
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
      estado || "disponible",
      es_de_organizacion || false,
      organizacion_id,
      parseInt(publicado_por_id),
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
    const { id } = req.query;

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

        return {
          ...propiedad,
          galeria: galeria || [],
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
