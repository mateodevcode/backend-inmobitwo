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

pub async fn upload_imagen(
    state: web::Data<AppState>,
    mut payload: Multipart,
) -> impl Responder {
    let mut urls = Vec::new();

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

        match image_processor::process_image(&buffer).await {
            Ok(versions) => {
                let timestamp = chrono::Utc::now().timestamp();
                let base_key = format!("propiedades/imagenes/{}", timestamp);

                let original_url = s3_client::upload_to_s3(
                    &state.s3_client,
                    &versions.original,
                    &format!("{}_original.webp", base_key),
                    "image/webp",
                    &state.bucket,
                )
                .await;
                let large_url = s3_client::upload_to_s3(
                    &state.s3_client,
                    &versions.large,
                    &format!("{}_large.webp", base_key),
                    "image/webp",
                    &state.bucket,
                )
                .await;
                let medium_url = s3_client::upload_to_s3(
                    &state.s3_client,
                    &versions.medium,
                    &format!("{}_medium.webp", base_key),
                    "image/webp",
                    &state.bucket,
                )
                .await;
                let small_url = s3_client::upload_to_s3(
                    &state.s3_client,
                    &versions.small,
                    &format!("{}_small.webp", base_key),
                    "image/webp",
                    &state.bucket,
                )
                .await;
                let thumbnail_url = s3_client::upload_to_s3(
                    &state.s3_client,
                    &versions.thumbnail,
                    &format!("{}_thumbnail.webp", base_key),
                    "image/webp",
                    &state.bucket,
                )
                .await;

                urls.push(serde_json::json!({
                    "original": original_url,
                    "large": large_url,
                    "medium": medium_url,
                    "small": small_url,
                    "thumbnail": thumbnail_url
                }));
            }
            Err(e) => {
                return HttpResponse::InternalServerError().json(
                    serde_json::json!({ "success": false, "error": format!("Error procesando imagen: {}", e) }),
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

            let master_url = s3_client::upload_file_to_s3(
                &state.s3_client,
                &versions.hls_master,
                &format!("{}/master.m3u8", base_key),
                "application/vnd.apple.mpegurl",
                &state.bucket,
            )
            .await;
            let thumbnail_url = s3_client::upload_file_to_s3(
                &state.s3_client,
                &versions.thumbnail,
                &format!("{}/thumbnail.jpg", base_key),
                "image/jpeg",
                &state.bucket,
            )
            .await;

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
