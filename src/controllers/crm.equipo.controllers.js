// src/controllers/crm.equipo.controllers.js — equipo de una inmobiliaria:
// reparto de leads por turnos y metas mensuales con su progreso.
//
// Todo es del espacio org. Configurar reparto y metas: solo agency_admin.
// Ver metas: el admin ve a todo el equipo; un agente solo las suyas.
import { z } from "zod";
import { pool } from "../db.js";
import { normalizarTelefonoCO, wherePropiedadesVisibles } from "../lib/crmPermisos.js";
import { prohibido, solicitudInvalida } from "../lib/errores.js";
import { siguienteAgente } from "../lib/equipo/reparto.js";
import { validar } from "../validations/visita.schema.js";

const ZONA = "America/Bogota";
export const METRICAS = [
  "visitas_realizadas",
  "captaciones",
  "oportunidades_ganadas",
  "valor_ganado",
  "contactos_nuevos",
];

function soloOrg(crm) {
  if (crm.tipo !== "org") throw solicitudInvalida("Disponible solo en el espacio de una inmobiliaria.");
}
function soloAdmin(crm) {
  soloOrg(crm);
  if (crm.rolEnOrg !== "agency_admin") throw prohibido("Solo un administrador de la inmobiliaria.");
}

async function miembrosActivos(orgId) {
  const { rows } = await pool.query(
    `SELECT u.id, u.name, u.image_url, om.rol_en_org
     FROM organizacion_miembros om JOIN usuarios u ON u.id = om.usuario_id
     WHERE om.organizacion_id = $1 AND om.estado = 'activo'
     ORDER BY u.name`,
    [orgId],
  );
  return rows;
}

// ── GET /crm/equipo/reparto ──────────────────────────────────────
export const obtenerReparto = async (req, res) => {
  soloAdmin(req.crm);
  const org = req.crm.organizacionId;
  const [{ rows }, miembros, pendientes] = await Promise.all([
    pool.query("SELECT modo, agentes, ultimo_indice, updated_at FROM crm_reparto WHERE organizacion_id = $1", [org]),
    miembrosActivos(org),
    pool.query(
      `SELECT COUNT(*)::int AS n FROM leads l JOIN propiedades p ON p.id = l.propiedad_id
       WHERE p.organizacion_id = $1 AND l.estado = 'nuevo'
         AND l.created_at > now() - interval '90 days'
         AND NOT EXISTS (SELECT 1 FROM crm_contactos k WHERE k.lead_id = l.id AND k.organizacion_id = $1 AND k.archivado_at IS NULL)`,
      [org],
    ),
  ]);
  const cfg = rows[0] ?? { modo: "manual", agentes: [], ultimo_indice: -1 };
  const siguiente =
    cfg.modo === "rotacion" && cfg.agentes.length
      ? cfg.agentes[(cfg.ultimo_indice + 1) % cfg.agentes.length]
      : null;
  res.json({
    success: true,
    data: { ...cfg, siguiente_id: siguiente, miembros, leads_sin_repartir: pendientes.rows[0].n },
  });
};

const repartoSchema = z
  .object({
    modo: z.enum(["manual", "rotacion"], { message: "Modo no válido." }),
    agentes: z.array(z.coerce.number().int().positive()).max(100).transform((a) => [...new Set(a)]),
  })
  .strict();

// ── PUT /crm/equipo/reparto ──────────────────────────────────────
export const guardarReparto = async (req, res) => {
  soloAdmin(req.crm);
  const d = validar(repartoSchema, req.body);
  const org = req.crm.organizacionId;
  if (d.agentes.length) {
    const { rows } = await pool.query(
      `SELECT usuario_id FROM organizacion_miembros
       WHERE organizacion_id = $1 AND estado = 'activo' AND usuario_id = ANY($2::int[])`,
      [org, d.agentes],
    );
    if (rows.length !== d.agentes.length) throw solicitudInvalida("Hay agentes que no son miembros activos.");
  }
  if (d.modo === "rotacion" && d.agentes.length === 0) {
    throw solicitudInvalida("Elige al menos un agente para repartir por turnos.");
  }
  await pool.query(
    `INSERT INTO crm_reparto (organizacion_id, modo, agentes, ultimo_indice, actualizado_por_id, updated_at)
     VALUES ($1, $2, $3, -1, $4, now())
     ON CONFLICT (organizacion_id) DO UPDATE SET
       modo = EXCLUDED.modo, agentes = EXCLUDED.agentes,
       -- Si cambia la lista, el turno vuelve a empezar.
       ultimo_indice = CASE WHEN crm_reparto.agentes = EXCLUDED.agentes THEN crm_reparto.ultimo_indice ELSE -1 END,
       actualizado_por_id = EXCLUDED.actualizado_por_id, updated_at = now()`,
    [org, d.modo, d.agentes, req.crm.usuarioId],
  );
  res.json({ success: true, message: "Reparto guardado." });
};

