// src/controllers/crm.demandas.controllers.js — demandas y cruce del CRM.
//
// Visibilidad igual que contactos/tareas (whereEspacioPropio): personal → las
// mías; org admin → toda la org; org agent → asignadas a él o creadas por él.
// El cruce con inmuebles vive en lib/demandas/cruce.js.
import { pool } from "../db.js";
import { duenoEspacio, whereEspacioPropio, wherePropiedadesVisibles } from "../lib/crmPermisos.js";
import { noEncontrado, prohibido, solicitudInvalida } from "../lib/errores.js";
import { getOperationId } from "../lib/catalogos.js";
import {
  buscarCoincidencias,
  conteosCartera,
  demandasParaPropiedad,
} from "../lib/demandas/cruce.js";
import {
  actualizarDemandaSchema,
  coincidenciasSchema,
  crearDemandaSchema,
  filtrosDemandasSchema,
  seguimientoSchema,
  validar,
} from "../validations/demanda.schema.js";

const esAgente = (crm) => crm.tipo === "org" && crm.rolEnOrg === "agent";
const esId = (v) => /^\d+$/.test(String(v));

const SELECT_DEMANDA = `
  SELECT d.*, ot.code AS operacion,
         c.nombre AS contacto_nombre, c.telefono AS contacto_telefono,
         u.name AS agente_nombre,
         COALESCE((SELECT json_agg(ci.name ORDER BY ci.name) FROM cities ci WHERE ci.id = ANY(d.city_ids)), '[]') AS ciudades,
         COALESCE((SELECT json_agg(b.name ORDER BY b.name) FROM barrios b WHERE b.id = ANY(d.barrio_ids)), '[]') AS barrios,
         COALESCE((SELECT json_agg(pt.label_es ORDER BY pt.id) FROM property_types pt WHERE pt.id = ANY(d.property_type_ids)), '[]') AS tipos
  FROM crm_demandas d
  JOIN operation_types ot ON ot.id = d.operation_type_id
  JOIN crm_contactos c ON c.id = d.contacto_id
  LEFT JOIN usuarios u ON u.id = d.asignado_a_id`;

async function demandaEnEspacio(crm, id) {
  if (!esId(id)) throw noEncontrado("Demanda no encontrada.");
  const base = whereEspacioPropio(crm, "d");
  const { rows } = await pool.query(
    `${SELECT_DEMANDA} WHERE d.id = $${base.nextIndex} AND ${base.where}`,
    [...base.params, id],
  );
  if (!rows[0]) throw noEncontrado("Demanda no encontrada.");
  return rows[0];
}

async function contactoEnEspacio(crm, id) {
  const base = whereEspacioPropio(crm, "c");
  const { rows } = await pool.query(
    `SELECT c.id FROM crm_contactos c
     WHERE c.id = $${base.nextIndex} AND ${base.where} AND c.archivado_at IS NULL`,
    [...base.params, id],
  );
  if (!rows[0]) throw noEncontrado("Contacto no encontrado.");
}

