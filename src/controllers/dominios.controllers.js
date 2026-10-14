// src/controllers/dominios.controllers.js — dominios propios con ejecución
// remota en el VPS. Solo superadmin. Flujo:
// agency_admin solicita (custom_domain, pendiente_dns) → superadmin ejecuta
// desde el CRM → el script configura nginx+SSL en el VPS → si termina en 0,
// la BD pasa a activo (o a sin_dominio al dar de baja).
import dns from "node:dns/promises";
import { pool } from "../db.js";
import { ejecutarRemoto } from "../lib/sshDominios.js";
import {
  DOMINIOS_SCRIPT_DIR,
  DOMINIOS_SERVER_IP,
  DOMINIOS_SSH_HOST,
  DOMINIOS_SSH_KEY_PATH,
  DOMINIOS_SSH_USER,
} from "../config.js";

const DOMINIO_RE =
  /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;

const sshListo = () => DOMINIOS_SSH_HOST && DOMINIOS_SSH_USER && DOMINIOS_SSH_KEY_PATH;

async function anexarLog(jobId, texto) {
  await pool.query(
    "UPDATE dominios_jobs SET log = RIGHT(COALESCE(log, '') || $2, 200000), updated_at = now() WHERE id = $1",
    [jobId, texto.endsWith("\n") ? texto : `${texto}\n`],
  );
}

async function marcarJob(jobId, estado) {
  await pool.query(
    "UPDATE dominios_jobs SET estado = $2, updated_at = now() WHERE id = $1",
    [jobId, estado],
  );
}

// Solo una ejecución a la vez (el lock de certbot es global en el VPS).
async function hayEjecucionEnCurso() {
  const { rows } = await pool.query(
    "SELECT 1 FROM dominios_jobs WHERE estado IN ('pendiente', 'ejecutando') LIMIT 1",
  );
  return rows.length > 0;
}

// ── GET /dominios/solicitudes ───────────────────────────────
// Orgs aprobadas con dominio solicitado o activo + último job.
export const solicitudesDominios = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT o.id, o.nombre, o.slug, o.ciudad, o.estado, o.custom_domain,
              o.dominio_estado, o.updated_at,
              (SELECT j.estado FROM dominios_jobs j
                WHERE j.organizacion_id = o.id ORDER BY j.id DESC LIMIT 1) AS ultimo_job,
              (SELECT j.id FROM dominios_jobs j
                WHERE j.organizacion_id = o.id ORDER BY j.id DESC LIMIT 1) AS ultimo_job_id
       FROM organizaciones o
       WHERE o.estado = 'aprobada' AND o.custom_domain IS NOT NULL
       ORDER BY o.updated_at DESC`,
    );
    return res.status(200).json({ success: true, data: rows });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

// ── GET /dominios/jobs ──────────────────────────────────────
export const listarJobs = async (req, res) => {
  try {
    const limite = Math.min(100, Math.max(1, parseInt(req.query.limite, 10) || 20));
    const { rows } = await pool.query(
      `SELECT j.*, o.nombre AS organizacion_nombre
       FROM dominios_jobs j LEFT JOIN organizaciones o ON o.id = j.organizacion_id
       ORDER BY j.id DESC LIMIT $1`,
      [limite],
    );
    return res.status(200).json({ success: true, data: rows });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

// ── GET /dominios/jobs/:id ──────────────────────────────────
export const obtenerJob = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT j.*, o.nombre AS organizacion_nombre
       FROM dominios_jobs j LEFT JOIN organizaciones o ON o.id = j.organizacion_id
       WHERE j.id = $1`,
      [req.params.id],
    );
    if (!rows[0]) return res.status(404).json({ success: false, error: "Job no encontrado." });
    return res.status(200).json({ success: true, data: rows[0] });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

async function crearJob({ tipo, organizacionId, dominio, conWww, creadoPor }) {
  const { rows } = await pool.query(
    `INSERT INTO dominios_jobs (tipo, organizacion_id, dominio, con_www, estado, creado_por_id)
     VALUES ($1, $2, $3, $4, 'pendiente', $5) RETURNING *`,
    [tipo, organizacionId, dominio, conWww, creadoPor],
  );
  return rows[0];
}

