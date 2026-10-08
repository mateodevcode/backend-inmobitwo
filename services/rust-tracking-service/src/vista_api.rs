//! Endpoint `POST /tracking/vista` (Fase 5).
//!
//! La decisión vive aquí (Rust). Node solo enriquece y reenvía, sin fallback
//! (decisión 3): si Rust no responde, Node contesta `error_sistema`.
//!
//! Orden del handler (mismos motivos y orden que la spec §4.3):
//! 1. `verificar_view_token` → `token_invalido` / `token_expirado`.
//! 2. DB `propiedades` → `inmueble_inexistente` / `inmueble_no_activo`.
//!    (Activo = `estado='publicado' AND listing_status='active'`
//!    `AND (expires_at IS NULL OR expires_at > ahora)`, decisión 7.)
//! 3. Identidad `user_id` > `anon_id` > hash(IP+UA). Sin ninguna → `sin_identidad`.
//!    Si hay `user_id` + `anon_id`, se vinculan (`vistas_identidades`, §5.3).
//! 4. `es_interno` (calculado por Node) → `interno`.
//! 5. Bots: sin user-agent, subcadena en Redis `vistas:bot:ua` (+ lista base
//!    compilada) o IP en `vistas:bot:ip` → `bot`. Listas actualizables sin
//!    redeploy vía `redis-cli` (operativo, ver Fase 8 para el panel).
//! 6-8. Estado Redis atómico (`aplicar_estado`, Fase 4) → `rate_limit` (con
//!    `sospechoso`), `token_reutilizado`, `duplicado`, `tope_diario`.
//! 9. `counted`: log + upsert de resumen (sincrónico, recalculable desde el log).
//!
//! Todo evento decidido se registra en `vistas_log` mediante un canal
//! asíncrono con escritura en lotes (decisión 11): el handler nunca se
//! bloquea en el INSERT. Excepción (decisión 10): los rechazos `rate_limit`
//! dejan como máximo 1 fila/min/IP en el log; el resto va al agregado.

use actix_web::{web, HttpRequest, HttpResponse};
use chrono::Utc;
use hmac::{Hmac, Mac};
use sha2::Sha256;
use sqlx::PgPool;
use std::sync::atomic::{AtomicI64, AtomicU64, Ordering};
use std::sync::Arc;
use tokio::sync::mpsc;

use crate::vista_decision::{
    decidir_vista, fecha_bogota_string, MotivoRechazo, VistaConfig, VistaDecision, VistaEvento,
    VistaEstadoConsultado,
};
use crate::vista_estado::{aplicar_estado, DecisionEstado, EntradaEstado, ErrorEstado};
use crate::vista_token::{verificar_view_token, ErrorViewToken};

// ---------------------------------------------------------------------------
// Entrada (la enriquece Node; Rust NUNCA usa la IP de su propia conexión)
// ---------------------------------------------------------------------------

#[derive(Debug, serde::Deserialize)]
pub struct VistaRequest {
    pub view_token: String,
    pub propiedad_id: i32,
    pub anon_id: Option<String>,
    pub user_id: Option<i32>,
    /// IP clara del visitante. Solo viaja por el canal interno Node→Rust;
    /// aquí se hashea de inmediato y jamás se persiste en claro (§5.2, §11).
    pub ip_address: Option<String>,
    pub user_agent: Option<String>,
    /// Calculado por Node: dueño / agente asignado / miembro activo de la
    /// organización del inmueble / superadmin.
    #[serde(default)]
    pub es_interno: bool,
    pub source: Option<String>,
    pub utm: Option<serde_json::Value>,
    pub referer: Option<String>,
    pub visible_seconds: Option<i32>,
}

// ---------------------------------------------------------------------------
// Fila de log (una por evento decidido)
// ---------------------------------------------------------------------------

#[derive(Debug)]
pub struct VistaLogRow {
    pub fecha_local: chrono::NaiveDate,
    pub propiedad_id: i32,
    pub agency_id: Option<i32>,
    pub user_id: Option<i32>,
    pub anon_id: Option<String>,
    pub identidad_debil: bool,
    pub ip_hash: String,
    pub user_agent: Option<String>,
    pub source: Option<String>,
    pub utm: Option<serde_json::Value>,
    pub referer: Option<String>,
    pub visible_seconds: Option<i32>,
    pub server_elapsed_ms: i64,
    pub result: &'static str,
    pub reason: String,
    pub sospechoso: bool,
    pub rules_version: String,
}

// ---------------------------------------------------------------------------
// Hashing de IP (§5.2, §11: nunca en claro, sal secreta rotable VIEW_IP_SALT)
// ---------------------------------------------------------------------------

pub fn hash_ip(ip_salt: &str, ip: &str) -> String {
    let mut mac = Hmac::<Sha256>::new_from_slice(ip_salt.as_bytes())
        .expect("VIEW_IP_SALT inválida para HMAC");
    mac.update(ip.as_bytes());
    hex::encode(mac.finalize().into_bytes())
}

/// Identidad débil: HMAC(sal, ip + "\n" + user-agent).
pub fn hash_identidad_debil(ip_salt: &str, ip: &str, user_agent: &str) -> String {
    let mut mac = Hmac::<Sha256>::new_from_slice(ip_salt.as_bytes())
        .expect("VIEW_IP_SALT inválida para HMAC");
    mac.update(ip.as_bytes());
    mac.update(b"\n");
    mac.update(user_agent.as_bytes());
    hex::encode(mac.finalize().into_bytes())
}

// ---------------------------------------------------------------------------
// (Listas de bots: ver sección "Listas de bots en memoria" más abajo. La
// detección por evento ya no toca Redis.)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Escritor de log en lotes (decisión 11)
// ---------------------------------------------------------------------------

const LOTE_MAX: usize = 500;

/// Emisor del canal ACOTADO de log (punto 3): `try_send` para no bloquear
/// nunca el handler. Si está lleno, la fila se descarta, se cuenta en un
/// contador atómico y se avisa por tracing como máximo 1 vez por minuto.
/// Espera máxima para encolar una fila counted con canal lleno (punto 1).
const ESPERA_COUNTED_SEGS: u64 = 2;

/// Resultado de enviar una fila al canal.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ResultadoEnvio {
    /// La fila quedó encolada.
    Encolada,
    /// Fila rejected descartada por canal lleno (contada en `descartes()`).
    Descartada,
    /// Fila counted que ni en 2 s encontró hueco: pérdida grave.
    PerdidaCounted,
}

/// Emisor del canal ACOTADO de log: nunca bloquea el handler más de lo
/// necesario. Las filas rejected usan `try_send` (si está lleno se descartan,
/// se cuentan y se avisa 1 vez/min). Las counted NUNCA se descartan por
/// lleno (punto 1): esperan hueco hasta 2 s y, si aun así falla, se reportan
/// como `PerdidaCounted` para el contador `counted_perdida`.
#[derive(Clone)]
pub struct EmisorLog {
    tx: mpsc::Sender<VistaLogRow>,
    capacidad: usize,
    descartes: Arc<AtomicU64>,
    ultimo_aviso_ms: Arc<AtomicI64>,
}

impl EmisorLog {
    pub async fn enviar(&self, fila: VistaLogRow) -> ResultadoEnvio {
        let es_counted = fila.result == "counted";
        match self.tx.try_send(fila) {
            Ok(()) => ResultadoEnvio::Encolada,
            Err(mpsc::error::TrySendError::Closed(fila)) => {
                // Canal muerto (apagado a medias): se registra qué se perdió.
                tracing::error!(
                    "vistas: canal de log cerrado, fila perdida (propiedad {})",
                    fila.propiedad_id
                );
                if es_counted {
                    ResultadoEnvio::PerdidaCounted
                } else {
                    self.descartes.fetch_add(1, Ordering::Relaxed);
                    ResultadoEnvio::Descartada
                }
            }
            Err(mpsc::error::TrySendError::Full(fila)) => {
                if !es_counted {
                    self.descartes.fetch_add(1, Ordering::Relaxed);
                    self.avisar_lleno();
                    return ResultadoEnvio::Descartada;
                }
                // Counted: espera acotada a que se libere hueco.
                match tokio::time::timeout(
                    std::time::Duration::from_secs(ESPERA_COUNTED_SEGS),
                    self.tx.reserve(),
                )
                .await
                {
                    Ok(Ok(permiso)) => {
                        permiso.send(fila);
                        ResultadoEnvio::Encolada
                    }
                    _ => {
                        tracing::error!(
                            "vistas: COUNTED PERDIDA tras {} s sin hueco en el canal (cap {})",
                            ESPERA_COUNTED_SEGS,
                            self.capacidad
                        );
                        ResultadoEnvio::PerdidaCounted
                    }
                }
            }
        }
    }

    fn avisar_lleno(&self) {
        let ahora = chrono::Utc::now().timestamp_millis();
        let ultimo = self.ultimo_aviso_ms.load(Ordering::Relaxed);
        if ahora - ultimo >= 60_000
            && self
                .ultimo_aviso_ms
                .compare_exchange(ultimo, ahora, Ordering::Relaxed, Ordering::Relaxed)
                .is_ok()
        {
            tracing::warn!(
                "vistas: canal de log lleno (cap {}), descartando filas",
                self.capacidad
            );
        }
    }

    /// Filas descartadas por canal lleno desde el arranque.
    /// Solo se lee en tests (en producción solo se incrementa).
    #[cfg(test)]
    pub fn descartes(&self) -> u64 {
        self.descartes.load(Ordering::Relaxed)
    }

    #[cfg(test)]
    fn para_pruebas(capacidad: usize) -> (Self, mpsc::Receiver<VistaLogRow>) {
        let (tx, rx) = mpsc::channel::<VistaLogRow>(capacidad.max(1));
        (
            Self {
                tx,
                capacidad: capacidad.max(1),
                descartes: Arc::new(AtomicU64::new(0)),
                ultimo_aviso_ms: Arc::new(AtomicI64::new(0)),
            },
            rx,
        )
    }
}

/// Arranca el escritor en background. Devuelve el emisor y el handle: quien
/// apaga el servicio debe soltar TODOS los emisores y esperar el handle para
/// garantizar que el lote pendiente se vacía antes de salir (cierre ordenado).
/// El bucle solo termina con el canal vacío Y cerrado, así que nada encolado
/// se pierde en un apagado ordenado.
pub fn iniciar_escritor_log(
    pool: PgPool,
    capacidad: usize,
) -> (
    EmisorLog,
    tokio::task::JoinHandle<()>,
) {
    let (tx, mut rx) = mpsc::channel::<VistaLogRow>(capacidad.max(1));
    let emisor = EmisorLog {
        tx,
        capacidad: capacidad.max(1),
        descartes: Arc::new(AtomicU64::new(0)),
        ultimo_aviso_ms: Arc::new(AtomicI64::new(0)),
    };
    let handle = tokio::spawn(async move {
        let mut lote = Vec::with_capacity(LOTE_MAX);
        loop {
            lote.clear();
            // Espera al menos una fila; si se cierran todos los emisores, sale.
            match rx.recv().await {
                Some(fila) => lote.push(fila),
                None => break,
            }
            // Drena hasta LOTE_MAX sin bloquear (ventana de 1 s).
            while lote.len() < LOTE_MAX {
                match tokio::time::timeout(std::time::Duration::from_secs(1), rx.recv()).await {
                    Ok(Some(fila)) => lote.push(fila),
                    _ => break,
                }
            }
            if let Err(e) = insertar_lote(&pool, &lote).await {
                // Punto 3: el INSERT multi-fila es atómico; si una fila falla
                // (p. ej. propiedad_id inexistente con la FK aún presente),
                // se reintenta fila por fila y solo se descartan las malas.
                tracing::error!("vistas_log: fallo lote de {} filas: {e}", lote.len());
                let mut descartadas = 0;
                for fila in &lote {
                    if let Err(e_fila) = insertar_fila(&pool, fila).await {
                        descartadas += 1;
                        tracing::error!(
                            "vistas_log: fila descartada (propiedad {}): {e_fila}",
                            fila.propiedad_id
                        );
                    }
                }
                if descartadas > 0 {
                    tracing::error!("vistas_log: {descartadas} filas descartadas del lote");
                }
            }
        }
    });
    (emisor, handle)
}

