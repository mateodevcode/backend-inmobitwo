// src/controllers/crm.importacion.controllers.js — importar contactos e inmuebles
// desde CSV/Excel. El CRM lee el archivo y envía filas ya mapeadas a claves fijas.
// `simular: true` valida todo sin escribir (vista previa).
import { z } from "zod";
import { pool } from "../db.js";
import { duenoEspacio } from "../lib/crmPermisos.js";
import { interpretarContacto, interpretarInmueble, textoAHtml } from "../lib/importacion/filas.js";
import { sanitizarHtml } from "../lib/sanitizarHtml.js";
import { generarTitulo } from "../lib/tituloPropiedad.js";
import { getOperationId } from "../lib/catalogos.js";
import { escapeHtml } from "../utils/sanitize.js";
import { validar } from "../validations/visita.schema.js";

const MAX_CONTACTOS = 500;
const MAX_INMUEBLES = 200;
const COLOMBIA_ID = 2;

const celda = z.union([z.string().max(5000), z.number(), z.boolean(), z.null()]).optional();
const filaSchema = z.record(z.string().max(40), celda);
const numFila = (f, i) => (Number.isInteger(f.fila) && f.fila > 0 ? f.fila : i + 2);

const contactosSchema = z.object({
  filas: z.array(filaSchema).min(1, "El archivo no tiene filas.").max(MAX_CONTACTOS, `Máximo ${MAX_CONTACTOS} contactos por importación.`),
  modo: z.enum(["omitir", "actualizar"]).default("omitir"),
  autorizacion_confirmada: z.boolean().optional(),
  simular: z.boolean().default(false),
});

const inmueblesSchema = z.object({
  filas: z.array(filaSchema).min(1, "El archivo no tiene filas.").max(MAX_INMUEBLES, `Máximo ${MAX_INMUEBLES} inmuebles por importación.`),
  simular: z.boolean().default(false),
});

const resumenDe = (resultados) => {
  const r = { creados: 0, actualizados: 0, omitidos: 0, errores: 0 };
  for (const x of resultados) {
    if (x.resultado === "creado") r.creados++;
    else if (x.resultado === "actualizado") r.actualizados++;
    else if (x.resultado === "omitido") r.omitidos++;
    else r.errores++;
  }
  return r;
};

