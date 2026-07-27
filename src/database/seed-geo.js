// src/database/seed-geo.js
//
// Semilla completa del catálogo geográfico de Colombia.
// Importa: países, regiones, estados (deptos), ciudades y barrios
// con geometría PostGIS y códigos DANE.
//
//   node --env-file .env src/database/seed-geo.js    o   npm run seed:geo
//
// Requisito previo: ejecutar db.sql (tablas + extensiones PostGIS)
// Archivos de datos en src/database/data/

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { pool } from "../db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function readJSON(filename) {
  const filePath = path.join(__dirname, "data", filename);
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function generateSlug(text) {
  if (!text) return "";
  return text
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9\-]/g, "")
    .replace(/\-{2,}/g, "-");
}

// Mapea nombre de departamento del GeoJSON a nombre en la DB
function normalizeDeptName(name) {
  const overrides = {
    "BOGOTÁ, D.C.": "Bogotá D.C.",
    "SAN ANDRÉS, PROVIDENCIA Y SANTA CATALINA": "San Andrés, Providencia y Santa Catalina",
  };
  return overrides[name] || name;
}

function normalizeName(n) {
  return (n || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[,.]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// Mapeo de nombres DB → nombres GeoJSON (cuando difieren)
const DB_TO_GEOJSON_NAME = {
  "san andres providencia y santa catalina": "archipielago de san andres providencia y santa catalina",
  "bogota d c": "bogota d c",
};

// Mapeo de nombres GeoJSON → nombres DB (para ciudades)
const CITY_NAME_OVERRIDES = {
  "san jose de cucuta": "cucuta",
};

async function seed() {
  const countries = readJSON("seed_countries.json");
  const regions = readJSON("seed_regions.json");
  const states = readJSON("seed_states.json");
  const cities = readJSON("seed_cities.json");
  const barrios = readJSON("seed_barrios.json");
  const dptoGeo = readJSON("co_2018_MGN_DPTO_POLITICO.geojson");
  const mpioGeo = readJSON("co_2018_MGN_MPIO_POLITICO.geojson");

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // =====================================================================
    // 1. Limpiar todo
    // =====================================================================
    console.log("Limpiando tablas existentes...");
    await client.query(
      "TRUNCATE barrios, cities, states, regions, countries RESTART IDENTITY CASCADE",
    );

    // =====================================================================
    // 2. Países
    // =====================================================================
    console.log(`Insertando ${countries.length} países...`);
    for (const c of countries) {
      await client.query(
        `INSERT INTO countries (id, name, iso2, phonecode, flag_emoji, latitude, longitude)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [c.id, c.name, c.iso2, c.phonecode, c.flag_emoji, c.latitude, c.longitude],
      );
    }

    // =====================================================================
    // 3. Regiones
    // =====================================================================
    console.log(`Insertando ${regions.length} regiones...`);
    for (const r of regions) {
      await client.query(
        `INSERT INTO regions (id, country_id, name, slug)
         VALUES ($1, $2, $3, $4)`,
        [r.id, r.country_id, r.name, generateSlug(r.name)],
      );
    }

    // =====================================================================
    // 4. Estados (departamentos) con DANE + geometría
    // =====================================================================
    console.log(`Insertando ${states.length} departamentos con geometría...`);

    // Mapa: nombre normalizado → { dane_code, geometry }
    const dptoDaneGeo = {};
    for (const feat of dptoGeo.features) {
      const name = normalizeName(feat.properties.DPTO_CNMBR);
      const code = feat.properties.DPTO_CCDGO;
      dptoDaneGeo[name] = { dane_code: code, geometry: feat.geometry };
    }

    for (const s of states) {
      const normName = normalizeName(s.name);
      const daneInfo = dptoDaneGeo[normName] || dptoDaneGeo[DB_TO_GEOJSON_NAME[normName]];
      const daneCode = daneInfo ? daneInfo.dane_code : null;
      const geom = daneInfo
        ? `ST_GeomFromGeoJSON('${JSON.stringify(daneInfo.geometry)}')`
        : "NULL";

      await client.query(
        `INSERT INTO states (id, country_id, region_id, name, slug, dane_code, latitude, longitude, geom)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, ${geom})`,
        [s.id, s.country_id, s.region_id, s.name, generateSlug(s.name), daneCode, s.latitude, s.longitude],
      );
    }

    // =====================================================================
    // 5. Poblar geometría de regiones (ST_Union de sus departamentos)
    // =====================================================================
    console.log("Calculando geometría de regiones...");
    await client.query(`
      UPDATE regions r SET geom = sub.geom
      FROM (
        SELECT s.region_id, ST_Multi(ST_Union(s.geom))::geometry(MultiPolygon,4326) AS geom
        FROM states s
        WHERE s.region_id IS NOT NULL AND s.geom IS NOT NULL
        GROUP BY s.region_id
      ) sub
      WHERE r.id = sub.region_id
    `);
    console.log("   ✅ regiones con geometría actualizadas");

    // =====================================================================
    // 6. Ciudades (municipios) con DANE + geometría
    // =====================================================================
    console.log(`Insertando ${cities.length} ciudades con geometría...`);

    // Mapa: dane_code → geometry
    const mpioDaneGeo = {};
    for (const feat of mpioGeo.features) {
      const code = feat.properties.MPIO_CCNCT;
      mpioDaneGeo[code] = feat.geometry;
    }

    // Mapa para mapear DANE → DB city ID (para barrios después)
    const daneToDbCityId = {};

    const BATCH = 500;
    for (let i = 0; i < cities.length; i += BATCH) {
      const batch = cities.slice(i, i + BATCH);
      const values = [];
      const cols = [];

      for (let j = 0; j < batch.length; j++) {
        const c = batch[j];
        const base = j * 8 + 1;

        // Buscar código DANE real desde el GeoJSON, mapeando por nombre normalizado
        let daneCode = null;
        const normName = normalizeName(c.name);
        const geoFeat = mpioGeo.features.find(
          (f) => {
            const gn = normalizeName(f.properties.MPIO_CNMBR);
            return gn === normName ||
                   CITY_NAME_OVERRIDES[gn] === normName ||
                   CITY_NAME_OVERRIDES[normName] === gn;
          },
        );
        if (geoFeat) {
          daneCode = geoFeat.properties.MPIO_CCNCT;
          daneToDbCityId[daneCode] = c.id;
        }

        const geo = mpioDaneGeo[daneCode];
        const geoJSON = geo ? JSON.stringify(geo) : null;
        values.push(c.id, c.state_id, c.name, generateSlug(c.name), daneCode, c.latitude, c.longitude, geoJSON);
        cols.push(
          `($${base}, $${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, ST_GeomFromGeoJSON($${base + 7})::geometry)`,
        );
      }

      await client.query(
        `INSERT INTO cities (id, state_id, name, slug, dane_code, latitude, longitude, geom)
         VALUES ${cols.join(", ")}`,
        values,
      );
      console.log(`  ... ${Math.min(i + BATCH, cities.length)}/${cities.length}`);
    }

    // =====================================================================
    // 7. Barrios con geometría
    // =====================================================================
    console.log("Insertando barrios...");

    const daneCodeToDbStateId = {};
    for (const s of states) {
      const daneInfo = dptoDaneGeo[s.name];
      if (daneInfo) daneCodeToDbStateId[daneInfo.dane_code] = s.id;
    }

    let barrioCount = 0;
    for (const [daneMpioCode, barrioList] of Object.entries(barrios)) {
      const dbCityId = daneToDbCityId[daneMpioCode];
      if (!dbCityId) {
        console.log(`  ⚠️  Ciudad DANE ${daneMpioCode} no encontrada en DB, saltando ${barrioList.length} barrios`);
        continue;
      }

      const batchSize = 50;
      for (let b = 0; b < barrioList.length; b += batchSize) {
        const batch = barrioList.slice(b, b + batchSize);
        const insertVals = [];
        const rows = [];

        for (let j = 0; j < batch.length; j++) {
          const barrio = batch[j];
          const bv = j * 7 + 1;
          const name = barrio.NOMB_BARR || barrio.name || barrio.nombre || "Sin nombre";
          const code = String(barrio.BAR_COD || barrio.id || barrio.slug || "unknown");
          const lat = barrio.latitude || null;
          const lon = barrio.longitude || null;
          const geoJSON = barrio.geom ? JSON.stringify(barrio.geom) : null;

          insertVals.push(dbCityId, name, generateSlug(name), code, lat, lon, geoJSON);
          const geomExpr = geoJSON ? `ST_GeomFromGeoJSON($${bv + 6})::geometry` : "NULL::geometry";
          rows.push(`($${bv}, $${bv + 1}, $${bv + 2}, $${bv + 3}, $${bv + 4}, $${bv + 5}, ${geomExpr})`);
        }

        await client.query(
          `INSERT INTO barrios (city_id, name, slug, dane_code, latitude, longitude, geom)
           VALUES ${rows.join(", ")}`,
          insertVals,
        );

        barrioCount += batch.length;
      }

      console.log(`  ✅ ${barrioList.length} barrios en ciudad ${daneMpioCode}`);
    }

    // =====================================================================
    // 8. Reajustar secuencias
    // =====================================================================
    await client.query(`SELECT setval('countries_id_seq', (SELECT MAX(id) FROM countries))`);
    await client.query(`SELECT setval('regions_id_seq', (SELECT MAX(id) FROM regions))`);
    await client.query(`SELECT setval('states_id_seq', (SELECT MAX(id) FROM states))`);
    await client.query(`SELECT setval('cities_id_seq', (SELECT MAX(id) FROM cities))`);
    await client.query(`SELECT setval('barrios_id_seq', (SELECT MAX(id) FROM barrios))`);

    await client.query("COMMIT");
    console.log(`\n✅ Catálogo geográfico completo importado:`);
    console.log(`   ${countries.length} países`);
    console.log(`   ${regions.length} regiones`);
    console.log(`   ${states.length} departamentos (con geometría + DANE)`);
    console.log(`   ${cities.length} ciudades (con geometría + DANE)`);
    console.log(`   ${barrioCount} barrios (con geometría PostGIS)`);
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("❌ Error durante la importación:", error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
