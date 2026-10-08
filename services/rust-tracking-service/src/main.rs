use actix_web::{web, App, HttpServer, middleware};
use actix_cors::Cors;
use sqlx::postgres::PgPoolOptions;
use std::sync::Arc;
use dashmap::DashMap;

mod handlers;
mod models;
mod scoring;
mod state;
mod vista_decision;
mod vista_token;
mod vista_estado;
mod vista_api;

use state::AppState;

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    tracing_subscriber::fmt::init();
    dotenvy::dotenv().ok();

    let database_url = std::env::var("DATABASE_URL").unwrap_or_default();
    let redis_url = std::env::var("REDIS_URL").expect("REDIS_URL must be set");

    // Vista de detalle: la conexión a Postgres se arma por PARTES (host,
    // puerto, usuario, password, base), igual que el backend Node. Armarla
    // como string URL se rompe si el password trae @ # / ? : sin codificar
    // (sqlx informa EmptyHost aunque las credenciales sean correctas).
    // Se mantiene DATABASE_URL como respaldo por compatibilidad.
    let pool = match (
        std::env::var("DB_HOST"),
        std::env::var("DB_PORT"),
        std::env::var("DB_USER"),
        std::env::var("DB_PASSWORD"),
        std::env::var("DB_NAME"),
    ) {
        (Ok(host), Ok(port), Ok(user), Ok(password), Ok(db))
            if !host.is_empty() && !user.is_empty() && !db.is_empty() =>
        {
            let port: u16 = port.parse().unwrap_or(5432);
            tracing::info!("vistas: Postgres por partes ({host}:{port}/{db})");
            PgPoolOptions::new()
                .max_connections(50)
                .connect_with(
                    sqlx::postgres::PgConnectOptions::new()
                        .host(&host)
                        .port(port)
                        .username(&user)
                        .password(&password)
                        .database(&db),
                )
                .await
                .expect("Error connecting to database")
        }
        _ => {
            if database_url.is_empty() {
                panic!("Faltan DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME y tampoco hay DATABASE_URL");
            }
            tracing::info!("vistas: Postgres por DATABASE_URL");
            PgPoolOptions::new()
                .max_connections(50)
                .connect(&database_url)
                .await
                .expect("Error connecting to database")
        }
    };

    let redis_client = redis::Client::open(redis_url).expect("Error creating Redis client");
    let redis_conn = redis_client.get_multiplexed_async_connection().await.expect("Error connecting to Redis");

    let scoring_cache = Arc::new(DashMap::new());

    // Vista de detalle: arranque TOLERANTE (punto 1). Un secreto faltante o
    // corto NO tumba el servicio: error muy visible + rutas de vistas
    // deshabilitadas (503); el resto (sesion/evento/score) sigue funcionando.
    let vista_config = vista_decision::VistaConfig::from_env();
    // El handle del escritor solo existe si las vistas están habilitadas.
    let mut log_handle_opt: Option<tokio::task::JoinHandle<()>> = None;
    let vista_deps = match (
        std::env::var("VIEW_TOKEN_SECRET").unwrap_or_default(),
        std::env::var("VIEW_IP_SALT").unwrap_or_default(),
        std::env::var("VIEW_INTERNAL_SECRET").unwrap_or_default(),
    ) {
        (a, b, c)
            if vista_api::validar_secreto("VIEW_TOKEN_SECRET", &a).is_ok()
                && vista_api::validar_secreto("VIEW_IP_SALT", &b).is_ok()
                && vista_api::validar_secreto("VIEW_INTERNAL_SECRET", &c).is_ok() =>
        {
            let (log_emisor, log_handle_tmp) = vista_api::iniciar_escritor_log(
                pool.clone(),
                vista_config.log_channel_capacity,
            );
            log_handle_opt = Some(log_handle_tmp);
            let bot_path = std::env::var("BOT_UA_FILE")
                .unwrap_or_else(|_| "bot_listas/ua.txt".to_string());
            let bot_listas = std::sync::Arc::new(std::sync::RwLock::new(
                vista_api::cargar_listas_bots(&bot_path, &pool).await,
            ));
            let deps = vista_api::VistaDeps {
                config: vista_config,
                view_token_secret: a,
                ip_salt: b,
                internal_secret: c,
                log_emisor,
                bot_listas: bot_listas.clone(),
            };
            // Recarga de listas de bots cada 10 min (punto 5) y consolidación
            // del resumen cada 5 min (punto 4). Fallos = warn, se conserva lo previo.
            let pool_bot = pool.clone();
            let listas_recarga = deps.bot_listas.clone();
            tokio::spawn(async move {
                let mut cada_10m =
                    tokio::time::interval(std::time::Duration::from_secs(600));
                loop {
                    cada_10m.tick().await;
                    let nuevas =
                        vista_api::cargar_listas_bots(&bot_path, &pool_bot).await;
                    match listas_recarga.write() {
                        Ok(mut g) => *g = nuevas,
                        Err(e) => tracing::error!("vistas: lock de bots envenenado: {e}"),
                    }
                }
            });
            let pool_cons = pool.clone();
            tokio::spawn(async move {
                let mut cada_5m =
                    tokio::time::interval(std::time::Duration::from_secs(300));
                loop {
                    cada_5m.tick().await;
                    if let Err(e) = vista_api::consolidar_resumen(&pool_cons).await {
                        tracing::error!("vistas: consolidación del resumen falló: {e}");
                    }
                }
            });
            // Retención 13 meses (paso8 6f): solo si VISTA_RETENCION_ACTIVA=1.
            if std::env::var("VISTA_RETENCION_ACTIVA").ok().as_deref() == Some("1") {
                let pool_ret = pool.clone();
                tokio::spawn(async move {
                    let mut cada_dia =
                        tokio::time::interval(std::time::Duration::from_secs(86_400));
                    loop {
                        cada_dia.tick().await;
                        match vista_api::retencion_vistas_log(&pool_ret).await {
                            Ok(n) => tracing::info!("vistas: retención borró {n} filas antiguas"),
                            Err(e) => tracing::error!("vistas: retención falló: {e}"),
                        }
                    }
                });
            } else {
                tracing::info!("vistas: retención DESACTIVADA (VISTA_RETENCION_ACTIVA!=1)");
            }
            Some(deps)
        }
        _ => {
            tracing::error!(
                "VISTAS DESHABILITADAS: VIEW_TOKEN_SECRET, VIEW_IP_SALT o VIEW_INTERNAL_SECRET falta o tiene <32 caracteres. /tracking/vista responde 503."
            );
            None
        }
    };

    let state = web::Data::new(AppState {
        db: pool,
        redis: redis_conn,
        scoring_cache,
        vista_deps,
    });
    // El closure del servidor se queda con un clon; el original se suelta
    // tras la parada para cerrar el canal del escritor (P2.6).
    let state_srv = state.clone();

    tracing::info!("Rust Tracking Service iniciando en puerto 3002 (prueba deploy automatico)");

    let server = HttpServer::new(move || {
        let cors = Cors::default().allow_any_origin().allow_any_method().allow_any_header().max_age(3600);

        App::new()
            .wrap(cors)
            .wrap(middleware::Logger::default())
            .app_data(state_srv.clone())
            .route("/tracking/sesion", web::post().to(handlers::registrar_sesion))
            .route("/tracking/evento", web::post().to(handlers::registrar_evento))
            .route("/tracking/vista", web::post().to(vista_api::registrar_vista))
            .route("/tracking/score/{sesion_id}/{propiedad_id}", web::get().to(handlers::obtener_score))
            .route("/health", web::get().to(handlers::health_check))
    })
    .bind("0.0.0.0:3002")?
    .run();

    // Cierre ordenado (P2.6): SIGTERM (unix) o Ctrl-C → parada elegante del
    // servidor y luego drenaje del lote pendiente de vistas_log.
    let srv_handle = server.handle();
    tokio::spawn(async move {
        #[cfg(unix)]
        {
            let mut term = tokio::signal::unix::signal(
                tokio::signal::unix::SignalKind::terminate(),
            )
            .expect("SIGTERM handler");
            tokio::select! {
                _ = tokio::signal::ctrl_c() => {},
                _ = term.recv() => {},
            }
        }
        #[cfg(not(unix))]
        {
            let _ = tokio::signal::ctrl_c().await;
        }
        tracing::info!("vistas: señal de apagado, deteniendo servidor...");
        srv_handle.stop(true).await;
    });
    server.await?;
    // Los workers ya soltaron sus clones de AppData; al soltar el último
    // emisor el escritor vacía lo encolado y termina (solo si hubo escritor).
    drop(state);
    if let Some(handle) = log_handle_opt {
        match tokio::time::timeout(std::time::Duration::from_secs(30), handle).await {
            Ok(Ok(())) => tracing::info!("vistas: lote de log vaciado antes de salir"),
            Ok(Err(e)) => tracing::error!("vistas: escritor terminó con error: {e}"),
            Err(_) => tracing::error!("vistas: timeout esperando el drenaje del log"),
        }
    }
    Ok(())
}
