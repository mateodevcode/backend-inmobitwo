// src/database/seed-geo.js
//
// Importa countries / states / cities (España + Colombia) a la base de datos.
// Ejecutar UNA SOLA VEZ (o cada vez que quieras resetear el catálogo de geografía):
//
//   node src/database/seed-geo.js
//
// Usa el mismo pool de conexión que el resto de tu app (src/database/db.js).

// correr script node --env-file .env src/database/seed-geo.js || npm run seed:geo

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { pool } from "../db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Función utilitaria para normalizar texto a slugs limpios amigables con URLs
function generateSlug(text) {
  if (!text) return "";
  return text
    .toString()
    .normalize("NFD") // Descompone caracteres con acentos
    .replace(/[\u0300-\u036f]/g, "") // Remueve los acentos completamente
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-") // Cambia espacios por guiones
    .replace(/[^a-z0-9\-]/g, "") // Remueve cualquier símbolo extraño residual
    .replace(/\-{2,}/g, "-"); // Mitiga guiones repetidos
}

function readJSON(filename) {
  const filePath = path.join(__dirname, "data", filename);
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

async function seed() {
  const countries = readJSON("seed_countries.json");
  const regions = readJSON("seed_regions.json");
  const states = readJSON("seed_states.json");
  const cities = readJSON("seed_cities.json");

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    console.log("Limpiando tablas existentes...");
    await client.query(
      "TRUNCATE cities, states, regions, countries RESTART IDENTITY CASCADE",
    );

    console.log(`Insertando ${countries.length} países...`);
    for (const c of countries) {
      await client.query(
        `INSERT INTO countries (id, name, iso2, phonecode, flag_emoji, latitude, longitude)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          c.id,
          c.name,
          c.iso2,
          c.phonecode,
          c.flag_emoji,
          c.latitude,
          c.longitude,
        ],
      );
    }

    console.log(`Insertando ${regions.length} regiones con auto-slug...`);
    for (const r of regions) {
      const regionSlug = generateSlug(r.name);
      await client.query(
        `INSERT INTO regions (id, country_id, name, slug)
         VALUES ($1, $2, $3, $4)`,
        [r.id, r.country_id, r.name, regionSlug],
      );
    }

    console.log(
      `Insertando ${states.length} provincias/departamentos con auto-slug...`,
    );
    for (const s of states) {
      const stateSlug = generateSlug(s.name);
      await client.query(
        `INSERT INTO states (id, country_id, region_id, name, slug, latitude, longitude)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [s.id, s.country_id, s.region_id, s.name, stateSlug, s.latitude, s.longitude],
      );
    }

    console.log(
      `Insertando ${cities.length} ciudades con auto-slug (en lotes)...`,
    );
    const BATCH_SIZE = 500;
    for (let i = 0; i < cities.length; i += BATCH_SIZE) {
      const batch = cities.slice(i, i + BATCH_SIZE);
      const values = [];
      const placeholders = batch
        .map((c, idx) => {
          const base = idx * 6; // 6 parámetros por fila ahora
          const citySlug = generateSlug(c.name); // 👈 Generación dinámica v3.3
          values.push(
            c.id,
            c.state_id,
            c.name,
            citySlug,
            c.latitude,
            c.longitude,
          );
          return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`;
        })
        .join(", ");

      await client.query(
        `INSERT INTO cities (id, state_id, name, slug, latitude, longitude) VALUES ${placeholders}`,
        values,
      );
      console.log(
        `  ... ${Math.min(i + BATCH_SIZE, cities.length)}/${cities.length}`,
      );
    }

    // Reajustar las secuencias de SERIAL ya que insertamos IDs explícitos
    await client.query(
      `SELECT setval('countries_id_seq', (SELECT MAX(id) FROM countries))`,
    );
    await client.query(
      `SELECT setval('regions_id_seq', (SELECT MAX(id) FROM regions))`,
    );
    await client.query(
      `SELECT setval('states_id_seq', (SELECT MAX(id) FROM states))`,
    );
    await client.query(
      `SELECT setval('cities_id_seq', (SELECT MAX(id) FROM cities))`,
    );

    await client.query("COMMIT");
    console.log(
      "✅ Importación de geografía completa con mapeo slug indexado.",
    );
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("❌ Error durante la importación, se hizo rollback:", error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
