import { pool } from "../db.js";
// import { organizacion_validate } from "../validations/organizacion_validate.js";

// ────────────────────────────────────────────────────────────────
// Helper: genera un slug a partir del nombre y garantiza que sea único
// "Inmobiliaria Oviedo S.L." -> "inmobiliaria-oviedo-sl"
// Si ya existe, prueba "-2", "-3", etc.
// ────────────────────────────────────────────────────────────────
const generarSlugBase = (nombre) => {
  return nombre
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // quita acentos
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "") // quita caracteres especiales
    .replace(/\s+/g, "-") // espacios -> guiones
    .replace(/-+/g, "-") // colapsa guiones repetidos
    .replace(/^-|-$/g, ""); // quita guiones al inicio/final
};

const generarSlugUnico = async (nombre) => {
  const base = generarSlugBase(nombre) || "inmobiliaria";
  let slug = base;
  let contador = 2;

  while (true) {
    const { rows } = await pool.query(
      "SELECT id FROM organizaciones WHERE slug = $1",
      [slug],
    );
    if (rows.length === 0) return slug;
    slug = `${base}-${contador}`;
    contador++;
  }
};

// ────────────────────────────────────────────────────────────────
// GET /organizaciones  → listado COMPLETO (uso: panel superadmin)
// Incluye pendientes, aprobadas y suspendidas.
// ────────────────────────────────────────────────────────────────
export const getOrganizaciones = async (req, res) => {
  try {
    const { estado } = req.query;

    let query = "SELECT * FROM organizaciones";
    const values = [];

    if (estado) {
      query += " WHERE estado = $1";
      values.push(estado);
    }

    query += " ORDER BY created_at DESC";

    const { rows } = await pool.query(query, values);
    res.status(200).json({
      success: true,
      message: "Organizaciones obtenidas correctamente.",
      data: rows,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Error al obtener las organizaciones",
    });
  }
};

// ────────────────────────────────────────────────────────────────
// GET /organizaciones/publicas  → solo aprobadas (uso: red social / listado público)
// ────────────────────────────────────────────────────────────────
export const getOrganizacionesPublicas = async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM organizaciones WHERE estado = 'aprobada' ORDER BY created_at DESC",
    );
    res.status(200).json({
      success: true,
      message: "Organizaciones públicas obtenidas correctamente.",
      data: rows,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Error al obtener las organizaciones",
    });
  }
};