// ── POST /dominios/agregar ──────────────────────────────────
export const agregarDominio = async (req, res) => {
  try {
    const { organizacion_id, dominio, con_www = true } = req.body;
    const base = String(dominio || "").toLowerCase().trim().replace(/^www\./, "");
    if (!DOMINIO_RE.test(base) || base.length > 253) {
      return res.status(400).json({ success: false, error: "Dominio inválido." });
    }
    const { rows: orgs } = await pool.query(
      "SELECT id, nombre, estado FROM organizaciones WHERE id = $1",
      [organizacion_id],
    );
    if (!orgs[0]) return res.status(404).json({ success: false, error: "Inmobiliaria no encontrada." });
    if (orgs[0].estado !== "aprobada") {
      return res.status(400).json({ success: false, error: "La inmobiliaria debe estar aprobada." });
    }
    if (await hayEjecucionEnCurso()) {
      return res.status(409).json({ success: false, error: "Ya hay una ejecución en curso. Espere a que termine." });
    }
    if (!sshListo()) {
      return res.status(503).json({ success: false, error: "Ejecución remota no configurada (DOMINIOS_SSH_*)." });
    }
    const job = await crearJob({
      tipo: "agregar",
      organizacionId: organizacion_id,
      dominio: base,
      conWww: !!con_www,
      creadoPor: req.usuario.id,
    });
    ejecutarAgregar(job.id, organizacion_id, base, !!con_www).catch((e) =>
      anexarLog(job.id, `[ERROR] Fallo interno: ${e.message}`),
    );
    return res.status(201).json({ success: true, data: job });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

async function ejecutarAgregar(jobId, organizacionId, dominio, conWww) {
  await marcarJob(jobId, "ejecutando");
  const nombres = conWww ? [dominio, `www.${dominio}`] : [dominio];
  await anexarLog(jobId, `Verificando DNS de ${nombres.join(", ")} (esperado: ${DOMINIOS_SERVER_IP})…`);
  let dnsOk = true;
  for (const n of nombres) {
    try {
      const r = await dns.resolve4(n);
      if (!r.includes(DOMINIOS_SERVER_IP)) {
        await anexarLog(jobId, `[ERROR] DNS ${n} -> ${r.join(",")} (esperado: ${DOMINIOS_SERVER_IP}). Regístrelo en Cloudflare.`);
        dnsOk = false;
      } else {
        await anexarLog(jobId, `[OK] DNS ${n} -> ${DOMINIOS_SERVER_IP}`);
      }
    } catch {
      await anexarLog(jobId, `[ERROR] ${n} no resuelve. Regístrelo en Cloudflare y reintente.`);
      dnsOk = false;
    }
  }
  if (!dnsOk) {
    await anexarLog(jobId, "[ERROR] Sin DNS no se puede emitir el certificado. Job detenido.");
    await marcarJob(jobId, "fallo");
    return;
  }
  const comando = `sudo ${DOMINIOS_SCRIPT_DIR}/agregar-dominio.sh ${dominio} ${conWww ? "--www" : "--sin-www"}`;
  await anexarLog(jobId, `Ejecutando en el VPS: ${comando}`);
  const { codigo } = await ejecutarRemoto({
    host: DOMINIOS_SSH_HOST,
    user: DOMINIOS_SSH_USER,
    keyPath: DOMINIOS_SSH_KEY_PATH,
    comando,
    onLinea: (linea) => anexarLog(jobId, linea),
  });
  if (codigo !== 0) {
    await anexarLog(jobId, `[ERROR] El script terminó con código ${codigo}. Revise el log.`);
    await marcarJob(jobId, "fallo");
    return;
  }
  await pool.query(
    "UPDATE organizaciones SET custom_domain = $2, dominio_estado = 'activo', updated_at = now() WHERE id = $1",
    [organizacionId, dominio],
  );
  await anexarLog(jobId, `[OK] https://${dominio} operativo. Estado en BD: activo.`);
  await marcarJob(jobId, "ok");
}

// ── POST /dominios/quitar ───────────────────────────────────
export const quitarDominio = async (req, res) => {
  try {
    const { organizacion_id } = req.body;
    const { rows: orgs } = await pool.query(
      "SELECT id, nombre, custom_domain FROM organizaciones WHERE id = $1",
      [organizacion_id],
    );
    if (!orgs[0]?.custom_domain) {
      return res.status(400).json({ success: false, error: "La inmobiliaria no tiene dominio." });
    }
    const base = orgs[0].custom_domain.toLowerCase().replace(/^www\./, "");
    if (await hayEjecucionEnCurso()) {
      return res.status(409).json({ success: false, error: "Ya hay una ejecución en curso. Espere a que termine." });
    }
    if (!sshListo()) {
      return res.status(503).json({ success: false, error: "Ejecución remota no configurada (DOMINIOS_SSH_*)." });
    }
    const job = await crearJob({
      tipo: "quitar",
      organizacionId: organizacion_id,
      dominio: base,
      conWww: false,
      creadoPor: req.usuario.id,
    });
    ejecutarQuitar(job.id, organizacion_id, base).catch((e) =>
      anexarLog(job.id, `[ERROR] Fallo interno: ${e.message}`),
    );
    return res.status(201).json({ success: true, data: job });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

async function ejecutarQuitar(jobId, organizacionId, dominio) {
  await marcarJob(jobId, "ejecutando");
  const comando = `sudo ${DOMINIOS_SCRIPT_DIR}/quitar-dominio.sh ${dominio}`;
  await anexarLog(jobId, `Ejecutando en el VPS: ${comando}`);
  const { codigo } = await ejecutarRemoto({
    host: DOMINIOS_SSH_HOST,
    user: DOMINIOS_SSH_USER,
    keyPath: DOMINIOS_SSH_KEY_PATH,
    comando,
    onLinea: (linea) => anexarLog(jobId, linea),
  });
  if (codigo !== 0) {
    await anexarLog(jobId, `[ERROR] El script terminó con código ${codigo}. Revise el log.`);
    await marcarJob(jobId, "fallo");
    return;
  }
  await pool.query(
    "UPDATE organizaciones SET custom_domain = NULL, dominio_estado = 'sin_dominio', updated_at = now() WHERE id = $1",
    [organizacionId],
  );
  await anexarLog(jobId, "[OK] Baja completa. Estado en BD: sin dominio.");
  await marcarJob(jobId, "ok");
}