// ── POST /crm/equipo/repartir-leads ──────────────────────────────
// Convierte en contactos los leads nuevos de la inmobiliaria que aún no lo
// son (últimos 90 días, hasta 50) y los asigna por turnos. Si un lead
// coincide por correo/teléfono con un contacto existente, se omite.
export const repartirLeads = async (req, res) => {
  soloAdmin(req.crm);
  const crm = req.crm;
  const org = crm.organizacionId;
  const { rows: cfg } = await pool.query("SELECT modo FROM crm_reparto WHERE organizacion_id = $1", [org]);
  if (cfg[0]?.modo !== "rotacion") throw solicitudInvalida("Activa el reparto por turnos primero.");

  const vis = wherePropiedadesVisibles(crm, "p");
  const { rows: leads } = await pool.query(
    `SELECT l.id, l.nombre, l.email, l.telefono, p.titulo AS propiedad_titulo, p.id AS propiedad_id
     FROM leads l JOIN propiedades p ON p.id = l.propiedad_id
     WHERE ${vis.where} AND l.estado = 'nuevo' AND l.created_at > now() - interval '90 days'
       AND NOT EXISTS (SELECT 1 FROM crm_contactos k WHERE k.lead_id = l.id AND k.organizacion_id = $${vis.nextIndex} AND k.archivado_at IS NULL)
     ORDER BY l.created_at
     LIMIT 50`,
    [...vis.params, org],
  );

  const repartidos = [];
  const omitidos = [];
  for (const l of leads) {
    const telefono = normalizarTelefonoCO(l.telefono);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows: dup } = await client.query(
        `SELECT id FROM crm_contactos
         WHERE organizacion_id = $1 AND archivado_at IS NULL
           AND (($2::text IS NOT NULL AND lower(email) = lower($2)) OR ($3::text IS NOT NULL AND telefono = $3))
         LIMIT 1`,
        [org, l.email || null, telefono],
      );
      if (dup[0]) {
        await client.query("ROLLBACK");
        omitidos.push({ lead_id: l.id, motivo: "Ya existe un contacto con ese correo o teléfono.", contacto_id: dup[0].id });
        continue;
      }
      const agente = (await siguienteAgente(org, client)) ?? crm.usuarioId;
      const { rows: c } = await client.query(
        `INSERT INTO crm_contactos (organizacion_id, nombre, email, telefono, origen, lead_id, asignado_a_id, creado_por_id)
         VALUES ($1, $2, $3, $4, 'portal', $5, $6, $7) RETURNING id`,
        [org, (l.nombre || l.email || `Lead ${l.id}`).slice(0, 200), l.email || null, telefono, l.id, agente, crm.usuarioId],
      );
      await client.query(
        `INSERT INTO crm_actividades (organizacion_id, contacto_id, propiedad_id, tipo, contenido, autor_id)
         VALUES ($1, $2, $3, 'sistema', $4, $5)`,
        [org, c[0].id, l.propiedad_id, `Lead del portal sobre «${l.propiedad_titulo}» asignado por turno.`.slice(0, 4000), crm.usuarioId],
      );
      await client.query("COMMIT");
      repartidos.push({ lead_id: l.id, contacto_id: c[0].id, asignado_a_id: agente });
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
  res.json({
    success: true,
    message: `${repartidos.length} ${repartidos.length === 1 ? "lead repartido" : "leads repartidos"}.`,
    data: { repartidos, omitidos },
  });
};

// ── Metas ────────────────────────────────────────────────────────
const mesSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Mes inválido (aaaa-mm).");

function mesActualBogota() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: ZONA }).format(new Date()).slice(0, 7);
}

// Logrado por usuario y métrica en el mes (límites en hora de Bogotá).
async function logrados(orgId, usuarios, mes) {
  if (!usuarios.length) return {};
  const desde = `(($3 || '-01')::date)::timestamp AT TIME ZONE '${ZONA}'`;
  const hasta = `((($3 || '-01')::date) + interval '1 month')::timestamp AT TIME ZONE '${ZONA}'`;
  const { rows } = await pool.query(
    `SELECT u.id AS usuario_id,
       (SELECT COUNT(*) FROM crm_visitas v WHERE v.organizacion_id = $1 AND v.asignado_a_id = u.id
          AND v.estado = 'realizada' AND v.inicio_at >= ${desde} AND v.inicio_at < ${hasta})::bigint AS visitas_realizadas,
       (SELECT COUNT(*) FROM crm_captaciones k WHERE k.organizacion_id = $1 AND k.asignado_a_id = u.id
          AND k.created_at >= ${desde} AND k.created_at < ${hasta})::bigint AS captaciones,
       (SELECT COUNT(*) FROM crm_oportunidades o WHERE o.organizacion_id = $1 AND o.asignado_a_id = u.id
          AND o.estado = 'ganada' AND o.cerrada_at >= ${desde} AND o.cerrada_at < ${hasta})::bigint AS oportunidades_ganadas,
       (SELECT COALESCE(SUM(o.valor), 0) FROM crm_oportunidades o WHERE o.organizacion_id = $1 AND o.asignado_a_id = u.id
          AND o.estado = 'ganada' AND o.cerrada_at >= ${desde} AND o.cerrada_at < ${hasta})::bigint AS valor_ganado,
       (SELECT COUNT(*) FROM crm_contactos c WHERE c.organizacion_id = $1 AND c.asignado_a_id = u.id
          AND c.created_at >= ${desde} AND c.created_at < ${hasta})::bigint AS contactos_nuevos
     FROM usuarios u WHERE u.id = ANY($2::int[])`,
    [orgId, usuarios, mes],
  );
  return Object.fromEntries(
    rows.map((r) => [r.usuario_id, Object.fromEntries(METRICAS.map((m) => [m, Number(r[m])]))]),
  );
}

