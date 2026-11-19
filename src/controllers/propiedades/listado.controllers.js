// src/controllers/propiedades/listado.controllers.js — listados y búsquedas públicas (home, mapa, slugs, mis anuncios).
import { pool } from "../../db.js";
import { cacheGet } from "../../lib/redis.js";
import { tiempoRelativo } from "../../utils/tiempoRelativo.js";
import { buildTipoFilter, esTipoVacacional } from "../../lib/propertyFilters.js";
import { clausulaExcluirDescartados } from "../../utils/descartados.js";
import { aplicarPrivacidadUbicacion, geomFiltroSQL } from "../../lib/ubicacion.service.js";
import {
  portadaSubquery,
  portadaPublicIdSubquery,
  ofertasSubquery,
  joinOfertaActiva,
  operationIdPorCode,
  camposCatalogoSelect,
  joinsCatalogo,
  resolverColumnasPropiedad,
} from "./_comun.js";

// ok
export const getPropiedades = async (req, res) => {
  try {
    const { selectBase, error } = resolverColumnasPropiedad(req.query.fields);
    if (error) {
      return res.status(400).json({ success: false, error });
    }

    const cacheKey = `propiedades:all:${req.query.fields || "default"}`;
    const propiedadesConDatos = await cacheGet(
      cacheKey,
      30,
      async () => {
        const { rows: propiedades } = await pool.query(
          `SELECT ${selectBase}, ${portadaSubquery("p")}, ${portadaPublicIdSubquery("p")},
                  ${ofertasSubquery("p")},
                  ${camposCatalogoSelect("p")}
         FROM propiedades p
         ${joinsCatalogo("p")}
         ORDER BY p.created_at DESC`,
        );

        return Promise.all(
          propiedades.map(async (propiedad) => {
            // Galería (incluye portada: es_portada=true, orden=-1)
            const { rows: galeria } = await pool.query(
              `SELECT id, url, public_id, orden, tamaño, es_portada
           FROM propiedades_galeria 
           WHERE propiedad_id = $1 
           ORDER BY orden ASC, tamaño ASC`,
              [propiedad.id],
            );

            // Planos
            const { rows: planos } = await pool.query(
              `SELECT id, url, public_id, orden, tamaño
           FROM propiedades_planos 
           WHERE propiedad_id = $1 
           ORDER BY orden ASC, tamaño ASC`,
              [propiedad.id],
            );

            // Publicador
            let publicador = null;

            if (propiedad.es_de_organizacion) {
              // 👉 Trae la organización + el usuario que la creó
              const { rows } = await pool.query(
                `SELECT 
              o.id,
              o.nombre,
              o.logo_url,
              o.telefono,
              o.ciudad,
              o.departamento
            FROM organizaciones o
            WHERE o.id = $1`,
                [propiedad.organizacion_id],
              );
              publicador = rows[0]
                ? { tipo: "organizacion", ...rows[0] }
                : null;
            } else {
              // 👉 Trae el usuario directamente
              const { rows } = await pool.query(
                `SELECT 
              id,
              name,
              image_url,
              telefono
            FROM usuarios
            WHERE id = $1`,
                [propiedad.publicado_por_id],
              );
              publicador = rows[0] ? { tipo: "usuario", ...rows[0] } : null;
            }

            return {
              ...propiedad,
              galeria: galeria || [],
              planos: planos || [],
              publicador,
              tiempo_relativo: tiempoRelativo(propiedad.created_at),
            };
          }),
        );
      },
    );

    // PRIVACIDAD DE UBICACIÓN: por request, fuera de la caché (30s).
    await aplicarPrivacidadUbicacion(propiedadesConDatos, req.usuario);

    res.status(200).json({
      success: true,
      message: "propiedades obtenidas.",
      data: propiedadesConDatos,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

/// Rutas especificas para frontend inmobitwo red social

// Raiz ---> https://inmobitwo.com

export const getPropiedadesHome = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const cursor = req.query.cursor || null; // created_at de la última propiedad que ya vio el front

    const { selectBase, error } = resolverColumnasPropiedad(req.query.fields);
    if (error) {
      return res.status(400).json({ success: false, error });
    }

    // Armamos la query dinámicamente según si hay cursor o no
    const params = [limit];
    let whereClause = "WHERE TRUE";

    if (cursor) {
      whereClause += " AND p.created_at < $2";
      params.push(cursor);
    }

    // Excluye los descartados del usuario logueado (anónimos ven todo)
    whereClause += clausulaExcluirDescartados(req.usuario?.id, params);

    const { rows: propiedades } = await pool.query(
      `SELECT ${selectBase}, ${portadaSubquery("p")}, ${portadaPublicIdSubquery("p")},
              ${ofertasSubquery("p")},
              ${camposCatalogoSelect("p")}
       FROM propiedades p
       ${joinsCatalogo("p")}
       ${whereClause}
       ORDER BY p.created_at DESC 
       LIMIT $1`,
      params,
    );

    const propiedadesConDatos = await Promise.all(
      propiedades.map(async (propiedad) => {
        const { rows: galeria } = await pool.query(
          `SELECT id, url, public_id, orden, tamaño, es_portada
           FROM propiedades_galeria 
           WHERE propiedad_id = $1 
           ORDER BY orden ASC, tamaño ASC`,
          [propiedad.id],
        );

        const { rows: planos } = await pool.query(
          `SELECT id, url, public_id, orden, tamaño
           FROM propiedades_planos 
           WHERE propiedad_id = $1 
           ORDER BY orden ASC, tamaño ASC`,
          [propiedad.id],
        );

        let publicador = null;
        if (propiedad.es_de_organizacion) {
          const { rows } = await pool.query(
            `SELECT id, nombre, logo_url, telefono, ciudad, departamento
             FROM organizaciones WHERE id = $1`,
            [propiedad.organizacion_id],
          );
          publicador = rows[0] ? { tipo: "organizacion", ...rows[0] } : null;
        } else {
          const { rows } = await pool.query(
            `SELECT id, name, image_url, telefono
             FROM usuarios WHERE id = $1`,
            [propiedad.publicado_por_id],
          );
          publicador = rows[0] ? { tipo: "usuario", ...rows[0] } : null;
        }

        return {
          ...propiedad,
          galeria: galeria || [],
          planos: planos || [],
          publicador,
          tiempo_relativo: tiempoRelativo(propiedad.created_at),
        };
      }),
    );

    // El cursor para la próxima llamada es el created_at del último item de esta tanda
    const ultimaPropiedad = propiedades[propiedades.length - 1];
    const nextCursor = ultimaPropiedad ? ultimaPropiedad.created_at : null;

    // PRIVACIDAD DE UBICACIÓN (feed público)
    await aplicarPrivacidadUbicacion(propiedadesConDatos, req.usuario);

    res.status(200).json({
      success: true,
      message: "propiedades obtenidas.",

      data: {
        data: propiedadesConDatos,
        pagination: {
          nextCursor,
          hasMore: propiedades.length === limit, // si trajo menos de "limit", ya no hay más
        },
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

export const getPropiedadesMisAnuncios = async (req, res) => {
  try {
    const id = req.usuario.id;

    const { selectBase, error } = resolverColumnasPropiedad(req.query.fields);
    if (error) {
      return res.status(400).json({ success: false, error });
    }

    const { rows: propiedades } = await pool.query(
      `SELECT ${selectBase}, ${portadaSubquery("p")}, ${portadaPublicIdSubquery("p")},
              p.description_needs_review,
              ${ofertasSubquery("p")},
              ${camposCatalogoSelect("p")}
       FROM propiedades p
       ${joinsCatalogo("p")}
       WHERE p.publicado_por_id = $1
       ORDER BY p.created_at DESC`,
      [id],
    );

    const propiedadesConDatos = await Promise.all(
      propiedades.map(async (propiedad) => {
        // Galería (incluye portada: es_portada=true, orden=-1)
        const { rows: galeria } = await pool.query(
          `SELECT id, url, public_id, orden, tamaño, es_portada
           FROM propiedades_galeria
           WHERE propiedad_id = $1
           ORDER BY orden ASC, tamaño ASC`,
          [propiedad.id],
        );

        // Planos
        const { rows: planos } = await pool.query(
          `SELECT id, url, public_id, orden, tamaño
           FROM propiedades_planos
           WHERE propiedad_id = $1
           ORDER BY orden ASC, tamaño ASC`,
          [propiedad.id],
        );

        // Publicador
        let publicador = null;

        if (propiedad.es_de_organizacion) {
          const { rows } = await pool.query(
            `SELECT
              id,
              nombre,
              logo_url,
              telefono,
              ciudad,
              departamento
            FROM organizaciones
            WHERE id = $1`,
            [propiedad.organizacion_id],
          );

          publicador = rows[0] ? { tipo: "organizacion", ...rows[0] } : null;
        } else {
          const { rows } = await pool.query(
            `SELECT
              id,
              name,
              image_url,
              telefono
            FROM usuarios
            WHERE id = $1`,
                [propiedad.publicado_por_id],
          );

          publicador = rows[0] ? { tipo: "usuario", ...rows[0] } : null;
        }

        return {
          ...propiedad,
          galeria: galeria || [],
          planos: planos || [],
          publicador,
          tiempo_relativo: tiempoRelativo(propiedad.created_at),
        };
      }),
    );

    // PRIVACIDAD DE UBICACIÓN (mis anuncios: el dueño casi siempre verá
    // las reales; si el usuario es agency_admin de otra org no aplica).
    await aplicarPrivacidadUbicacion(propiedadesConDatos, req.usuario);

    res.status(200).json({
      success: true,
      message: "propiedades obtenidas.",
      data: propiedadesConDatos,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

// ============================================================================
// COUNT — Contador ligero de mis anuncios (para el modal de usuario)
// GET /propiedades/mis-anuncios/count
// Solo hace COUNT(*) en propiedades, sin joins de catálogo/galería/planos.
// ============================================================================
export const countPropiedadesMisAnuncios = async (req, res) => {
  try {
    const id = req.usuario.id;

    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS total
       FROM propiedades
       WHERE publicado_por_id = $1`,
      [id],
    );

    res.status(200).json({
      success: true,
      message: "count obtenido.",
      data: rows[0]?.total ?? 0,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

// ============================================================================
// NUEVO — Vista de organización (tenant)
// Raiz ---> https://www.inmobiliariaoviedo.com  o  inmobitwo.com/inmobiliarias/:slug
// ============================================================================
// GET /propiedades/organizacion/:slug?limit=10&cursor=...
// Trae solo los inmuebles publicados bajo el sello de esa organización.
// Usa la misma paginación por cursor que getPropiedadesHome para que el
// frontend pueda reutilizar el mismo componente de scroll infinito.
// ============================================================================
export const getPropiedadesByOrganizacion = async (req, res) => {
  try {
    const { slug } = req.params;
    const limit = parseInt(req.query.limit) || 10;
    const cursor = req.query.cursor || null;

    // 1. Resolver la organización por slug (solo si está aprobada)
    const { rows: orgRows } = await pool.query(
      `SELECT id, nombre, logo_url, telefono, ciudad, departamento, slug, custom_domain
       FROM organizaciones 
       WHERE slug = $1 AND estado = 'aprobada'`,
      [slug],
    );
    const organizacion = orgRows[0];

    if (!organizacion) {
      return res.status(404).json({
        success: false,
        error: "Organización no encontrada.",
      });
    }

    // 2. Traer sus propiedades con paginación por cursor
    const params = [organizacion.id, limit];
    let whereClause =
      "WHERE p.organizacion_id = $1 AND p.es_de_organizacion = true";

    if (cursor) {
      whereClause += " AND p.created_at < $3";
      params.push(cursor);
    }

    const { selectBase, error } = resolverColumnasPropiedad(req.query.fields);
    if (error) {
      return res.status(400).json({ success: false, error });
    }

    const { rows: propiedades } = await pool.query(
      `SELECT ${selectBase}, ${portadaSubquery("p")}, ${portadaPublicIdSubquery("p")},
              ${ofertasSubquery("p")},
              ${camposCatalogoSelect("p")}
       FROM propiedades p
       ${joinsCatalogo("p")}
       ${whereClause}
       ORDER BY p.created_at DESC 
       LIMIT $2`,
      params,
    );

    const propiedadesConDatos = await Promise.all(
      propiedades.map(async (propiedad) => {
        const { rows: galeria } = await pool.query(
          `SELECT id, url, public_id, orden, tamaño, es_portada
           FROM propiedades_galeria 
           WHERE propiedad_id = $1 
           ORDER BY orden ASC, tamaño ASC`,
          [propiedad.id],
        );

        const { rows: planos } = await pool.query(
          `SELECT id, url, public_id, orden, tamaño
           FROM propiedades_planos 
           WHERE propiedad_id = $1 
           ORDER BY orden ASC, tamaño ASC`,
          [propiedad.id],
        );

        return {
          ...propiedad,
          galeria: galeria || [],
          planos: planos || [],
          publicador: { tipo: "organizacion", ...organizacion },
          tiempo_relativo: tiempoRelativo(propiedad.created_at),
        };
      }),
    );

    const ultimaPropiedad = propiedades[propiedades.length - 1];
    const nextCursor = ultimaPropiedad ? ultimaPropiedad.created_at : null;

    // PRIVACIDAD DE UBICACIÓN (escaparate público de la organización)
    await aplicarPrivacidadUbicacion(propiedadesConDatos, req.usuario);

    res.status(200).json({
      success: true,
      message: "Propiedades de la organización obtenidas.",
      data: {
        organizacion,
        data: propiedadesConDatos,
        pagination: {
          nextCursor,
          hasMore: propiedades.length === limit,
        },
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

export const getPropertiesBySlugs = async (req, res) => {
  const { type, city, dept } = req.query;
  let { operation } = req.query;

  if (!operation || !type || !dept) {
    return res.status(400).json({
      success: false,
      message: "Faltan parámetros requeridos de geolocalización o negocio.",
      data: null,
      error: null,
    });
  }

  try {
    let opSlug = operation.toLowerCase();
    const params = [];

    const { sql: tipoFilterSql, params: tipoFilterParams } = buildTipoFilter(
      type,
      { alias: "p", startIdx: params.length + 1 },
    );
    tipoFilterParams.forEach((t) => params.push(t));
    const typeCondition = tipoFilterSql ? `AND ${tipoFilterSql}` : "";

    // Filtro por rango de precio (min/max, en millones COP → ×1.000.000). Saneado.
    const minPrecio = parseFloat(req.query.min) * 1000000;
    const maxPrecio = parseFloat(req.query.max) * 1000000;
    const precioCondiciones = [
      !isNaN(minPrecio) ? `l.precio >= ${minPrecio}` : null,
      !isNaN(maxPrecio) ? `l.precio <= ${maxPrecio}` : null,
    ].filter(Boolean);
    const precioWhere = precioCondiciones.length
      ? `AND ${precioCondiciones.join(" AND ")}`
      : "";

    // Filtro por tamaño (área privada, con fallback a construida). Saneado a enteros.
    const minTam = parseInt(req.query.tamMin, 10);
    const maxTam = parseInt(req.query.tamMax, 10);
    const tamCondiciones = [
      !isNaN(minTam)
        ? `COALESCE(p.private_area, p.constructed_area) >= ${minTam}`
        : null,
      !isNaN(maxTam)
        ? `COALESCE(p.private_area, p.constructed_area) <= ${maxTam}`
        : null,
    ].filter(Boolean);
    const tamWhere = tamCondiciones.length
      ? `AND ${tamCondiciones.join(" AND ")}`
      : "";

    // Filtro por tipo de alquiler (rental_type_id). Saneado a enteros.
    const rentalList = (req.query.rental ?? "")
      .split(",")
      .map(Number)
      .filter(Boolean);
    const rentalWhere = rentalList.length
      ? `AND l.rental_type_id IN (${rentalList.join(",")})`
      : "";

    // Filtro por fecha de publicación (created_at). Saneado a valores fijos.
    const fechaIntervals = {
      "24h": "24 HOURS",
      semana: "7 DAYS",
      mes: "30 DAYS",
    };
    const fechaWhere = fechaIntervals[req.query.fecha]
      ? `AND p.created_at >= NOW() - INTERVAL '${fechaIntervals[req.query.fecha]}'`
      : "";

    // Filtro por tipo de anunciante (es_de_organizacion). Saneado a valores fijos.
    const anunciantesValidos = new Set(["persona", "inmobiliaria"]);
    const anuncianteList = (req.query.anunciante ?? "")
      .split(",")
      .map((a) => a.trim().toLowerCase())
      .filter((a) => anunciantesValidos.has(a));
    const anuncianteConds = [];
    if (anuncianteList.includes("inmobiliaria"))
      anuncianteConds.push("p.es_de_organizacion = true");
    if (anuncianteList.includes("persona"))
      anuncianteConds.push("p.es_de_organizacion = false");
    const anuncianteWhere = anuncianteConds.length
      ? `AND (${anuncianteConds.join(" OR ")})`
      : "";

    // Filtro por multimedia. Solo "plano" implementado (video_3d/video pendientes).
    const multimediaValidos = new Set(["plano", "video_3d", "video"]);
    const multimediaList = (req.query.multimedia ?? "")
      .split(",")
      .map((m) => m.trim().toLowerCase())
      .filter((m) => multimediaValidos.has(m));
    const multimediaConds = [];
    if (multimediaList.includes("plano"))
      multimediaConds.push(
        "EXISTS (SELECT 1 FROM propiedades_planos pp WHERE pp.propiedad_id = p.id)",
      );
    // TODO: implementar filtros de video_3d y video cuando exista el campo en la DB.
    const multimediaWhere = multimediaConds.length
      ? `AND ${multimediaConds.join(" AND ")}`
      : "";

    // Filtro por alcobas (bedroom_count). Saneado a enteros.
    const habList = (req.query.hab ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s !== "")
      .map(Number)
      .filter((n) => Number.isInteger(n) && n >= 0);
    const habConds = [];
    if (habList.includes(4)) habConds.push("p.bedroom_count >= 4");
    habList.filter((n) => n < 4).forEach((n) =>
      habConds.push(`p.bedroom_count = ${n}`),
    );
    const habWhere = habConds.length ? `AND (${habConds.join(" OR ")})` : "";

    // Filtro por baños (bathroom_count). Saneado a enteros.
    const banosList = (req.query.banos ?? "")
      .split(",")
      .map(Number)
      .filter((n) => Number.isInteger(n) && n >= 1);
    const banosConds = [];
    if (banosList.includes(3)) banosConds.push("p.bathroom_count >= 3");
    banosList.filter((n) => n < 3).forEach((n) =>
      banosConds.push(`p.bathroom_count = ${n}`),
    );
    const banosWhere = banosConds.length ? `AND (${banosConds.join(" OR ")})` : "";

    // Filtro por estado (agrupado → códigos de condition_types).
    const estadoGrupos = {
      obra_nueva: ["nuevo", "para_estrenar", "en_construccion", "obra_negra", "obra_gris"],
      usado: ["usado"],
      remodelado: ["remodelado"],
      para_remodelar: ["para_remodelar"],
    };
    const estadoList = (req.query.estado ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter((e) => estadoGrupos[e]);
    const estadoConds = [];
    if (estadoList.length)
      estadoConds.push(
        `p.condition_type_id IN (SELECT id FROM condition_types WHERE code IN (${estadoList
          .flatMap((e) => estadoGrupos[e])
          .map((c) => `'${c}'`)
          .join(", ")}))`,
      );
    const estadoWhere = estadoConds.length ? `AND (${estadoConds.join(" OR ")})` : "";

    // Filtro por características (flags rápidos de la tabla propiedades).
    const caractFlags = {
      ascensor: "has_elevator",
      piscina: "has_swimming_pool",
      gimnasio: "has_gym",
      seguridad_24h: "has_security_24h",
      aire_acondicionado: "has_air_conditioning",
      amoblado: "is_furnished",
      parqueadero: "parking_space_count",
    };
    const caractList = (req.query.caract ?? "")
      .split(",")
      .map((c) => c.trim().toLowerCase())
      .filter((c) => caractFlags[c]);
    const caractConds = [];
    caractList.forEach((c) => {
      const col = caractFlags[c];
      caractConds.push(
        col === "parking_space_count"
          ? `p.parking_space_count > 0`
          : `p.${col} = true`,
      );
    });
    const caractWhere = caractConds.length
      ? `AND (${caractConds.join(" AND ")})`
      : "";

    // Vacacional solo aplica a alquiler (por temporada).
    if (esTipoVacacional(type)) {
      opSlug = "alquiler";
    }

    // Fase 5: la operación filtrada sale de la oferta activa (una "ambas"
    // aparece en venta con su precio de venta y en alquiler con su canon).
    const opIdSlugs = await operationIdPorCode(opSlug);
    if (!opIdSlugs) {
      return res.status(400).json({
        success: false,
        message: "Operación no válida.",
        data: null,
        error: null,
      });
    }
    const listingsJoinSlugs = joinOfertaActiva(opIdSlugs);

    const galeriaSubquery = `
      COALESCE(
        (SELECT json_agg(json_build_object(
          'id', pg.id,
          'url', pg.url,
          'orden', pg.orden,
          'tamaño', pg.tamaño,
          'es_portada', pg.es_portada
        ) ORDER BY pg.orden, pg.tamaño)
        FROM propiedades_galeria pg
        WHERE pg.propiedad_id = p.id),
        '[]'::json
      ) as galeria
    `;

    const planosSubquery = `
      COALESCE(
        (SELECT json_agg(json_build_object(
          'id', pp.id,
          'url', pp.url,
          'orden', pp.orden,
          'tamaño', pp.tamaño
        ) ORDER BY pp.orden, pp.tamaño)
        FROM propiedades_planos pp
        WHERE pp.propiedad_id = p.id),
        '[]'::json
      ) as planos
    `;

    // Excluye los descartados del usuario logueado (anónimos ven todo).
    // Se calcula aquí para que los índices posicionales de city/dept
    // (computados después con params.length) queden correctos.
    const excluirDescartados = clausulaExcluirDescartados(
      req.usuario?.id,
      params,
    );

    const selectFields = `
      p.id, p.titulo, p.direccion, p.description, l.precio, l.price_per_sqm, p.estrato,
      l.rental_type_id,
      p.private_area, p.constructed_area, p.bedroom_count, p.bathroom_count,
      p.created_at,
      ot.code as operacion_slug,
      pt.code as tipo_slug,
      ot.label_es as operacion,
      pt.label_es as tipo_inmueble,
      ct.label_es as estado_conservacion,
      ${portadaSubquery("p")},
      ${portadaPublicIdSubquery("p")},
      p.es_de_organizacion,
      ${galeriaSubquery},
      ${planosSubquery},
      ${ofertasSubquery("p")},
      c.name as city_name,
      s.name as state_name,
      o.nombre as organizacion_nombre,
      o.logo_url as organizacion_logo_url,
      p.longitude::float as longitude, 
      p.latitude::float as latitude
    `;

    const orgJoin = `LEFT JOIN organizaciones o ON p.organizacion_id = o.id`;
    const catalogosJoin = `
      INNER JOIN operation_types ot ON p.operation_type_id = ot.id
      INNER JOIN property_types pt ON p.property_type_id = pt.id
      LEFT JOIN condition_types ct ON p.condition_type_id = ct.id
      ${listingsJoinSlugs}
    `;

    let query;
    if (city) {
      params.push(city.toLowerCase(), dept.toLowerCase());
      const cityIdx = params.length - 1;
      const deptIdx = params.length;

      query = `
        SELECT ${selectFields}
        FROM propiedades p
        ${catalogosJoin}
        INNER JOIN cities c ON p.city_id = c.id
        INNER JOIN states s ON c.state_id = s.id 
        ${orgJoin}
        WHERE 1 = 1 -- la operación la filtra el JOIN a la oferta activa
          ${typeCondition}
          AND c.slug = $${cityIdx}
          AND s.slug = $${deptIdx}
          AND p.estado = 'publicado'
          ${precioWhere}
          ${tamWhere}
          ${rentalWhere}
          ${fechaWhere}
          ${anuncianteWhere}
          ${multimediaWhere}
          ${habWhere}
          ${banosWhere}
          ${estadoWhere}
          ${caractWhere}
          ${excluirDescartados}
        ORDER BY p.id DESC
        LIMIT 100;
      `;

      const { rows: cityRows } = await pool.query(query, params);

      if (cityRows.length > 0) {
        return res.json({
          success: true,
          message: null,
          data: cityRows,
          error: null,
        });
      }

      // Fallback: El "city" podria ser parte de un depto con guion (ej: "la" + "guajira")
      params.splice(-2);
      const fullSlug = `${city.toLowerCase()}-${dept.toLowerCase()}`;
      params.push(fullSlug);
      const fallbackIdx = params.length;

      query = `
        SELECT ${selectFields}
        FROM propiedades p
        ${catalogosJoin}
        INNER JOIN cities c ON p.city_id = c.id
        INNER JOIN states s ON c.state_id = s.id 
        ${orgJoin}
        WHERE 1 = 1 -- la operación la filtra el JOIN a la oferta activa
          ${typeCondition}
          AND s.slug = $${fallbackIdx}
          AND p.estado = 'publicado'
          ${precioWhere}
          ${tamWhere}
          ${rentalWhere}
          ${fechaWhere}
          ${anuncianteWhere}
          ${multimediaWhere}
          ${habWhere}
          ${banosWhere}
          ${estadoWhere}
          ${caractWhere}
          ${excluirDescartados}
        ORDER BY p.id DESC
        LIMIT 100;
      `;
    } else if (dept) {
      params.push(dept.toLowerCase());
      const geoIdx = params.length;

      query = `
        SELECT ${selectFields}
        FROM propiedades p
        ${catalogosJoin}
        INNER JOIN cities c ON p.city_id = c.id
        INNER JOIN states s ON c.state_id = s.id 
        ${orgJoin}
        WHERE 1 = 1 -- la operación la filtra el JOIN a la oferta activa
          ${typeCondition}
          AND s.slug = $${geoIdx}
          AND p.estado = 'publicado'
          ${precioWhere}
          ${tamWhere}
          ${rentalWhere}
          ${fechaWhere}
          ${anuncianteWhere}
          ${multimediaWhere}
          ${habWhere}
          ${banosWhere}
          ${estadoWhere}
          ${caractWhere}
          ${excluirDescartados}
        ORDER BY p.id DESC
        LIMIT 100;
      `;

      const { rows: deptRows } = await pool.query(query, params);

      if (deptRows.length > 0) {
        return res.json({
          success: true,
          message: null,
          data: deptRows,
          error: null,
        });
      }

      // No encontró como depto, intentar como región (mismo índice)
      query = `
        SELECT ${selectFields}
        FROM propiedades p
        ${catalogosJoin}
        INNER JOIN cities c ON p.city_id = c.id
        INNER JOIN states s ON c.state_id = s.id
        INNER JOIN regions r ON s.region_id = r.id
        ${orgJoin}
        WHERE 1 = 1 -- la operación la filtra el JOIN a la oferta activa
          ${typeCondition}
          AND r.slug = $${geoIdx}
          AND p.estado = 'publicado'
          ${precioWhere}
          ${tamWhere}
          ${rentalWhere}
          ${fechaWhere}
          ${anuncianteWhere}
          ${multimediaWhere}
          ${habWhere}
          ${banosWhere}
          ${estadoWhere}
          ${caractWhere}
          ${excluirDescartados}
        ORDER BY p.id DESC
        LIMIT 100;
      `;
    }

    const { rows } = await pool.query(query, params);

    // PRIVACIDAD DE UBICACIÓN (listado por ciudad/departamento)
    await aplicarPrivacidadUbicacion(rows, req.usuario);

    // Enviamos la respuesta estructurada respetando tu firma estándar del apiBackend
    return res.json({
      success: true,
      message:
        rows.length === 0 ? "No se encontraron inmuebles en esta zona" : null,
      data: rows,
      error: null,
    });
  } catch (error) {
    console.error("Error crítico en getPropertiesBySlugs:", error.message);

    return res.status(500).json({
      success: false,
      message: "Error interno al procesar la búsqueda geográfica",
      data: null,
      error: error.message,
    });
  }
};

// NUEVO: Búsqueda por múltiples tipos de vivienda (agrupados).
// Endpoint separado para no modificar getPropertiesBySlugs.
// GET /propiedades/search-vivienda?operation=&tipos=casa,casa_lote&city=&dept=&min=&max=&tamMin=&tamMax=
export const searchVivienda = async (req, res) => {
  const { operation, tipos, city, dept, min, max, tamMin, tamMax } = req.query;

  if (!operation || !tipos || !dept) {
    return res.status(400).json({
      success: false,
      message: "Faltan parámetros requeridos (operation, tipos, dept).",
      data: null,
      error: null,
    });
  }

  try {
    const tipoLista = tipos
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
    if (tipoLista.length === 0) {
      return res.status(400).json({
        success: false,
        message: "tipos inválido.",
        data: null,
        error: null,
      });
    }

    // Fase 5: la operación filtrada sale de la oferta activa.
    const opIdVivienda = await operationIdPorCode(operation);
    if (!opIdVivienda) {
      return res.status(400).json({
        success: false,
        message: "Operación no válida.",
        data: null,
        error: null,
      });
    }

    const minPrecio = parseFloat(min) * 1000000;
    const maxPrecio = parseFloat(max) * 1000000;
    const minTamNum = parseInt(tamMin, 10);
    const maxTamNum = parseInt(tamMax, 10);

    const params = [tipoLista];
    const conds = [
      // La operación la filtra el JOIN a la oferta activa (una "ambas" sale
      // en venta y en alquiler con su precio); el espejo no se usa aquí.
      "LOWER(pt.code) = ANY($1::text[])",
      "p.estado = 'publicado'",
    ];
    let idx = 2;

    if (city) {
      params.push(city.toLowerCase(), dept.toLowerCase());
      conds.push(`c.slug = $${idx++}`, `s.slug = $${idx++}`);
    } else {
      params.push(dept.toLowerCase());
      conds.push(`s.slug = $${idx++}`);
    }

    if (!isNaN(minPrecio)) {
      params.push(minPrecio);
      conds.push(`l.precio >= $${idx++}`);
    }
    if (!isNaN(maxPrecio)) {
      params.push(maxPrecio);
      conds.push(`l.precio <= $${idx++}`);
    }
    if (!isNaN(minTamNum)) {
      params.push(minTamNum);
      conds.push(`COALESCE(p.private_area, p.constructed_area) >= $${idx++}`);
    }
    if (!isNaN(maxTamNum)) {
      params.push(maxTamNum);
      conds.push(`COALESCE(p.private_area, p.constructed_area) <= $${idx++}`);
    }

    // Filtro por tipo de alquiler (rental_type_id)
    const rentalList = (req.query.rental ?? "")
      .split(",")
      .map(Number)
      .filter(Boolean);
    if (rentalList.length) {
      params.push(rentalList);
      conds.push(`l.rental_type_id = ANY($${idx++}::int[])`);
    }

    // Filtro por fecha de publicación (created_at). Saneado a valores fijos.
    const fechaIntervals = {
      "24h": "24 HOURS",
      semana: "7 DAYS",
      mes: "30 DAYS",
    };
    if (fechaIntervals[req.query.fecha]) {
      conds.push(
        `p.created_at >= NOW() - INTERVAL '${fechaIntervals[req.query.fecha]}'`,
      );
    }

    // Filtro por tipo de anunciante (es_de_organizacion). Saneado a valores fijos.
    const anunciantesValidos = new Set(["persona", "inmobiliaria"]);
    const anuncianteList = (req.query.anunciante ?? "")
      .split(",")
      .map((a) => a.trim().toLowerCase())
      .filter((a) => anunciantesValidos.has(a));
    const anuncianteConds = [];
    if (anuncianteList.includes("inmobiliaria"))
      anuncianteConds.push("p.es_de_organizacion = true");
    if (anuncianteList.includes("persona"))
      anuncianteConds.push("p.es_de_organizacion = false");
    if (anuncianteConds.length)
      conds.push(`(${anuncianteConds.join(" OR ")})`);

    // Filtro por multimedia. Solo "plano" implementado (video_3d/video pendientes).
    const multimediaValidos = new Set(["plano", "video_3d", "video"]);
    const multimediaList = (req.query.multimedia ?? "")
      .split(",")
      .map((m) => m.trim().toLowerCase())
      .filter((m) => multimediaValidos.has(m));
    if (multimediaList.includes("plano"))
      conds.push(
        "EXISTS (SELECT 1 FROM propiedades_planos pp WHERE pp.propiedad_id = p.id)",
      );
    // TODO: implementar filtros de video_3d y video cuando exista el campo en la DB.

    // Filtro por alcobas (bedroom_count). Saneado a enteros.
    const habList = (req.query.hab ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s !== "")
      .map(Number)
      .filter((n) => Number.isInteger(n) && n >= 0);
    const habConds = [];
    if (habList.includes(4)) habConds.push("p.bedroom_count >= 4");
    habList.filter((n) => n < 4).forEach((n) =>
      habConds.push(`p.bedroom_count = ${n}`),
    );
    if (habConds.length) conds.push(`(${habConds.join(" OR ")})`);

    // Filtro por baños (bathroom_count). Saneado a enteros.
    const banosList = (req.query.banos ?? "")
      .split(",")
      .map(Number)
      .filter((n) => Number.isInteger(n) && n >= 1);
    const banosConds = [];
    if (banosList.includes(3)) banosConds.push("p.bathroom_count >= 3");
    banosList.filter((n) => n < 3).forEach((n) =>
      banosConds.push(`p.bathroom_count = ${n}`),
    );
    if (banosConds.length) conds.push(`(${banosConds.join(" OR ")})`);

    // Filtro por estado (agrupado → códigos de condition_types).
    const estadoGrupos = {
      obra_nueva: ["nuevo", "para_estrenar", "en_construccion", "obra_negra", "obra_gris"],
      usado: ["usado"],
      remodelado: ["remodelado"],
      para_remodelar: ["para_remodelar"],
    };
    const estadoList = (req.query.estado ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter((e) => estadoGrupos[e]);
    if (estadoList.length)
      conds.push(
        `p.condition_type_id IN (SELECT id FROM condition_types WHERE code IN (${estadoList
          .flatMap((e) => estadoGrupos[e])
          .map((c) => `'${c}'`)
          .join(", ")}))`,
      );

    // Filtro por características (flags rápidos de la tabla propiedades).
    const caractFlags = {
      ascensor: "has_elevator",
      piscina: "has_swimming_pool",
      gimnasio: "has_gym",
      seguridad_24h: "has_security_24h",
      aire_acondicionado: "has_air_conditioning",
      amoblado: "is_furnished",
      parqueadero: "parking_space_count",
    };
    const caractList = (req.query.caract ?? "")
      .split(",")
      .map((c) => c.trim().toLowerCase())
      .filter((c) => caractFlags[c]);
    const caractConds = [];
    caractList.forEach((c) => {
      const col = caractFlags[c];
      caractConds.push(
        col === "parking_space_count"
          ? `p.parking_space_count > 0`
          : `p.${col} = true`,
      );
    });
    if (caractConds.length) conds.push(`(${caractConds.join(" AND ")})`);

    // Excluye los descartados del usuario logueado (anónimos ven todo)
    const excluirVivienda = clausulaExcluirDescartados(req.usuario?.id, params);
    if (excluirVivienda) conds.push(excluirVivienda.replace(/^ AND /, ""));

    const galeriaSubquery = `
      COALESCE(
        (SELECT json_agg(json_build_object(
          'id', pg.id, 'url', pg.url, 'orden', pg.orden, 'tamaño', pg.tamaño, 'es_portada', pg.es_portada
        ) ORDER BY pg.orden, pg.tamaño)
        FROM propiedades_galeria pg WHERE pg.propiedad_id = p.id),
        '[]'::json
      ) as galeria
    `;
    const planosSubquery = `
      COALESCE(
        (SELECT json_agg(json_build_object(
          'id', pp.id, 'url', pp.url, 'orden', pp.orden, 'tamaño', pp.tamaño
        ) ORDER BY pp.orden, pp.tamaño)
        FROM propiedades_planos pp WHERE pp.propiedad_id = p.id),
        '[]'::json
      ) as planos
    `;

    const selectFields = `
      p.id, p.titulo, p.direccion, p.description, l.precio, l.price_per_sqm, p.estrato,
      l.rental_type_id,
      p.private_area, p.constructed_area, p.bedroom_count, p.bathroom_count,
      p.created_at,
      ot.code as operacion_slug,
      pt.code as tipo_slug,
      ot.label_es as operacion,
      pt.label_es as tipo_inmueble,
      ct.label_es as estado_conservacion,
      ${portadaSubquery("p")},
      ${portadaPublicIdSubquery("p")},
      p.es_de_organizacion,
      ${galeriaSubquery},
      ${planosSubquery},
      ${ofertasSubquery("p")},
      c.name as city_name,
      s.name as state_name,
      o.nombre as organizacion_nombre,
      o.logo_url as organizacion_logo_url,
      p.longitude::float as longitude,
      p.latitude::float as latitude
    `;

    const query = `
      SELECT ${selectFields}
      FROM propiedades p
      INNER JOIN operation_types ot ON p.operation_type_id = ot.id
      INNER JOIN property_types pt ON p.property_type_id = pt.id
      LEFT JOIN condition_types ct ON p.condition_type_id = ct.id
      ${joinOfertaActiva(opIdVivienda)}
      LEFT JOIN cities c ON p.city_id = c.id
      LEFT JOIN states s ON c.state_id = s.id
      LEFT JOIN organizaciones o ON p.organizacion_id = o.id
      WHERE ${conds.join(" AND ")}
      ORDER BY p.id DESC
      LIMIT 100;
    `;

    const { rows } = await pool.query(query, params);

    // PRIVACIDAD DE UBICACIÓN (búsqueda por tipos de vivienda)
    await aplicarPrivacidadUbicacion(rows, req.usuario);

    return res.json({
      success: true,
      message:
        rows.length === 0 ? "No se encontraron inmuebles en esta zona" : null,
      data: rows,
      error: null,
    });
  } catch (error) {
    console.error("Error en searchVivienda:", error.message);
    return res.status(500).json({
      success: false,
      message: "Error interno al buscar por tipo de vivienda",
      data: null,
      error: error.message,
    });
  }
};

// NUEVO v3.6: Inmuebles dentro de un bounding box (para MapaInmuebles)
export const getInmueblesEnBbox = async (req, res) => {
  const { minLat, minLng, maxLat, maxLng, tipoInmueble } = req.query;
  let { operation } = req.query;

  if (!minLat || !minLng || !maxLat || !maxLng) {
    return res.status(400).json({
      success: false,
      message: "minLat, minLng, maxLat, maxLng son requeridos",
      data: null,
      error: null,
    });
  }

    try {
      const params = [];
      // UBICACIÓN OCULTA: el filtro espacial usa geom_publica para las propiedades
      // ocultas (y geom real para el resto). Si geom_publica aún no existe
      // (pago recién aprobado sin aplicar), no se muestra.
      const filters = [
        "p.estado = 'publicado'",
        `${geomFiltroSQL("p")} IS NOT NULL`,
      ];

    if (esTipoVacacional(tipoInmueble)) {
      operation = "alquiler";
    }

    // params[0] se reservaba a la operación del espejo; la operación la filtra
    // el JOIN a la oferta activa (ver abajo), así que no se envía parámetro.

    // Fase 5: con filtro de operación, filtra el JOIN a la oferta activa
    // (el espejo no sirve para "ambas"); sin filtro, valores del espejo.
    let listingsJoinBbox = "";
    let precioSelectBbox = "p.precio";
    if (operation) {
      const opIdBbox = await operationIdPorCode(operation);
      if (!opIdBbox) {
        return res.status(400).json({
          success: false,
          message: "Operación no válida.",
          data: null,
          error: null,
        });
      }
      listingsJoinBbox = joinOfertaActiva(opIdBbox);
      precioSelectBbox = "l.precio";
    }

    if (tipoInmueble) {
      const { sql, params: tipoParams } = buildTipoFilter(tipoInmueble, {
        alias: "p",
        startIdx: params.length + 1,
      });
      tipoParams.forEach((t) => params.push(t));
      if (sql) filters.push(sql);
    }

    // Excluye los descartados del usuario logueado (anónimos ven todo).
    // Antes de los params del bbox para no desplazar sus índices.
    const excluirBbox = clausulaExcluirDescartados(req.usuario?.id, params);
    if (excluirBbox) filters.push(excluirBbox.replace(/^ AND /, ""));

    params.push(minLng, minLat, maxLng, maxLat);
    const bboxParamIdx = params.length - 3;

    const query = `
      SELECT p.id, p.titulo, ${precioSelectBbox} as precio, p.estrato,
             ot.label_es as operacion, ot.code as operacion_slug,
             pt.label_es as tipo_inmueble, pt.code as tipo_slug,
             ${portadaSubquery("p")},
             ${ofertasSubquery("p")},
             ST_Y(${geomFiltroSQL("p")}) AS lat, ST_X(${geomFiltroSQL("p")}) AS lng
      FROM propiedades p
      LEFT JOIN operation_types ot ON p.operation_type_id = ot.id
      LEFT JOIN property_types pt ON p.property_type_id = pt.id
      ${listingsJoinBbox}
      WHERE ST_Intersects(
        ${geomFiltroSQL("p")},
        ST_MakeEnvelope(
          $${bboxParamIdx}::float,
          $${bboxParamIdx + 1}::float,
          $${bboxParamIdx + 2}::float,
          $${bboxParamIdx + 3}::float,
          4326
        )
      )
      AND ${filters.join(" AND ")}
      LIMIT 1000
    `;

    const { rows } = await pool.query(query, params);

    res.json({
      success: true,
      message: null,
      data: rows.map((r) => ({
        ...r,
        lat: parseFloat(r.lat),
        lng: parseFloat(r.lng),
      })),
      error: null,
    });
  } catch (error) {
    console.error("Error en getInmueblesEnBbox:", error);
    res.status(500).json({
      success: false,
      message: "Error al obtener inmuebles",
      data: null,
      error: error.message,
    });
  }
};

export const getPropiedadResumen = async (req, res) => {
  const { id } = req.params;

  if (!id) {
    return res.status(400).json({
      success: false,
      message: "id es requerido",
      data: null,
      error: null,
    });
  }

  try {
      const { rows } = await pool.query(
        `SELECT
          p.latitude, p.longitude,
          p.ubicacion_oculta, p.publicado_por_id, p.organizacion_id,
          p.description_needs_review,
          ${ofertasSubquery("p")},
          (SELECT COUNT(DISTINCT pg.orden) FROM propiedades_galeria pg WHERE pg.propiedad_id = p.id AND pg.es_portada = false)::int AS galeria_count,
          (SELECT COUNT(DISTINCT pp.orden) FROM propiedades_planos pp WHERE pp.propiedad_id = p.id)::int AS planos_count
        FROM propiedades p
        WHERE p.id = $1`,
        [id],
      );

    if (!rows.length) {
      return res.status(404).json({
        success: false,
        message: "Propiedad no encontrada",
        data: null,
        error: null,
      });
    }

    // PRIVACIDAD DE UBICACIÓN (resumen ligero usado por PropertyCard)
    await aplicarPrivacidadUbicacion(rows, req.usuario);

    res.json({ success: true, message: null, data: rows[0], error: null });
  } catch (error) {
    console.error("Error en getPropiedadResumen:", error);
    res.status(500).json({
      success: false,
      message: "Error al obtener resumen",
      data: null,
      error: error.message,
    });
  }
};
