use actix_web::{web, HttpResponse, Responder};
use actix_multipart::Multipart;
use futures::StreamExt;
use std::io::Write;

use crate::image_processor;
use crate::s3_client;
use crate::state::AppState;
use crate::video_processor;

pub async fn health_check() -> impl Responder {
    HttpResponse::Ok().json(serde_json::json!({ "status": "ok", "service": "rust-media" }))
}

async fn procesar_una_imagen(
    state: web::Data<AppState>,
    buffer: Vec<u8>,
    timestamp: i64,
    idx: usize,
) -> Result<serde_json::Value, String> {
    // El decode + resize + encode es puro trabajo de CPU (bloqueante, sin
    // ningún .await interno). Correrlo con spawn_blocking lo manda al pool
    // de hilos "blocking" de Tokio, que sí da paralelismo real entre
    // imágenes (varios hilos de sistema operativo a la vez) — a diferencia
    // de tokio::spawn a secas, que en un runtime de un solo hilo por worker
    // de Actix termina ejecutando las tareas una tras otra si nunca ceden
    // el paso con un .await.
    let versions = tokio::task::spawn_blocking(move || image_processor::process_image(&buffer))
        .await
        .map_err(|e| format!("Tarea de procesamiento (blocking) falló: {}", e))?
        .map_err(|e| format!("Error procesando imagen: {}", e))?;

    let base_key = format!("propiedades/imagenes/{}_{}", timestamp, idx);

    let key_thumbnail = format!("{}_thumbnail.webp", base_key);
    let key_small = format!("{}_small.webp", base_key);
    let key_medium = format!("{}_medium.webp", base_key);
    let key_large = format!("{}_large.webp", base_key);
    let key_xlarge = format!("{}_xlarge.webp", base_key);

    let (thumbnail_url, small_url, medium_url, large_url, xlarge_url) = tokio::join!(
        s3_client::upload_to_s3(&state.s3_client, &versions.thumbnail, &key_thumbnail, "image/webp", &state.bucket),
        s3_client::upload_to_s3(&state.s3_client, &versions.small, &key_small, "image/webp", &state.bucket),
        s3_client::upload_to_s3(&state.s3_client, &versions.medium, &key_medium, "image/webp", &state.bucket),
        s3_client::upload_to_s3(&state.s3_client, &versions.large, &key_large, "image/webp", &state.bucket),
        s3_client::upload_to_s3(&state.s3_client, &versions.xlarge, &key_xlarge, "image/webp", &state.bucket),
    );

    Ok(serde_json::json!({
        "thumbnail": thumbnail_url,
        "small": small_url,
        "medium": medium_url,
        "large": large_url,
        "xlarge": xlarge_url
    }))
}

pub async fn upload_imagen(
    state: web::Data<AppState>,
    mut payload: Multipart,
) -> impl Responder {
    let mut buffers: Vec<Vec<u8>> = Vec::new();

    // Leer el multipart es inherentemente secuencial (es un solo stream HTTP),
    // pero esto es rápido: solo copia bytes, no procesa ni sube nada todavía.
    while let Some(item) = payload.next().await {
        let mut field = match item {
            Ok(f) => f,
            Err(e) => {
                return HttpResponse::BadRequest().json(serde_json::json!({ "success": false, "error": format!("Error leyendo campo: {}", e) }))
            }
        };

        let mut buffer = Vec::new();
        while let Some(chunk) = field.next().await {
            match chunk {
                Ok(data) => buffer.extend_from_slice(&data),
                Err(e) => {
                    return HttpResponse::BadRequest().json(serde_json::json!({ "success": false, "error": format!("Error leyendo datos: {}", e) }))
                }
            }
        }
        buffers.push(buffer);
    }

    let timestamp = chrono::Utc::now().timestamp_millis();

    // Cada imagen se procesa en su propia tarea (tokio::spawn) y, dentro de
    // ella, el trabajo de CPU va a spawn_blocking — así sí se reparten entre
    // los núcleos disponibles de verdad, en vez de solo en apariencia.
    let handles: Vec<_> = buffers
        .into_iter()
        .enumerate()
        .map(|(idx, buffer)| {
            let state = state.clone();
            tokio::spawn(procesar_una_imagen(state, buffer, timestamp, idx))
        })
        .collect();

    let resultados = futures::future::join_all(handles).await;

    let mut urls = Vec::new();
    for resultado in resultados {
        match resultado {
            Ok(Ok(json)) => urls.push(json),
            Ok(Err(e)) => {
                return HttpResponse::InternalServerError().json(
                    serde_json::json!({ "success": false, "error": e }),
                )
            }
            Err(e) => {
                return HttpResponse::InternalServerError().json(
                    serde_json::json!({ "success": false, "error": format!("Tarea de procesamiento falló: {}", e) }),
                )
            }
        }
    }

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "message": "Imagenes procesadas y subidas",
        "data": urls
    }))
}