// ── POST /crm/importar/contactos ─────────────────────────────────
export const importarContactos = async (req, res) => {
  const { filas, modo, autorizacion_confirmada, simular } = validar(contactosSchema, req.body);
  if (!simular && autorizacion_confirmada !== true) {
    return res.status(400).json({
      success: false,
      error: "Confirma que tienes la autorización de tratamiento de datos (Ley 1581) de estos contactos.",
    });
  }
  const crm = req.crm;
  const esAgente = crm.tipo === "org" && crm.rolEnOrg === "agent";
  const dueno = duenoEspacio(crm);

  const interpretadas = filas.map((f, i) => ({ fila: numFila(f, i), ...interpretarContacto(f) }));

  // Duplicados existentes del espacio en una sola consulta.
  const emails = [...new Set(interpretadas.map((x) => x.valores?.email).filter(Boolean))];
  const telefonos = [...new Set(interpretadas.map((x) => x.valores?.telefono).filter(Boolean))];
  const existentes = emails.length || telefonos.length
    ? (
        await pool.query(
          `SELECT id, nombre, email, telefono, asignado_a_id, creado_por_id, etiquetas
           FROM crm_contactos
           WHERE ${dueno.col} = $1 AND archivado_at IS NULL
             AND (lower(email) = ANY($2::text[]) OR telefono = ANY($3::text[]))`,
          [dueno.val, emails, telefonos],
        )
      ).rows
    : [];
  const porEmail = new Map(existentes.filter((c) => c.email).map((c) => [c.email.toLowerCase(), c]));
  const porTel = new Map(existentes.filter((c) => c.telefono).map((c) => [c.telefono, c]));

  const vistos = new Set();
  const resultados = [];
  for (const it of interpretadas) {
    if (it.errores) {
      resultados.push({ fila: it.fila, resultado: "error", mensaje: it.errores.join(" ") });
      continue;
    }
    const v = it.valores;
    const claves = [v.email && `e:${v.email}`, v.telefono && `t:${v.telefono}`].filter(Boolean);
    if (claves.some((k) => vistos.has(k))) {
      resultados.push({ fila: it.fila, resultado: "omitido", mensaje: "Repetido en el archivo." });
      continue;
    }
    claves.forEach((k) => vistos.add(k));

    const dup = (v.email && porEmail.get(v.email)) || (v.telefono && porTel.get(v.telefono)) || null;
    if (dup) {
      const ajeno = esAgente && dup.asignado_a_id !== crm.usuarioId && dup.creado_por_id !== crm.usuarioId;
      if (modo === "omitir" || ajeno) {
        resultados.push({
          fila: it.fila,
          resultado: "omitido",
          id: dup.id,
          mensaje: ajeno ? `Ya existe (${dup.nombre}) y lo lleva otro agente.` : `Ya existe: ${dup.nombre}.`,
        });
        continue;
      }
      if (simular) {
        resultados.push({ fila: it.fila, resultado: "actualizado", id: dup.id, mensaje: `Se actualizará ${dup.nombre}.` });
        continue;
      }
      try {
        // Solo completa: no borra datos existentes con celdas vacías.
        await pool.query(
          `UPDATE crm_contactos SET
             email = COALESCE(email, $2),
             telefono = COALESCE(telefono, $3),
             tipo = CASE WHEN $4 <> 'otro' THEN $4 ELSE tipo END,
             presupuesto_min = COALESCE($5, presupuesto_min),
             presupuesto_max = COALESCE($6, presupuesto_max),
             zona_interes = COALESCE($7, zona_interes),
             etiquetas = ARRAY(SELECT DISTINCT unnest(etiquetas || $8::text[])),
             updated_at = now()
           WHERE id = $1`,
          [dup.id, v.email, v.telefono, v.tipo, v.presupuesto_min, v.presupuesto_max, v.zona_interes, v.etiquetas],
        );
        if (v.notas) await guardarNota(dueno, dup.id, v.notas, crm.usuarioId);
        resultados.push({ fila: it.fila, resultado: "actualizado", id: dup.id });
      } catch (e) {
        resultados.push({ fila: it.fila, resultado: "error", mensaje: mensajePg(e) });
      }
      continue;
    }

    if (simular) {
      resultados.push({ fila: it.fila, resultado: "creado" });
      continue;
    }
    try {
      const { rows } = await pool.query(
        `INSERT INTO crm_contactos
           (${dueno.cols}, nombre, email, telefono, tipo, origen, presupuesto_min, presupuesto_max,
            zona_interes, etiquetas, asignado_a_id, creado_por_id, autorizacion_datos_at, autorizacion_origen)
         VALUES ($1, $2, $3, $4, $5, 'importacion', $6, $7, $8, $9, $10, $11, now(), 'importacion')
         RETURNING id`,
        [
          ...dueno.vals,
          v.nombre,
          v.email,
          v.telefono,
          v.tipo,
          v.presupuesto_min,
          v.presupuesto_max,
          v.zona_interes,
          v.etiquetas,
          esAgente ? crm.usuarioId : null,
          crm.usuarioId,
        ],
      );
      if (v.notas) await guardarNota(dueno, rows[0].id, v.notas, crm.usuarioId);
      resultados.push({ fila: it.fila, resultado: "creado", id: rows[0].id });
    } catch (e) {
      resultados.push({ fila: it.fila, resultado: "error", mensaje: mensajePg(e) });
    }
  }

  res.status(simular ? 200 : 201).json({
    success: true,
    data: { simulado: simular, resumen: resumenDe(resultados), filas: resultados },
  });
};

async function guardarNota(dueno, contactoId, contenido, autorId) {
  await pool.query(
    `INSERT INTO crm_actividades (${dueno.cols}, contacto_id, tipo, contenido, autor_id, metadata)
     VALUES ($1, $2, 'nota', $3, $4, $5)`,
    [...dueno.vals, contactoId, contenido, autorId, JSON.stringify({ origen: "importacion" })],
  );
}

function mensajePg(e) {
  if (e.code === "23505") return "Ya existe un contacto con ese correo o teléfono.";
  if (e.code?.startsWith("22") || e.code?.startsWith("23")) return "Un valor no es válido para la base de datos.";
  throw e;
}

// Catálogos para interpretar inmuebles (cambian muy poco: caché de 10 min).
let cacheCatalogos = null;
let cacheHasta = 0;
async function catalogosInmuebles() {
  if (cacheCatalogos && Date.now() < cacheHasta) return cacheCatalogos;
  const [tipos, ciudades] = await Promise.all([
    pool.query("SELECT id, code, label_es FROM property_types ORDER BY id"),
    pool.query(
      `SELECT c.id, c.name, c.state_id, s.name AS state_name
       FROM cities c JOIN states s ON s.id = c.state_id
       WHERE s.country_id = $1`,
      [COLOMBIA_ID],
    ),
  ]);
  cacheCatalogos = { tipos: tipos.rows, ciudades: ciudades.rows };
  cacheHasta = Date.now() + 10 * 60 * 1000;
  return cacheCatalogos;
}

