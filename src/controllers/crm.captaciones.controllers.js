// src/controllers/crm.captaciones.controllers.js — captación y propietarios.
//
// Visibilidad igual que contactos/tareas (whereEspacioPropio sobre la
// captación). Para crear, el inmueble tiene que ser visible en el CRM del
// espacio (wherePropiedadesVisibles) y el propietario, un contacto del espacio.
//
// Documentos: se suben a S3 bajo `<subcarpeta>/privado/captaciones/<id>/<uuid>`
// y solo se descargan por GET …/documentos/:docId (con sesión y permisos).
// Nunca se devuelve la clave ni una URL de S3 al cliente.
import { randomUUID } from "node:crypto";
import { pool } from "../db.js";
import { AWS_BUCKET_SUBFOLDER } from "../config.js";
import { duenoEspacio, whereEspacioPropio, wherePropiedadesVisibles } from "../lib/crmPermisos.js";
import { HttpError, noEncontrado, prohibido, solicitudInvalida } from "../lib/errores.js";
import { deleteFromS3, getFromS3, uploadPrivadoToS3 } from "../lib/s3AWS.js";
import { detectarTipoDocumento, nombreArchivoSeguro } from "../lib/archivos.js";
import {
  actualizarCaptacionSchema,
  crearCaptacionSchema,
  documentoSchema,
  filtrosCaptacionesSchema,
  validar,
} from "../validations/captacion.schema.js";

const MAX_DOCUMENTOS = 20;
const HOY_BOGOTA = "(now() AT TIME ZONE 'America/Bogota')::date";
const esId = (v) => /^\d+$/.test(String(v));
const esAgente = (crm) => crm.tipo === "org" && crm.rolEnOrg === "agent";

const SELECT_CAPTACION = `
  SELECT k.*,
         -- DATE como texto aaaa-mm-dd (pg los convertiría en Date con zona).
         -- Van después de k.* para reemplazar esas columnas en el resultado.
         to_char(k.inicio_el, 'YYYY-MM-DD') AS inicio_el,
         to_char(k.vence_el, 'YYYY-MM-DD') AS vence_el,
         (k.vence_el - ${HOY_BOGOTA})::int AS dias_para_vencer,
         p.titulo AS propiedad_titulo, p.estado AS propiedad_estado,
         (SELECT MIN(l.precio) FROM property_listings l
          WHERE l.propiedad_id = p.id AND l.listing_status = 'active') AS precio_publicado,
         c.nombre AS propietario_nombre, c.telefono AS propietario_telefono, c.email AS propietario_email,
         u.name AS agente_nombre,
         COALESCE((SELECT json_agg(json_build_object(
                     'id', dc.id, 'tipo', dc.tipo, 'nombre_archivo', dc.nombre_archivo,
                     'mime', dc.mime, 'tamano_bytes', dc.tamano_bytes, 'created_at', dc.created_at)
                   ORDER BY dc.created_at)
                   FROM crm_captacion_documentos dc WHERE dc.captacion_id = k.id), '[]') AS documentos
  FROM crm_captaciones k
  JOIN propiedades p ON p.id = k.propiedad_id
  LEFT JOIN crm_contactos c ON c.id = k.propietario_id
  LEFT JOIN usuarios u ON u.id = k.asignado_a_id`;

async function captacionEnEspacio(crm, id) {
  if (!esId(id)) throw noEncontrado("Captación no encontrada.");
  const base = whereEspacioPropio(crm, "k");
  const { rows } = await pool.query(
    `${SELECT_CAPTACION} WHERE k.id = $${base.nextIndex} AND ${base.where}`,
    [...base.params, id],
  );
  if (!rows[0]) throw noEncontrado("Captación no encontrada.");
  return rows[0];
}

async function propiedadParaCaptar(crm, id) {
  const vis = wherePropiedadesVisibles(crm, "p");
  const { rows } = await pool.query(
    `SELECT p.id, p.titulo FROM propiedades p WHERE p.id = $${vis.nextIndex} AND ${vis.where}`,
    [...vis.params, id],
  );
  if (!rows[0]) throw noEncontrado("Inmueble no encontrado en este espacio.");
  return rows[0];
}

