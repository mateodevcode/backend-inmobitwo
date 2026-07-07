import { AWS_BUCKET_SUBFOLDER } from "../config.js";
import { pool } from "../db.js";
import { deleteFromS3, uploadToS3 } from "../lib/s3AWS.js";
import { usuario_validate } from "../validations/usuario_validate.js";
import bcrypt from "bcryptjs";
import { password_validate } from "../validations/password_validate.js";

const CAMPOS_USUARIO_PERMITIDOS = [
  "id",
  "name",
  "email",
  "telefono", 
  "image_url",
  "public_id",
  "provider",
  "role",
  "bloqueado",
  "intentos_fallidos",
  "email_verificado",
  "created_at",
  "updated_at",
];
const CAMPOS_USUARIO_DEFAULT = [...CAMPOS_USUARIO_PERMITIDOS];

export const getUsuarios = async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM usuarios");
    res.status(200).json({
      success: true,
      message: "Usuarios obtenidos correctamente.",
      data: rows,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Error al obtener los usuarios",
    });
  }
};

export const createUsuario = async (req, res) => {
  try {
    const data = req.body;

    const errores = usuario_validate(data);
    if (errores.length > 0) {
      return res.status(400).json({
        success: false,
        error: errores[0],
      });
    }

    const pass = await bcrypt.hash(data.password, 10);
    const { rows } = await pool.query(
      "INSERT INTO usuarios (name, email, password) VALUES ($1, $2, $3) RETURNING *",
      [data.name, data.email, pass],
    );

    res.status(201).json({
      success: true,
      message: "Usuario creado correctamente.",
      data: rows,
    });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(400).json({
        success: false,
        error: "Email ya registrado.",
      });
    }
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

export const getUsuarioById = async (req, res) => {
  try {
    const { id } = req.params;
    const { fields } = req.query;

    let columnas = CAMPOS_USUARIO_DEFAULT;

    if (fields) {
      const solicitados = fields
        .split(",")
        .map((f) => f.trim())
        .filter(Boolean);

      // Solo se permiten campos que estén en la whitelist
      columnas = solicitados.filter((campo) =>
        CAMPOS_USUARIO_PERMITIDOS.includes(campo),
      );

      if (columnas.length === 0) {
        return res.status(400).json({
          success: false,
          error: "Ninguno de los campos solicitados es válido.",
        });
      }
    }

    const query = `SELECT ${columnas.join(", ")} FROM usuarios WHERE id = $1`;
    const { rows } = await pool.query(query, [id]);
    const usuario = rows[0];

    if (!usuario) {
      return res.status(404).json({
        success: false,
        error: "Usuario no encontrado",
      });
    }

    res.status(200).json({
      success: true,
      message: "Usuario obtenido correctamente.",
      data: usuario,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

export const updateUsuario = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        error: "ID de usuario requerido",
      });
    }

    let formDataObj = {};
    let file = null;

    const contentType = req.headers["content-type"] || "";

    if (contentType.includes("multipart/form-data")) {
      if (req.files?.imagenPrincipal?.[0]) {
        file = req.files.imagenPrincipal[0];
      }
      formDataObj = req.body;
    } else {
      formDataObj = req.body;
    }

    const { name } = formDataObj;

    // FormData manda todo como string, por eso comparamos con "true"
    const eliminarImagen =
      formDataObj.eliminarImagenPrincipal === true ||
      formDataObj.eliminarImagenPrincipal === "true";

    let uploadResponse = null;
    let oldPublicId = null;

    // ========================================
    // OBTENER public_id ACTUAL (lo necesitamos para subir nueva o eliminar)
    // ========================================
    if ((file && file.size > 0) || eliminarImagen) {
      const result = await pool.query(
        "SELECT public_id FROM usuarios WHERE id = $1",
        [id],
      );

      if (result.rows.length === 0) {
        return res
          .status(404)
          .json({ success: false, error: "Usuario no encontrado." });
      }

      oldPublicId = result.rows[0].public_id;
    }

    // ========================================
    // PROCESAR IMAGEN DE PERFIL NUEVA (tiene prioridad sobre eliminar)
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

      const carpeta = AWS_BUCKET_SUBFOLDER || "inmobitwo";
      const fileName = `${carpeta}/usuarios/avatar_${(name || "usuario")
        .toLowerCase()
        .replace(/\s+/g, "-")}_${Date.now()}.jpg`;

      const url = await uploadToS3(file.buffer, fileName, file.mimetype);
      uploadResponse = { fileId: fileName, url };
    }

    // ========================================
    // ACTUALIZAR CAMPOS
    // ========================================
    const camposPermitidos = [
      "name",
      "email",
      "password",
      "telefono",
      "provider",
      "role",
      "bloqueado",
      "intentos_fallidos",
      "email_verificado",
    ];

    const campos = [];
    const valores = [];
    let contador = 1;

    for (const campo of camposPermitidos) {
      if (formDataObj[campo] !== undefined) {
        campos.push(`${campo} = $${contador}`);
        valores.push(formDataObj[campo]);
        contador++;
      }
    }

    if (uploadResponse) {
      // Subió foto nueva → seteamos la nueva URL/public_id
      campos.push(`image_url = $${contador}`);
      valores.push(uploadResponse.url);
      contador++;
      campos.push(`public_id = $${contador}`);
      valores.push(uploadResponse.fileId);
      contador++;
    } else if (eliminarImagen) {
      // No subió foto, pero pidió eliminar la actual
      campos.push(`image_url = $${contador}`);
      valores.push(null);
      contador++;
      campos.push(`public_id = $${contador}`);
      valores.push(null);
      contador++;
    }

    if (campos.length === 0) {
      return res.status(400).json({
        success: false,
        error: "No hay campos o imagen para actualizar.",
      });
    }

    valores.push(id);
    const query = `UPDATE usuarios SET ${campos.join(", ")} WHERE id = $${contador} RETURNING *`;
    const { rows } = await pool.query(query, valores);
    const usuarioActualizado = rows[0];

    if (!usuarioActualizado) {
      return res
        .status(404)
        .json({ success: false, error: "Usuario no encontrado." });
    }

    // Borrar la imagen vieja de S3 recién cuando el UPDATE salió bien
    // (aplica tanto si subió una nueva como si solo eliminó)
    if ((uploadResponse || eliminarImagen) && oldPublicId) {
      try {
        await deleteFromS3(oldPublicId);
      } catch (err) {
        console.warn(
          "⚠️ No se pudo eliminar imagen de perfil antigua:",
          err.message,
        );
      }
    }

    res.status(200).json({
      success: true,
      message: "Usuario modificado con éxito.",
      data: usuarioActualizado,
    });
  } catch (error) {
    console.error("❌ Error en PATCH /usuarios/:id:", error);
    res.status(500).json({
      success: false,
      error: "Error interno del servidor.",
      details: error.message,
    });
  }
};