// ────────────────────────────────────────────────────────────────
// GET /organizaciones/slug/:slug  → para /inmobiliarias/:slug en el front
// ────────────────────────────────────────────────────────────────
export const getOrganizacionBySlug = async (req, res) => {
  try {
    const { slug } = req.params;

    const { rows } = await pool.query(
      "SELECT * FROM organizaciones WHERE slug = $1 AND estado = 'aprobada'",
      [slug],
    );
    const organizacion = rows[0];

    if (!organizacion) {
      return res.status(404).json({
        success: false,
        error: "Organización no encontrada.",
      });
    }

    res.status(200).json({
      success: true,
      message: "Organización obtenida correctamente.",
      data: organizacion,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

// ────────────────────────────────────────────────────────────────
// GET /organizaciones/resolve-tenant?host=www.inmobiliariaoviedo.com
// El frontend llama esto al arrancar, pasando window.location.hostname.
// Devuelve la organización si el host coincide con un dominio propio ACTIVO.
// Si no hay coincidencia, data = null (el front cae a modo "red social").
// ────────────────────────────────────────────────────────────────
export const resolveTenant = async (req, res) => {
  try {
    const { host } = req.query;

    if (!host) {
      return res.status(400).json({
        success: false,
        error: "El parámetro host es requerido.",
      });
    }

    const { rows } = await pool.query(
      `SELECT * FROM organizaciones 
       WHERE custom_domain = $1 
         AND dominio_estado = 'activo' 
         AND estado = 'aprobada'`,
      [host],
    );

    res.status(200).json({
      success: true,
      message: rows[0]
        ? "Tenant resuelto."
        : "No hay organización asociada a este host.",
      data: rows[0] || null,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

// ────────────────────────────────────────────────────────────────
// POST /organizaciones  → crear (queda en estado 'pendiente' de aprobación)
// ────────────────────────────────────────────────────────────────
export const createOrganizacion = async (req, res) => {
  try {
    const data = req.body;

    // const errores = organizacion_validate(data);
    // if (errores.length > 0) {
    //   return res.status(400).json({
    //     success: false,
    //     error: errores[0],
    //   });
    // }

    if (!data.nombre) {
      return res.status(400).json({
        success: false,
        error: "El nombre es requerido.",
      });
    }
    if (!data.creada_por_id) {
      return res.status(400).json({
        success: false,
        error: "creada_por_id es requerido.",
      });
    }

    const slug = await generarSlugUnico(data.nombre);

    const { rows } = await pool.query(
      `INSERT INTO organizaciones 
        (nombre, email, telefono, website, descripcion, logo_url, logo_public_id, ciudad, provincia, slug, creada_por_id) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) 
       RETURNING *`,
      [
        data.nombre,
        data.email,
        data.telefono,
        data.website,
        data.descripcion,
        data.logo_url,
        data.logo_public_id,
        data.ciudad,
        data.provincia,
        slug,
        data.creada_por_id,
      ],
    );

    res.status(201).json({
      success: true,
      message:
        "Organización creada correctamente. Queda pendiente de aprobación.",
      data: rows[0],
    });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(400).json({
        success: false,
        error: "Ya existe una organización con ese nombre o email.",
      });
    }
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

// ────────────────────────────────────────────────────────────────
// GET /organizaciones/:id
// ────────────────────────────────────────────────────────────────
export const getOrganizacionById = async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(
      "SELECT * FROM organizaciones WHERE id = $1",
      [id],
    );
    const organizacion = rows[0];

    if (!organizacion) {
      return res.status(404).json({
        success: false,
        error: "organización no encontrada",
      });
    }

    res.status(200).json({
      success: true,
      message: "organización obtenida correctamente.",
      data: organizacion,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

// ────────────────────────────────────────────────────────────────
// PATCH /organizaciones/:id  → edición de datos "de perfil"
// OJO: NO permite tocar aquí slug, estado, custom_domain, dominio_estado ni plan.
// Esos campos tienen sus propios endpoints (más abajo) por seguridad.
// ────────────────────────────────────────────────────────────────
export const updateOrganizacion = async (req, res) => {
  try {
    const { id } = req.params;
    const data = req.body;

    const campos = [];
    const valores = [];
    let contador = 1;

    const camposPermitidos = [
      "nombre",
      "email",
      "telefono",
      "website",
      "descripcion",
      "logo_url",
      "logo_public_id",
      "ciudad",
      "provincia",
    ];

    for (const campo of camposPermitidos) {
      if (data[campo] !== undefined) {
        campos.push(`${campo} = $${contador}`);
        valores.push(data[campo]);
        contador++;
      }
    }

    if (campos.length === 0) {
      return res.status(400).json({
        success: false,
        error: "No hay campos para actualizar.",
      });
    }

    valores.push(id);
    const query = `UPDATE organizaciones SET ${campos.join(", ")} WHERE id = $${contador} RETURNING *`;
    const { rows } = await pool.query(query, valores);
    const organizacionActualizada = rows[0];

    if (!organizacionActualizada) {
      return res.status(404).json({
        success: false,
        error: "Organización no encontrada.",
      });
    }

    res.status(200).json({
      success: true,
      message: "Organización modificada con éxito.",
      data: organizacionActualizada,
    });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(400).json({
        success: false,
        error: "Ya existe una organización con ese nombre o email.",
      });
    }
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

// ────────────────────────────────────────────────────────────────
// PATCH /organizaciones/:id/aprobar  → superadmin aprueba la organización
// ────────────────────────────────────────────────────────────────
export const aprobarOrganizacion = async (req, res) => {
  try {
    const { id } = req.params;

    const { rows } = await pool.query(
      "UPDATE organizaciones SET estado = 'aprobada' WHERE id = $1 RETURNING *",
      [id],
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Organización no encontrada.",
      });
    }

    res.status(200).json({
      success: true,
      message: "Organización aprobada.",
      data: rows[0],
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

// ────────────────────────────────────────────────────────────────
// PATCH /organizaciones/:id/suspender  → superadmin suspende la organización
// ────────────────────────────────────────────────────────────────
export const suspenderOrganizacion = async (req, res) => {
  try {
    const { id } = req.params;

    const { rows } = await pool.query(
      "UPDATE organizaciones SET estado = 'suspendida' WHERE id = $1 RETURNING *",
      [id],
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Organización no encontrada.",
      });
    }

    res.status(200).json({
      success: true,
      message: "Organización suspendida.",
      data: rows[0],
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

// ────────────────────────────────────────────────────────────────
// PATCH /organizaciones/:id/dominio  → la organización solicita su dominio propio
// Body: { custom_domain: "www.inmobiliariaoviedo.com" }
// Pasa a dominio_estado = 'pendiente_dns' hasta que el superadmin lo active
// (una vez verificado el DNS y emitido el SSL con certbot en el VPS).
// ────────────────────────────────────────────────────────────────
export const solicitarDominioPropio = async (req, res) => {
  try {
    const { id } = req.params;
    const { custom_domain } = req.body;

    if (!custom_domain) {
      return res.status(400).json({
        success: false,
        error: "custom_domain es requerido.",
      });
    }

    const { rows } = await pool.query(
      `UPDATE organizaciones 
       SET custom_domain = $1, dominio_estado = 'pendiente_dns' 
       WHERE id = $2 
       RETURNING *`,
      [custom_domain.toLowerCase().trim(), id],
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Organización no encontrada.",
      });
    }

    res.status(200).json({
      success: true,
      message:
        "Dominio propio solicitado. Queda pendiente de verificación DNS y activación.",
      data: rows[0],
    });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(400).json({
        success: false,
        error: "Ese dominio ya está en uso por otra organización.",
      });
    }
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

// ────────────────────────────────────────────────────────────────
// PATCH /organizaciones/:id/dominio/activar  → SOLO superadmin
// Se llama cuando ya verificaste el DNS y corriste certbot en el VPS.
// ────────────────────────────────────────────────────────────────
export const activarDominioPropio = async (req, res) => {
  try {
    const { id } = req.params;

    const { rows } = await pool.query(
      `UPDATE organizaciones 
       SET dominio_estado = 'activo' 
       WHERE id = $1 AND custom_domain IS NOT NULL 
       RETURNING *`,
      [id],
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        error:
          "Organización no encontrada o no tiene un dominio propio solicitado.",
      });
    }

    res.status(200).json({
      success: true,
      message: "Dominio propio activado.",
      data: rows[0],
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

// ────────────────────────────────────────────────────────────────
// DELETE /organizaciones/:id
// ────────────────────────────────────────────────────────────────
export const deleteOrganizacion = async (req, res) => {
  try {
    const { id } = req.params;

    const { rows } = await pool.query(
      "SELECT * FROM organizaciones WHERE id = $1",
      [id],
    );
    const organizacion = rows[0];

    if (!organizacion) {
      return res.status(404).json({
        success: false,
        error: "organización no encontrada.",
      });
    }

    await pool.query("DELETE FROM organizaciones WHERE id = $1", [id]);

    res.status(200).json({
      success: true,
      message: "organización eliminada correctamente.",
      data: organizacion,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Error interno del servidor: " + error.message,
    });
  }
};