async function contactoEnEspacio(crm, id) {
  const base = whereEspacioPropio(crm, "c");
  const { rows } = await pool.query(
    `SELECT c.id FROM crm_contactos c
     WHERE c.id = $${base.nextIndex} AND ${base.where} AND c.archivado_at IS NULL`,
    [...base.params, id],
  );
  if (!rows[0]) throw noEncontrado("Propietario no encontrado entre tus contactos.");
}

async function resolverAgente(crm, solicitado) {
  if (crm.tipo === "personal" || esAgente(crm)) {
    if (solicitado && Number(solicitado) !== Number(crm.usuarioId)) {
      throw prohibido("Solo puedes asignarte captaciones a ti.");
    }
    return crm.usuarioId;
  }
  const agente = solicitado ?? crm.usuarioId;
  const { rows } = await pool.query(
    `SELECT 1 FROM organizacion_miembros
     WHERE usuario_id = $1 AND organizacion_id = $2 AND estado = 'activo'`,
    [agente, crm.organizacionId],
  );
  if (!rows[0]) throw solicitudInvalida("El agente no es miembro activo de la inmobiliaria.");
  return agente;
}

// La comisión guarda solo el campo del tipo elegido.
function normalizarComision(tipo, porcentaje, valor) {
  return tipo === "valor"
    ? { comision_porcentaje: null, comision_valor: valor ?? null }
    : { comision_porcentaje: porcentaje ?? null, comision_valor: null };
}

const fmtFecha = (d) => (d ? String(d).slice(0, 10).split("-").reverse().join("/") : null);
const TEXTO_MANDATO = { exclusiva: "exclusiva", compartida: "compartida", sin_exclusiva: "sin exclusividad" };

// ── GET /crm/captaciones ─────────────────────────────────────────
export const listarCaptaciones = async (req, res) => {
  const crm = req.crm;
  const f = validar(filtrosCaptacionesSchema, req.query);
  const base = whereEspacioPropio(crm, "k");
  const conds = [base.where];
  const params = [...base.params];
  const add = (sql, v) => {
    params.push(v);
    conds.push(sql.replace("?", `$${params.length}`));
  };
  if (f.estado) add("k.estado = ?", f.estado);
  if (f.asignado) add("k.asignado_a_id = ?", f.asignado);
  if (f.propietario_id) add("k.propietario_id = ?", f.propietario_id);
  if (f.vence_en_dias !== undefined) {
    conds.push("k.estado IN ('en_captacion', 'activa')", "k.vence_el IS NOT NULL");
    add(`k.vence_el <= ${HOY_BOGOTA} + ?::int`, f.vence_en_dias);
  }
  const { rows } = await pool.query(
    `${SELECT_CAPTACION} WHERE ${conds.join(" AND ")}
     ORDER BY k.vence_el NULLS LAST, k.updated_at DESC LIMIT 300`,
    params,
  );
  res.json({ success: true, data: rows });
};

// ── GET /crm/captaciones/:id ─────────────────────────────────────
export const obtenerCaptacion = async (req, res) => {
  res.json({ success: true, data: await captacionEnEspacio(req.crm, req.params.id) });
};

// ── GET /crm/propiedades/:id/captacion ───────────────────────────
// La captación del inmueble (o null si aún no tiene).
export const captacionDePropiedad = async (req, res) => {
  const crm = req.crm;
  if (!esId(req.params.id)) throw noEncontrado("Inmueble no encontrado.");
  await propiedadParaCaptar(crm, req.params.id);
  const base = whereEspacioPropio(crm, "k");
  const { rows } = await pool.query(
    `${SELECT_CAPTACION} WHERE k.propiedad_id = $${base.nextIndex} AND ${base.where}`,
    [...base.params, req.params.id],
  );
  res.json({ success: true, data: rows[0] ?? null });
};

