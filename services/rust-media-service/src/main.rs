use actix_web::{web, App, HttpServer, middleware};
use actix_cors::Cors;

mod handlers;
mod image_processor;
mod models;
mod s3_client;
mod state;
mod video_processor;

use state::AppState;

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    tracing_subscriber::fmt::init();
    dotenvy::dotenv().ok();

    let state = web::Data::new(AppState::new().await);

    tracing::info!("Rust Media Service iniciando en puerto 3003");

    HttpServer::new(move || {
        let cors = Cors::default()
            .allow_any_origin()
            .allow_any_method()
            .allow_any_header()
            .max_age(3600);

        App::new()
            .wrap(cors)
            .wrap(middleware::Logger::default())
            .app_data(state.clone())
            .app_data(web::PayloadConfig::new(100 * 1024 * 1024))
            .route("/media/upload/imagen", web::post().to(handlers::upload_imagen))
            .route("/media/upload/video", web::post().to(handlers::upload_video))
            .route("/media/upload/3d", web::post().to(handlers::upload_modelo_3d))
            .route("/health", web::get().to(handlers::health_check))
    })
    .bind("0.0.0.0:3003")?
    .run()
    .await
}
