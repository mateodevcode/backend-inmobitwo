// src/jobs/run-once.js — ejecución manual: npm run job:busquedas -- <frecuencia>
import { pool } from "../db.js";
import { procesarBusquedas } from "../lib/busquedasGuardadas/procesador.js";

const frecuencia = process.argv[2] || "diaria";
await procesarBusquedas(frecuencia);
await pool.end();
process.exit(0);
