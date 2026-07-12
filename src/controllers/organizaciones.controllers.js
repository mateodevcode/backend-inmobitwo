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
// GET /organizaciones/publicas  → solo aprobadas (red social / listado público)
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
// GET /organizaciones/mias  → organizaciones donde el usuario logueado
// es miembro activo (agent o agency_admin). Para el sidebar "Mi organización".
// ────────────────────────────────────────────────────────────────
export const getMisOrganizaciones = async (req, res) => {
  try {
    const usuarioId = req.usuario.id;

    const { rows } = await pool.query(
      `SELECT o.*, om.rol_en_org
       FROM organizaciones o
       JOIN organizacion_miembros om ON om.organizacion_id = o.id
       WHERE om.usuario_id = $1 AND om.estado = 'activo'
       ORDER BY o.created_at DESC`,
      [usuarioId],
    );

    res.status(200).json({
      success: true,
      message: "Tus organizaciones fueron obtenidas correctamente.",
      data: rows,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
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
// La resolución real ya la hizo el middleware resolverTenant (req.tenant),
// este controller solo la devuelve.
// ────────────────────────────────────────────────────────────────
export const resolveTenant = async (req, res) => {
  res.status(200).json({
    success: true,
    message: req.tenant
      ? "Tenant resuelto."
      : "No hay organización asociada a este host.",
    data: req.tenant,
  });
};

// ────────────────────────────────────────────────────────────────
// POST /organizaciones  → crear (queda en estado 'pendiente' de aprobación)
// El creador queda automáticamente como agency_admin de su organización.
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

    const nuevaOrganizacion = rows[0];

    // El creador queda como agency_admin de su propia organización
    await pool.query(
      `INSERT INTO organizacion_miembros (usuario_id, organizacion_id, rol_en_org)
       VALUES ($1, $2, 'agency_admin')`,
      [data.creada_por_id, nuevaOrganizacion.id],
    );

    res.status(201).json({
      success: true,
      message:
        "Organización creada correctamente. Queda pendiente de aprobación.",
      data: nuevaOrganizacion,
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
// Protegido por requiereAdminOrganizacion("id") en la ruta: solo el
// agency_admin de ESTA organización (o superadmin) puede editar.
// NO permite tocar aquí slug, estado, custom_domain, dominio_estado ni plan.
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
// PATCH /organizaciones/:id/dominio  → solicitar dominio propio
// Protegido por requiereAdminOrganizacion("id") en la ruta.
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
// PATCH /organizaciones/:id/dominio/desactivar  → SOLO superadmin
// Pausa el dominio (vuelve a pendiente_dns) SIN perder el custom_domain.
// Uso: incidencias temporales, sin que el cliente tenga que reconfigurar
// DNS de nuevo si se reactiva más tarde.
// ────────────────────────────────────────────────────────────────
export const desactivarDominioPropio = async (req, res) => {
  try {
    const { id } = req.params;

    const { rows } = await pool.query(
      `UPDATE organizaciones 
       SET dominio_estado = 'pendiente_dns' 
       WHERE id = $1 AND custom_domain IS NOT NULL 
       RETURNING *`,
      [id],
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Organización no encontrada o no tiene un dominio propio.",
      });
    }

    res.status(200).json({
      success: true,
      message: "Dominio propio desactivado (pausado).",
      data: rows[0],
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// ────────────────────────────────────────────────────────────────
// PATCH /organizaciones/:id/dominio/quitar  → SOLO superadmin
// Elimina el custom_domain por completo (vuelve a sin_dominio).
// Uso: después de correr quitar-dominio.sh en el VPS, o cuando el
// cliente decide definitivamente no usar dominio propio.
// ────────────────────────────────────────────────────────────────
export const quitarDominioPropio = async (req, res) => {
  try {
    const { id } = req.params;

    const { rows } = await pool.query(
      `UPDATE organizaciones 
       SET custom_domain = NULL, dominio_estado = 'sin_dominio' 
       WHERE id = $1 
       RETURNING *`,
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
      message:
        "Dominio propio eliminado. La organización volvió a sin_dominio.",
      data: rows[0],
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// ────────────────────────────────────────────────────────────────
// GET /organizaciones/:id/estadisticas
// Métricas básicas para el panel de la organización.
// Protegido por requiereMiembroOrganizacion("id") en la ruta:
// cualquier miembro activo (agent o agency_admin) puede verlas.
//
// NOTA: de momento solo cuenta datos de "propiedades" y "miembros".
// Cuando compartas el esquema de eventos_tracking / leads, esto se
// puede ampliar con vistas, contactos recibidos, etc.
// ────────────────────────────────────────────────────────────────
export const getEstadisticasOrganizacion = async (req, res) => {
  try {
    const { id } = req.params;

    const { rows: orgRows } = await pool.query(
      "SELECT id, nombre FROM organizaciones WHERE id = $1",
      [id],
    );
    if (orgRows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Organización no encontrada.",
      });
    }

    const { rows: propiedadesRows } = await pool.query(
      `SELECT 
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE estado = 'publicado')::int AS publicadas,
        COUNT(*) FILTER (WHERE estado = 'no_publicado')::int AS no_publicadas
       FROM propiedades
       WHERE organizacion_id = $1 AND es_de_organizacion = true`,
      [id],
    );

    const { rows: miembrosRows } = await pool.query(
      `SELECT 
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE estado = 'activo')::int AS activos,
        COUNT(*) FILTER (WHERE rol_en_org = 'agency_admin')::int AS administradores,
        COUNT(*) FILTER (WHERE rol_en_org = 'agent')::int AS agentes
       FROM organizacion_miembros
       WHERE organizacion_id = $1`,
      [id],
    );

    const { rows: ultimaPropiedadRows } = await pool.query(
      `SELECT titulo, created_at FROM propiedades 
       WHERE organizacion_id = $1 AND es_de_organizacion = true
       ORDER BY created_at DESC LIMIT 1`,
      [id],
    );

    res.status(200).json({
      success: true,
      message: "Estadísticas obtenidas correctamente.",
      data: {
        propiedades: propiedadesRows[0],
        miembros: miembrosRows[0],
        ultimaPropiedad: ultimaPropiedadRows[0] || null,
      },
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
