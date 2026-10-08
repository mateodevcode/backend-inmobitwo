//! Algoritmo de Vista de Detalle — función de decisión PURA.
//!
//! Spec: `algoritmos/algoritmo_vista_detalle.md` (§2-§6, §12).
//! Reglas:
//! - Pura: entra evento + estado consultado + config + hora del servidor.
//!   Sale `counted` / `rejected` + motivo. Sin Redis, sin DB, sin reloj interno,
//!   sin efectos secundarios (los aplica quien la llama).
//! - Orden de pasos EXACTO según §4.3. Al primer fallo se detiene.
//! - `error_sistema` lo devuelve quien llama cuando la infra falla; aquí se
//!   modela con `estado.error_infraestructura = true` para que sea testeable.
//! - La firma HMAC del token y el hash de IP se verifican FUERA (Fase 3);
//!   aquí entran como booleanos ya evaluados (`token_firma_valida`, `ip_hash`).
//! - Bogotá = UTC-5 fijo (sin DST). `fecha_bogota_string` no necesita `chrono-tz`.

use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Configuración versionada (§3). Valores iniciales SOLO en `Default` + `from_env`.
// La lógica NUNCA usa literales, solo campos de este struct.
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VistaConfig {
    pub min_visible_seconds: u64,
    pub dedupe_window_minutes: u64,
    pub daily_cap_per_visitor_property: u32,
    /// Tope diario por (IP + inmueble + fecha Bogotá). 0 = sin tope.
    pub daily_cap_per_ip: u32,
    pub rate_limit_events_per_minute: u32,
    /// Límite por minuto solo para el contador de IP (visitante usa el anterior).
    pub rate_limit_ip_events_per_minute: u32,
    /// Tolerancia del chequeo de coherencia visible_seconds vs servidor.
    pub visible_tolerance_ms: u64,
    /// Capacidad del canal acotado del escritor de log (infra, no regla).
    pub log_channel_capacity: usize,
    pub token_max_age_minutes: u64,
    pub token_clock_tolerance_ms: u64,
    /// Corte diario. Solo informativo: el día lo calcula quien llama con
    /// `fecha_bogota_string` y pasa `estado.conteo_diario` ya acotado al día.
    pub timezone_day_cut: String,
    pub rules_version: String,
}

impl Default for VistaConfig {
    fn default() -> Self {
        Self {
            min_visible_seconds: 3,
            dedupe_window_minutes: 30,
            daily_cap_per_visitor_property: 5,
            daily_cap_per_ip: 30,
            rate_limit_events_per_minute: 30,
            rate_limit_ip_events_per_minute: 120,
            visible_tolerance_ms: 2000,
            log_channel_capacity: 10_000,
            token_max_age_minutes: 60,
            token_clock_tolerance_ms: 500,
            timezone_day_cut: "America/Bogota".to_string(),
            rules_version: "v1".to_string(),
        }
    }
}

impl VistaConfig {
    /// Lee env con fallback a los valores de la spec. Nunca panica.
    /// Vars: VISTA_MIN_VISIBLE_SECONDS, VISTA_DEDUPE_WINDOW_MINUTES,
    /// VISTA_DAILY_CAP, VISTA_DAILY_CAP_PER_IP, VISTA_RATE_LIMIT_PER_MINUTE,
    /// VISTA_RATE_LIMIT_IP_PER_MINUTE, VISTA_TOKEN_MAX_AGE_MINUTES,
    /// VISTA_TOKEN_CLOCK_TOLERANCE_MS, VISTA_VISIBLE_TOLERANCE_MS,
    /// VISTA_TIMEZONE, VISTA_RULES_VERSION,
    /// VISTA_LOG_CHANNEL_CAPACITY.
    pub fn from_env() -> Self {
        let mapa: std::collections::HashMap<String, String> = std::env::vars().collect();
        Self::from_mapa(&mapa)
    }

    /// Construye desde un mapa (la versión testeable de `from_env`: no toca
    /// el entorno global del proceso).
    pub fn from_mapa(vars: &std::collections::HashMap<String, String>) -> Self {
        let base = Self::default();
        let parse_u64 = |k: &str, d: u64| {
            vars.get(k)
                .and_then(|v| v.parse::<u64>().ok())
                .unwrap_or(d)
        };
        let parse_u32 = |k: &str, d: u32| {
            vars.get(k)
                .and_then(|v| v.parse::<u32>().ok())
                .unwrap_or(d)
        };
        Self {
            min_visible_seconds: parse_u64("VISTA_MIN_VISIBLE_SECONDS", base.min_visible_seconds),
            dedupe_window_minutes: parse_u64(
                "VISTA_DEDUPE_WINDOW_MINUTES",
                base.dedupe_window_minutes,
            ),
            daily_cap_per_visitor_property: parse_u32(
                "VISTA_DAILY_CAP",
                base.daily_cap_per_visitor_property,
            ),
            daily_cap_per_ip: parse_u32("VISTA_DAILY_CAP_PER_IP", base.daily_cap_per_ip),
            rate_limit_events_per_minute: parse_u32(
                "VISTA_RATE_LIMIT_PER_MINUTE",
                base.rate_limit_events_per_minute,
            ),
            rate_limit_ip_events_per_minute: parse_u32(
                "VISTA_RATE_LIMIT_IP_PER_MINUTE",
                base.rate_limit_ip_events_per_minute,
            ),
            log_channel_capacity: parse_u64(
                "VISTA_LOG_CHANNEL_CAPACITY",
                base.log_channel_capacity as u64,
            ) as usize,
            visible_tolerance_ms: parse_u64(
                "VISTA_VISIBLE_TOLERANCE_MS",
                base.visible_tolerance_ms,
            ),
            token_max_age_minutes: parse_u64(
                "VISTA_TOKEN_MAX_AGE_MINUTES",
                base.token_max_age_minutes,
            ),
            token_clock_tolerance_ms: parse_u64(
                "VISTA_TOKEN_CLOCK_TOLERANCE_MS",
                base.token_clock_tolerance_ms,
            ),
            timezone_day_cut: vars
                .get("VISTA_TIMEZONE")
                .filter(|s| !s.is_empty())
                .cloned()
                .unwrap_or(base.timezone_day_cut),
            rules_version: vars
                .get("VISTA_RULES_VERSION")
                .filter(|s| !s.is_empty())
                .cloned()
                .unwrap_or(base.rules_version),
        }
    }
}