// ── GET /crm/equipo/metas?mes=aaaa-mm ────────────────────────────
// [{ usuario_id, nombre, imagen, metricas: { m: { objetivo, logrado } }, avance }]
// avance = promedio del % logrado en las métricas con meta (tope 100 por métrica).
export const obtenerMetas = async (req, res) => {
  const crm = req.crm;
  soloOrg(crm);
  const mes = req.query.mes ? validar(mesSchema, req.query.mes) : mesActualBogota();
  const org = crm.organizacionId;
  let miembros = await miembrosActivos(org);
  if (crm.rolEnOrg !== "agency_admin") miembros = miembros.filter((m) => m.id === crm.usuarioId);

  const ids = miembros.map((m) => m.id);
  const [{ rows: metas }, log] = await Promise.all([
    pool.query(
      `SELECT usuario_id, metrica, objetivo FROM crm_metas
       WHERE organizacion_id = $1 AND mes = ($2 || '-01')::date AND usuario_id = ANY($3::int[])`,
      [org, mes, ids],
    ),
    logrados(org, ids, mes),
  ]);
  const data = miembros.map((m) => {
    const metricas = Object.fromEntries(
      METRICAS.map((k) => {
        const meta = metas.find((x) => x.usuario_id === m.id && x.metrica === k);
        return [k, { objetivo: meta ? Number(meta.objetivo) : null, logrado: log[m.id]?.[k] ?? 0 }];
      }),
    );
    const conMeta = Object.values(metricas).filter((x) => x.objetivo);
    const avance = conMeta.length
      ? Math.round(conMeta.reduce((s, x) => s + Math.min(1, x.logrado / x.objetivo), 0) / conMeta.length * 100)
      : null;
    return { usuario_id: m.id, nombre: m.name, imagen: m.image_url, rol: m.rol_en_org, metricas, avance };
  });
  data.sort((a, b) => (b.avance ?? -1) - (a.avance ?? -1) || a.nombre.localeCompare(b.nombre));
  res.json({ success: true, data: { mes, equipo: data } });
};

const guardarMetasSchema = z
  .object({
    mes: mesSchema,
    usuario_id: z.coerce.number().int().positive(),
    // null o 0 = quitar la meta de esa métrica.
    metricas: z
      .object(Object.fromEntries(METRICAS.map((m) => [m, z.union([z.null(), z.coerce.number().int().min(0).max(1e13)]).optional()])))
      .strict(),
  })
  .strict();

// ── PUT /crm/equipo/metas ────────────────────────────────────────
export const guardarMetas = async (req, res) => {
  soloAdmin(req.crm);
  const d = validar(guardarMetasSchema, req.body);
  const org = req.crm.organizacionId;
  const { rows } = await pool.query(
    "SELECT 1 FROM organizacion_miembros WHERE organizacion_id = $1 AND usuario_id = $2 AND estado = 'activo'",
    [org, d.usuario_id],
  );
  if (!rows[0]) throw solicitudInvalida("El agente no es miembro activo.");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const [metrica, objetivo] of Object.entries(d.metricas)) {
      if (objetivo === undefined) continue;
      if (!objetivo) {
        await client.query(
          "DELETE FROM crm_metas WHERE organizacion_id = $1 AND usuario_id = $2 AND mes = ($3 || '-01')::date AND metrica = $4",
          [org, d.usuario_id, d.mes, metrica],
        );
      } else {
        await client.query(
          `INSERT INTO crm_metas (organizacion_id, usuario_id, mes, metrica, objetivo, creado_por_id)
           VALUES ($1, $2, ($3 || '-01')::date, $4, $5, $6)
           ON CONFLICT (organizacion_id, usuario_id, mes, metrica)
           DO UPDATE SET objetivo = EXCLUDED.objetivo, updated_at = now()`,
          [org, d.usuario_id, d.mes, metrica, objetivo, req.crm.usuarioId],
        );
      }
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  res.json({ success: true, message: "Metas guardadas." });
};