// Agente responsable. Personal o agente de org → siempre él mismo.
async function resolverAgente(crm, solicitado) {
  if (crm.tipo === "personal" || esAgente(crm)) {
    if (solicitado && Number(solicitado) !== Number(crm.usuarioId)) {
      throw prohibido("Solo puedes asignarte demandas a ti.");
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

async function operacionId(code) {
  const id = await getOperationId(code);
  if (!id) throw solicitudInvalida("Operación no válida.");
  return id;
}

// Columnas editables (excepto operación y agente, que se resuelven aparte).
const COLUMNAS = [
  "property_type_ids", "city_ids", "barrio_ids", "estratos",
  "precio_min", "precio_max", "habitaciones_min", "banos_min",
  "parqueaderos_min", "area_min", "area_max", "notas", "avisar",
];
const VACIOS = { property_type_ids: [], city_ids: [], barrio_ids: [], estratos: [] };

// ── GET /crm/demandas ────────────────────────────────────────────
export const listarDemandas = async (req, res) => {
  const crm = req.crm;
  const f = validar(filtrosDemandasSchema, req.query);
  const base = whereEspacioPropio(crm, "d");
  const conds = [base.where];
  const params = [...base.params];
  const add = (sql, v) => {
    params.push(v);
    conds.push(sql.replace("?", `$${params.length}`));
  };
  if (f.contacto_id) add("d.contacto_id = ?", f.contacto_id);
  if (f.asignado) add("d.asignado_a_id = ?", f.asignado);
  if (f.estado) add("d.estado = ?", f.estado);
  else conds.push("d.estado <> 'cerrada'");

  const { rows } = await pool.query(
    `${SELECT_DEMANDA} WHERE ${conds.join(" AND ")}
     ORDER BY (d.estado = 'activa') DESC, d.updated_at DESC LIMIT 200`,
    params,
  );
  const conteos = await conteosCartera(pool, rows.map((r) => r.id));
  res.json({
    success: true,
    data: rows.map((r) => ({ ...r, coincidencias: conteos[String(r.id)] ?? { total: 0, nuevas: 0 } })),
  });
};

// ── GET /crm/demandas/:id ────────────────────────────────────────
export const obtenerDemanda = async (req, res) => {
  res.json({ success: true, data: await demandaEnEspacio(req.crm, req.params.id) });
};

// ── POST /crm/demandas ───────────────────────────────────────────
export const crearDemanda = async (req, res) => {
  const crm = req.crm;
  const d = validar(crearDemandaSchema, req.body);
  await contactoEnEspacio(crm, d.contacto_id);
  const opId = await operacionId(d.operacion);
  const agente = await resolverAgente(crm, d.asignado_a_id);
  const dueno = duenoEspacio(crm);

  const valores = [
    dueno.val, d.contacto_id, opId,
    ...COLUMNAS.map((c) => d[c] ?? VACIOS[c] ?? (c === "avisar" ? true : null)),
    agente, crm.usuarioId,
  ];
  const { rows } = await pool.query(
    `INSERT INTO crm_demandas
       (${dueno.col}, contacto_id, operation_type_id, ${COLUMNAS.join(", ")}, asignado_a_id, creado_por_id)
     VALUES (${valores.map((_, i) => `$${i + 1}`).join(", ")})
     RETURNING id`,
    valores,
  );
  const demanda = await demandaEnEspacio(crm, rows[0].id);
  res.status(201).json({ success: true, message: "Demanda creada.", data: demanda });
};

// ── PATCH /crm/demandas/:id ──────────────────────────────────────
export const actualizarDemanda = async (req, res) => {
  const crm = req.crm;
  const d = validar(actualizarDemandaSchema, req.body);
  const actual = await demandaEnEspacio(crm, req.params.id);

  // Coherencia de rangos con lo ya guardado (el esquema solo ve lo enviado).
  const pmin = d.precio_min !== undefined ? d.precio_min : actual.precio_min;
  const pmax = d.precio_max !== undefined ? d.precio_max : actual.precio_max;
  if (pmin != null && pmax != null && Number(pmax) < Number(pmin)) {
    throw solicitudInvalida("El precio máximo debe ser mayor o igual al mínimo.");
  }

  const sets = ["updated_at = now()"];
  const params = [];
  const put = (col, v) => {
    params.push(v);
    sets.push(`${col} = $${params.length}`);
  };
  for (const c of COLUMNAS) {
    if (d[c] !== undefined) put(c, d[c] ?? VACIOS[c] ?? null);
  }
  if (d.operacion !== undefined) put("operation_type_id", await operacionId(d.operacion));
  if (d.asignado_a_id !== undefined) put("asignado_a_id", await resolverAgente(crm, d.asignado_a_id));
  if (d.estado !== undefined) put("estado", d.estado);

  params.push(actual.id);
  await pool.query(`UPDATE crm_demandas SET ${sets.join(", ")} WHERE id = $${params.length}`, params);
  res.json({ success: true, message: "Demanda actualizada.", data: await demandaEnEspacio(crm, actual.id) });
};

// ── DELETE /crm/demandas/:id ─────────────────────────────────────
export const eliminarDemanda = async (req, res) => {
  const crm = req.crm;
  const actual = await demandaEnEspacio(crm, req.params.id);
  if (esAgente(crm) && Number(actual.creado_por_id) !== Number(crm.usuarioId)) {
    throw prohibido("Solo quien creó la demanda o un administrador puede borrarla.");
  }
  await pool.query("DELETE FROM crm_demandas WHERE id = $1", [actual.id]);
  res.json({ success: true, message: "Demanda eliminada.", data: { id: actual.id } });
};

// ── GET /crm/demandas/:id/coincidencias ──────────────────────────
export const coincidenciasDemanda = async (req, res) => {
  const crm = req.crm;
  const q = validar(coincidenciasSchema, req.query);
  const demanda = await demandaEnEspacio(crm, req.params.id);
  const data = await buscarCoincidencias(pool, demanda.id, crm, {
    alcance: q.alcance,
    incluirDescartadas: q.incluir_descartadas,
    soloNuevas: q.solo_nuevas,
  });
  res.json({ success: true, data });
};

// ── POST /crm/demandas/:id/vistas ────────────────────────────────
// Marca las coincidencias actuales como vistas (deja de mostrarlas como nuevas).
export const marcarCoincidenciasVistas = async (req, res) => {
  const demanda = await demandaEnEspacio(req.crm, req.params.id);
  await pool.query("UPDATE crm_demandas SET coincidencias_vistas_at = now() WHERE id = $1", [demanda.id]);
  res.json({ success: true, message: "Coincidencias marcadas como vistas." });
};

// El inmueble tiene que estar en la cartera del espacio o publicado en el portal.
async function propiedadSeguible(crm, propiedadId) {
  if (!esId(propiedadId)) throw noEncontrado("Inmueble no encontrado.");
  const cartera =
    crm.tipo === "personal"
      ? "(p.publicado_por_id = $2 AND p.organizacion_id IS NULL)"
      : "p.organizacion_id = $2";
  const { rows } = await pool.query(
    `SELECT p.id, p.titulo FROM propiedades p
     WHERE p.id = $1 AND (${cartera} OR p.estado = 'publicado')`,
    [propiedadId, crm.tipo === "personal" ? crm.usuarioId : crm.organizacionId],
  );
  if (!rows[0]) throw noEncontrado("Inmueble no encontrado.");
  return rows[0];
}

// ── PUT /crm/demandas/:id/propiedades/:propiedadId ───────────────
// Marca un inmueble como enviado al cliente o descartado. "Enviada" deja
// constancia en la línea de tiempo del contacto.
export const marcarSeguimiento = async (req, res) => {
  const crm = req.crm;
  const { estado } = validar(seguimientoSchema, req.body);
  const demanda = await demandaEnEspacio(crm, req.params.id);
  const prop = await propiedadSeguible(crm, req.params.propiedadId);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `INSERT INTO crm_demanda_propiedades (demanda_id, propiedad_id, estado, autor_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (demanda_id, propiedad_id)
       DO UPDATE SET estado = EXCLUDED.estado, autor_id = EXCLUDED.autor_id, updated_at = now()
       RETURNING (xmax = 0) AS nuevo, estado`,
      [demanda.id, prop.id, estado, crm.usuarioId],
    );
    if (estado === "enviada") {
      const dueno = duenoEspacio(crm);
      await client.query(
        `INSERT INTO crm_actividades (${dueno.col}, contacto_id, propiedad_id, tipo, contenido, autor_id, metadata)
         VALUES ($1, $2, $3, 'sistema', $4, $5, $6)`,
        [
          dueno.val, demanda.contacto_id, prop.id,
          `Inmueble enviado: ${prop.titulo}`.slice(0, 4000), crm.usuarioId,
          { demanda_id: Number(demanda.id) },
        ],
      );
    }
    await client.query("COMMIT");
    res.json({ success: true, message: estado === "enviada" ? "Marcado como enviado." : "Inmueble descartado.", data: rows[0] });
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
};

// ── DELETE /crm/demandas/:id/propiedades/:propiedadId ────────────
export const quitarSeguimiento = async (req, res) => {
  const demanda = await demandaEnEspacio(req.crm, req.params.id);
  if (!esId(req.params.propiedadId)) throw noEncontrado("Inmueble no encontrado.");
  await pool.query(
    "DELETE FROM crm_demanda_propiedades WHERE demanda_id = $1 AND propiedad_id = $2",
    [demanda.id, req.params.propiedadId],
  );
  res.json({ success: true, message: "Marca quitada." });
};

// ── GET /crm/propiedades/:id/demandas ────────────────────────────
// "¿A quién le ofrezco este inmueble?": demandas activas del espacio que lo
// cumplen. El inmueble tiene que ser visible en el CRM del espacio.
export const demandasDePropiedad = async (req, res) => {
  const crm = req.crm;
  if (!esId(req.params.id)) throw noEncontrado("Inmueble no encontrado.");
  const vis = wherePropiedadesVisibles(crm, "p");
  const { rows } = await pool.query(
    `SELECT p.id FROM propiedades p WHERE p.id = $${vis.nextIndex} AND ${vis.where}`,
    [...vis.params, req.params.id],
  );
  if (!rows[0]) throw noEncontrado("Inmueble no encontrado.");
  const data = await demandasParaPropiedad(pool, rows[0].id, whereEspacioPropio(crm, "d"));
  res.json({ success: true, data });
};
