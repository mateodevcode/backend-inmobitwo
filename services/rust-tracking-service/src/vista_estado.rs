//! Estado en Redis (Fase 4).
//!
//! Solo claves de DECISIÓN con TTL y prefijo `vistas:` (§8). Los contadores
//! NO viven aquí (decisión 5: el log en Postgres es la fuente de verdad y el
//! resumen diario se actualiza con upsert en Fase 5).
//!
//! Atomicidad (§7): "verificar dedupe → verificar tope → marcar" y el uso
//! único del token van en UN script Lua (`LUA_VISTA_DECISION`), no en llamadas
//! separadas. Si Redis falla, el resultado es `error_sistema` (fail-closed,
//! distinto del rate limiter actual que es fail-open).
//!
//! Identidades (§5.3): quien llama pasa TODAS las vinculadas con la primaria
//! primera. El dedupe se verifica contra todas; el tope se SUMA entre todas
//! y solo se incrementa/marcan las de la primaria.

use crate::vista_decision::VistaConfig;

/// Prefijo propio para no chocar con `score:*` / `rate_limit:*` actuales.
pub const PREFIJO: &str = "vistas";

/// Script atómico de decisión de estado. Ver documentación del módulo.
///
/// KEYS: [token, dedupe×N (primaria primera), tope×M (primaria primera),
///        rate_visitante, rate_ip, tope_ip]  (N ≥ 1, M ≥ 1)
/// ARGV: [N, M, token_ttl_s, dedupe_ttl_s, tope_ttl_s, rate_limit, daily_cap,
///        tiene_ip (0/1), daily_cap_per_ip, rate_limit_ip]
/// Sin IP (`tiene_ip=0`) se omiten rate_ip y tope_ip; las claves en esas
/// posiciones son relleno jamás leído (punto 2).
/// Devuelve: {decision, rate_visitante, rate_ip} con decision en
/// {counted, rate_limit, token_reutilizado, duplicado, tope_diario, tope_ip}.
/// `tope_ip` = tope por IP; `tope_diario` solo el de visitante (lote 3).
pub const LUA_VISTA_DECISION: &str = r#"
local n = tonumber(ARGV[1])
local m = tonumber(ARGV[2])
local rate_lim = tonumber(ARGV[6])
local cap_max = tonumber(ARGV[7])
local tiene_ip = tonumber(ARGV[8])
local cap_ip_max = tonumber(ARGV[9])
local rate_ip_lim = tonumber(ARGV[10])

-- 1. Rate limit por visitante (siempre) y por IP (solo si hay IP).
local rv_key = KEYS[2 + n + m]
local ri_key = KEYS[3 + n + m]
local cap_ip_key = KEYS[4 + n + m]
local cv = redis.call('INCR', rv_key)
if cv == 1 then redis.call('EXPIRE', rv_key, 60) end
local ci = 0
if tiene_ip == 1 then
  ci = redis.call('INCR', ri_key)
  if ci == 1 then redis.call('EXPIRE', ri_key, 60) end
end
-- Visitante con su límite (30), IP con el suyo (120, lote 2).
if cv > rate_lim or ci > rate_ip_lim then
  return {'rate_limit', cv, ci}
end

-- 2. Uso único del token: se marca al consumir (antes que dedupe, como en §4.3)
if redis.call('EXISTS', KEYS[1]) == 1 then
  return {'token_reutilizado', cv, ci}
end
redis.call('SET', KEYS[1], '1', 'EX', ARGV[3])

-- 3. Dedupe contra TODAS las identidades vinculadas
for i = 2, 1 + n do
  if redis.call('EXISTS', KEYS[i]) == 1 then
    return {'duplicado', cv, ci}
  end
end

-- 4. Tope diario por visitante: suma entre vinculadas. Si rechaza, NO marca dedupe (§7)
local total = 0
for i = 2 + n, 1 + n + m do
  local v = redis.call('GET', KEYS[i])
  if v then total = total + tonumber(v) end