async fn insertar_fila(pool: &PgPool, f: &VistaLogRow) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO vistas_log (received_at, fecha_local, propiedad_id, agency_id, user_id, anon_id, identidad_debil, ip_hash, user_agent, source, utm, referer, visible_seconds, server_elapsed_ms, result, reason, sospechoso, rules_version) VALUES (NOW(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)",
    )
    .bind(f.fecha_local)
    .bind(f.propiedad_id)
    .bind(f.agency_id)
    .bind(f.user_id)
    .bind(&f.anon_id)
    .bind(f.identidad_debil)
    .bind(&f.ip_hash)
    .bind(&f.user_agent)
    .bind(&f.source)
    .bind(&f.utm)
    .bind(&f.referer)
    .bind(f.visible_seconds)
    .bind(f.server_elapsed_ms)
    .bind(f.result)
    .bind(&f.reason)
    .bind(f.sospechoso)
    .bind(&f.rules_version)
    .execute(pool)
    .await
    .map(|_| ())
}

async fn insertar_lote(pool: &PgPool, lote: &[VistaLogRow]) -> Result<(), sqlx::Error> {
    let mut qb = sqlx::QueryBuilder::new(
        "INSERT INTO vistas_log (received_at, fecha_local, propiedad_id, agency_id, user_id, anon_id, identidad_debil, ip_hash, user_agent, source, utm, referer, visible_seconds, server_elapsed_ms, result, reason, sospechoso, rules_version) ",
    );
    qb.push_values(lote, |mut b, f| {
        b.push("NOW()")
            .push_bind(&f.fecha_local)
            .push_bind(f.propiedad_id)
            .push_bind(f.agency_id)
            .push_bind(f.user_id)
            .push_bind(&f.anon_id)
            .push_bind(f.identidad_debil)
            .push_bind(&f.ip_hash)
            .push_bind(&f.user_agent)
            .push_bind(&f.source)
            .push_bind(&f.utm)
            .push_bind(&f.referer)
            .push_bind(f.visible_seconds)
            .push_bind(f.server_elapsed_ms)
            .push_bind(f.result)
            .push_bind(&f.reason)
            .push_bind(f.sospechoso)
            .push_bind(&f.rules_version);
    });
    qb.build().execute(pool).await.map(|_| ())
}

// ---------------------------------------------------------------------------
// Estado compartido del endpoint (vive en AppState)
// ---------------------------------------------------------------------------

#[derive(Clone)]
pub struct VistaDeps {
    pub config: VistaConfig,
    pub view_token_secret: String,
    pub ip_salt: String,
    /// Secreto interno Node↔Rust (punto 4): el endpoint lo exige en el header
    /// `X-Internal-Secret`. Sin él, Rust no es llamable desde fuera.
    pub internal_secret: String,
    pub log_emisor: EmisorLog,
    /// Listas de bots en memoria (punto 5): se cargan al arrancar y cada 10 min.
    pub bot_listas: std::sync::Arc<std::sync::RwLock<BotEstado>>,
}

/// Comparación en tiempo constante (punto 4): no corta ante el primer byte
/// distinto para no filtrar por timing. Nunca autoriza vacíos (punto 1b).
fn secreto_coincide(a: &[u8], b: &[u8]) -> bool {
    if a.is_empty() || b.is_empty() || a.len() != b.len() {
        return false;
    }
    a.iter().zip(b.iter()).fold(0u8, |x, (p, q)| x | (p ^ q)) == 0
}

/// Validación de arranque (punto 1): secreto presente, no vacío y ≥32 chars.
pub fn validar_secreto(nombre: &str, valor: &str) -> Result<(), String> {
    if valor.trim().is_empty() {
        return Err(format!("{nombre} vacío o ausente"));
    }
    if valor.len() < 32 {
        return Err(format!("{nombre} demasiado corto ({} < 32 caracteres)", valor.len()));
    }
    Ok(())
}

/// Rechazos sin fila de log (punto 2: `token_invalido`, `evento_invalido`).
/// Solo incrementa un contador agregado diario en Redis + tracing (punto 5:
// el warn sale como máximo 1 vez por minuto y motivo; el contador siempre).
async fn agregar_rechazo(conn: &mut redis::aio::MultiplexedConnection, motivo: &str, fecha: &str) {
    let clave = format!("vistas:agregado:{motivo}:{fecha}");
    let n: i64 = redis::cmd("INCR")
        .arg(&clave)
        .query_async(conn)
        .await
        .unwrap_or(0);
    if n == 1 {
        let _: () = redis::cmd("EXPIRE")
            .arg(&clave)
            .arg(86_400)
            .query_async(conn)
            .await
            .unwrap_or(());
    }
    static ULTIMO_AVISO_MS: std::sync::OnceLock<dashmap::DashMap<String, i64>> =
        std::sync::OnceLock::new();
    let avisos = ULTIMO_AVISO_MS.get_or_init(dashmap::DashMap::new);
    let ahora_ms = chrono::Utc::now().timestamp_millis();
    let emitir = match avisos.entry(motivo.to_string()) {
        dashmap::mapref::entry::Entry::Occupied(o) if ahora_ms - *o.get() < 60_000 => false,
        e => {
            e.insert(ahora_ms);
            true
        }
    };
    if emitir {
        tracing::warn!("vistas: {motivo} agregado sin fila de log");
    }
}

// ---------------------------------------------------------------------------
// Listas de bots en memoria (punto 5)
// ---------------------------------------------------------------------------

/// Subcadenas UA de respaldo compiladas (la lista viva está en el archivo).
const BOT_UA_BASE: &[&str] = &[
    "bot", "crawl", "spider", "slurp", "mediapartners", "baidu", "yandex", "sogou", "exabot",
    "facebot", "ia_archiver", "python-requests", "curl", "wget", "headless",
];

/// Listas de bots/detectors: UA por subcadena (minúsculas) + redes IP.
/// Se cargan al arrancar y cada 10 min; un fallo conserva lo previo.
#[derive(Debug, Clone, Default)]
pub struct BotListas {
    pub ua_substrings: Vec<String>,
    pub redes: Vec<ipnet::IpNet>,
}

impl BotListas {
    /// Solo la base compilada (tests y respaldo si el archivo falta).
    pub fn base() -> Self {
        Self {
            ua_substrings: BOT_UA_BASE.iter().map(|s| s.to_string()).collect(),
            redes: Vec::new(),
        }
    }
}

/// Estado de bots con su origen (punto 3): qué se cargó y de dónde.
#[derive(Debug, Clone)]
pub struct BotEstado {
    pub listas: BotListas,
    /// "archivo" si el ua.txt se leyó, "respaldo" si no.
    pub ua_fuente: String,
    /// true si la tabla `vistas_bot_ips` se leyó sin error.
    pub tabla_ok: bool,
}

impl BotEstado {
    /// Solo para tests (en producción se usa `cargar_listas_bots`).
    #[cfg(test)]
    pub fn base() -> Self {
        Self {
            listas: BotListas::base(),
            ua_fuente: "respaldo".to_string(),
            tabla_ok: false,
        }
    }
}

/// Lee el archivo versionado de user-agents (una subcadena por línea, `#`
/// comenta) y la tabla `vistas_bot_ips` (CIDR). Nunca falla: ante archivo
/// ausente o DB caída devuelve base compilada + lo que haya en el otro lado.
/// Registra de dónde salió cada fuente (punto 3).
pub async fn cargar_listas_bots(ruta_ua: &str, pool: &PgPool) -> BotEstado {
    let mut ua: Vec<String> = BotListas::base().ua_substrings;
    let mut ua_fuente = "respaldo".to_string();
    match tokio::fs::read_to_string(ruta_ua).await {
        Ok(texto) => {
            let mut n = 0;
            for linea in texto.lines() {
                let l = linea.trim().to_lowercase();
                if !l.is_empty() && !l.starts_with('#') && !ua.contains(&l) {
                    ua.push(l);
                    n += 1;
                }
            }
            ua_fuente = "archivo".to_string();
            tracing::info!("vistas: bots UA cargados: {} del archivo + base", n);
        }
        Err(e) => tracing::error!("VISTAS: no se pudo leer {ruta_ua}: {e} (respaldo compilado)"),
    }
    let mut redes = Vec::new();
    let mut tabla_ok = false;
    match sqlx::query_scalar::<_, String>("SELECT cidr::text FROM vistas_bot_ips")
        .fetch_all(pool)
        .await
    {
        Ok(c) => {
            tabla_ok = true;
            for s in c {
                match s.parse::<ipnet::IpNet>() {
                    Ok(net) => redes.push(net),
                    Err(e) => tracing::error!("vistas: CIDR inválido {s}: {e}"),
                }
            }
        }
        Err(e) => tracing::error!("vistas: no se pudo leer vistas_bot_ips: {e}"),
    }
    let estado = BotEstado {
        listas: BotListas { ua_substrings: ua, redes },
        ua_fuente,
        tabla_ok,
    };
    tracing::info!(
        "vistas: listas de bots: {} UA ({}), {} CIDR (tabla_ok={})",
        estado.listas.ua_substrings.len(),
        estado.ua_fuente,
        estado.listas.redes.len(),
        estado.tabla_ok,
    );
    estado
}

/// Detección pura sobre las listas en memoria (sin Redis por evento).
pub fn es_bot_listas(listas: &BotListas, user_agent: Option<&str>, ip: Option<&str>) -> bool {
    let ua = match user_agent {
        Some(u) if !u.trim().is_empty() => u,
        _ => return true, // sin user-agent → bot (§4.3.5)
    };
    let ua_min = ua.to_lowercase();
    if listas.ua_substrings.iter().any(|p| ua_min.contains(p)) {
        return true;
    }
    if let Some(ip) = ip {
        if let Ok(addr) = ip.parse::<std::net::IpAddr>() {
            if listas.redes.iter().any(|net| net.contains(&addr)) {
                return true;
            }
        }
    }
    false
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

fn respuesta(decision: &VistaDecision) -> HttpResponse {
    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "data": { "result": if decision.es_contada() { "counted" } else { "rejected" }, "reason": decision.motivo },
    }))
}

pub async fn registrar_vista(
    state: web::Data<crate::state::AppState>,
    req_http: HttpRequest,
    body: web::Json<VistaRequest>,
) -> HttpResponse {
    let req = body.into_inner();
    // Punto 1: vistas deshabilitadas (secretos inválidos al arrancar) →
    // 503 ANTES de mirar el header. El resto del servicio sigue vivo.
    if state.vista_deps.is_none() {
        return HttpResponse::ServiceUnavailable().json(serde_json::json!({
            "success": false,
            "error": "Medición de vistas deshabilitada: secretos no configurados.",
        }));
    }
    // Punto 4: secreto interno ANTES de tocar Redis o Postgres. Sin header
    // válido no hay decisión, ni log, ni consulta: 401 directo.
    let deps_opt = state.vista_deps.as_ref();
    let secreto_ok = deps_opt
        .and_then(|d| {
            req_http
                .headers()
                .get("x-internal-secret")
                .and_then(|v| v.to_str().ok())
                .map(|recibido| secreto_coincide(recibido.as_bytes(), d.internal_secret.as_bytes()))
        })
        .unwrap_or(false);
    if !secreto_ok {
        return HttpResponse::Unauthorized().json(serde_json::json!({
            "success": false, "error": "No autorizado.",
        }));
    }
    // Sin propiedad válida no hay log posible (FK): 400 directo.
    if req.propiedad_id <= 0 {
        return HttpResponse::BadRequest().json(serde_json::json!({
            "success": false, "error": "propiedad_id inválido.",
        }));
    }
    let (db, rconn, deps) = match state.vista_deps.as_ref() {
        // El secreto ya garantizó que hay deps: el None es inalcanzable.
        Some(d) => (state.db.clone(), state.redis.clone(), d.clone()),
        None => {
            tracing::error!("vistas: endpoint sin configurar (faltan secretos)");
            return respuesta(&VistaDecision::rejected(
                MotivoRechazo::ErrorSistema,
                false,
                "v1".to_string(),
                false,
            ));
        }
    };
    let decision =
        procesar_vista(db, rconn, deps, req, Utc::now().timestamp_millis()).await;
    respuesta(&decision)
}