// ---------------------------------------------------------------------------
// Motivos — lista cerrada §9 + `tope_ip` (lote 3) + `visible_incoherente`
// (lote 4, 17 valores). Los de agregado nunca dejan fila en vistas_log.
// ---------------------------------------------------------------------------

/// Motivo de rechazo. `Counted` va aparte (no es rechazo).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MotivoRechazo {
    EventoInvalido,
    TokenInvalido,
    TokenExpirado,
    TokenReutilizado,
    TiempoInsuficiente,
    InmuebleInexistente,
    InmuebleNoActivo,
    SinIdentidad,
    Interno,
    Bot,
    RateLimit,
    Duplicado,
    TopeDiario,
    /// Tope diario por IP (lote 3): el Lua lo distingue del de visitante.
    TopeIp,
    /// visible_seconds imposible frente al tiempo de servidor (lote 4).
    /// Solo agregado en Redis, sin fila.
    VisibleIncoherente,
    ErrorSistema,
}

impl MotivoRechazo {
    pub fn as_str(&self) -> &'static str {
        match self {
            MotivoRechazo::EventoInvalido => "evento_invalido",
            MotivoRechazo::TokenInvalido => "token_invalido",
            MotivoRechazo::TokenExpirado => "token_expirado",
            MotivoRechazo::TokenReutilizado => "token_reutilizado",
            MotivoRechazo::TiempoInsuficiente => "tiempo_insuficiente",
            MotivoRechazo::InmuebleInexistente => "inmueble_inexistente",
            MotivoRechazo::InmuebleNoActivo => "inmueble_no_activo",
            MotivoRechazo::SinIdentidad => "sin_identidad",
            MotivoRechazo::Interno => "interno",
            MotivoRechazo::Bot => "bot",
            MotivoRechazo::RateLimit => "rate_limit",
            MotivoRechazo::Duplicado => "duplicado",
            MotivoRechazo::TopeDiario => "tope_diario",
            MotivoRechazo::TopeIp => "tope_ip",
            MotivoRechazo::VisibleIncoherente => "visible_incoherente",
            MotivoRechazo::ErrorSistema => "error_sistema",
        }
    }
}

// ---------------------------------------------------------------------------
// Entrada
// ---------------------------------------------------------------------------

/// Evento enriquecido por Node (arch. decisión 2: Node autentica con
/// `verificarTokenOpcional`, resuelve IP real de X-Real-IP, user-agent,
/// estado del inmueble e `es_interno`; Rust NUNCA usa la IP de su conexión).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VistaEvento {
    /// Falso si falta estructura/tipos (campos obligatorios ausentes).
    pub estructura_valida: bool,
    /// Resultado de verificar HMAC-SHA256 con VIEW_TOKEN_SECRET (Fase 3).
    pub token_firma_valida: bool,
    /// property_id declarado en el evento (body).
    pub property_id: i32,
    /// property_id contenido DENTRO del token. Debe coincidir.
    pub token_property_id: i32,
    /// Emisión del token, hora del SERVIDOR (ms Unix UTC). Nunca hora cliente.
    pub token_emitido_en_ms: i64,
    /// Identidad prioritaria §5.1: sesión JWT.
    pub user_id: Option<i32>,
    /// Cookie propia `anon_id` (= session_id del frontend). Solo si hubo
    /// consentimiento; sin consentimiento va `None` y se cae a débil.
    pub anon_id: Option<String>,
    /// Hash IP+UA con VIEW_IP_SALT. `None` si no se pudo construir.
    pub ip_hash: Option<String>,
    /// Enriquecido por Node: dueño / agente asignado / miembro activo de la
    /// org del inmueble / superadmin / cookie de interno.
    pub es_interno: bool,
    /// Enriquecido por quien llama: UA de bot / UA ausente / IP datacenter
    /// (lista actualizable sin redeploy, evaluada FUERA de esta función).
    pub es_bot: bool,
    /// Segundos visibles reportados por el cliente (informativo). Si supera
    /// el tiempo transcurrido en servidor + tolerancia es imposible y se
    /// rechaza (lote 3). `None` no rechaza.
    pub visible_seconds: Option<i64>,
}

