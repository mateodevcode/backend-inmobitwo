// src/lib/equipo/reparto.js — reparto de leads por turnos (rotación).
//
// siguienteAgente() bloquea la fila de crm_reparto (FOR UPDATE) para que dos
// conversiones simultáneas nunca den el mismo turno, salta a quien ya no sea
// miembro activo y avanza ultimo_indice. Devuelve null si la org reparte en
// modo manual (o no tiene agentes válidos): el llamador asigna a quien convierte.
import { pool } from "../../db.js";

export async function siguienteAgente(organizacionId, db = pool) {
  const propio = db === pool;
  const client = propio ? await pool.connect() : db;
  try {
    if (propio) await client.query("BEGIN");
    const { rows } = await client.query(
      "SELECT modo, agentes, ultimo_indice FROM crm_reparto WHERE organizacion_id = $1 FOR UPDATE",
      [organizacionId],
    );
    const cfg = rows[0];
    if (!cfg || cfg.modo !== "rotacion" || cfg.agentes.length === 0) {
      if (propio) await client.query("COMMIT");
      return null;
    }
    const { rows: activos } = await client.query(
      `SELECT usuario_id FROM organizacion_miembros
       WHERE organizacion_id = $1 AND estado = 'activo' AND usuario_id = ANY($2::int[])`,
      [organizacionId, cfg.agentes],
    );
    const validos = new Set(activos.map((r) => r.usuario_id));
    let elegido = null;
    let indice = cfg.ultimo_indice;
    for (let i = 1; i <= cfg.agentes.length; i++) {
      const j = (cfg.ultimo_indice + i) % cfg.agentes.length;
      if (validos.has(cfg.agentes[j])) {
        elegido = cfg.agentes[j];
        indice = j;
        break;
      }
    }
    if (elegido != null) {
      await client.query("UPDATE crm_reparto SET ultimo_indice = $1 WHERE organizacion_id = $2", [indice, organizacionId]);
    }
    if (propio) await client.query("COMMIT");
    return elegido;
  } catch (e) {
    if (propio) await client.query("ROLLBACK");
    throw e;
  } finally {
    if (propio) client.release();
  }
}