/// Núcleo de decisión: todo owned + Send, sin tipos actix. Se puede lanzar
/// con `tokio::spawn` (la prueba de concurrencia lo hace).
async fn procesar_vista(
    db: PgPool,
    mut rconn: redis::aio::MultiplexedConnection,
    deps: VistaDeps,
    req: VistaRequest,
    ahora_ms: i64,
) -> VistaDecision {
    let config = &deps.config;
    let fecha_str = fecha_bogota_string(ahora_ms);
    let Ok(fecha_date) = chrono::NaiveDate::parse_from_str(&fecha_str, "%Y-%m-%d") else {
        tracing::error!("vistas: fecha Bogotá inválida");
        return VistaDecision::rejected(
            MotivoRechazo::ErrorSistema,
            false,
            "v1".to_string(),
            false,
        );
    };

    // Identidad temprana (para el log incluso en rechazos previos a DB).
    let anon_limpio = req.anon_id.filter(|s| !s.trim().is_empty());
    let ip_limpia = req.ip_address.filter(|s| !s.trim().is_empty());
    let ua_limpia = req.user_agent.filter(|s| !s.trim().is_empty());
    let ip_hash_opt = ip_limpia.as_deref().map(|ip| hash_ip(&deps.ip_salt, ip));

    // Anti-inundación (punto 2): ANTES de cualquier consulta a Postgres se
    // cuenta cada evento con IP en Redis. Si supera el límite, se responde
    // rate_limit sin tocar la base de datos (ni siquiera el log).
    if let Some(ip_hash) = ip_hash_opt.as_deref() {
        let preflood = format!("vistas:preflood:{ip_hash}:{}", ahora_ms.div_euclid(60_000));
        let n: i64 = redis::cmd("INCR")
            .arg(&preflood)
            .query_async(&mut rconn)
            .await
            .unwrap_or(0); // Redis caído: sigue; el fail-closed llega abajo
        if n == 1 {
            let _: () = redis::cmd("EXPIRE")
                .arg(&preflood)
                .arg(60)
                .query_async(&mut rconn)
                .await
                .unwrap_or(());
        }
        if n > config.rate_limit_ip_events_per_minute as i64 {
            tracing::debug!("vistas: pre-flood por IP superado");
            // Punto 3: también suma al agregado (sin fila).
            agregar_rechazo(&mut rconn, "rate_limit", &fecha_str).await;
            let debil = req.user_id.is_none()
                && !anon_limpio
                    .as_ref()
                    .map(|s| !s.is_empty())
                    .unwrap_or(false);
            return VistaDecision::rejected(
                MotivoRechazo::RateLimit,
                debil,
                config.rules_version.clone(),
                true,
            );
        }
    }

    let fila_base = |reason: MotivoRechazo, sospechoso: bool| VistaLogRow {
        fecha_local: fecha_date,
        propiedad_id: req.propiedad_id,
        agency_id: None,
        user_id: req.user_id,
        anon_id: anon_limpio.clone(),
        identidad_debil: req.user_id.is_none() && anon_limpio.is_none() && ip_hash_opt.is_some(),
        ip_hash: ip_hash_opt.clone().unwrap_or_default(),
        user_agent: ua_limpia.clone(),
        source: req.source.clone(),
        utm: req.utm.clone(),
        referer: req.referer.clone(),
        visible_seconds: req.visible_seconds,
        server_elapsed_ms: 0,
        result: "rejected",
        reason: reason.as_str().to_string(),
        sospechoso,
        rules_version: config.rules_version.clone(),
    };

    // Estructura mínima: token no vacío (propiedad_id > 0 lo garantiza el wrapper).
    // Punto 2: token_invalido no deja fila, solo agregado.
    if req.view_token.trim().is_empty() {
        agregar_rechazo(&mut rconn, "token_invalido", &fecha_str).await;
        return VistaDecision::rejected(
            MotivoRechazo::TokenInvalido,
            false,
            config.rules_version.clone(),
            false,
        );
    }

    // Paso 1: token.
    let datos = match verificar_view_token(
        req.view_token.trim(),
        deps.view_token_secret.as_bytes(),
        ahora_ms,
        config,
    ) {
        Ok(d) => d,
        Err(ErrorViewToken::Expirado) => {
            // Punto 3: sin fila, solo agregado.
            agregar_rechazo(&mut rconn, "token_expirado", &fecha_str).await;
            return VistaDecision::rejected(
                MotivoRechazo::TokenExpirado,
                false,
                config.rules_version.clone(),
                false,
            );
        }
        Err(ErrorViewToken::Invalido) => {
            agregar_rechazo(&mut rconn, "token_invalido", &fecha_str).await;
            return VistaDecision::rejected(
                MotivoRechazo::TokenInvalido,
                false,
                config.rules_version.clone(),
                false,
            );
        }
    };
    if datos.propiedad_id != req.propiedad_id {
        agregar_rechazo(&mut rconn, "token_invalido", &fecha_str).await;
        return VistaDecision::rejected(
            MotivoRechazo::TokenInvalido,
            false,
            config.rules_version.clone(),
            false,
        );
    }
    let elapsed_ms = ahora_ms.saturating_sub(datos.emitido_en_ms);

    // Paso 2: inmueble (decisión 7) con caché Redis 60 s (punto 6). Solo se
    // cachean inmuebles EXISTENTES: un inexistente siempre consulta DB para
    // no bloquear vistas de propiedades recién creadas (≤60 s de retraso).
    // Formato: {"a":bool_activo,"o":organizacion_id|null}.
    let cache_inmueble = format!("vistas:inmueble:{}", req.propiedad_id);
    let cached: Option<String> = redis::cmd("GET")
        .arg(&cache_inmueble)
        .query_async(&mut rconn)
        .await
        .unwrap_or(None);
    let (existe, activo, agency_id): (bool, bool, Option<i32>) = match cached
        .as_deref()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(s).ok())
    {
        Some(v) => (
            true,
            v.get("a").and_then(|x| x.as_bool()).unwrap_or(false),
            v.get("o").and_then(|x| x.as_i64()).map(|x| x as i32),
        ),
        None => match sqlx::query_as::<_, (bool, bool, Option<i32>)>(
            r#"SELECT true,
            (estado = 'publicado' AND listing_status = 'active'
             AND (expires_at IS NULL OR expires_at > NOW())),
            organizacion_id
           FROM propiedades WHERE id = $1"#,
        )
        .bind(req.propiedad_id)
        .fetch_optional(&db)
        .await
        {
            Ok(Some(fila)) => {
                let cuerpo_cache = serde_json::json!({"a": fila.1, "o": fila.2});
                let _: () = redis::cmd("SET")
                    .arg(&cache_inmueble)
                    .arg(cuerpo_cache.to_string())
                    .arg("EX")
                    .arg(60)
                    .query_async(&mut rconn)
                    .await
                    .unwrap_or(());
                (fila.0, fila.1, fila.2)
            }
            Ok(None) => {
                // Punto 3: sin fila, solo agregado.
                agregar_rechazo(&mut rconn, "inmueble_inexistente", &fecha_str).await;
                return VistaDecision::rejected(
                    MotivoRechazo::InmuebleInexistente,
                    false,
                    config.rules_version.clone(),
                    false,
                );
            }
            Err(e) => {
                tracing::error!("vistas: fallo DB inmueble: {e}");
                let fila = fila_base(MotivoRechazo::ErrorSistema, false);
                deps.log_emisor.enviar(fila).await;
                return VistaDecision::rejected(
                    MotivoRechazo::ErrorSistema,
                    false,
                    config.rules_version.clone(),
                    false,
                );
            }
        },
    };
    let _ = existe;
    if !activo {
        let mut fila = fila_base(MotivoRechazo::InmuebleNoActivo, false);
        fila.agency_id = agency_id;
        deps.log_emisor.enviar(fila).await;
        return VistaDecision::rejected(
            MotivoRechazo::InmuebleNoActivo,
            false,
            config.rules_version.clone(),
            false,
        );
    }

    // Paso 3: identidad + vínculo (§5.3).
    let clave_primaria: Option<String> = req
        .user_id
        .map(|id| format!("user:{id}"))
        .or_else(|| anon_limpio.clone().map(|a| format!("anon:{a}")))
        .or_else(|| {
            ip_limpia.as_deref().zip(ua_limpia.as_deref()).map(|(ip, ua)| {
                format!("weak:{}", hash_identidad_debil(&deps.ip_salt, ip, ua))
            })
        });
    let Some(primaria) = clave_primaria else {
        let mut fila = fila_base(MotivoRechazo::SinIdentidad, false);
        fila.agency_id = agency_id;
        deps.log_emisor.enviar(fila).await;
        return VistaDecision::rejected(
            MotivoRechazo::SinIdentidad,
            false,
            config.rules_version.clone(),
            false,
        );
    };
    if let (Some(uid), Some(anon)) = (req.user_id, anon_limpio.as_deref()) {
        if let Err(e) = sqlx::query(
            "INSERT INTO vistas_identidades (anon_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        )
        .bind(anon)
        .bind(uid)
        .execute(&db)
        .await
        {
            tracing::error!("vistas: fallo vínculo identidades: {e}");
            let mut fila = fila_base(MotivoRechazo::ErrorSistema, false);
            fila.agency_id = agency_id;
            deps.log_emisor.enviar(fila).await;
            return VistaDecision::rejected(
                MotivoRechazo::ErrorSistema,
                false,
                config.rules_version.clone(),
                false,
            );
        }
    }
    // Todas las vinculadas, primaria primera. Las consultas a
    // vistas_identidades solo corren si hay user_id o anon_id (punto 6):
    // con identidad débil no hay nada que vincular.
    let mut identidades = vec![primaria.clone()];
    if req.user_id.is_some() || anon_limpio.is_some() {
        if let Some(uid) = req.user_id {
            if let Ok(anons) = sqlx::query_scalar::<_, String>(
                "SELECT anon_id FROM vistas_identidades WHERE user_id = $1",
            )
            .bind(uid)
            .fetch_all(&db)
            .await
            {
                for a in anons {
                    let k = format!("anon:{a}");
                    if !identidades.contains(&k) {
                        identidades.push(k);
                    }
                }
            }
        }
        if let Some(anon) = anon_limpio.as_deref() {
            if let Ok(uids) = sqlx::query_scalar::<_, i32>(
                "SELECT user_id FROM vistas_identidades WHERE anon_id = $1",
            )
            .bind(anon)
            .fetch_all(&db)
            .await
            {
                for u in uids {
                    let k = format!("user:{u}");
                    if !identidades.contains(&k) {
                        identidades.push(k);
                    }
                }
            }
        }
    }

    let evento = VistaEvento {
        estructura_valida: true,
        token_firma_valida: true,
        property_id: req.propiedad_id,
        token_property_id: datos.propiedad_id,
        token_emitido_en_ms: datos.emitido_en_ms,
        user_id: req.user_id,
        anon_id: anon_limpio.clone(),
        ip_hash: ip_hash_opt.clone(),
        es_interno: req.es_interno,
        es_bot: false, // se resuelve abajo con las listas
        visible_seconds: req.visible_seconds.map(|v| v as i64),
    };

    // Paso 5: bots con listas en memoria (punto 5, sin I/O por evento).
    // El guard se suelta antes de cualquier await (el futuro debe ser Send).
    let es_bot: Option<bool> = deps
        .bot_listas
        .read()
        .ok()
        .map(|estado| es_bot_listas(&estado.listas, ua_limpia.as_deref(), ip_limpia.as_deref()));
    let es_bot = match es_bot {
        Some(b) => b,
        None => {
            tracing::error!("vistas: lock de bots envenenado");
            let mut fila = fila_base(MotivoRechazo::ErrorSistema, false);
            fila.agency_id = agency_id;
            fila.server_elapsed_ms = elapsed_ms;
            deps.log_emisor.enviar(fila).await;
            return VistaDecision::rejected(
                MotivoRechazo::ErrorSistema,
                false,
                config.rules_version.clone(),
                false,
            );
        }
    };

    // Pasos 1-5 puros con estado limpio (los de Redis los decide el Lua).
    let evento = VistaEvento { es_bot, ..evento };
    let limpio = VistaEstadoConsultado {
        token_ya_usado: false,
        inmueble_existe: true,
        inmueble_activo: true,
        ventana_dedupe_ocupada: false,
        conteo_diario: 0,
        eventos_visitante_ultimo_minuto: 0,
        eventos_ip_ultimo_minuto: 0,
        error_infraestructura: false,
    };
    let previo = decidir_vista(&evento, &limpio, config, ahora_ms);
    if !previo.es_contada() {
        // Lotes 2-4: estos motivos no dejan fila, solo agregado en Redis.
        if previo.motivo == "evento_invalido"
            || previo.motivo == "bot"
            || previo.motivo == "visible_incoherente"
        {
            agregar_rechazo(&mut rconn, &previo.motivo, &fecha_str).await;
            return previo;
        }
        let mut fila = fila_base(
            match previo.motivo.as_str() {
                "interno" => MotivoRechazo::Interno,
                "bot" => MotivoRechazo::Bot,
                "tiempo_insuficiente" => MotivoRechazo::TiempoInsuficiente,
                _ => MotivoRechazo::EventoInvalido,
            },
            false,
        );
        fila.agency_id = agency_id;
        fila.server_elapsed_ms = elapsed_ms;
        deps.log_emisor.enviar(fila).await;
        return previo;
    }

    // Pasos 6-8: estado atómico.
    let fecha = fecha_str.clone();
    let entrada = EntradaEstado {
        jti: &datos.jti,
        propiedad_id: req.propiedad_id,
        fecha_bogota: &fecha,
        identidades: &identidades,
        ip_hash: &ip_hash_opt.clone().unwrap_or_default(),
        minuto_bucket: ahora_ms.div_euclid(60_000),
        ttl_tope_s: crate::vista_estado::ttl_tope_segundos(ahora_ms) as usize,
        config,
    };
    let salida = match aplicar_estado(&mut rconn, &entrada).await {
        Ok(s) => s,
        Err(ErrorEstado::Redis(msg)) => {
            tracing::error!("vistas: fallo Redis (estado): {msg}");
            let mut fila = fila_base(MotivoRechazo::ErrorSistema, false);
            fila.agency_id = agency_id;
            fila.server_elapsed_ms = elapsed_ms;
            deps.log_emisor.enviar(fila).await;
            return VistaDecision::rejected(
                MotivoRechazo::ErrorSistema,
                false,
                config.rules_version.clone(),
                false,
            );
        }
    };
    let decision = match salida.decision {
        DecisionEstado::Counted => VistaDecision::counted(evento.es_identidad_debil(), config.rules_version.clone()),
        DecisionEstado::TokenReutilizado => VistaDecision::rejected(
            MotivoRechazo::TokenReutilizado, evento.es_identidad_debil(), config.rules_version.clone(), false,
        ),
        DecisionEstado::RateLimit => VistaDecision::rejected(
            MotivoRechazo::RateLimit, evento.es_identidad_debil(), config.rules_version.clone(), true,
        ),
        DecisionEstado::Duplicado => VistaDecision::rejected(
            MotivoRechazo::Duplicado, evento.es_identidad_debil(), config.rules_version.clone(), false,
        ),
        DecisionEstado::TopeDiario => VistaDecision::rejected(
            MotivoRechazo::TopeDiario, evento.es_identidad_debil(), config.rules_version.clone(), false,
        ),
        DecisionEstado::TopeIp => VistaDecision::rejected(
            MotivoRechazo::TopeIp, evento.es_identidad_debil(), config.rules_version.clone(), false,
        ),
    };

    // Efectos: log (con muestreo rate_limit, decisión 10) + resumen si counted.
    let fila = VistaLogRow {
        fecha_local: fecha_date,
        propiedad_id: req.propiedad_id,
        agency_id,
        user_id: req.user_id,
        anon_id: anon_limpio,
        identidad_debil: decision.identidad_debil,
        ip_hash: ip_hash_opt.unwrap_or_default(),
        user_agent: ua_limpia,
        source: req.source,
        utm: req.utm,
        referer: req.referer,
        visible_seconds: req.visible_seconds,
        server_elapsed_ms: elapsed_ms,
        result: if decision.es_contada() { "counted" } else { "rejected" },
        reason: decision.motivo.clone(),
        sospechoso: decision.sospechoso,
        rules_version: config.rules_version.clone(),
    };

    if decision.motivo == "rate_limit" {
        // Decisión 10: máximo 1 fila/min/IP; el resto al agregado.
        let muestra: String = format!(
            "vistas:muestra_ratelimit:{}:{}",
            fila.ip_hash,
            ahora_ms.div_euclid(60_000)
        );
        let es_primera: bool = redis::cmd("SET")
            .arg(&muestra)
            .arg(1)
            .arg("EX")
            .arg(60)
            .arg("NX")
            .query_async(&mut rconn)
            .await
            .unwrap_or(false);
        if es_primera {
            deps.log_emisor.enviar(fila).await;
        } else if let Err(e) = sqlx::query(
            r#"INSERT INTO vistas_rate_limit_agregado (ip_hash, ventana_minuto, motivo, conteo, updated_at)
               VALUES ($1, to_timestamp($2 * 60), 'rate_limit', 1, NOW())
               ON CONFLICT (ip_hash, ventana_minuto)
               DO UPDATE SET conteo = vistas_rate_limit_agregado.conteo + 1, updated_at = NOW()"#,
        )
        .bind(&fila.ip_hash)
        .bind(ahora_ms.div_euclid(60_000))
        .execute(&db)
        .await
        {
            tracing::error!("vistas: fallo agregado rate_limit: {e}");
        }
        return decision;
    }

    // Punto 4: el resumen lo recalcula el job cada 5 min desde el log
    // (consolidar_resumen). Aquí solo se encola la fila; sin SADD ni upsert.
    // Punto 1: si ni esperando 2 s entra una counted, va al agregado grave.
    if deps.log_emisor.enviar(fila).await == ResultadoEnvio::PerdidaCounted {
        let clave = format!("vistas:agregado:counted_perdida:{fecha_str}");
        let n: i64 = redis::cmd("INCR")
            .arg(&clave)
            .query_async(&mut rconn)
            .await
            .unwrap_or(0);
        if n == 1 {
            let _: () = redis::cmd("EXPIRE")
                .arg(&clave)
                .arg(86_400)
                .query_async(&mut rconn)
                .await
                .unwrap_or(());
        }
    }
    decision
}