impl VistaEvento {
    /// ¿Hay alguna identidad construible? (§5: user > anon > débil)
    pub fn tiene_identidad(&self) -> bool {
        self.user_id.is_some()
            || self
                .anon_id
                .as_ref()
                .map(|s| !s.is_empty())
                .unwrap_or(false)
            || self
                .ip_hash
                .as_ref()
                .map(|s| !s.is_empty())
                .unwrap_or(false)
    }

    /// Solo existe la identidad débil → log marca `identidad_debil = true` (§5.2).
    pub fn es_identidad_debil(&self) -> bool {
        self.user_id.is_none()
            && !self
                .anon_id
                .as_ref()
                .map(|s| !s.is_empty())
                .unwrap_or(false)
            && self
                .ip_hash
                .as_ref()
                .map(|s| !s.is_empty())
                .unwrap_or(false)
    }
}

/// Estado consultado FUERA (DB/Redis/listas). Todo booleano/conteo.
/// `ventana_dedupe_ocupada` y `conteo_diario` ya consideran TODAS las
/// identidades vinculadas anon<->user (§5.3).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct VistaEstadoConsultado {
    /// El token ya fue marcado como usado en Redis (uso único, atómico).
    pub token_ya_usado: bool,
    pub inmueble_existe: bool,
    /// Activo = `estado='publicado' AND listing_status='active'
    /// AND (expires_at IS NULL OR expires_at > ahora)` (decisión 7).
    pub inmueble_activo: bool,
    /// Vista `counted` del mismo visitante+inmueble dentro de la ventana.
    pub ventana_dedupe_ocupada: bool,
    /// Vistas `counted` del visitante+inmueble en el día Colombia vigente.
    pub conteo_diario: u32,
    /// Eventos recibidos (cualquier resultado) último minuto, por visitante.
    pub eventos_visitante_ultimo_minuto: u32,
    /// Idem por IP hasheada.
    pub eventos_ip_ultimo_minuto: u32,
    /// Redis/DB caídos en la consulta previa → `error_sistema` (fail-closed).
    pub error_infraestructura: bool,
}