pub async fn upload_video(
    state: web::Data<AppState>,
    mut payload: Multipart,
) -> impl Responder {
    let mut temp_file = match tempfile::Builder::new().suffix(".mp4").tempfile() {
        Ok(f) => f,
        Err(e) => {
            return HttpResponse::InternalServerError().json(
                serde_json::json!({ "success": false, "error": format!("Error creando archivo temporal: {}", e) }),
            )
        }
    };

    while let Some(item) = payload.next().await {
        let mut field = match item {
            Ok(f) => f,
            Err(e) => {
                return HttpResponse::BadRequest().json(serde_json::json!({ "success": false, "error": format!("Error leyendo campo: {}", e) }))
            }
        };

        while let Some(chunk) = field.next().await {
            match chunk {
                Ok(data) => {
                    if let Err(e) = temp_file.write_all(&data) {
                        return HttpResponse::InternalServerError().json(
                            serde_json::json!({ "success": false, "error": format!("Error escribiendo archivo: {}", e) }),
                        );
                    }
                }
                Err(e) => {
                    return HttpResponse::BadRequest().json(serde_json::json!({ "success": false, "error": format!("Error leyendo datos: {}", e) }))
                }
            }
        }
    }

    let temp_path = temp_file.path();
    match video_processor::process_video(temp_path).await {
        Ok(versions) => {
            let timestamp = chrono::Utc::now().timestamp();
            let base_key = format!("propiedades/videos/{}", timestamp);

            let key_master = format!("{}/master.m3u8", base_key);
            let key_thumbnail_video = format!("{}/thumbnail.jpg", base_key);

            let (master_url, thumbnail_url) = tokio::join!(
                s3_client::upload_file_to_s3(
                    &state.s3_client,
                    &versions.hls_master,
                    &key_master,
                    "application/vnd.apple.mpegurl",
                    &state.bucket,
                ),
                s3_client::upload_file_to_s3(
                    &state.s3_client,
                    &versions.thumbnail,
                    &key_thumbnail_video,
                    "image/jpeg",
                    &state.bucket,
                ),
            );

            HttpResponse::Ok().json(serde_json::json!({
                "success": true,
                "message": "Video procesado y subido",
                "data": { "hls_master": master_url, "thumbnail": thumbnail_url, "format": "hls" }
            }))
        }
        Err(e) => HttpResponse::InternalServerError().json(
            serde_json::json!({ "success": false, "error": format!("Error procesando video: {}", e) }),
        ),
    }
}

pub async fn upload_modelo_3d(
    state: web::Data<AppState>,
    mut payload: Multipart,
) -> impl Responder {
    let mut buffer = Vec::new();

    while let Some(item) = payload.next().await {
        let mut field = match item {
            Ok(f) => f,
            Err(e) => {
                return HttpResponse::BadRequest().json(serde_json::json!({ "success": false, "error": format!("Error leyendo campo: {}", e) }))
            }
        };

        while let Some(chunk) = field.next().await {
            match chunk {
                Ok(data) => buffer.extend_from_slice(&data),
                Err(e) => {
                    return HttpResponse::BadRequest().json(serde_json::json!({ "success": false, "error": format!("Error leyendo datos: {}", e) }))
                }
            }
        }
    }

    let timestamp = chrono::Utc::now().timestamp();
    let key = format!("propiedades/modelos_3d/{}.glb", timestamp);

    let url = s3_client::upload_to_s3(
        &state.s3_client,
        &buffer,
        &key,
        "model/gltf-binary",
        &state.bucket,
    )
    .await;

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "message": "Modelo 3D subido",
        "data": { "url": url }
    }))
}