/// Retención de 13 meses (paso8 6f): borra filas de `vistas_log` con
/// `received_at` anterior a la ventana, en lotes de 10000. No toca agregados
/// (`vistas_rate_limit_agregado`), resumen ni Redis (sin KEYS). Retorna filas
/// borradas. DESACTIVADO por defecto: solo corre si VISTA_RETENCION_ACTIVA=1.
pub async fn retencion_vistas_log(pool: &PgPool) -> Result<u64, sqlx::Error> {
    let mut total = 0u64;
    loop {
        let n = sqlx::query(
            "DELETE FROM vistas_log WHERE event_id IN (
               SELECT event_id FROM vistas_log
               WHERE received_at < NOW() - INTERVAL '13 months'
               ORDER BY event_id LIMIT 10000
             )",
        )
        .execute(pool)
        .await?
        .rows_affected();
        total += n;
        if n < 10_000 {
            break;
        }
    }
    Ok(total)
}

/// Recalcula `vistas_resumen_diario` desde `vistas_log` (punto 4). El resumen/// es DERIVADO: la fuente de verdad es el log y esta función es idempotente
/// (valores absolutos, no incrementos). Solo toca fechas dentro de la ventana
/// de retención de 13 meses. La ejecuta Rust cada 5 min (ver main.rs).
/// El job solo recalcula HOY y AYER (hora Bogotá, punto 2).
pub async fn consolidar_resumen(pool: &PgPool) -> Result<u64, sqlx::Error> {
    let hoy = chrono::NaiveDate::parse_from_str(
        &fecha_bogota_string(chrono::Utc::now().timestamp_millis()),
        "%Y-%m-%d",
    )
    .expect("fecha Bogotá válida");
    let ayer = hoy.pred_opt().unwrap_or(hoy);
    consolidar_fechas(pool, Some([hoy, ayer])).await
}

/// Recálculo MANUAL de toda la ventana de retención (punto 2): corrige
/// cualquier fecha, no solo hoy/ayer. Idempotente. Uso explícito, no automático.
/// Solo se usa en tests (en producción corre el job); el binario no lo llama.
#[cfg(test)]
pub async fn consolidar_completo(pool: &PgPool) -> Result<u64, sqlx::Error> {
    consolidar_fechas(pool, None).await
}

