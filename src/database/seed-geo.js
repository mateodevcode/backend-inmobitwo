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

function readJSON(filename) {
  const filePath = path.join(__dirname, "data", filename);
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

async function seed() {
  const countries = readJSON("seed_countries.json");
  const states = readJSON("seed_states.json");
  const cities = readJSON("seed_cities.json");

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    console.log("Limpiando tablas existentes...");
    await client.query(
      "TRUNCATE cities, states, countries RESTART IDENTITY CASCADE",
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

    console.log(`Insertando ${states.length} provincias/departamentos...`);
    for (const s of states) {
      await client.query(
        `INSERT INTO states (id, country_id, name, latitude, longitude)
         VALUES ($1, $2, $3, $4, $5)`,
        [s.id, s.country_id, s.name, s.latitude, s.longitude],
      );
    }

    console.log(
      `Insertando ${cities.length} ciudades (puede tardar unos segundos)...`,
    );
    const BATCH_SIZE = 500;
    for (let i = 0; i < cities.length; i += BATCH_SIZE) {
      const batch = cities.slice(i, i + BATCH_SIZE);
      const values = [];
      const placeholders = batch
        .map((c, idx) => {
          const base = idx * 5;
          values.push(c.id, c.state_id, c.name, c.latitude, c.longitude);
          return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`;
        })
        .join(", ");

      await client.query(
        `INSERT INTO cities (id, state_id, name, latitude, longitude) VALUES ${placeholders}`,
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
      `SELECT setval('states_id_seq', (SELECT MAX(id) FROM states))`,
    );
    await client.query(
      `SELECT setval('cities_id_seq', (SELECT MAX(id) FROM cities))`,
    );

    await client.query("COMMIT");
    console.log("✅ Importación de geografía completa.");
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
