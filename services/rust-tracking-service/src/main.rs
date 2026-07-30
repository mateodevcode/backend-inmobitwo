use actix_web::{web, App, HttpServer, middleware};
use actix_cors::Cors;
use sqlx::postgres::PgPoolOptions;
use std::sync::Arc;
use dashmap::DashMap;

mod handlers;
mod models;
mod scoring;
mod state;

use state::AppState;

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    tracing_subscriber::fmt::init();
    dotenvy::dotenv().ok();

    let database_url = std::env::var("DATABASE_URL").expect("DATABASE_URL must be set");
    let redis_url = std::env::var("REDIS_URL").expect("REDIS_URL must be set");

    let pool = PgPoolOptions::new()
        .max_connections(50)
        .connect(&database_url)
        .await
        .expect("Error connecting to database");

    let redis_client = redis::Client::open(redis_url).expect("Error creating Redis client");
    let redis_conn = redis_client.get_multiplexed_async_connection().await.expect("Error connecting to Redis");

    let scoring_cache = Arc::new(DashMap::new());

    let state = web::Data::new(AppState {
        db: pool,
        redis: redis_conn,
        scoring_cache,
    });

    tracing::info!("Rust Tracking Service iniciando en puerto 3002 (prueba deploy automatico)");

    HttpServer::new(move || {
        let cors = Cors::default().allow_any_origin().allow_any_method().allow_any_header().max_age(3600);

        App::new()
            .wrap(cors)
            .wrap(middleware::Logger::default())
            .app_data(state.clone())
            .route("/tracking/sesion", web::post().to(handlers::registrar_sesion))
            .route("/tracking/evento", web::post().to(handlers::registrar_evento))
            .route("/tracking/score/{sesion_id}/{propiedad_id}", web::get().to(handlers::obtener_score))
            .route("/health", web::get().to(handlers::health_check))
    })
    .bind("0.0.0.0:3002")?
    .run()
    .await
}