end
if total >= cap_max then
  return {'tope_diario', cv, ci}
end

-- 4b. Tope diario por IP (punto 1): omitido sin IP.
if tiene_ip == 1 then
  local tip = redis.call('GET', cap_ip_key)
  if tip and tonumber(tip) >= cap_ip_max then
    return {'tope_ip', cv, ci}
  end
end

-- 5. Aprobado: marcar dedupe (primaria) + topes (primaria e IP)
redis.call('SET', KEYS[2], '1', 'EX', ARGV[4])
local cap_primaria = KEYS[2 + n]
local cc = redis.call('INCR', cap_primaria)
if cc == 1 then redis.call('EXPIRE', cap_primaria, ARGV[5]) end
if tiene_ip == 1 then
  local cc_ip = redis.call('INCR', cap_ip_key)
  if cc_ip == 1 then redis.call('EXPIRE', cap_ip_key, ARGV[5]) end
end
return {'counted', cv, ci}
"#;

// ---------------------------------------------------------------------------
// Constructores de claves
// ---------------------------------------------------------------------------

/// Convención de identidad: `user:{id}` > `anon:{session_id}` > `weak:{ip_hash}`.
pub fn clave_token(jti: &str) -> String {
    format!("{PREFIJO}:token:{jti}")
}

pub fn clave_dedupe(ident: &str, propiedad_id: i32) -> String {
    format!("{PREFIJO}:dedupe:{ident}:{propiedad_id}")
}

pub fn clave_tope(ident: &str, propiedad_id: i32, fecha_bogota: &str) -> String {
    format!("{PREFIJO}:tope:{ident}:{propiedad_id}:{fecha_bogota}")
}

pub fn clave_rate_visitante(ident_primaria: &str, minuto_bucket: i64) -> String {
    format!("{PREFIJO}:ratelimit:visitante:{ident_primaria}:{minuto_bucket}")
}

pub fn clave_rate_ip(ip_hash: &str, minuto_bucket: i64) -> String {
    format!("{PREFIJO}:ratelimit:ip:{ip_hash}:{minuto_bucket}")
}

pub fn clave_tope_ip(ip_hash: &str, propiedad_id: i32, fecha_bogota: &str) -> String {
    format!("{PREFIJO}:tope_ip:{ip_hash}:{propiedad_id}:{fecha_bogota}")
}

/// Clave de relleno para las posiciones de IP cuando no hay IP (punto 2).
/// Jamás se lee ni escribe (el Lua la ignora con `tiene_ip=0`); lleva el jti
/// para no colisionar con nada.
pub fn clave_nula(jti: &str, proposito: &str) -> String {
    format!("{PREFIJO}:nulo:{proposito}:{jti}")
}

/// Segundos desde `ahora_ms` (UTC) hasta las 00:00 Bogotá del día siguiente.
/// Bogotá = UTC-5 fijo. En 00:00 exactas devuelve 86400.
pub fn ttl_tope_segundos(ahora_ms: i64) -> u64 {
    const DIA_S: i64 = 86_400;
    const OFFSET_S: i64 = -5 * 3600;
    let unix_s = ahora_ms.div_euclid(1000) + OFFSET_S;
    let trascurrido = unix_s.rem_euclid(DIA_S);
    (DIA_S - trascurrido) as u64
}

// ---------------------------------------------------------------------------
// Aplicación del estado
// ---------------------------------------------------------------------------

/// Entrada para `aplicar_estado`. `identidades`: todas las vinculadas con la
/// primaria primera (no vacía). Tiempos ya calculados por quien llama.
pub struct EntradaEstado<'a> {
    pub jti: &'a str,
    pub propiedad_id: i32,
    pub fecha_bogota: &'a str,
    pub identidades: &'a [String],
    pub ip_hash: &'a str,
    pub minuto_bucket: i64,
    pub ttl_tope_s: usize,
    pub config: &'a VistaConfig,
}

/// Decisión del paso de estado (motivos que dependen de Redis).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DecisionEstado {
    Counted,
    TokenReutilizado,
    RateLimit,
    Duplicado,
    TopeDiario,
    TopeIp,
}