// ---------------------------------------------------------------------------
// Salida
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VistaResultado {
    Counted,
    Rejected,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VistaDecision {
    pub resultado: VistaResultado,
    /// "counted" o el motivo snake_case.
    pub motivo: String,
    /// `true` solo cuando se construyó con identidad débil (§5.2).
    pub identidad_debil: bool,
    /// `true` en `rate_limit` (y lo que marque quien llama).
    pub sospechoso: bool,
    pub rules_version: String,
}

impl VistaDecision {
    pub fn counted(identidad_debil: bool, rules_version: String) -> Self {
        Self {
            resultado: VistaResultado::Counted,
            motivo: "counted".to_string(),
            identidad_debil,
            sospechoso: false,
            rules_version,
        }
    }

    pub fn rejected(
        motivo: MotivoRechazo,
        identidad_debil: bool,
        rules_version: String,
        sospechoso: bool,
    ) -> Self {
        Self {
            resultado: VistaResultado::Rejected,
            motivo: motivo.as_str().to_string(),
            identidad_debil,
            sospechoso,
            rules_version,
        }
    }

    pub fn es_contada(&self) -> bool {
        self.resultado == VistaResultado::Counted
    }
}

// ---------------------------------------------------------------------------
// Función pura (§4.3, orden exacto). `ahora_ms`: hora del SERVIDOR (ms Unix UTC).
// ---------------------------------------------------------------------------

pub fn decidir_vista(
    evento: &VistaEvento,
    estado: &VistaEstadoConsultado,
    config: &VistaConfig,
    ahora_ms: i64,
) -> VistaDecision {
    let rv = config.rules_version.clone();
    // Identidad débil se calcula igual para counted y rejected (§5.2: el log
    // siempre la marca). Si no hay identidad, va `false` (no hay ni débil).
    let debil = evento.es_identidad_debil();

    // Infra caída: fail-closed antes de decidir (principio 6).
    if estado.error_infraestructura {
        return VistaDecision::rejected(MotivoRechazo::ErrorSistema, debil, rv, false);
    }

    // --- Paso 1: validación del evento ---
    if !evento.estructura_valida {
        return VistaDecision::rejected(MotivoRechazo::EventoInvalido, debil, rv, false);
    }
    if !evento.token_firma_valida {
        return VistaDecision::rejected(MotivoRechazo::TokenInvalido, debil, rv, false);
    }
    if evento.property_id != evento.token_property_id {
        return VistaDecision::rejected(MotivoRechazo::TokenInvalido, debil, rv, false);
    }
    // Expiración: emitido hace más de token_max_age_minutes.
    let edad_ms = ahora_ms.saturating_sub(evento.token_emitido_en_ms);
    let max_edad_ms = (config.token_max_age_minutes as i64).saturating_mul(60_000);
    // Emitido en el futuro más allá de la tolerancia también es inválido
    // (reloj / token fabricado), no "expirado".
    if evento.token_emitido_en_ms > ahora_ms + config.token_clock_tolerance_ms as i64 {
        return VistaDecision::rejected(MotivoRechazo::TokenInvalido, debil, rv, false);
    }
    if edad_ms > max_edad_ms {
        return VistaDecision::rejected(MotivoRechazo::TokenExpirado, debil, rv, false);
    }
    if estado.token_ya_usado {
        return VistaDecision::rejected(MotivoRechazo::TokenReutilizado, debil, rv, false);
    }
    // Coherencia de tiempo (lote 3, tolerancia propia en lote 4): el cliente
    // no puede haber visto más de lo transcurrido en servidor (+ tolerancia).
    // Nulo no rechaza. El motivo es de agregado, sin fila. Va ANTES de
    // tiempo_insuficiente: un visible imposible se reporta como tal aunque el
    // transcurrido tampoco alcance el mínimo.
    if let Some(v) = evento.visible_seconds {
        if v.saturating_mul(1000) > edad_ms.saturating_add(config.visible_tolerance_ms as i64) {
            return VistaDecision::rejected(MotivoRechazo::VisibleIncoherente, debil, rv, false);
        }
    }
    // Tiempo visible: transcurrido servidor >= min_visible - tolerancia.
    // Se usa la hora del servidor, NUNCA la del cliente (caso borde §6).
    let minimo_ms =
        (config.min_visible_seconds as i64).saturating_mul(1000) - config.token_clock_tolerance_ms as i64;
    let minimo_ms = minimo_ms.max(0);
    if edad_ms < minimo_ms {
        return VistaDecision::rejected(MotivoRechazo::TiempoInsuficiente, debil, rv, false);
    }

    // --- Paso 2: estado del inmueble ---
    if !estado.inmueble_existe {
        return VistaDecision::rejected(MotivoRechazo::InmuebleInexistente, debil, rv, false);
    }
    if !estado.inmueble_activo {
        return VistaDecision::rejected(MotivoRechazo::InmuebleNoActivo, debil, rv, false);
    }

    // --- Paso 3: identidad ---
    if !evento.tiene_identidad() {
        return VistaDecision::rejected(MotivoRechazo::SinIdentidad, false, rv, false);
    }

    // --- Paso 4: internos ---
    if evento.es_interno {
        return VistaDecision::rejected(MotivoRechazo::Interno, debil, rv, false);
    }

    // --- Paso 5: bots ---
    if evento.es_bot {
        return VistaDecision::rejected(MotivoRechazo::Bot, debil, rv, false);
    }

    // --- Paso 6: rate limit (visitante con su límite, IP con el suyo).
    // NOTA: quien llama incrementa estos contadores con CADA evento recibido,
    // sea cual sea el resultado posterior (§4.3.6).
    if estado.eventos_visitante_ultimo_minuto > config.rate_limit_events_per_minute
        || estado.eventos_ip_ultimo_minuto > config.rate_limit_ip_events_per_minute
    {
        return VistaDecision::rejected(MotivoRechazo::RateLimit, debil, rv, true);
    }

    // --- Paso 7: dedupe ANTES que tope (nota §4.3: duplicado no consume cupo).
    if estado.ventana_dedupe_ocupada {
        return VistaDecision::rejected(MotivoRechazo::Duplicado, debil, rv, false);
    }

    // --- Paso 8: tope diario (día Colombia, calculado por quien llama).
    if estado.conteo_diario >= config.daily_cap_per_visitor_property {
        return VistaDecision::rejected(MotivoRechazo::TopeDiario, debil, rv, false);
    }

    // --- Paso 9: aprobado. Efectos los aplica quien llama (dedupe, tope,
    // contador, visitantes únicos, log) — ver §4.3.9 y §7 (atómico en Redis).
    VistaDecision::counted(debil, rv)
}

// ---------------------------------------------------------------------------
// Día Colombia (UTC-5 fijo, sin DST). Quien llama lo usa para acotar el tope.
// ---------------------------------------------------------------------------

/// Lee una variable de entorno para tests de integración (punto 6): si falta
/// y no existe `VISTAS_SKIP_INTEGRATION=1`, PANIC con mensaje claro en vez de
/// omitir en silencio. Con `=1`, devuelve `None` y el test se auto-omite.
pub fn req_env_integracion(nombre: &str) -> Option<String> {
    match std::env::var(nombre) {
        Ok(v) => Some(v),
        Err(_) if std::env::var("VISTAS_SKIP_INTEGRATION").ok().as_deref() == Some("1") => {
            eprintln!("SKIP deliberado: falta {nombre} (VISTAS_SKIP_INTEGRATION=1)");
            None
        }
        Err(_) => panic!(
            "falta {nombre}: define VISTAS_TEST_PG_URL y VISTAS_TEST_REDIS_URL o usa VISTAS_SKIP_INTEGRATION=1"
        ),
    }
}

/// `ahora_ms` (UTC) → `"YYYY-MM-DD"` en Bogotá. Aritmética pura y determinista.
pub fn fecha_bogota_string(ahora_ms: i64) -> String {    const OFFSET_S: i64 = -5 * 3600;
    let unix_s = ahora_ms.div_euclid(1000) + OFFSET_S;
    let days = unix_s.div_euclid(86_400);
    // Algoritmo civil-days (Howard Hinnant), válido para todo el rango i64.
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64; // [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365; // [0, 399]
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let d = doy - (153 * mp + 2) / 5 + 1; // [1, 31]
    let m = if mp < 10 { mp + 3 } else { mp - 9 }; // [1, 12]
    let year = if m <= 2 { y + 1 } else { y };
    format!("{:04}-{:02}-{:02}", year, m, d)
}

// ---------------------------------------------------------------------------
// Tests obligatorios §12 (deterministas, sin I/O, sin sleep).
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    /// 2025-10-04 06:40:00 UTC = 01:40 Bogotá (mismo día).
    const AHORA: i64 = 1_759_560_000_000;
    /// Emitido hace 10 s (supera min 3 s, dentro de max 60 min).
    const EMITIDO_OK: i64 = AHORA - 10_000;

    fn evento_base() -> VistaEvento {
        VistaEvento {
            estructura_valida: true,
            token_firma_valida: true,
            property_id: 7,
            token_property_id: 7,
            token_emitido_en_ms: EMITIDO_OK,
            user_id: Some(42),
            anon_id: Some("anon-abc".to_string()),
            ip_hash: Some("iph-1".to_string()),
            es_interno: false,
            es_bot: false,
            visible_seconds: None,
        }
    }

    fn estado_base() -> VistaEstadoConsultado {
        VistaEstadoConsultado {
            token_ya_usado: false,
            inmueble_existe: true,
            inmueble_activo: true,
            ventana_dedupe_ocupada: false,
            conteo_diario: 0,
            eventos_visitante_ultimo_minuto: 0,
            eventos_ip_ultimo_minuto: 0,
            error_infraestructura: false,
        }
    }

    fn cfg() -> VistaConfig {
        VistaConfig::default()
    }

    fn mapa_env(vars: &[(&str, &str)]) -> std::collections::HashMap<String, String> {
        vars.iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }

    // --- 1 prueba por motivo (§12.1): counted + 14 rechazos ---

    #[test]
    fn counted_caso_feliz() {
        let d = decidir_vista(&evento_base(), &estado_base(), &cfg(), AHORA);
        assert!(d.es_contada());
        assert_eq!(d.motivo, "counted");
        assert_eq!(d.rules_version, "v1");
        assert!(!d.sospechoso);
        assert!(!d.identidad_debil);
    }

    #[test]
    fn rechaza_evento_invalido() {
        let mut e = evento_base();
        e.estructura_valida = false;
        let d = decidir_vista(&e, &estado_base(), &cfg(), AHORA);
        assert_eq!(d.motivo, "evento_invalido");
        assert!(!d.es_contada());
    }

    #[test]
    fn rechaza_token_invalido_firma() {
        let mut e = evento_base();
        e.token_firma_valida = false;
        let d = decidir_vista(&e, &estado_base(), &cfg(), AHORA);
        assert_eq!(d.motivo, "token_invalido");
    }

    #[test]
    fn rechaza_token_invalido_otro_inmueble() {
        let mut e = evento_base();
        e.token_property_id = 999;
        let d = decidir_vista(&e, &estado_base(), &cfg(), AHORA);
        assert_eq!(d.motivo, "token_invalido");
    }

    #[test]
    fn rechaza_token_invalido_emitido_en_futuro() {
        let mut e = evento_base();
        e.token_emitido_en_ms = AHORA + 60_000; // más allá de tolerancia 500ms
        let d = decidir_vista(&e, &estado_base(), &cfg(), AHORA);
        assert_eq!(d.motivo, "token_invalido");
    }

    #[test]
    fn rechaza_token_expirado() {
        let mut e = evento_base();
        e.token_emitido_en_ms = AHORA - 61 * 60_000;
        let d = decidir_vista(&e, &estado_base(), &cfg(), AHORA);
        assert_eq!(d.motivo, "token_expirado");
    }

    #[test]
    fn rechaza_token_reutilizado() {
        let mut s = estado_base();
        s.token_ya_usado = true;
        let d = decidir_vista(&evento_base(), &s, &cfg(), AHORA);
        assert_eq!(d.motivo, "token_reutilizado");
    }

    #[test]
    fn rechaza_tiempo_insuficiente() {
        let mut e = evento_base();
        e.token_emitido_en_ms = AHORA - 1_000; // 1s < 3s - 0.5s
        let d = decidir_vista(&e, &estado_base(), &cfg(), AHORA);
        assert_eq!(d.motivo, "tiempo_insuficiente");
    }

    #[test]
    fn acepta_en_borde_tolerancia() {
        // 2500ms = 3000 - 500 → pasa justo en el borde.
        let mut e = evento_base();
        e.token_emitido_en_ms = AHORA - 2_500;
        let d = decidir_vista(&e, &estado_base(), &cfg(), AHORA);
        assert!(d.es_contada(), "borde 2500ms debe contar, fue {}", d.motivo);
        e.token_emitido_en_ms = AHORA - 2_499;
        let d2 = decidir_vista(&e, &estado_base(), &cfg(), AHORA);
        assert_eq!(d2.motivo, "tiempo_insuficiente");
    }

    #[test]
    fn rechaza_inmueble_inexistente() {
        let mut s = estado_base();
        s.inmueble_existe = false;
        let d = decidir_vista(&evento_base(), &s, &cfg(), AHORA);
        assert_eq!(d.motivo, "inmueble_inexistente");
    }

    #[test]
    fn rechaza_inmueble_no_activo() {
        let mut s = estado_base();
        s.inmueble_activo = false; // pausado/vendido/arrendado/borrador/expirado
        let d = decidir_vista(&evento_base(), &s, &cfg(), AHORA);
        assert_eq!(d.motivo, "inmueble_no_activo");
    }

    #[test]
    fn rechaza_sin_identidad() {
        let mut e = evento_base();
        e.user_id = None;
        e.anon_id = None;
        e.ip_hash = None;
        let d = decidir_vista(&e, &estado_base(), &cfg(), AHORA);
        assert_eq!(d.motivo, "sin_identidad");
    }

    #[test]
    fn rechaza_interno() {
        let mut e = evento_base();
        e.es_interno = true;
        let d = decidir_vista(&e, &estado_base(), &cfg(), AHORA);
        assert_eq!(d.motivo, "interno");
    }

    #[test]
    fn rechaza_bot() {
        let mut e = evento_base();
        e.es_bot = true;
        let d = decidir_vista(&e, &estado_base(), &cfg(), AHORA);
        assert_eq!(d.motivo, "bot");
    }

    #[test]
    fn rechaza_rate_limit_visitante_y_marca_sospechoso() {
        let mut s = estado_base();
        s.eventos_visitante_ultimo_minuto = 31;
        let d = decidir_vista(&evento_base(), &s, &cfg(), AHORA);
        assert_eq!(d.motivo, "rate_limit");
        assert!(d.sospechoso);
    }

    #[test]
    fn rechaza_rate_limit_solo_ip() {
        // CGNAT/oficina: misma IP, distinto visitante. El límite por IP (120,
        // lote 2) es independiente del de visitante (30) y SÍ bloquea al
        // excederse: marca sospechoso sin bloquear de forma permanente.
        let mut s = estado_base();
        s.eventos_ip_ultimo_minuto = 121;
        let d = decidir_vista(&evento_base(), &s, &cfg(), AHORA);
        assert_eq!(d.motivo, "rate_limit");
        assert!(d.sospechoso);
    }

    #[test]
    fn limite_ip_independiente_del_visitante() {
        let mut s = estado_base();
        s.eventos_ip_ultimo_minuto = 31; // bajo el límite de IP (120)
        s.eventos_visitante_ultimo_minuto = 0;
        assert!(decidir_vista(&evento_base(), &s, &cfg(), AHORA).es_contada());
        s.eventos_ip_ultimo_minuto = 120; // en el borde: aún pasa
        assert!(decidir_vista(&evento_base(), &s, &cfg(), AHORA).es_contada());
        s.eventos_ip_ultimo_minuto = 121; // excedido
        assert_eq!(decidir_vista(&evento_base(), &s, &cfg(), AHORA).motivo, "rate_limit");
        // El de visitante sigue en 30 aunque el de IP sea 120.
        let mut s2 = estado_base();
        s2.eventos_visitante_ultimo_minuto = 31;
        assert_eq!(decidir_vista(&evento_base(), &s2, &cfg(), AHORA).motivo, "rate_limit");
    }

    #[test]
    fn no_rechaza_rate_limit_en_el_limite() {
        let mut s = estado_base();
        s.eventos_visitante_ultimo_minuto = 30;
        s.eventos_ip_ultimo_minuto = 30;
        let d = decidir_vista(&evento_base(), &s, &cfg(), AHORA);
        assert!(d.es_contada());
    }

    #[test]
    fn rechaza_duplicado() {
        let mut s = estado_base();
        s.ventana_dedupe_ocupada = true;
        let d = decidir_vista(&evento_base(), &s, &cfg(), AHORA);
        assert_eq!(d.motivo, "duplicado");
    }

    #[test]
    fn dedupe_va_antes_que_tope_y_no_consume_cupo() {
        // Nota §4.3: si hay duplicado Y tope lleno, el motivo debe ser
        // `duplicado` (el más frecuente y el que no consume cupo).
        let mut s = estado_base();
        s.ventana_dedupe_ocupada = true;
        s.conteo_diario = 5;
        let d = decidir_vista(&evento_base(), &s, &cfg(), AHORA);
        assert_eq!(d.motivo, "duplicado");
    }

    #[test]
    fn rechaza_tope_diario() {
        let mut s = estado_base();
        s.conteo_diario = 5;
        let d = decidir_vista(&evento_base(), &s, &cfg(), AHORA);
        assert_eq!(d.motivo, "tope_diario");
    }

    #[test]
    fn rechaza_error_sistema_con_fail_closed() {
        let mut s = estado_base();
        s.error_infraestructura = true; // caída Redis/DB
        let d = decidir_vista(&evento_base(), &s, &cfg(), AHORA);
        assert_eq!(d.motivo, "error_sistema");
        assert!(!d.es_contada(), "en duda por fallo NO se cuenta a ciegas");
    }

    #[test]
    fn orden_pasos_el_primero_que_falla_manda() {
        // Token inválido + inmueble inexistente + sin identidad →
        // debe salir `token_invalido` (paso 1 antes que 2 y 3).
        let mut e = evento_base();
        e.token_firma_valida = false;
        e.user_id = None;
        e.anon_id = None;
        e.ip_hash = None;
        let mut s = estado_base();
        s.inmueble_existe = false;
        let d = decidir_vista(&e, &s, &cfg(), AHORA);
        assert_eq!(d.motivo, "token_invalido");
    }

    // --- Identidad §5 ---

    #[test]
    fn identidad_debil_solo_ip_hash_cuenta_pero_marca_flag() {
        let mut e = evento_base();
        e.user_id = None;
        e.anon_id = None; // cookies rechazadas → cae a débil
        let d = decidir_vista(&e, &estado_base(), &cfg(), AHORA);
        assert!(d.es_contada());
        assert!(d.identidad_debil);
    }

    #[test]
    fn anon_id_solo_no_es_debil() {
        let mut e = evento_base();
        e.user_id = None;
        let d = decidir_vista(&e, &estado_base(), &cfg(), AHORA);
        assert!(d.es_contada());
        assert!(!d.identidad_debil);
    }

    #[test]
    fn cambio_de_ip_no_afecta_con_anon_o_user() {
        // wifi→datos: la decisión no usa la IP salvo rate-limit/identidad
        // débil; con anon_id el cambio es irrelevante.
        let mut e = evento_base();
        e.ip_hash = Some("iph-nueva".to_string());
        let d = decidir_vista(&e, &estado_base(), &cfg(), AHORA);
        assert!(d.es_contada());
    }

    // --- Casos borde §6 (mapeo explícito) ---

    #[test]
    fn borde_recarga_cae_en_duplicado() {
        // Recarga = nuevo token, pero vista contada <30min → duplicado.
        let mut s = estado_base();
        s.ventana_dedupe_ocupada = true;
        let d = decidir_vista(&evento_base(), &s, &cfg(), AHORA);
        assert_eq!(d.motivo, "duplicado");
    }

    #[test]
    fn borde_bfcache_no_duplica_por_token_unico() {
        // Atrás/adelante reutiliza la carga → mismo jti → reutilizado.
        let mut s = estado_base();
        s.token_ya_usado = true;
        let d = decidir_vista(&evento_base(), &s, &cfg(), AHORA);
        assert_eq!(d.motivo, "token_reutilizado");
    }

    #[test]
    fn borde_multi_pestana_solo_cuenta_una() {
        // Dos pestañas = dos tokens distintos, pero la segunda ve la ventana.
        let mut s = estado_base();
        s.ventana_dedupe_ocupada = true;
        let d = decidir_vista(&evento_base(), &s, &cfg(), AHORA);
        assert_eq!(d.motivo, "duplicado");
    }

    #[test]
    fn borde_reintento_red_segundo_evento_reutilizado() {
        let mut s = estado_base();
        s.token_ya_usado = true;
        let d = decidir_vista(&evento_base(), &s, &cfg(), AHORA);
        assert_eq!(d.motivo, "token_reutilizado");
    }

    #[test]
    fn borde_despublicado_entre_carga_y_evento() {
        let mut s = estado_base();
        s.inmueble_activo = false;
        let d = decidir_vista(&evento_base(), &s, &cfg(), AHORA);
        assert_eq!(d.motivo, "inmueble_no_activo");
    }

    #[test]
    fn borde_reloj_cliente_manipulado_es_irrelevante() {
        // No hay campo "hora cliente" en la entrada: imposible que afecte.
        // El elapsed solo usa token_emitido (servidor) vs ahora (servidor).
        let d = decidir_vista(&evento_base(), &estado_base(), &cfg(), AHORA);
        assert!(d.es_contada());
    }

    #[test]
    fn borde_token_fabricado() {
        let mut e = evento_base();
        e.token_firma_valida = false;
        let d = decidir_vista(&e, &estado_base(), &cfg(), AHORA);
        assert_eq!(d.motivo, "token_invalido");
    }

    #[test]
    fn borde_caida_redis_es_error_sistema() {
        let mut s = estado_base();
        s.error_infraestructura = true;
        let d = decidir_vista(&evento_base(), &s, &cfg(), AHORA);
        assert_eq!(d.motivo, "error_sistema");
    }

    #[test]
    fn borde_interno_sin_sesion_cubierto_por_flag() {
        // El cookie de interno lo resuelve Node y llega como es_interno.
        let mut e = evento_base();
        e.user_id = None;
        e.es_interno = true;
        let d = decidir_vista(&e, &estado_base(), &cfg(), AHORA);
        assert_eq!(d.motivo, "interno");
    }

    #[test]
    fn borde_borrado_cookies_genera_identidad_nueva() {
        // Limitación conocida: anon nuevo → no hay dedupe contra el anterior.
        // Se documenta con este test: con anon distinto y sin ventana, cuenta.
        let mut e = evento_base();
        e.user_id = None;
        e.anon_id = Some("anon-nuevo-incognito".to_string());
        let d = decidir_vista(&e, &estado_base(), &cfg(), AHORA);
        assert!(d.es_contada());
    }

    // --- Medianoche Colombia (§12.4) ---

    #[test]
    fn medianoche_bogota_corta_a_las_00() {
        // 2026-10-04 04:59:59 UTC = 2026-10-03 23:59:59 Bogotá.
        // 2026-10-04 05:00:00 UTC = 2026-10-04 00:00:00 Bogotá.
        assert_eq!(fecha_bogota_string(1_791_089_999_000), "2026-10-03");
        assert_eq!(fecha_bogota_string(1_791_090_000_000), "2026-10-04");
    }

    #[test]
    fn tope_compara_conteo_contra_limite() {
        // Quien llama pasa conteo_diario ya acotado al día Bogotá
        // (fecha_bogota_string). La función solo compara contra el tope:
        // con 5 cuenta el rechazo aunque en UTC sea otro día.
        // OJO: se usa AHORA para no invalidar el token por expiración.
        let mut s = estado_base();
        s.conteo_diario = 5;
        let d = decidir_vista(&evento_base(), &s, &cfg(), AHORA);
        assert_eq!(d.motivo, "tope_diario");
        s.conteo_diario = 4;
        let d2 = decidir_vista(&evento_base(), &s, &cfg(), AHORA);
        assert!(d2.es_contada());
    }

    // --- Coherencia visible_seconds (lote 3) ---

    #[test]
    fn visible_imposible_rechaza() {
        // 100 s visibles con 10 s transcurridos en servidor → imposible.
        let mut e = evento_base();
        e.visible_seconds = Some(100);
        let d = decidir_vista(&e, &estado_base(), &cfg(), AHORA);
        assert_eq!(d.motivo, "visible_incoherente");
        assert!(!d.es_contada());
    }

    #[test]
    fn visible_coherente_cuenta() {
        // 8 s visibles con 10 s transcurridos → coherente.
        let mut e = evento_base();
        e.visible_seconds = Some(8);
        let d = decidir_vista(&e, &estado_base(), &cfg(), AHORA);
        assert!(d.es_contada(), "esperaba counted, fue {}", d.motivo);
    }

    #[test]
    fn visible_nulo_cuenta() {
        let mut e = evento_base();
        e.visible_seconds = None;
        let d = decidir_vista(&e, &estado_base(), &cfg(), AHORA);
        assert!(d.es_contada());
    }

    #[test]
    fn visible_3s_con_token_de_2s_no_es_incoherente() {
        // Lote 4 punto 2: 3 s visibles y token de hace 2 s → coherente
        // (3000 ≤ 2000 + 2000 de tolerancia). Falla después por
        // tiempo_insuficiente (min 3 s − 0,5 s), que es otro motivo.
        let mut e = evento_base();
        e.token_emitido_en_ms = AHORA - 2_000;
        e.visible_seconds = Some(3);
        let d = decidir_vista(&e, &estado_base(), &cfg(), AHORA);
        assert_eq!(d.motivo, "tiempo_insuficiente");
    }

    #[test]
    fn visible_10s_con_2s_medidos_es_incoherente() {
        // Lote 4 punto 2: 10 s visibles con 2 s medidos en servidor →
        // 10000 > 2000 + 2000 de tolerancia → visible_incoherente (antes que
        // tiempo_insuficiente: lo imposible se reporta como tal).
        let mut e = evento_base();
        e.token_emitido_en_ms = AHORA - 2_000;
        e.visible_seconds = Some(10);
        let d = decidir_vista(&e, &estado_base(), &cfg(), AHORA);
        assert_eq!(d.motivo, "visible_incoherente");
    }

    // --- §12.5: cambiar parámetro cambia el resultado sin tocar la lógica ---

    #[test]
    fn cambiar_parametro_cambia_resultado() {
        let mut c5 = cfg();
        c5.daily_cap_per_visitor_property = 1;
        let mut s = estado_base();
        s.conteo_diario = 1;
        let d = decidir_vista(&evento_base(), &s, &c5, AHORA);
        assert_eq!(d.motivo, "tope_diario");

        let mut c10 = cfg();
        c10.daily_cap_per_visitor_property = 10;
        let d2 = decidir_vista(&evento_base(), &s, &c10, AHORA);
        assert!(d2.es_contada());

        // min_visible_seconds también es configurable:
        let mut c0 = cfg();
        c0.min_visible_seconds = 0;
        let mut e = evento_base();
        e.token_emitido_en_ms = AHORA; // 0ms transcurridos
        let d3 = decidir_vista(&e, &estado_base(), &c0, AHORA);
        assert!(d3.es_contada());
    }

    #[test]
    fn from_env_respeta_variables() {
        // Punto 7: no toca el entorno global; recibe un mapa.
        let c = VistaConfig::from_mapa(&mapa_env(&[
            ("VISTA_DAILY_CAP", "9"),
            ("VISTA_RULES_VERSION", "v-test"),
            ("VISTA_NO_NUMERICO", "abc"),
        ]));
        assert_eq!(c.daily_cap_per_visitor_property, 9);
        assert_eq!(c.rules_version, "v-test");
        let c2 = VistaConfig::from_mapa(&mapa_env(&[]));
        assert_eq!(c2.daily_cap_per_visitor_property, 5);
        assert_eq!(c2.rules_version, "v1");
    }

    // --- §12.6: reproducibilidad ---

    #[test]
    fn mismo_input_mismo_output() {
        let e = evento_base();
        let s = estado_base();
        let c = cfg();
        let a = decidir_vista(&e, &s, &c, AHORA);
        let b = decidir_vista(&e, &s, &c, AHORA);
        assert_eq!(a.motivo, b.motivo);
        assert_eq!(a.es_contada(), b.es_contada());
        assert_eq!(a.rules_version, b.rules_version);
    }
}
