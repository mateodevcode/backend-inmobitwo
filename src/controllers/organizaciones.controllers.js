import { pool } from "../db.js";
// import { organizacion_validate } from "../validations/organizacion_validate.js";

export const getOrganizaciones = async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM organizaciones");
    res.status(200).json({
      success: true,
      message: "Organizaciones obtenides correctamente.",
      data: rows,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Error al obtener las organizaciones",
    });
  }
};

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

    const { rows } = await pool.query(
      "INSERT INTO organizaciones (nombre, email, telefono, website, descripcion, logo_url, logo_public_id, ciudad, provincia, estado, creada_por_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *",
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
        data.estado,
        data.creada_por_id,
      ],
    );

    res.status(201).json({
      success: true,
      message: "Organización creada correctamente.",
      data: rows,
    });
  } catch (error) {
    // if (error.code === "23505") {
    //   return res.status(400).json({
    //     success: false,
    //     error: "Email ya registrado.",
    //   });
    // }
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

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
      "estado",
      "creada_por_id",
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
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

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