export const deleteUsuario = async (req, res) => {
  try {
    const { id } = req.params;

    const { rows } = await pool.query("SELECT * FROM usuarios WHERE id = $1", [
      id,
    ]);
    const usuario = rows[0];

    if (!usuario) {
      return res.status(404).json({
        success: false,
        error: "Usuario no encontrado.",
      });
    }

    await pool.query("DELETE FROM usuarios WHERE id = $1", [id]);

    res.status(200).json({
      success: true,
      message: "Usuario eliminado correctamente.",
      data: usuario,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Error interno del servidor: " + error.message,
    });
  }
};

export const updatePassword = async (req, res) => {
  try {
    const { id } = req.params;
    const { passwordActual, passwordNueva } = req.body;

    if (!id) {
      return res.status(400).json({
        success: false,
        error: "ID de usuario requerido",
      });
    }

    const errores = password_validate({ passwordActual, passwordNueva });
    if (errores.length > 0) {
      return res.status(400).json({
        success: false,
        error: errores[0],
      });
    }

    const result = await pool.query(
      "SELECT password FROM usuarios WHERE id = $1",
      [id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Usuario no encontrado.",
      });
    }

    const passwordGuardada = result.rows[0].password;

    const coincide = await bcrypt.compare(passwordActual, passwordGuardada);
    if (!coincide) {
      return res.status(400).json({
        success: false,
        error: "La contraseña actual no es correcta.",
      });
    }

    const nuevaHash = await bcrypt.hash(passwordNueva, 10);

    await pool.query("UPDATE usuarios SET password = $1 WHERE id = $2", [
      nuevaHash,
      id,
    ]);

    res.status(200).json({
      success: true,
      message: "Contraseña actualizada correctamente.",
    });
  } catch (error) {
    console.error("❌ Error en PATCH /usuarios/:id/password:", error);
    res.status(500).json({
      success: false,
      error: "Error interno del servidor.",
      details: error.message,
    });
  }
};
