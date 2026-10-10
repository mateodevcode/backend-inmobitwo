// src/lib/busquedasGuardadas/procesador.js
import { pool } from "../../db.js";
import { construirWhereBusqueda } from "./filtros.js";
import { enviarEmailAlerta } from "./notificadorEmail.js";
import { enviarPushUsuario } from "./notificadorPush.js";

const MAX_ITEMS = Number(process.env.ALERTAS_MAX_ITEMS_EMAIL || 10);
const MAX_FALLOS = 5;
const DRY = process.env.ALERTAS_DRY_RUN === "true";
const LOCK_KEYS = { inmediata: 940101, diaria: 940102, semanal: 940103 };

// URL pública canónica de una vivienda (la usa irAInmueble en el frontend).
const rutaVivienda = (row) => `/inmueble/${row.id}`;

export async function procesarBusquedas(frecuencia) {
  const lockClient = await pool.connect();
  try {
    const { rows: [lk] } = await lockClient.query(
      "SELECT pg_try_advisory_lock($1) AS ok", [LOCK_KEYS[frecuencia]]);
    if (!lk.ok) { console.log(`[alertas] ${frecuencia}: ya hay una ejecución en curso`); return; }

    // Margen de 30 s: evita perder eventos de transacciones que aún no hacen commit
    const { rows: [{ corte }] } = await pool.query("SELECT NOW() - INTERVAL '30 seconds' AS corte");

    const { rows: busquedas } = await pool.query(
      `SELECT s.*, u.email, u.name
       FROM saved_searches s JOIN usuarios u ON u.id = s.usuario_id
       WHERE s.estado = 'activa' AND s.frecuencia = $1
         AND (s.canal_email OR s.canal_push)
         AND u.bloqueado IS NOT TRUE`, [frecuencia]);

    console.log(`[alertas] ${frecuencia}: ${busquedas.length} búsquedas, corte=${corte.toISOString()}`);
    let enviados = 0;

    for (const s of busquedas) {
      try {
        enviados += await procesarUna(s, corte);
      } catch (e) {
        console.error(`[alertas] búsqueda ${s.id} falló:`, e.message);
        await pool.query(
          `UPDATE saved_searches
             SET fallos_envio = fallos_envio + 1,
                 estado = CASE WHEN fallos_envio + 1 >= $2 THEN 'pausada' ELSE estado END
           WHERE id = $1`, [s.id, MAX_FALLOS]);
        // NO se avanza last_checked_at: se reintenta en la próxima ejecución
      }
    }

    if (frecuencia === "diaria") {
      await pool.query("DELETE FROM property_events WHERE created_at < NOW() - INTERVAL '90 days'");
    }
    console.log(`[alertas] ${frecuencia}: ${enviados} correos/avisos enviados`);
  } finally {
    await lockClient.query("SELECT pg_advisory_unlock($1)", [LOCK_KEYS[frecuencia]]).catch(() => {});
    lockClient.release();
  }
}

async function procesarUna(s, corte) {
  const params = [s.last_checked_at, corte, s.id, s.usuario_id];
  const { joins, where } = await construirWhereBusqueda(s.filtros, params);

  const sql = `
    WITH m AS (
      SELECT DISTINCT ON (p.id)
        e.id AS event_id, e.event_type, e.precio_anterior, e.created_at AS event_at,
        p.id, p.titulo,
        l.precio, l.operation_type_id,
        COALESCE(p.private_area, p.constructed_area) AS area,
        COALESCE(p.barrio_nombre, '') AS barrio,
        COALESCE(c.name, '') AS ciudad,
        port.url AS imagen
      FROM property_events e
      JOIN propiedades p ON p.id = e.propiedad_id
      LEFT JOIN LATERAL (
        SELECT g.url FROM propiedades_galeria g
        WHERE g.propiedad_id = p.id AND g.es_portada = TRUE
        ORDER BY CASE g.tamaño WHEN 'thumbnail' THEN 0 WHEN 'small' THEN 1
                               WHEN 'medium' THEN 2 ELSE 3 END
        LIMIT 1
      ) port ON TRUE
      ${joins}
      WHERE e.created_at > $1 AND e.created_at <= $2
        AND e.operation_type_id = l.operation_type_id
        AND p.estado = 'publicado'
        AND p.publicado_por_id <> $4
        AND NOT EXISTS (SELECT 1 FROM saved_search_notifications n
                        WHERE n.search_id = $3 AND n.event_id = e.id)
        AND ${where.join("\n        AND ")}
      ORDER BY p.id, e.created_at DESC
    )
    SELECT *, COUNT(*) OVER() AS total FROM m ORDER BY event_at DESC LIMIT ${MAX_ITEMS}`;

  const { rows } = await pool.query(sql, params);

  if (!rows.length) {
    if (!DRY) await pool.query("UPDATE saved_searches SET last_checked_at = $2 WHERE id = $1", [s.id, corte]);
    return 0;
  }

  const total = Number(rows[0].total);
  const items = rows.map((r) => ({
    ...r,
    path: rutaVivienda(r),
    ubicacion: [r.barrio, r.ciudad].filter(Boolean).join(", "),
  }));

  if (DRY) {
    console.log(`[alertas][DRY] búsqueda ${s.id} → ${s.email}: ${total} novedades`,
      items.map((i) => `${i.id}:${i.event_type}`));
    return 0;
  }

  let enviado = 0;
  const canalesOk = [];

  if (s.canal_email) {
    await enviarEmailAlerta({ busqueda: s, usuario: { name: s.name, email: s.email }, items, total });
    canalesOk.push("email"); enviado++;
  }
  if (s.canal_push) {
    try {
      const ok = await enviarPushUsuario(s.usuario_id, {
        title: "Novedades en tu búsqueda",
        body: `${total} ${total === 1 ? "novedad" : "novedades"} en "${s.nombre}"`,
        url: s.url_original,
      });
      if (ok) { canalesOk.push("push"); enviado++; }
    } catch (e) { console.error(`[alertas] push búsqueda ${s.id}:`, e.message); }
  }

  // Registrar solo lo que realmente se envió + avanzar el cursor
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const canal of canalesOk) {
      await client.query(
        `INSERT INTO saved_search_notifications (search_id, event_id, canal)
         SELECT $1, x, $3 FROM unnest($2::bigint[]) AS x
         ON CONFLICT DO NOTHING`, [s.id, items.map((i) => i.event_id), canal]);
    }
    await client.query(
      `UPDATE saved_searches SET last_checked_at = $2, last_sent_at = NOW(), fallos_envio = 0 WHERE id = $1`,
      [s.id, corte]);
    await client.query("COMMIT");
  } catch (e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }

  return enviado;
}