/// Núcleo compartido: `dias=None` = toda la ventana de 13 meses;
/// `Some([hoy, ayer])` = solo esas fechas (job cada 5 min, punto 2).
async fn consolidar_fechas(
    pool: &PgPool,
    dias: Option<[chrono::NaiveDate; 2]>,
) -> Result<u64, sqlx::Error> {
    let r = sqlx::query(
        r#"INSERT INTO vistas_resumen_diario
             (propiedad_id, fecha_local, vistas, visitantes_unicos, updated_at)
           SELECT propiedad_id, fecha_local,
                  COUNT(*)::int,
                  COUNT(DISTINCT COALESCE(
                      'u' || user_id::text,
                      'a' || anon_id,
                      'w' || ip_hash))::int,
                  NOW()
           FROM vistas_log
           WHERE result = 'counted'
             AND fecha_local >= CURRENT_DATE - INTERVAL '13 months'
             AND ($1::date IS NULL OR fecha_local = $1::date OR fecha_local = $2::date)
           GROUP BY propiedad_id, fecha_local
           ON CONFLICT (propiedad_id, fecha_local) DO UPDATE SET
             vistas = EXCLUDED.vistas,
             visitantes_unicos = EXCLUDED.visitantes_unicos,
             updated_at = NOW()"#,
    )
    .bind(dias.map(|d| d[0]))
    .bind(dias.map(|d| d[1]))
    .execute(pool)
    .await?;
    Ok(r.rows_affected())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::AppState;
    use crate::vista_decision::req_env_integracion;
    use dashmap::DashMap;
    use std::sync::Arc;

    const SECRETO: &str = "secreto-fase5-test";
    const SAL: &str = "sal-fase5-test";

    fn token_de(pid: i32, iat_ms: i64) -> String {
        use base64::Engine as _;
        let exp = iat_ms + 3_600_000;
        let payload = serde_json::json!({"pid": pid, "jti": uuid::Uuid::new_v4().to_string(), "iat": iat_ms, "exp": exp});
        let b64 = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .encode(payload.to_string().as_bytes());
        let cuerpo = format!("v1.{b64}");
        let mut mac = Hmac::<Sha256>::new_from_slice(SECRETO.as_bytes()).unwrap();
        mac.update(cuerpo.as_bytes());
        format!("{cuerpo}.{}", hex::encode(mac.finalize().into_bytes()))
    }

    async fn estado_vivo() -> Option<(PgPool, redis::aio::MultiplexedConnection)> {
        // Punto 6: sin URLs falla (salvo VISTAS_SKIP_INTEGRATION=1).
        let (Some(pg_url), Some(redis_url)) = (
            req_env_integracion("VISTAS_TEST_PG_URL"),
            req_env_integracion("VISTAS_TEST_REDIS_URL"),
        ) else {
            return None;
        };
        let pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(2)
            .connect(&pg_url)
            .await
            .ok()?;
        let cliente = redis::Client::open(redis_url).ok()?;
        let conn = cliente.get_multiplexed_async_connection().await.ok()?;
        Some((pool, conn))
    }

    async fn sembrar(pool: &PgPool, tag: &str) -> (i32, i32) {
        let uid: i32 = sqlx::query_scalar(
            "INSERT INTO usuarios (name, email) VALUES ($1, $2) RETURNING id",
        )
        .bind(format!("Vista {tag}"))
        .bind(format!("vista-{tag}@test.local"))
        .fetch_one(pool)
        .await
        .unwrap();
        let pid: i32 = sqlx::query_scalar(
            "INSERT INTO propiedades (publicado_por_id, estado, listing_status) VALUES ($1, 'publicado', 'active') RETURNING id",
        )
        .bind(uid)
        .fetch_one(pool)
        .await
        .unwrap();
        (uid, pid)
    }

    fn cuerpo(
        token: String,
        pid: i32,
        anon: Option<String>,
        uid: Option<i32>,
        ip: &str,
    ) -> VistaRequest {
        VistaRequest {
            view_token: token,
            propiedad_id: pid,
            anon_id: anon,
            user_id: uid,
            ip_address: Some(ip.to_string()),
            user_agent: Some("Mozilla/5.0 (Windows NT 10.0) TestBrowser/1.0".to_string()),
            es_interno: false,
            source: Some("directo".to_string()),
            utm: None,
            referer: None,
            visible_seconds: Some(5), // coherente: tokens con 10 s de edad
        }
    }

    async fn llamar(state: web::Data<AppState>, req: VistaRequest) -> VistaDecision {
        let (db, rconn, deps) = (
            state.db.clone(),
            state.redis.clone(),
            state.vista_deps.clone().expect("deps de prueba"),
        );
        procesar_vista(db, rconn, deps, req, Utc::now().timestamp_millis()).await
    }

    #[tokio::test]
    async fn flujo_counted_y_duplicado_y_resumen() {
        let Some((pool, conn)) = estado_vivo().await else {
            eprintln!("skip: sin VISTAS_TEST_PG_URL/REDIS_URL");
            return;
        };
        let tag = uuid::Uuid::new_v4().to_string();
        let (_uid, pid) = sembrar(&pool, &tag).await;
        let deps = VistaDeps {
            config: VistaConfig::default(),
            view_token_secret: SECRETO.to_string(),
            internal_secret: "interno-test".to_string(),
            ip_salt: SAL.to_string(),
            log_emisor: iniciar_escritor_log(pool.clone(), 10_000).0,
            bot_listas: std::sync::Arc::new(std::sync::RwLock::new(BotEstado::base())),
        };
        let state = web::Data::new(AppState {
            db: pool.clone(),
            redis: conn,
            scoring_cache: Arc::new(DashMap::new()),
            vista_deps: Some(deps),
        });

        let ahora = Utc::now().timestamp_millis();
        let anon = format!("sesion-{tag}");
        let ip = format!("ip-flujo-{tag}");
        // 1. Vista válida → counted.
        let r1 = llamar(
            state.clone(),
            cuerpo(token_de(pid, ahora - 10_000), pid, Some(anon.clone()), None, &ip),
        )
        .await;
        assert_eq!(r1.motivo, "counted", "{r1:?}");
        // 2. Otro token, misma sesión → duplicado (ventana 30 min).
        let r2 = llamar(
            state.clone(),
            cuerpo(token_de(pid, ahora - 10_000), pid, Some(anon.clone()), None, &ip),
        )
        .await;
        assert_eq!(r2.motivo, "duplicado", "{r2:?}");
        // 3. Resumen (vía consolidación, punto 4) con 1 vista y log con
        // 1 counted + 1 duplicado.
        tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
        consolidar_resumen(&pool).await.unwrap();
        let hoy = fecha_bogota_string(ahora);
        let (vistas, unicos): (i32, i32) = sqlx::query_as(
            "SELECT vistas, visitantes_unicos FROM vistas_resumen_diario WHERE propiedad_id = $1 AND fecha_local = $2::date",
        )
        .bind(pid)
        .bind(&hoy)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!((vistas, unicos), (1, 1));
        let n_counted: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM vistas_log WHERE propiedad_id = $1 AND reason = 'counted'",
        )
        .bind(pid)
        .fetch_one(&pool)
        .await
        .unwrap();
        let n_dup: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM vistas_log WHERE propiedad_id = $1 AND reason = 'duplicado'",
        )
        .bind(pid)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!((n_counted, n_dup), (1, 1));
        // 4. IP nunca en claro en el log.
        let hashes: Vec<String> = sqlx::query_scalar(
            "SELECT DISTINCT ip_hash FROM vistas_log WHERE propiedad_id = $1",
        )
        .bind(pid)
        .fetch_all(&pool)
        .await
        .unwrap();
        assert!(hashes.iter().all(|h| h.len() == 64 && !h.contains("203.0.113")));
    }

    #[tokio::test]
    async fn rechazos_token_e_inmueble() {
        let Some((pool, conn)) = estado_vivo().await else {
            eprintln!("skip: sin VISTAS_TEST_PG_URL/REDIS_URL");
            return;
        };
        let tag = uuid::Uuid::new_v4().to_string();
        let (_uid, pid) = sembrar(&pool, &tag).await;
        let deps = VistaDeps {
            config: VistaConfig::default(),
            view_token_secret: SECRETO.to_string(),
            internal_secret: "interno-test".to_string(),
            ip_salt: SAL.to_string(),
            log_emisor: iniciar_escritor_log(pool.clone(), 10_000).0,
            bot_listas: std::sync::Arc::new(std::sync::RwLock::new(BotEstado::base())),
        };
        let state = web::Data::new(AppState {
            db: pool.clone(),
            redis: conn,
            scoring_cache: Arc::new(DashMap::new()),
            vista_deps: Some(deps),
        });
        let ahora = Utc::now().timestamp_millis();
        let ip = format!("ip-rechazos-{tag}");

        // Firma inválida.
        let mut malo = cuerpo(token_de(pid, ahora - 10_000), pid, None, None, &ip);
        malo.view_token.push('x');
        let r = llamar(state.clone(), malo).await;
        assert_eq!(r.motivo, "token_invalido", "{r:?}");

        // Inmueble inexistente (token válido firmado para pid 999999).
        let r = llamar(
            state.clone(),
            cuerpo(token_de(999_999, ahora - 10_000), 999_999, None, None, &ip),
        )
        .await;
        assert_eq!(r.motivo, "inmueble_inexistente", "{r:?}");

        // Interno (dueño declara es_interno).
        let (_uid2, pid2) = sembrar(&pool, &format!("{tag}-b")).await;
        let mut req = cuerpo(token_de(pid2, ahora - 10_000), pid2, None, None, &ip);
        req.es_interno = true;
        let r = llamar(state.clone(), req).await;
        assert_eq!(r.motivo, "interno", "{r:?}");

        // Bot (curl en user-agent).
        let mut req = cuerpo(token_de(pid, ahora - 10_000), pid, None, None, &ip);
        req.user_agent = Some("curl/8.0".to_string());
        let r = llamar(state.clone(), req).await;
        assert_eq!(r.motivo, "bot", "{r:?}");
        let _ = _uid;
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 8)]
    async fn cien_vistas_simultaneas_end_to_end() {        // Paso2 punto 3: 100 eventos del MISMO visitante + inmueble, contra
        // Postgres y Redis reales → exactamente 1 counted (Lua atómico).
        let Some((pool, _conn)) = estado_vivo().await else {
            eprintln!("skip: sin VISTAS_TEST_PG_URL/REDIS_URL");
            return;
        };
        let tag = uuid::Uuid::new_v4().to_string();
        let (_uid, pid) = sembrar(&pool, &tag).await;
        // Rate holgado: este test mide dedupe end-to-end (el rate con
        // defaults ya está cubierto en vista_estado).
        let mut config = VistaConfig::default();
        config.rate_limit_events_per_minute = 10_000;
        let deps = VistaDeps {
            config,
            view_token_secret: SECRETO.to_string(),
            internal_secret: "interno-test".to_string(),
            ip_salt: SAL.to_string(),
            log_emisor: iniciar_escritor_log(pool.clone(), 10_000).0,
            bot_listas: std::sync::Arc::new(std::sync::RwLock::new(BotEstado::base())),
        };
        let ahora = Utc::now().timestamp_millis();
        let anon = format!("sesion-conc-{tag}");
        let ip = format!("ip-conc-{tag}");
        let redis_url = std::env::var("VISTAS_TEST_REDIS_URL").unwrap();
        let mut handles = Vec::new();
        for _ in 0..100 {
            // Estado propio por tarea (la conexión Redis no se comparte entre
            // hilos); el pool y el canal de log sí se comparten.
            let cliente = redis::Client::open(redis_url.as_str()).unwrap();
            let conn = cliente.get_multiplexed_async_connection().await.unwrap();
            let st = web::Data::new(AppState {
                db: pool.clone(),
                redis: conn,
                scoring_cache: Arc::new(DashMap::new()),
                vista_deps: Some(deps.clone()),
            });
            let req = cuerpo(token_de(pid, ahora - 10_000), pid, Some(anon.clone()), None, &ip);
            handles.push(tokio::spawn(async move { llamar(st, req).await }));
        }
        let mut contadas = 0;
        let mut duplicadas = 0;
        for h in handles {
            let r = h.await.unwrap();
            match r.motivo.as_str() {
                "counted" => contadas += 1,
                "duplicado" => duplicadas += 1,
                otro => panic!("motivo inesperado end-to-end: {otro} en {r:?}"),
            }
        }
        assert_eq!(contadas, 1, "exactamente una vista contada end-to-end");
        assert_eq!(duplicadas, 99);
        // Resumen vía consolidación (punto 4) y log consolidan lo mismo.
        tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
        consolidar_resumen(&pool).await.unwrap();
        let hoy = fecha_bogota_string(ahora);
        let (vistas, unicos): (i32, i32) = sqlx::query_as(
            "SELECT vistas, visitantes_unicos FROM vistas_resumen_diario WHERE propiedad_id = $1 AND fecha_local = $2::date",
        )
        .bind(pid)
        .bind(&hoy)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!((vistas, unicos), (1, 1));
        let n: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM vistas_log WHERE propiedad_id = $1 AND reason = 'counted'",
        )
        .bind(pid)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(n, 1);
    }

    #[tokio::test]
    async fn cierre_ordenado_vacia_el_lote() {
        // Paso2 punto 6: al soltar el último emisor (lo que hace main tras
        // SIGTERM), el escritor vacía lo encolado antes de terminar.
        let pg = req_env_integracion("VISTAS_TEST_PG_URL");
        let Some(pg_url) = pg else {
            return;
        };
        let pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(2)
            .connect(&pg_url)
            .await
            .unwrap();
        let tag = uuid::Uuid::new_v4().to_string();
        let (_uid, pid) = sembrar(&pool, &tag).await;
        let (emisor, handle) = iniciar_escritor_log(pool.clone(), 10_000);
        let fecha = chrono::NaiveDate::parse_from_str("2026-10-04", "%Y-%m-%d").unwrap();
        for i in 0..50 {
            emisor.enviar(VistaLogRow {
                fecha_local: fecha,
                propiedad_id: pid,
                agency_id: None,
                user_id: None,
                anon_id: Some(format!("anon-drain-{tag}-{i}")),
                identidad_debil: false,
                ip_hash: "a".repeat(64),
                user_agent: None,
                source: None,
                utm: None,
                referer: None,
                visible_seconds: None,
                server_elapsed_ms: 10_000,
                result: "counted",
                reason: "counted".to_string(),
                sospechoso: false,
                rules_version: "v1".to_string(),
            })
            .await;
        }
        drop(emisor); // == todos los emisores soltados tras SIGTERM
        tokio::time::timeout(std::time::Duration::from_secs(15), handle)
            .await
            .expect("el escritor debe terminar tras cerrar el canal")
            .expect("el escritor no debe fallar");
        let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM vistas_log WHERE propiedad_id = $1")
            .bind(pid)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(n, 50, "las 50 filas encoladas deben persistirse al cerrar");
    }

    #[tokio::test]
    async fn lote_descarta_solo_la_fila_mala() {
        // Lote 3 punto 6: con el esquema completo (002+003+004), la fila mala
        // falla por CHECK de motivos (reason inexistente). Las buenas entran.
        let pg = req_env_integracion("VISTAS_TEST_PG_URL");
        let Some(pg_url) = pg else {
            return;
        };
        let pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(2)
            .connect(&pg_url)
            .await
            .unwrap();
        let tag = uuid::Uuid::new_v4().to_string();
        let (_uid, pid) = sembrar(&pool, &tag).await;
        let (emisor, handle) = iniciar_escritor_log(pool.clone(), 10_000);
        let fecha = chrono::NaiveDate::parse_from_str("2026-10-04", "%Y-%m-%d").unwrap();
        let fila_buena = |i: i32, p: i32| VistaLogRow {
            fecha_local: fecha,
            propiedad_id: p,
            agency_id: None,
            user_id: None,
            anon_id: Some(format!("anon-lote-{tag}-{i}")),
            identidad_debil: false,
            ip_hash: "b".repeat(64),
            user_agent: None,
            source: None,
            utm: None,
            referer: None,
            visible_seconds: None,
            server_elapsed_ms: 10_000,
            result: "counted",
            reason: "counted".to_string(),
            sospechoso: false,
            rules_version: "v1".to_string(),
        };
        let mut fila_mala = fila_buena(1, pid);
        fila_mala.reason = "motivo_inexistente".to_string(); // viola el CHECK
        fila_mala.result = "rejected";
        emisor.enviar(fila_buena(0, pid)).await;
        emisor.enviar(fila_mala).await;
        emisor.enviar(fila_buena(2, pid)).await;
        drop(emisor);
        tokio::time::timeout(std::time::Duration::from_secs(15), handle)
            .await
            .expect("el escritor debe terminar")
            .expect("el escritor no debe fallar");
        let buenas: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM vistas_log WHERE propiedad_id = $1 AND reason = 'counted'")
                .bind(pid)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(buenas, 2, "las 2 filas buenas deben insertarse");
        let malas: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM vistas_log WHERE propiedad_id = $1 AND reason = 'motivo_inexistente'")
                .bind(pid)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(malas, 0, "la fila mala debe descartarse");
    }

    #[tokio::test]
    async fn flood_100_tokens_invalidos_sin_filas() {
        // Lote 2.2a (reducido a 100 en lote 3 punto 6): eventos con token
        // inválido no crean ninguna fila en vistas_log (solo agregado).
        let Some((pool, conn)) = estado_vivo().await else {
            eprintln!("skip: sin VISTAS_TEST_PG_URL/REDIS_URL");
            return;
        };
        let tag = uuid::Uuid::new_v4().to_string();
        let (_uid, _pid) = sembrar(&pool, &tag).await;
        let deps = VistaDeps {
            config: VistaConfig::default(),
            view_token_secret: SECRETO.to_string(),
            internal_secret: "interno-test".to_string(),
            ip_salt: SAL.to_string(),
            log_emisor: iniciar_escritor_log(pool.clone(), 10_000).0,
            bot_listas: std::sync::Arc::new(std::sync::RwLock::new(BotEstado::base())),
        };
        let state = web::Data::new(AppState {
            db: pool.clone(),
            redis: conn,
            scoring_cache: Arc::new(DashMap::new()),
            vista_deps: Some(deps),
        });
        // propiedad_id único de este test: ninguna fila debe aparecer con él.
        let pid_flood = 979_797_979;
        for i in 0..100 {
            let req = VistaRequest {
                view_token: format!("basura-{tag}-{i}"),
                propiedad_id: pid_flood,
                anon_id: None,
                user_id: None,
                ip_address: Some(format!("ip-flood-{tag}")),
                user_agent: Some("Mozilla/5.0 TestBrowser/1.0".to_string()),
                es_interno: false,
                source: None,
                utm: None,
                referer: None,
                visible_seconds: None,
            };
            let d = llamar(state.clone(), req).await;
            assert!(
                d.motivo == "token_invalido" || d.motivo == "rate_limit",
                "inesperado: {}",
                d.motivo
            );
        }
        tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
        let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM vistas_log WHERE propiedad_id = $1")
            .bind(pid_flood)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(n, 0, "ningún token inválido deja fila");
    }

    #[tokio::test]
    async fn flood_supera_limite_sin_tocar_db() {
        // Lote 2.2b: con la pool ROTA (cualquier SQL fallaría), si el contador
        // pre-flood de la IP ya supera el límite, se responde rate_limit sin
        // tocar DB. Una IP fresca en cambio sí llega a DB y falla.
        let redis_url = req_env_integracion("VISTAS_TEST_REDIS_URL");
        let Some(redis_url) = redis_url else {
            return;
        };
        let pool_rota = sqlx::postgres::PgPoolOptions::new()
            .max_connections(1)
            // Punto 4: acquire corto SOLO en la prueba (producción intacta)
            // para no esperar el default (30 s) ante el puerto muerto.
            .acquire_timeout(std::time::Duration::from_millis(500))
            .connect_lazy("postgres://t:t@127.0.0.1:1/t")
            .expect("lazy no falla al crear");
        let cliente = redis::Client::open(redis_url).unwrap();
        let conn = cliente.get_multiplexed_async_connection().await.unwrap();
        let deps = VistaDeps {
            config: VistaConfig::default(),
            view_token_secret: SECRETO.to_string(),
            ip_salt: SAL.to_string(),
            internal_secret: "interno-test".to_string(),
            log_emisor: iniciar_escritor_log(pool_rota.clone(), 10_000).0,
            bot_listas: std::sync::Arc::new(std::sync::RwLock::new(BotEstado::base())),
        };
        let state = web::Data::new(AppState {
            db: pool_rota,
            redis: conn,
            scoring_cache: Arc::new(DashMap::new()),
            vista_deps: Some(deps),
        });
        let tag = uuid::Uuid::new_v4().to_string();
        let ahora = Utc::now().timestamp_millis();
        let ip = format!("ip-preflood-{tag}");
        // Pre-siembra: 121 eventos ya contados en este minuto (límite 120).
        let bucket = Utc::now().timestamp_millis().div_euclid(60_000);
        let clave = format!("vistas:preflood:{}:{bucket}", crate::vista_api::hash_ip(SAL, &ip));
        let mut seed = cliente.get_multiplexed_async_connection().await.unwrap();
        let _: () = redis::cmd("SET")
            .arg(&clave)
            .arg(121)
            .arg("EX")
            .arg(120)
            .query_async(&mut seed)
            .await
            .unwrap();
        let req = cuerpo(token_de(1, ahora - 10_000), 1, None, None, &ip);
        let r = llamar(state.clone(), req).await;
        assert_eq!(r.motivo, "rate_limit", "con pool rota no hay SQL");
        let req_fresca = cuerpo(token_de(1, ahora - 10_000), 1, None, None, &format!("ip-otra-{tag}"));
        let r = llamar(state.clone(), req_fresca).await;
        assert_eq!(r.motivo, "error_sistema", "IP fresca sí llega a DB y falla");
    }

    #[tokio::test]
    async fn emisor_acotado_descarta_y_cuenta() {
        // Lote 2.3: capacidad 10, receptor detenido, 50 REJECTED → 40
        // descartes y el contador marca 40. Nunca bloquea (try_send).
        let (emisor, _rx) = EmisorLog::para_pruebas(10);
        let fecha = chrono::NaiveDate::parse_from_str("2026-10-04", "%Y-%m-%d").unwrap();
        for i in 0..50 {
            let r = emisor
                .enviar(VistaLogRow {
                    fecha_local: fecha,
                    propiedad_id: 1,
                    agency_id: None,
                    user_id: None,
                    anon_id: Some(format!("anon-cap-{i}")),
                    identidad_debil: false,
                    ip_hash: "c".repeat(64),
                    user_agent: None,
                    source: None,
                    utm: None,
                    referer: None,
                    visible_seconds: None,
                    server_elapsed_ms: 10_000,
                    result: "rejected",
                    reason: "duplicado".to_string(),
                    sospechoso: false,
                    rules_version: "v1".to_string(),
                })
                .await;
            if i < 10 {
                assert_eq!(r, ResultadoEnvio::Encolada);
            } else {
                assert_eq!(r, ResultadoEnvio::Descartada);
            }
        }
        assert_eq!(emisor.descartes(), 40);
    }

    #[tokio::test]
    async fn counted_espera_y_entra_al_liberarse() {
        // Punto 1: canal lleno + counted → espera; al liberarse un hueco entra
        // (Encolada), sin descartarse.
        let (emisor, mut rx) = EmisorLog::para_pruebas(1);
        let fecha = chrono::NaiveDate::parse_from_str("2026-10-04", "%Y-%m-%d").unwrap();
        let fila = move |i: i32| VistaLogRow {
            fecha_local: fecha,
            propiedad_id: 1,
            agency_id: None,
            user_id: None,
            anon_id: Some(format!("anon-w-{i}")),
            identidad_debil: false,
            ip_hash: "c".repeat(64),
            user_agent: None,
            source: None,
            utm: None,
            referer: None,
            visible_seconds: None,
            server_elapsed_ms: 10_000,
            result: "counted",
            reason: "counted".to_string(),
            sospechoso: false,
            rules_version: "v1".to_string(),
        };
        assert_eq!(emisor.enviar(fila(0)).await, ResultadoEnvio::Encolada);
        let emisor2 = emisor.clone();
        let espera = tokio::spawn(async move { emisor2.enviar(fila(1)).await });
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        let _ = rx.recv().await; // libera un hueco
        assert_eq!(espera.await.unwrap(), ResultadoEnvio::Encolada);
        assert_eq!(emisor.descartes(), 0);
    }

    #[tokio::test]
    async fn counted_sin_hueco_es_perdida() {
        // Punto 1: canal lleno que nunca se libera → PerdidaCounted (2 s).
        let (emisor, _rx) = EmisorLog::para_pruebas(1);
        let fecha = chrono::NaiveDate::parse_from_str("2026-10-04", "%Y-%m-%d").unwrap();
        let fila = || VistaLogRow {
            fecha_local: fecha,
            propiedad_id: 1,
            agency_id: None,
            user_id: None,
            anon_id: Some("anon-p".to_string()),
            identidad_debil: false,
            ip_hash: "c".repeat(64),
            user_agent: None,
            source: None,
            utm: None,
            referer: None,
            visible_seconds: None,
            server_elapsed_ms: 10_000,
            result: "counted",
            reason: "counted".to_string(),
            sospechoso: false,
            rules_version: "v1".to_string(),
        };
        assert_eq!(emisor.enviar(fila()).await, ResultadoEnvio::Encolada);
        assert_eq!(emisor.enviar(fila()).await, ResultadoEnvio::PerdidaCounted);
        assert_eq!(emisor.descartes(), 0, "counted no suma a descartes");
    }

    #[tokio::test]
    async fn expirados_100_sin_filas() {
        // Lote 3 punto 3: 100 eventos con token expirado no crean filas
        // (agregado en Redis + tracing).
        let Some((pool, conn)) = estado_vivo().await else {
            eprintln!("skip: sin VISTAS_TEST_PG_URL/REDIS_URL");
            return;
        };
        let tag = uuid::Uuid::new_v4().to_string();
        let (_uid, _pid) = sembrar(&pool, &tag).await;
        let deps = VistaDeps {
            config: VistaConfig::default(),
            view_token_secret: SECRETO.to_string(),
            ip_salt: SAL.to_string(),
            internal_secret: "interno-test".to_string(),
            log_emisor: iniciar_escritor_log(pool.clone(), 10_000).0,
            bot_listas: std::sync::Arc::new(std::sync::RwLock::new(BotEstado::base())),
        };
        let state = web::Data::new(AppState {
            db: pool.clone(),
            redis: conn,
            scoring_cache: Arc::new(DashMap::new()),
            vista_deps: Some(deps),
        });
        let pid_exp = 978_787_878;
        let ahora = Utc::now().timestamp_millis();
        let ip = format!("ip-exp-{tag}");
        for i in 0..100 {
            // iat hace 61 min (> max 60): expirado. jti único por evento.
            let t = {
                use base64::Engine as _;
                let exp = ahora - 61 * 60_000 + 3_600_000;
                let payload = serde_json::json!({"pid": pid_exp, "jti": format!("jti-exp-{tag}-{i}"), "iat": ahora - 61 * 60_000, "exp": exp});
                let b64 = base64::engine::general_purpose::URL_SAFE_NO_PAD
                    .encode(payload.to_string().as_bytes());
                let cuerpo_tok = format!("v1.{b64}");
                let mut mac = Hmac::<Sha256>::new_from_slice(SECRETO.as_bytes()).unwrap();
                mac.update(cuerpo_tok.as_bytes());
                format!("{cuerpo_tok}.{}", hex::encode(mac.finalize().into_bytes()))
            };
            let r = llamar(state.clone(), cuerpo(t, pid_exp, None, None, &ip)).await;
            assert_eq!(r.motivo, "token_expirado", "{r:?}");
        }
        tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
        let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM vistas_log WHERE propiedad_id = $1")
            .bind(pid_exp)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(n, 0, "ningún expirado deja fila");
    }

    #[tokio::test]
    async fn sin_secreto_interno_401_sin_tocar_infra() {
        // Lote 3 punto 4: sin header X-Internal-Secret → 401 sin tocar
        // Redis ni Postgres (pool rota + ausencia de claves lo prueban).
        let redis_url = req_env_integracion("VISTAS_TEST_REDIS_URL");
        let Some(redis_url) = redis_url else {
            return;
        };
        let pool_rota = sqlx::postgres::PgPoolOptions::new()
            .max_connections(1)
            .connect_lazy("postgres://t:t@127.0.0.1:1/t")
            .expect("lazy no falla al crear");
        let cliente = redis::Client::open(redis_url).unwrap();
        let conn = cliente.get_multiplexed_async_connection().await.unwrap();
        let deps = VistaDeps {
            config: VistaConfig::default(),
            view_token_secret: SECRETO.to_string(),
            ip_salt: SAL.to_string(),
            internal_secret: "interno-test".to_string(),
            log_emisor: iniciar_escritor_log(pool_rota.clone(), 10_000).0,
            bot_listas: std::sync::Arc::new(std::sync::RwLock::new(BotEstado::base())),
        };
        let state = web::Data::new(AppState {
            db: pool_rota,
            redis: conn,
            scoring_cache: Arc::new(DashMap::new()),
            vista_deps: Some(deps),
        });
        let tag = uuid::Uuid::new_v4().to_string();
        let req_http = actix_web::test::TestRequest::post()
            .uri("/tracking/vista")
            .to_http_request();
        let body = web::Json(cuerpo(
            format!("tok-{tag}"),
            1,
            None,
            None,
            &format!("ip-401-{tag}"),
        ));
        let resp = registrar_vista(state.clone(), req_http, body).await;
        assert_eq!(resp.status(), actix_web::http::StatusCode::UNAUTHORIZED);
        // Sin rastro en Redis (ninguna clave de este jti/token).
        let mut check = cliente.get_multiplexed_async_connection().await.unwrap();
        let claves: Vec<String> = redis::cmd("KEYS")
            .arg(format!("vistas:*{tag}*"))
            .query_async(&mut check)
            .await
            .unwrap();
        assert!(claves.is_empty(), "sin toques a Redis: {claves:?}");
        // Con secreto correcto sí pasa el gate (falla después, en DB rota).
        let req_ok = actix_web::test::TestRequest::post()
            .uri("/tracking/vista")
            .insert_header(("x-internal-secret", "interno-test"))
            .to_http_request();
        let body_ok = web::Json(cuerpo(
            format!("tok-{tag}"),
            1,
            None,
            None,
            &format!("ip-401-{tag}"),
        ));
        let resp_ok = registrar_vista(state.clone(), req_ok, body_ok).await;
        assert_ne!(resp_ok.status(), actix_web::http::StatusCode::UNAUTHORIZED);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 8)]
    async fn concurrencia_defaults_1_counted_resto_dup_o_rate() {
        // Punto 6a: 100 simultáneos, MISMO visitante+propiedad, config por
        // defecto (visitante 30/min): exactamente 1 counted; el resto SOLO
        // duplicado o rate_limit, nunca otro motivo.
        let Some((pool, _conn)) = estado_vivo().await else {
            return;
        };
        let tag = uuid::Uuid::new_v4().to_string();
        let (_uid, pid) = sembrar(&pool, &tag).await;
        let deps = VistaDeps {
            config: VistaConfig::default(),
            view_token_secret: SECRETO.to_string(),
            ip_salt: SAL.to_string(),
            internal_secret: "interno-test".to_string(),
            log_emisor: iniciar_escritor_log(pool.clone(), 10_000).0,
            bot_listas: std::sync::Arc::new(std::sync::RwLock::new(BotEstado::base())),
        };
        let ahora = Utc::now().timestamp_millis();
        let anon = format!("sesion-def-{tag}");
        let ip = format!("ip-def-{tag}");
        let redis_url = req_env_integracion("VISTAS_TEST_REDIS_URL").unwrap();
        let mut handles = Vec::new();
        for _ in 0..100 {
            let cliente = redis::Client::open(redis_url.as_str()).unwrap();
            let conn = cliente.get_multiplexed_async_connection().await.unwrap();
            let st = web::Data::new(AppState {
                db: pool.clone(),
                redis: conn,
                scoring_cache: Arc::new(DashMap::new()),
                vista_deps: Some(deps.clone()),
            });
            let req = cuerpo(token_de(pid, ahora - 10_000), pid, Some(anon.clone()), None, &ip);
            handles.push(tokio::spawn(async move { llamar(st, req).await }));
        }
        let (mut contadas, mut duplicadas, mut rates) = (0, 0, 0);
        for h in handles {
            match h.await.unwrap().motivo.as_str() {
                "counted" => contadas += 1,
                "duplicado" => duplicadas += 1,
                "rate_limit" => rates += 1,
                otro => panic!("motivo inesperado con defaults: {otro}"),
            }
        }
        assert_eq!(contadas, 1, "exactamente una vista contada");
        assert_eq!(duplicadas + rates, 99);
        assert!(rates > 0, "con defaults el rate de visitante debe saltar");
    }

    #[test]
    fn arranque_rechaza_secreto_vacio_o_corto() {
        // Punto 1a: la validación de arranque falla con vacío o corto.
        assert!(validar_secreto("X", "").is_err());
        assert!(validar_secreto("X", "   ").is_err());
        assert!(validar_secreto("X", "corto").is_err());
        assert!(validar_secreto("X", &"a".repeat(31)).is_err());
        assert!(validar_secreto("X", &"a".repeat(32)).is_ok());
    }

    #[test]
    fn header_vacio_nunca_autoriza() {        // Punto 1b: header vacío no autoriza aunque el configurado fuera vacío.
        assert!(!secreto_coincide(b"", b""));
        assert!(!secreto_coincide(b"", b"un-secreto-largo-de-mas-de-32-chars"));
        assert!(!secreto_coincide(b"un-secreto-largo-de-mas-de-32-chars", b""));
        assert!(secreto_coincide(
            b"un-secreto-largo-de-mas-de-32-chars",
            b"un-secreto-largo-de-mas-de-32-chars"
        ));
        assert!(!secreto_coincide(
            b"un-secreto-largo-de-mas-de-32-chars",
            b"otro-secreto-largo-de-mas-de-32-char"
        ));
    }

    // --- Lote 5: bots en memoria (puros, sin infra) ---

    #[test]
    fn bots_ua_base_rechaza() {
        let base = BotListas::base();
        assert!(es_bot_listas(&base, Some("curl/8.0"), None));
        assert!(es_bot_listas(&base, Some("Mozilla/5.0 GPTBot/1.0"), None));
        assert!(!es_bot_listas(
            &base,
            Some("Mozilla/5.0 (Windows NT 10.0) TestBrowser/1.0"),
            None
        ));
        assert!(es_bot_listas(&base, None, None)); // sin UA → bot
        assert!(es_bot_listas(&base, Some("   "), None));
    }

    #[test]
    fn bots_cidr_contiene_y_excluye() {
        let listas = BotListas {
            ua_substrings: Vec::new(),
            redes: vec!["203.0.113.0/24".parse().unwrap()],
        };
        let ua = Some("Mozilla/5.0 TestBrowser/1.0");
        assert!(es_bot_listas(&listas, ua, Some("203.0.113.9")));
        assert!(!es_bot_listas(&listas, ua, Some("198.51.100.1")));
        assert!(!es_bot_listas(&listas, ua, Some("no-es-ip")));
        assert!(!es_bot_listas(&listas, ua, None));
    }

    #[tokio::test]
    async fn bots_recarga_toma_cambios_y_tabla() {
        // Punto 5: el archivo suma subcadenas y la tabla CIDRs; al reescribir
        // el archivo la recarga lo refleja.
        let pg = req_env_integracion("VISTAS_TEST_PG_URL");
        let Some(pg_url) = pg else {
            return;
        };
        let pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(1)
            .connect(&pg_url)
            .await
            .unwrap();
        let dir = std::env::temp_dir();
        let ruta = dir.join(format!("ua-test-{}.txt", uuid::Uuid::new_v4()));
        tokio::fs::write(&ruta, "mimejorbottestunico\n").await.unwrap();
        let l1 = cargar_listas_bots(ruta.to_str().unwrap(), &pool).await;
        assert_eq!(l1.ua_fuente, "archivo");
        assert!(
            l1.listas.ua_substrings.len() > BotListas::base().ua_substrings.len(),
            "con archivo, ua supera la base"
        );
        assert!(l1.listas.ua_substrings.iter().any(|s| s == "mimejorbottestunico"));
        tokio::fs::write(&ruta, "# solo comentario\n").await.unwrap();
        let l2 = cargar_listas_bots(ruta.to_str().unwrap(), &pool).await;
        assert!(!l2.listas.ua_substrings.iter().any(|s| s == "mimejorbottestunico"));
        tokio::fs::remove_file(&ruta).await.ok();
        // Tabla: inserta un CIDR de documentación, recarga y limpia.
        sqlx::query("INSERT INTO vistas_bot_ips (cidr, descripcion) VALUES ('192.0.2.0/24', 'test') ON CONFLICT DO NOTHING")
            .execute(&pool)
            .await
            .unwrap();
        let l3 = cargar_listas_bots("ruta/inexistente/ua.txt", &pool).await;
        assert_eq!(l3.ua_fuente, "respaldo", "sin archivo la fuente es respaldo");
        assert!(l3.tabla_ok);
        assert!(l3.listas.redes.iter().any(|n| n.to_string() == "192.0.2.0/24"));
        assert!(es_bot_listas(&l3.listas, Some("Mozilla/5.0 TestBrowser/1.0"), Some("192.0.2.7")));
        sqlx::query("DELETE FROM vistas_bot_ips WHERE cidr = '192.0.2.0/24'")
            .execute(&pool)
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn inmueble_cache_sirve_segundo_evento() {
        // Punto 6: dos eventos del mismo inmueble → el segundo sale de caché
        // (se despublica en DB entremedias y SIGUE contando: staleness ≤60 s).
        let Some((pool, conn)) = estado_vivo().await else {
            return;
        };
        let tag = uuid::Uuid::new_v4().to_string();
        let (_uid, pid) = sembrar(&pool, &tag).await;
        let deps = VistaDeps {
            config: VistaConfig::default(),
            view_token_secret: SECRETO.to_string(),
            ip_salt: SAL.to_string(),
            internal_secret: "interno-test".to_string(),
            log_emisor: iniciar_escritor_log(pool.clone(), 10_000).0,
            bot_listas: std::sync::Arc::new(std::sync::RwLock::new(BotEstado::base())),
        };
        let state = web::Data::new(AppState {
            db: pool.clone(),
            redis: conn,
            scoring_cache: Arc::new(DashMap::new()),
            vista_deps: Some(deps),
        });
        let ahora = Utc::now().timestamp_millis();
        let anon = format!("sesion-cache-{tag}");
        let ip = format!("ip-cache-{tag}");
        let r1 = llamar(
            state.clone(),
            cuerpo(token_de(pid, ahora - 10_000), pid, Some(anon.clone()), None, &ip),
        )
        .await;
        assert_eq!(r1.motivo, "counted", "{r1:?}");
        // La caché existe con TTL.
        let mut check = state.redis.clone();
        let ttl: i64 = redis::cmd("TTL")
            .arg(format!("vistas:inmueble:{pid}"))
            .query_async(&mut check)
            .await
            .unwrap();
        assert!((0..=60).contains(&ttl), "TTL caché 60 s, fue {ttl}");
        // Se despublica en DB: el segundo evento sale de caché (stale).
        sqlx::query("UPDATE propiedades SET estado = 'no_publicado' WHERE id = $1")
            .bind(pid)
            .execute(&pool)
            .await
            .unwrap();
        let r2 = llamar(
            state.clone(),
            cuerpo(token_de(pid, ahora - 10_000), pid, Some(anon.clone()), None, &ip),
        )
        .await;
        assert_eq!(r2.motivo, "duplicado", "{r2:?}"); // dedupe, no releyó DB
    }

    #[tokio::test]
    async fn vinculo_login_no_duplica() {
        // Punto 7a: anónimo cuenta; al iniciar sesión (mismo anon + user),
        // la vista con sesión cae en duplicado por el vínculo.
        let Some((pool, conn)) = estado_vivo().await else {
            return;
        };
        let tag = uuid::Uuid::new_v4().to_string();
        let (uid, pid) = sembrar(&pool, &tag).await;
        let deps = VistaDeps {
            config: VistaConfig::default(),
            view_token_secret: SECRETO.to_string(),
            ip_salt: SAL.to_string(),
            internal_secret: "interno-test".to_string(),
            log_emisor: iniciar_escritor_log(pool.clone(), 10_000).0,
            bot_listas: std::sync::Arc::new(std::sync::RwLock::new(BotEstado::base())),
        };
        let state = web::Data::new(AppState {
            db: pool.clone(),
            redis: conn,
            scoring_cache: Arc::new(DashMap::new()),
            vista_deps: Some(deps),
        });
        let ahora = Utc::now().timestamp_millis();
        let anon = format!("sesion-link-{tag}");
        let ip = format!("ip-link-{tag}");
        let r1 = llamar(
            state.clone(),
            cuerpo(token_de(pid, ahora - 10_000), pid, Some(anon.clone()), None, &ip),
        )
        .await;
        assert_eq!(r1.motivo, "counted", "{r1:?}");
        // Login a mitad de sesión: mismo anon + user_id.
        let r2 = llamar(
            state.clone(),
            cuerpo(token_de(pid, ahora - 10_000), pid, Some(anon.clone()), Some(uid), &ip),
        )
        .await;
        assert_eq!(r2.motivo, "duplicado", "{r2:?}");
        // El vínculo quedó registrado.
        let n: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM vistas_identidades WHERE anon_id = $1 AND user_id = $2",
        )
        .bind(&anon)
        .bind(uid)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(n, 1);
    }

    #[tokio::test]
    async fn muestreo_rate_limit_una_fila_y_agregado() {
        // Punto 7b: con rate 0 cada evento es rate_limit; solo el primero del
        // minuto deja fila, el resto va al agregado.
        let Some((pool, conn)) = estado_vivo().await else {
            return;
        };
        let tag = uuid::Uuid::new_v4().to_string();
        let (_uid, pid) = sembrar(&pool, &tag).await;
        let mut config = VistaConfig::default();
        config.rate_limit_events_per_minute = 0;
        let deps = VistaDeps {
            config,
            view_token_secret: SECRETO.to_string(),
            ip_salt: SAL.to_string(),
            internal_secret: "interno-test".to_string(),
            log_emisor: iniciar_escritor_log(pool.clone(), 10_000).0,
            bot_listas: std::sync::Arc::new(std::sync::RwLock::new(BotEstado::base())),
        };
        let state = web::Data::new(AppState {
            db: pool.clone(),
            redis: conn,
            scoring_cache: Arc::new(DashMap::new()),
            vista_deps: Some(deps),
        });
        let ahora = Utc::now().timestamp_millis();
        let ip = format!("ip-muestreo-{tag}");
        for i in 0..5 {
            let anon = format!("sesion-muestreo-{tag}-{i}");
            let r = llamar(
                state.clone(),
                cuerpo(token_de(pid, ahora - 10_000), pid, Some(anon), None, &ip),
            )
            .await;
            assert_eq!(r.motivo, "rate_limit", "{r:?}");
        }
        tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
        let filas: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM vistas_log WHERE propiedad_id = $1 AND reason = 'rate_limit'",
        )
        .bind(pid)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(filas, 1, "solo la primera del minuto deja fila");
        // Suma por ip_hash (aisla este test; el minuto puede rodar entremedias).
        let agg: Option<i64> = sqlx::query_scalar(
            "SELECT SUM(conteo) FROM vistas_rate_limit_agregado WHERE ip_hash = $1",
        )
        .bind(hash_ip(SAL, &ip))
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(agg, Some(4), "el resto va al agregado");
    }

    #[tokio::test]
    async fn interno_sin_sesion_fuerza_interno() {
        // Punto 7c: es_interno de Node (p. ej. cookie de interno) fuerza el
        // motivo aunque no haya sesión (user_id None).
        let Some((pool, conn)) = estado_vivo().await else {
            return;
        };
        let tag = uuid::Uuid::new_v4().to_string();
        let (_uid, pid) = sembrar(&pool, &tag).await;
        let deps = VistaDeps {
            config: VistaConfig::default(),
            view_token_secret: SECRETO.to_string(),
            ip_salt: SAL.to_string(),
            internal_secret: "interno-test".to_string(),
            log_emisor: iniciar_escritor_log(pool.clone(), 10_000).0,
            bot_listas: std::sync::Arc::new(std::sync::RwLock::new(BotEstado::base())),
        };
        let state = web::Data::new(AppState {
            db: pool.clone(),
            redis: conn,
            scoring_cache: Arc::new(DashMap::new()),
            vista_deps: Some(deps),
        });
        let ahora = Utc::now().timestamp_millis();
        let ip = format!("ip-interno-{tag}");
        let mut req = cuerpo(
            token_de(pid, ahora - 10_000),
            pid,
            None,
            None,
            &ip,
        );
        req.es_interno = true;
        let r = llamar(state.clone(), req).await;
        assert_eq!(r.motivo, "interno", "{r:?}");
    }

    #[tokio::test]
    async fn salud_sin_secretos_deshabilita_vistas() {        // Punto 1: sin deps → /health con vistas_habilitado=false y 503.
        let redis_url = req_env_integracion("VISTAS_TEST_REDIS_URL");
        let Some(redis_url) = redis_url else {
            return;
        };
        let pool_rota = sqlx::postgres::PgPoolOptions::new()
            .max_connections(1)
            .acquire_timeout(std::time::Duration::from_millis(500))
            .connect_lazy("postgres://t:t@127.0.0.1:1/t")
            .expect("lazy no falla al crear");
        let cliente = redis::Client::open(redis_url).unwrap();
        let conn = cliente.get_multiplexed_async_connection().await.unwrap();
        let state = web::Data::new(AppState {
            db: pool_rota.clone(),
            redis: conn,
            scoring_cache: Arc::new(DashMap::new()),
            vista_deps: None,
        });
        let resp = crate::handlers::health_check(state.clone()).await;
        assert_eq!(resp.status(), actix_web::http::StatusCode::OK);
        let bytes = actix_web::body::to_bytes(resp.into_body()).await.unwrap();
        let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(json["vistas_habilitado"], false);
        // Con deps válidas el flag es true.
        let conn2 = cliente.get_multiplexed_async_connection().await.unwrap();
        let deps_ok = VistaDeps {
            config: VistaConfig::default(),
            view_token_secret: "s".repeat(32),
            ip_salt: "s".repeat(32),
            internal_secret: "s".repeat(32),
            log_emisor: iniciar_escritor_log(pool_rota.clone(), 10).0,
            bot_listas: std::sync::Arc::new(std::sync::RwLock::new(BotEstado::base())),
        };
        let state_ok = web::Data::new(AppState {
            db: pool_rota.clone(),
            redis: conn2,
            scoring_cache: Arc::new(DashMap::new()),
            vista_deps: Some(deps_ok),
        });
        let resp_ok = crate::handlers::health_check(state_ok).await;
        let bytes_ok = actix_web::body::to_bytes(resp_ok.into_body()).await.unwrap();
        let json_ok: serde_json::Value = serde_json::from_slice(&bytes_ok).unwrap();
        assert_eq!(json_ok["vistas_habilitado"], true);
        let req_http = actix_web::test::TestRequest::post()
            .uri("/tracking/vista")
            .to_http_request();
        let body = web::Json(cuerpo(
            "tok".to_string(),
            1,
            None,
            None,
            "ip-x",
        ));
        let r503 = registrar_vista(state.clone(), req_http, body).await;
        assert_eq!(
            r503.status(),
            actix_web::http::StatusCode::SERVICE_UNAVAILABLE
        );
    }

    #[tokio::test]
    async fn consolidar_desde_log_3x2_idempotente() {
        // Punto 4: 3 eventos counted de 2 identidades → vistas=3, únicos=2;
        // recalcular dos veces da lo mismo. Solo ventana de 13 meses.
        let pg = req_env_integracion("VISTAS_TEST_PG_URL");
        let Some(pg_url) = pg else {
            return;
        };
        let pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(2)
            .connect(&pg_url)
            .await
            .unwrap();
        let tag = uuid::Uuid::new_v4().to_string();
        let (uid, pid) = sembrar(&pool, &tag).await;
        let hoy = "2026-10-04";
        for (anon, user) in [
            (Some(format!("a-cons-{tag}")), None),
            (Some(format!("a-cons-{tag}")), None),
            (None, Some(uid)),
        ] {
            sqlx::query(
                "INSERT INTO vistas_log (fecha_local, propiedad_id, user_id, anon_id, ip_hash, server_elapsed_ms, result, reason) VALUES ($1::date, $2, $3, $4, 'h', 5000, 'counted', 'counted')",
            )
            .bind(hoy)
            .bind(pid)
            .bind(user)
            .bind(anon)
            .execute(&pool)
            .await
            .unwrap();
        }
        // Fila vieja fuera de retención: no debe generar resumen.
        sqlx::query(
            "INSERT INTO vistas_log (fecha_local, propiedad_id, ip_hash, server_elapsed_ms, result, reason) VALUES ('2020-01-01', $1, 'h', 5000, 'counted', 'counted')",
        )
        .bind(pid)
        .execute(&pool)
        .await
        .unwrap();
        // Recálculo MANUAL (punto 2): corrige cualquier fecha; idempotente.
        consolidar_completo(&pool).await.unwrap();
        consolidar_completo(&pool).await.unwrap();
        let (v, u): (i32, i32) = sqlx::query_as(
            "SELECT vistas, visitantes_unicos FROM vistas_resumen_diario WHERE propiedad_id = $1 AND fecha_local = $2::date",
        )
        .bind(pid)
        .bind(hoy)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!((v, u), (3, 2));
        let vieja: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM vistas_resumen_diario WHERE propiedad_id = $1 AND fecha_local = '2020-01-01'",
        )
        .bind(pid)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(vieja, 0);
    }

    #[tokio::test]
    async fn job_solo_toca_hoy_y_ayer() {
        // Punto 2: el job (hoy/ayer Bogotá) no modifica fechas anteriores,
        // aunque tengan filas counted nuevas.
        let pg = req_env_integracion("VISTAS_TEST_PG_URL");
        let Some(pg_url) = pg else {
            return;
        };
        let pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(2)
            .connect(&pg_url)
            .await
            .unwrap();
        let tag = uuid::Uuid::new_v4().to_string();
        let (_uid, pid) = sembrar(&pool, &tag).await;
        // Fecha antigua dentro de retención pero anterior a ayer.
        sqlx::query(
            "INSERT INTO vistas_log (fecha_local, propiedad_id, ip_hash, server_elapsed_ms, result, reason) VALUES (CURRENT_DATE - 5, $1, 'h', 5000, 'counted', 'counted')",
        )
        .bind(pid)
        .execute(&pool)
        .await
        .unwrap();
        consolidar_resumen(&pool).await.unwrap();
        let n: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM vistas_resumen_diario WHERE propiedad_id = $1 AND fecha_local = CURRENT_DATE - 5",
        )
        .bind(pid)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(n, 0, "el job no toca fechas anteriores a ayer");
        // El recálculo manual sí la corrige.
        consolidar_completo(&pool).await.unwrap();
        let n2: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM vistas_resumen_diario WHERE propiedad_id = $1 AND fecha_local = CURRENT_DATE - 5",
        )
        .bind(pid)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(n2, 1);
    }

    #[tokio::test]
    async fn retencion_borra_viejo_conserva_reciente() {
        // Paso8 6f (DESACTIVADO por defecto en prod): borra en lotes filas con
        // received_at anterior a 13 meses; conserva recientes y agregados.
        let pg = req_env_integracion("VISTAS_TEST_PG_URL");
        let Some(pg_url) = pg else {
            return;
        };
        let pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(2)
            .connect(&pg_url)
            .await
            .unwrap();
        let tag = uuid::Uuid::new_v4().to_string();
        let (_uid, pid) = sembrar(&pool, &tag).await;
        sqlx::query(
            "INSERT INTO vistas_log (received_at, fecha_local, propiedad_id, ip_hash, server_elapsed_ms, result, reason) VALUES (NOW() - INTERVAL '14 months', CURRENT_DATE - 400, $1, 'h', 5000, 'counted', 'counted')",
        )
        .bind(pid)
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO vistas_log (fecha_local, propiedad_id, ip_hash, server_elapsed_ms, result, reason) VALUES (CURRENT_DATE, $1, 'h', 5000, 'counted', 'counted')",
        )
        .bind(pid)
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO vistas_rate_limit_agregado (ip_hash, ventana_minuto, conteo, updated_at) VALUES ('h', NOW(), 7, NOW())",
        )
        .execute(&pool)
        .await
        .unwrap();
        let borradas = retencion_vistas_log(&pool).await.unwrap();
        assert_eq!(borradas, 1, "solo la fila de 14 meses");
        let recientes: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM vistas_log WHERE propiedad_id = $1",
        )
        .bind(pid)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(recientes, 1);
        let agg: i64 = sqlx::query_scalar("SELECT SUM(conteo) FROM vistas_rate_limit_agregado")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert!(agg >= 7, "agregados intactos");
    }
}