// ── POST /crm/importar/inmuebles ─────────────────────────────────
// Quedan como borradores sin publicar ni fotos; se completan en el portal.
export const importarInmuebles = async (req, res) => {
  const { filas, simular } = validar(inmueblesSchema, req.body);
  const crm = req.crm;
  const catalogos = await catalogosInmuebles();
  const interpretadas = filas.map((f, i) => ({ fila: numFila(f, i), ...interpretarInmueble(f, catalogos) }));

  const resultados = [];
  if (simular) {
    for (const it of interpretadas) {
      resultados.push(
        it.errores
          ? { fila: it.fila, resultado: "error", mensaje: it.errores.join(" ") }
          : { fila: it.fila, resultado: "creado", mensaje: tituloDe(it.valores) },
      );
    }
    return res.status(200).json({ success: true, data: { simulado: true, resumen: resumenDe(resultados), filas: resultados } });
  }

  const operaciones = { venta: await getOperationId("venta"), alquiler: await getOperationId("alquiler") };
  const { rows: residencial } = await pool.query("SELECT id FROM rental_types WHERE code = 'residencial'");
  const rentalResidencial = residencial[0]?.id ?? null;
  const esOrg = crm.tipo === "org";

  for (const it of interpretadas) {
    if (it.errores) {
      resultados.push({ fila: it.fila, resultado: "error", mensaje: it.errores.join(" ") });
      continue;
    }
    const v = it.valores;
    const opId = operaciones[v.operacion];
    const rentalId = v.operacion === "alquiler" ? rentalResidencial : null;
    const m2 = v.constructed_area ? Math.round(v.precio / v.constructed_area) : null;
    const precioM2 = m2 != null && m2 < 99_999_999 ? m2 : null;
    const descripcion = v.descripcion ? sanitizarHtml(textoAHtml(v.descripcion, escapeHtml)) : null;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query(
        `INSERT INTO propiedades (
           operation_type_id, property_type_id, rental_type_id, country_id, state_id, city_id,
           direccion, barrio_nombre, estrato, titulo, description, precio, price_per_sqm, administracion,
           constructed_area, private_area, bedroom_count, bathroom_count, parking_space_count,
           estado, listing_status, published_at, es_de_organizacion, organizacion_id, publicado_por_id,
           how_to_contact, created_at, updated_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, COALESCE($19, 0),
           'no_publicado', 'active', now(), $20, $21, $22, 'telefono_chat', now(), now()
         ) RETURNING id, titulo`,
        [
          opId,
          v.tipo.id,
          rentalId,
          COLOMBIA_ID,
          v.ciudad.state_id,
          v.ciudad.id,
          v.direccion,
          v.barrio,
          v.estrato,
          tituloDe(v),
          descripcion,
          v.precio,
          precioM2,
          v.administracion,
          v.constructed_area,
          v.private_area,
          v.bedroom_count,
          v.bathroom_count,
          v.parking_space_count,
          esOrg,
          esOrg ? crm.organizacionId : null,
          crm.usuarioId,
        ],
      );
      const id = rows[0].id;
      await client.query(
        `INSERT INTO property_listings
           (propiedad_id, operation_type_id, precio, price_per_sqm, rental_type_id, listing_status, published_at)
         VALUES ($1, $2, $3, $4, $5, 'active', now())`,
        [id, opId, v.precio, precioM2, rentalId],
      );
      await client.query(
        `INSERT INTO price_history (propiedad_id, old_price, new_price, change_type, source)
         VALUES ($1, NULL, $2, 'initial', 'user_update')`,
        [id, v.precio],
      );
      await client.query("COMMIT");
      resultados.push({ fila: it.fila, resultado: "creado", id, mensaje: rows[0].titulo });
    } catch (e) {
      await client.query("ROLLBACK");
      if (e.code?.startsWith("22") || e.code?.startsWith("23")) {
        resultados.push({ fila: it.fila, resultado: "error", mensaje: "Un valor no es válido para la base de datos." });
      } else {
        throw e;
      }
    } finally {
      client.release();
    }
  }

  res.status(201).json({ success: true, data: { simulado: false, resumen: resumenDe(resultados), filas: resultados } });
};

function tituloDe(v) {
  return generarTitulo({
    operacion: v.operacion,
    tipoLabel: v.tipo.label_es,
    direccion: v.direccion,
    ciudad: v.ciudad.name,
    departamento: v.ciudad.state_name,
  }).slice(0, 255);
}