// ── POST /crm/captaciones ────────────────────────────────────────
export const crearCaptacion = async (req, res) => {
  const crm = req.crm;
  const d = validar(crearCaptacionSchema, req.body);
  const prop = await propiedadParaCaptar(crm, d.propiedad_id);
  if (d.propietario_id) await contactoEnEspacio(crm, d.propietario_id);
  const agente = await resolverAgente(crm, d.asignado_a_id);
  const dueno = duenoEspacio(crm);
  const comisionTipo = d.comision_tipo ?? "porcentaje";
  const com = normalizarComision(comisionTipo, d.comision_porcentaje, d.comision_valor);

  const client = await pool.connect();
  let id;
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `INSERT INTO crm_captaciones
         (${dueno.col}, propiedad_id, propietario_id, tipo_mandato, inicio_el, vence_el,
          comision_tipo, comision_porcentaje, comision_valor, precio_propietario, estado, notas,
          asignado_a_id, creado_por_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       ON CONFLICT (propiedad_id) DO NOTHING
       RETURNING id`,
      [
        dueno.val, prop.id, d.propietario_id ?? null, d.tipo_mandato ?? "sin_exclusiva",
        d.inicio_el ?? null, d.vence_el ?? null, comisionTipo, com.comision_porcentaje,
        com.comision_valor, d.precio_propietario ?? null, d.estado ?? "activa", d.notas ?? null,
        agente, crm.usuarioId,
      ],
    );
    if (!rows[0]) throw new HttpError(409, "Este inmueble ya tiene una captación. Edítala.");
    id = rows[0].id;
    if (d.propietario_id) {
      const mandato = TEXTO_MANDATO[d.tipo_mandato ?? "sin_exclusiva"];
      const vence = d.vence_el ? `, vence el ${fmtFecha(d.vence_el)}` : "";
      await client.query(
        `INSERT INTO crm_actividades (${dueno.col}, contacto_id, propiedad_id, tipo, contenido, autor_id, metadata)
         VALUES ($1, $2, $3, 'sistema', $4, $5, $6)`,
        [
          dueno.val, d.propietario_id, prop.id,
          `Captación de «${prop.titulo}»: mandato ${mandato}${vence}.`.slice(0, 4000),
          crm.usuarioId, { captacion_id: Number(id) },
        ],
      );
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  res.status(201).json({ success: true, message: "Captación registrada.", data: await captacionEnEspacio(crm, id) });
};

// ── PATCH /crm/captaciones/:id ───────────────────────────────────
export const actualizarCaptacion = async (req, res) => {
  const crm = req.crm;
  const d = validar(actualizarCaptacionSchema, req.body);
  const actual = await captacionEnEspacio(crm, req.params.id);

  // actual.inicio_el / vence_el ya vienen como texto aaaa-mm-dd (ver SELECT_CAPTACION).
  const inicio = d.inicio_el !== undefined ? d.inicio_el : actual.inicio_el;
  const vence = d.vence_el !== undefined ? d.vence_el : actual.vence_el;
  if (inicio && vence && vence < inicio) throw solicitudInvalida("El vencimiento debe ser posterior al inicio.");
  if (d.propietario_id) await contactoEnEspacio(crm, d.propietario_id);

  const sets = ["updated_at = now()"];
  const params = [];
  const put = (col, v) => {
    params.push(v);
    sets.push(`${col} = $${params.length}`);
  };
  for (const col of ["propietario_id", "tipo_mandato", "inicio_el", "vence_el", "precio_propietario", "estado", "notas"]) {
    if (d[col] !== undefined) put(col, d[col]);
  }
  if (d.comision_tipo !== undefined || d.comision_porcentaje !== undefined || d.comision_valor !== undefined) {
    const tipo = d.comision_tipo ?? actual.comision_tipo;
    const com = normalizarComision(
      tipo,
      d.comision_porcentaje !== undefined ? d.comision_porcentaje : actual.comision_porcentaje,
      d.comision_valor !== undefined ? d.comision_valor : actual.comision_valor,
    );
    put("comision_tipo", tipo);
    put("comision_porcentaje", com.comision_porcentaje);
    put("comision_valor", com.comision_valor);
  }
  if (d.asignado_a_id !== undefined) put("asignado_a_id", await resolverAgente(crm, d.asignado_a_id));

  params.push(actual.id);
  await pool.query(`UPDATE crm_captaciones SET ${sets.join(", ")} WHERE id = $${params.length}`, params);
  res.json({ success: true, message: "Captación actualizada.", data: await captacionEnEspacio(crm, actual.id) });
};

// Borrar objetos de S3 sin tumbar la petición: un huérfano se registra y ya.
async function borrarDeS3(keys) {
  for (const k of keys) {
    try {
      await deleteFromS3(k);
    } catch (e) {
      console.error("[captaciones] no se pudo borrar de S3:", k, e?.message ?? e);
    }
  }
}