impl DecisionEstado {
    /// Solo se usa en tests (el mapeo real a `VistaDecision` está en vista_api).
    #[cfg(test)]
    pub fn motivo(&self) -> &'static str {
        match self {
            DecisionEstado::Counted => "counted",
            DecisionEstado::TokenReutilizado => "token_reutilizado",
            DecisionEstado::RateLimit => "rate_limit",
            DecisionEstado::Duplicado => "duplicado",
            DecisionEstado::TopeDiario => "tope_diario",
            DecisionEstado::TopeIp => "tope_ip",
        }
    }
}

pub struct SalidaEstado {
    pub decision: DecisionEstado,
    /// Conteos devueltos por el Lua (informativos; hoy solo se usa `decision`).
    #[allow(dead_code)]
    pub rate_visitante: i64,
    #[allow(dead_code)]
    pub rate_ip: i64,
}

/// Fallo de infraestructura → quien llama responde `error_sistema` (fail-closed).
#[derive(Debug)]
pub enum ErrorEstado {
    Redis(String),
}

/// Ejecuta el script Lua atómico. Nunca decide por validación/inmueble/
/// identidad/interno/bot: eso es `decidir_vista` (Fase 1) + `verificar_view_token`
/// (Fase 3); aquí solo el estado que exige atomicidad.
pub async fn aplicar_estado(
    conn: &mut redis::aio::MultiplexedConnection,
    e: &EntradaEstado<'_>,
) -> Result<SalidaEstado, ErrorEstado> {
    let primaria = e
        .identidades
        .first()
        .map(|s| s.as_str())
        .unwrap_or("sin_identidad");
    // Punto 2: sin IP no hay control por IP (antes todas las peticiones sin
    // IP compartían la clave `vistas:ratelimit:ip::{minuto}`).
    let tiene_ip: usize = if e.ip_hash.is_empty() { 0 } else { 1 };
    let script = redis::Script::new(LUA_VISTA_DECISION);
    let mut invocacion = script.prepare_invoke();
    invocacion.key(clave_token(e.jti));
    for ident in e.identidades {
        invocacion.key(clave_dedupe(ident, e.propiedad_id));
    }
    // Si por error viniera vacío, la primaria sostiene el par dedupe/tope.
    if e.identidades.is_empty() {
        invocacion.key(clave_dedupe(primaria, e.propiedad_id));
    }
    let n = e.identidades.len().max(1);
    for ident in e.identidades {
        invocacion.key(clave_tope(ident, e.propiedad_id, e.fecha_bogota));
    }
    if e.identidades.is_empty() {
        invocacion.key(clave_tope(primaria, e.propiedad_id, e.fecha_bogota));
    }
    let m = n;
    if tiene_ip == 1 {
        invocacion
            .key(clave_rate_visitante(primaria, e.minuto_bucket))
            .key(clave_rate_ip(e.ip_hash, e.minuto_bucket))
            .key(clave_tope_ip(e.ip_hash, e.propiedad_id, e.fecha_bogota));
    } else {
        invocacion
            .key(clave_rate_visitante(primaria, e.minuto_bucket))
            .key(clave_nula(e.jti, "rate_ip"))
            .key(clave_nula(e.jti, "tope_ip"));
    }
    invocacion
        .arg(n)
        .arg(m)
        .arg((e.config.token_max_age_minutes as usize).saturating_mul(60))
        .arg((e.config.dedupe_window_minutes as usize).saturating_mul(60))
        .arg(e.ttl_tope_s)
        .arg(e.config.rate_limit_events_per_minute)
        .arg(e.config.daily_cap_per_visitor_property)
        .arg(tiene_ip)
        .arg(e.config.daily_cap_per_ip)
        .arg(e.config.rate_limit_ip_events_per_minute);
    let (decision, cv, ci): (String, i64, i64) = invocacion
        .invoke_async(conn)
        .await
        .map_err(|err| ErrorEstado::Redis(err.to_string()))?;
    let decision = match decision.as_str() {
        "counted" => DecisionEstado::Counted,
        "token_reutilizado" => DecisionEstado::TokenReutilizado,
        "rate_limit" => DecisionEstado::RateLimit,
        "duplicado" => DecisionEstado::Duplicado,
        "tope_diario" => DecisionEstado::TopeDiario,
        "tope_ip" => DecisionEstado::TopeIp,
        otro => return Err(ErrorEstado::Redis(format!("decision desconocida: {otro}"))),
    };
    Ok(SalidaEstado {
        decision,
        rate_visitante: cv,
        rate_ip: ci,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vista_decision::req_env_integracion;

    fn cfg() -> VistaConfig {
        VistaConfig::default()
    }

    // --- Constructores y TTL (sin Redis, deterministas) ---

    #[test]
    fn claves_con_prefijo_propio() {
        assert_eq!(clave_token("jti-1"), "vistas:token:jti-1");
        assert_eq!(clave_dedupe("user:42", 7), "vistas:dedupe:user:42:7");
        assert_eq!(
            clave_tope("anon:abc", 7, "2026-10-04"),
            "vistas:tope:anon:abc:7:2026-10-04"
        );
        assert!(clave_rate_visitante("user:42", 123).starts_with("vistas:ratelimit:visitante:"));
        assert!(clave_rate_ip("iph-1", 123).starts_with("vistas:ratelimit:ip:"));
        // No choca con las claves actuales (`score:*`, `rate_limit:*`).
        for k in [
            clave_token("x"),
            clave_dedupe("u", 1),
            clave_tope("u", 1, "2026-10-04"),
        ] {
            assert!(!k.starts_with("score:") && !k.starts_with("rate_limit:"));
        }
    }

    #[test]
    fn ttl_tope_hasta_medianoche_bogota() {
        // 2026-10-04 12:00:00 Bogotá = 17:00:00 UTC → faltan 12 h = 43200 s.
        assert_eq!(ttl_tope_segundos(1_791_133_200_000), 43_200);
        // 2026-10-04 23:59:00 Bogotá = 2026-10-05 04:59:00 UTC → 60 s.
        assert_eq!(ttl_tope_segundos(1_791_176_340_000), 60);
        // 2026-10-04 00:00:00 Bogotá = 05:00:00 UTC → día completo.
        assert_eq!(ttl_tope_segundos(1_791_090_000_000), 86_400);
    }

    // --- Integración con Redis efímero (VISTAS_TEST_REDIS_URL) ---

    async fn conexion_prueba() -> Option<redis::aio::MultiplexedConnection> {
        // Punto 6: sin URL falla (salvo VISTAS_SKIP_INTEGRATION=1).
        let Some(url) = req_env_integracion("VISTAS_TEST_REDIS_URL") else {
            return None;
        };
        let cliente = redis::Client::open(url).ok()?;
        cliente.get_multiplexed_async_connection().await.ok()
    }

    fn entrada<'a>(
        jti: &'a str,
        propiedad_id: i32,
        identidades: &'a [String],
        ip_hash: &'a str,
        minuto_bucket: i64,
        config: &'a VistaConfig,
    ) -> EntradaEstado<'a> {
        EntradaEstado {
            jti,
            propiedad_id,
            fecha_bogota: "2026-10-04",
            identidades,
            ip_hash,
            minuto_bucket,
            ttl_tope_s: 40_000,
            config,
        }
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 8)]
    async fn cien_eventos_simultaneos_producen_una_vista() {
        let Some(mut conn) = conexion_prueba().await else {
            eprintln!("skip: sin VISTAS_TEST_REDIS_URL");
            return;
        };
        // Config con rate holgado: el test mide dedupe, no rate limit.
        // 'static para poder moverla a las tareas spawn.
        let c: &'static VistaConfig = Box::leak(Box::new({
            let mut c = cfg();
            c.rate_limit_events_per_minute = 10_000;
            c
        }));
        // Sufijo único por corrida: aísla este test de otras corridas/tests.
        let tag = uuid::Uuid::new_v4().to_string();
        let ident = format!("user:9001-{tag}");
        let identidades = vec![ident.clone()];
        let ip = format!("iph-9001-{tag}");
        // 100 cargas distintas (jti único) del mismo visitante + inmueble.
        let tareas: Vec<_> = (0..100)
            .map(|i| {
                let jti = format!("jti-conc-{tag}-{i}");
                let e = entrada(
                    Box::leak(jti.into_boxed_str()),
                    9001,
                    Box::leak(Box::new(identidades.clone())),
                    Box::leak(ip.clone().into_boxed_str()),
                    29_851_501,
                    c,
                );
                async move {
                    let cliente = redis::Client::open(
                        std::env::var("VISTAS_TEST_REDIS_URL").unwrap(),
                    )
                    .unwrap();
                    let mut conn = cliente.get_multiplexed_async_connection().await.unwrap();
                    aplicar_estado(&mut conn, &e).await.unwrap().decision
                }
            })
            .collect();
        // Conteo sin join_all (sin crate extra): polling secuencial de handles.
        let mut handles = Vec::new();
        for fut in tareas {
            handles.push(tokio::spawn(fut));
        }
        let mut contadas = 0;
        let mut duplicadas = 0;
        for h in handles {
            match h.await.unwrap() {
                DecisionEstado::Counted => contadas += 1,
                DecisionEstado::Duplicado => duplicadas += 1,
                otra => panic!("motivo inesperado: {}", otra.motivo()),
            }
        }
        assert_eq!(contadas, 1, "exactamente una vista contada");
        assert_eq!(duplicadas, 99);

        // Reintento con un MISMO jti ya consumido → token_reutilizado.
        let jti_reuso = format!("jti-conc-{tag}-0");
        let e = entrada(&jti_reuso, 9001, &identidades, &ip, 29_851_501, c);
        let r = aplicar_estado(&mut conn, &e).await.unwrap();
        assert_eq!(r.decision, DecisionEstado::TokenReutilizado);
    }

    #[tokio::test]
    async fn tope_rechaza_sin_marcar_dedupe() {
        let Some(mut conn) = conexion_prueba().await else {
            eprintln!("skip: sin VISTAS_TEST_REDIS_URL");
            return;
        };
        let c = cfg();
        let tag = uuid::Uuid::new_v4().to_string();
        let ident = format!("user:9002-{tag}");
        let identidades = vec![ident.clone()];
        let ip = format!("iph-9002-{tag}");
        // Pre-siembra: el tope ya está lleno (5/5) sin ventana de dedupe.
        let cap: String = clave_tope(&ident, 9002, "2026-10-04");
        let _: () = redis::cmd("SET")
            .arg(&cap)
            .arg(5)
            .query_async(&mut conn)
            .await
            .unwrap();
        let jti_tope = format!("jti-tope-{tag}");
        let e = entrada(&jti_tope, 9002, &identidades, &ip, 29_851_502, &c);
        let r = aplicar_estado(&mut conn, &e).await.unwrap();
        assert_eq!(r.decision, DecisionEstado::TopeDiario);
        // §7: al rechazar por tope NO debe quedar marcada la ventana de dedupe.
        let dedupe: String = clave_dedupe(&ident, 9002);
        let existe: bool = redis::cmd("EXISTS")
            .arg(&dedupe)
            .query_async(&mut conn)
            .await
            .unwrap();
        assert!(!existe, "dedupe no debe marcarse si el tope rechaza");
    }

    #[tokio::test]
    async fn rate_limit_con_config_estricta() {
        let Some(mut conn) = conexion_prueba().await else {
            eprintln!("skip: sin VISTAS_TEST_REDIS_URL");
            return;
        };
        let mut c = cfg();
        c.rate_limit_events_per_minute = 0; // el primer evento ya excede
        let tag = uuid::Uuid::new_v4().to_string();
        let identidades = vec![format!("user:9003-{tag}")];
        let ip = format!("iph-9003-{tag}");
        let jti_rate = format!("jti-rate-{tag}");
        let e = entrada(&jti_rate, 9003, &identidades, &ip, 29_851_503, &c);
        let r = aplicar_estado(&mut conn, &e).await.unwrap();
        assert_eq!(r.decision, DecisionEstado::RateLimit);
    }

    #[tokio::test]
    async fn tope_por_ip_31_visitantes_distintos() {
        // Lote 2 + lote 3: 31 eventos con anon_id distintos, misma IP y
        // propiedad → 30 counted y el 31.º tope_ip (no tope_diario).
        let Some(mut conn) = conexion_prueba().await else {
            eprintln!("skip: sin VISTAS_TEST_REDIS_URL");
            return;
        };
        let mut c = cfg();
        c.rate_limit_events_per_minute = 10_000;
        c.daily_cap_per_ip = 30;
        let tag = uuid::Uuid::new_v4().to_string();
        let ip = format!("iph-topip-{tag}");
        let mut contadas = 0;
        for i in 0..31 {
            let identidades = vec![format!("anon:topip-{tag}-{i}")];
            let jti = format!("jti-topip-{tag}-{i}");
            let e = entrada(&jti, 9104, &identidades, &ip, 29_851_511, &c);
            let r = aplicar_estado(&mut conn, &e).await.unwrap();
            if i < 30 {
                assert_eq!(r.decision, DecisionEstado::Counted, "evento {i}");
                contadas += 1;
            } else {
                assert_eq!(r.decision, DecisionEstado::TopeIp, "evento 31");
            }
        }
        assert_eq!(contadas, 30);
    }

    #[tokio::test]
    async fn ips_distintas_no_se_afectan() {
        // Llena el tope de la IP-A (30 counted) y verifica que la IP-B,
        // misma propiedad, sigue contando.
        let Some(mut conn) = conexion_prueba().await else {
            eprintln!("skip: sin VISTAS_TEST_REDIS_URL");
            return;
        };
        let mut c = cfg();
        c.rate_limit_events_per_minute = 10_000;
        c.daily_cap_per_ip = 30;
        let tag = uuid::Uuid::new_v4().to_string();
        let ip_a = format!("iph-a-{tag}");
        for i in 0..30 {
            let identidades = vec![format!("anon:ipa-{tag}-{i}")];
            let jti = format!("jti-ipa-{tag}-{i}");
            let e = entrada(&jti, 9105, &identidades, &ip_a, 29_851_512, &c);
            let r = aplicar_estado(&mut conn, &e).await.unwrap();
            assert_eq!(r.decision, DecisionEstado::Counted);
        }
        let identidades_b = vec![format!("anon:ipb-{tag}-0")];
        let ip_b = format!("iph-b-{tag}");
        let jti_b = format!("jti-ipb-{tag}-0");
        let e = entrada(&jti_b, 9105, &identidades_b, &ip_b, 29_851_512, &c);
        let r = aplicar_estado(&mut conn, &e).await.unwrap();
        assert_eq!(r.decision, DecisionEstado::Counted);
    }

    #[tokio::test]
    async fn sin_ip_omite_controles_por_ip() {        // Punto 2: 31 eventos sin IP (distintos visitantes) → los 31 counted
        // (ni rate_ip ni tope_ip actúan) y no existe clave con segmento vacío.
        let Some(mut conn) = conexion_prueba().await else {
            eprintln!("skip: sin VISTAS_TEST_REDIS_URL");
            return;
        };
        let mut c = cfg();
        c.rate_limit_events_per_minute = 10_000;
        c.daily_cap_per_ip = 30;
        let tag = uuid::Uuid::new_v4().to_string();
        let bucket = 29_851_513_i64;
        for i in 0..31 {
            let identidades = vec![format!("anon:noip-{tag}-{i}")];
            let jti = format!("jti-noip-{tag}-{i}");
            let e = entrada(&jti, 9106, &identidades, "", bucket, &c);
            let r = aplicar_estado(&mut conn, &e).await.unwrap();
            assert_eq!(r.decision, DecisionEstado::Counted, "evento {i}");
        }
        let claves: Vec<String> = redis::cmd("KEYS")
            .arg("vistas:ratelimit:ip:*")
            .query_async(&mut conn)
            .await
            .unwrap();
        assert!(
            claves.iter().all(|k| !k.contains("::")),
            "ninguna clave de IP vacía: {claves:?}"
        );
    }

    #[tokio::test]
    async fn rate_ip_separado_31_sin_rate_limit() {
        // Lote 2.1a: 31 eventos, misma IP, visitantes distintos → ninguno es
        // rate_limit (el límite de IP es 120; el tope por IP se relaja aquí
        // para aislar el control).
        let Some(mut conn) = conexion_prueba().await else {
            eprintln!("skip: sin VISTAS_TEST_REDIS_URL");
            return;
        };
        let mut c = cfg();
        c.daily_cap_per_ip = 10_000;
        let tag = uuid::Uuid::new_v4().to_string();
        let ip = format!("iph-rl31-{tag}");
        for i in 0..31 {
            let identidades = vec![format!("anon:rl31-{tag}-{i}")];
            let jti = format!("jti-rl31-{tag}-{i}");
            let e = entrada(&jti, 9107, &identidades, &ip, 29_851_514, &c);
            let r = aplicar_estado(&mut conn, &e).await.unwrap();
            assert_eq!(r.decision, DecisionEstado::Counted, "evento {i}");
        }
    }

    #[tokio::test]
    async fn rate_ip_evento_121_da_rate_limit() {
        // Lote 2.1b: el evento 121 desde la misma IP (visitantes distintos,
        // topes relajados) es rate_limit.
        let Some(mut conn) = conexion_prueba().await else {
            eprintln!("skip: sin VISTAS_TEST_REDIS_URL");
            return;
        };
        let mut c = cfg();
        c.daily_cap_per_ip = 10_000;
        let tag = uuid::Uuid::new_v4().to_string();
        let ip = format!("iph-rl121-{tag}");
        for i in 0..121 {
            let identidades = vec![format!("anon:rl121-{tag}-{i}")];
            let jti = format!("jti-rl121-{tag}-{i}");
            let e = entrada(&jti, 9108, &identidades, &ip, 29_851_515, &c);
            let r = aplicar_estado(&mut conn, &e).await.unwrap();
            if i < 120 {
                assert_eq!(r.decision, DecisionEstado::Counted, "evento {i}");
            } else {
                assert_eq!(r.decision, DecisionEstado::RateLimit, "evento 121");
            }
        }
    }

    #[tokio::test]
    async fn rate_visitante_31_da_rate_limit() {
        // Lote 2.1c: 31 eventos del MISMO visitante → el 31.º es rate_limit
        // (límite de visitante 30). El 1.º cuenta y del 2.º al 30.º duplican.
        let Some(mut conn) = conexion_prueba().await else {
            eprintln!("skip: sin VISTAS_TEST_REDIS_URL");
            return;
        };
        let mut c = cfg();
        c.daily_cap_per_ip = 10_000;
        let tag = uuid::Uuid::new_v4().to_string();
        let identidades = vec![format!("anon:rlv-{tag}")];
        let ip = format!("iph-rlv-{tag}");
        for i in 0..31 {
            let jti = format!("jti-rlv-{tag}-{i}");
            let e = entrada(&jti, 9109, &identidades, &ip, 29_851_516, &c);
            let r = aplicar_estado(&mut conn, &e).await.unwrap();
            if i == 0 {
                assert_eq!(r.decision, DecisionEstado::Counted);
            } else if i < 30 {
                assert_eq!(r.decision, DecisionEstado::Duplicado, "evento {i}");
            } else {
                assert_eq!(r.decision, DecisionEstado::RateLimit, "evento 31");
            }
        }
    }
}
