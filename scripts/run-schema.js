// scripts/run-schema.js — Ejecuta db.sql para crear tablas nuevas (barrios, columnas geom/dane_code)
import fs from "fs";
import { pool } from "../src/db.js";

const sql = fs.readFileSync(
  new URL("../src/database/db.sql", import.meta.url),
  "utf-8",
);

pool
  .query(sql)
  .then(() => {
    console.log("✅ Schema aplicado correctamente");
    pool.end();
  })
  .catch((e) => {
    console.error("❌", e.message);
    pool.end();
  });