// ── DELETE /crm/captaciones/:id ──────────────────────────────────
export const eliminarCaptacion = async (req, res) => {
  const crm = req.crm;
  const actual = await captacionEnEspacio(crm, req.params.id);
  if (esAgente(crm) && Number(actual.creado_por_id) !== Number(crm.usuarioId)) {
    throw prohibido("Solo quien registró la captación o un administrador puede borrarla.");
  }
  const { rows } = await pool.query(
    "SELECT s3_key FROM crm_captacion_documentos WHERE captacion_id = $1",
    [actual.id],
  );
  await pool.query("DELETE FROM crm_captaciones WHERE id = $1", [actual.id]);
  await borrarDeS3(rows.map((r) => r.s3_key));
  res.json({ success: true, message: "Captación eliminada.", data: { id: actual.id } });
};

// ── POST /crm/captaciones/:id/documentos (multipart: archivo, tipo) ──
export const subirDocumento = async (req, res) => {
  const crm = req.crm;
  const { tipo } = validar(documentoSchema, req.body);
  const captacion = await captacionEnEspacio(crm, req.params.id);
  if (!req.file) throw solicitudInvalida("Adjunta un archivo (campo 'archivo').");
  if (captacion.documentos.length >= MAX_DOCUMENTOS) {
    throw solicitudInvalida(`Máximo ${MAX_DOCUMENTOS} documentos por captación.`);
  }
  const real = detectarTipoDocumento(req.file.buffer);
  if (!real) throw solicitudInvalida("Formato no admitido. Sube un PDF, JPG, PNG o WEBP.");

  const nombre = nombreArchivoSeguro(req.file.originalname, real.ext);
  const key = `${AWS_BUCKET_SUBFOLDER}/privado/captaciones/${captacion.id}/${randomUUID()}.${real.ext}`;
  await uploadPrivadoToS3(req.file.buffer, key, real.mime);
  try {
    const { rows } = await pool.query(
      `INSERT INTO crm_captacion_documentos (captacion_id, tipo, nombre_archivo, s3_key, mime, tamano_bytes, subido_por_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, tipo, nombre_archivo, mime, tamano_bytes, created_at`,
      [captacion.id, tipo, nombre, key, real.mime, req.file.size, crm.usuarioId],
    );
    res.status(201).json({ success: true, message: "Documento subido.", data: rows[0] });
  } catch (e) {
    await borrarDeS3([key]); // no dejar el archivo huérfano
    throw e;
  }
};

async function documentoDe(captacionId, docId) {
  if (!esId(docId)) throw noEncontrado("Documento no encontrado.");
  const { rows } = await pool.query(
    "SELECT * FROM crm_captacion_documentos WHERE id = $1 AND captacion_id = $2",
    [docId, captacionId],
  );
  if (!rows[0]) throw noEncontrado("Documento no encontrado.");
  return rows[0];
}

// ── GET /crm/captaciones/:id/documentos/:docId ───────────────────
// Descarga a través del backend (el cliente nunca ve la URL de S3).
export const descargarDocumento = async (req, res) => {
  const captacion = await captacionEnEspacio(req.crm, req.params.id);
  const doc = await documentoDe(captacion.id, req.params.docId);
  let obj;
  try {
    obj = await getFromS3(doc.s3_key);
  } catch (e) {
    console.error("[captaciones] lectura S3:", e?.message ?? e);
    throw new HttpError(502, "No se pudo obtener el documento.");
  }
  const ascii = doc.nombre_archivo.replace(/[^\x20-\x7e]/g, "_");
  res.set({
    "Content-Type": doc.mime,
    "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(doc.nombre_archivo)}`,
    "Cache-Control": "private, no-store",
    ...(obj.contentLength ? { "Content-Length": String(obj.contentLength) } : {}),
  });
  obj.body.on("error", (e) => {
    console.error("[captaciones] stream S3:", e?.message ?? e);
    res.destroy(e);
  });
  obj.body.pipe(res);
};

// ── DELETE /crm/captaciones/:id/documentos/:docId ────────────────
export const eliminarDocumento = async (req, res) => {
  const captacion = await captacionEnEspacio(req.crm, req.params.id);
  const doc = await documentoDe(captacion.id, req.params.docId);
  await pool.query("DELETE FROM crm_captacion_documentos WHERE id = $1", [doc.id]);
  await borrarDeS3([doc.s3_key]);
  res.json({ success: true, message: "Documento eliminado.", data: { id: doc.id } });
};
