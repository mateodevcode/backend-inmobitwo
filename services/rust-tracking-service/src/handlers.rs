use actix_web::{web, HttpResponse, Responder};
use redis::AsyncCommands;
use uuid::Uuid;

use crate::models::*;
use crate::scoring;
use crate::state::AppState;

pub async fn health_check() -> impl Responder {
    HttpResponse::Ok().json(serde_json::json!({ "status": "ok", "service": "rust-tracking" }))
}

pub async fn registrar_sesion(
    state: web::Data<AppState>,
    sesion: web::Json<SesionTracking>,
) -> impl Responder {
    let session_id = Uuid::new_v4();

    let result = sqlx::query(
        r#"
        INSERT INTO sesiones_tracking (session_id, usuario_id, ip_address, user_agent, consentimiento_dado)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id
        "#
    )
    .bind(session_id)
    .bind(sesion.usuario_id)
    .bind(&sesion.ip_address)
    .bind(&sesion.user_agent)
    .bind(sesion.consentimiento_dado)
    .fetch_one(&state.db)
    .await;

    match result {
        Ok(_) => HttpResponse::Ok().json(serde_json::json!({
            "success": true,
            "message": "Sesion registrada",
            "data": { "session_id": session_id }
        })),
        Err(e) => {
            tracing::error!("Error registrando sesion: {}", e);
            HttpResponse::InternalServerError().json(serde_json::json!({
                "success": false,
                "error": "Error al registrar sesion"
            }))
        }
    }
}

pub async fn registrar_evento(
    state: web::Data<AppState>,
    evento: web::Json<EventoTracking>,
) -> impl Responder {
    let result = sqlx::query(
        r#"
        INSERT INTO eventos_tracking (sesion_id, propiedad_id, tipo_evento, metadata)
        VALUES ($1, $2, $3, $4)
        RETURNING id
        "#
    )
    .bind(evento.sesion_id)
    .bind(evento.propiedad_id)
    .bind(&evento.tipo_evento)
    .bind(&evento.metadata)
    .fetch_one(&state.db)
    .await;

    if let Err(e) = result {
        tracing::error!("Error insertando evento: {}", e);
        return HttpResponse::InternalServerError().json(serde_json::json!({
            "success": false,
            "error": "Error al registrar evento"
        }));
    }

    let cache_key = format!("{}:{}", evento.sesion_id, evento.propiedad_id);
    let peso = scoring::calcular_peso_evento(&evento.tipo_evento, &evento.metadata);

    let nuevo_score = {
        let mut cache = state.scoring_cache.entry(cache_key.clone()).or_insert(0);
        *cache += peso;
        *cache
    };

    let redis_key = format!("score:{}:{}", evento.sesion_id, evento.propiedad_id);
    let _: Result<(), redis::RedisError> = state.redis.clone().set_ex(&redis_key, nuevo_score, 3600).await;

    if nuevo_score >= scoring::UMBRAL_LEAD {
        let lead_exists = sqlx::query_scalar::<_, i32>(
            "SELECT COUNT(*) FROM leads WHERE sesion_id = $1 AND propiedad_id = $2"
        )
        .bind(evento.sesion_id)
        .bind(evento.propiedad_id)
        .fetch_one(&state.db)
        .await
        .unwrap_or(0);

        if lead_exists == 0 {
            let _ = sqlx::query(
                r#"
                INSERT INTO leads (propiedad_id, sesion_id, score, origen, estado, notificado)
                VALUES ($1, $2, $3, 'automatico', 'nuevo', false)
                "#
            )
            .bind(evento.propiedad_id)
            .bind(evento.sesion_id)
            .bind(nuevo_score)
            .execute(&state.db)
            .await;

            tracing::info!("Lead automatico creado para sesion {} en propiedad {}", evento.sesion_id, evento.propiedad_id);
        }
    }

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "message": "Evento registrado",
        "data": { "score": nuevo_score, "umbral_lead": scoring::UMBRAL_LEAD }
    }))
}

pub async fn obtener_score(
    state: web::Data<AppState>,
    path: web::Path<(String, i32)>,
) -> impl Responder {
    let (sesion_id_str, propiedad_id) = path.into_inner();
    let sesion_id = match Uuid::parse_str(&sesion_id_str) {
        Ok(id) => id,
        Err(_) => {
            return HttpResponse::BadRequest().json(serde_json::json!({
                "success": false,
                "error": "ID de sesion invalido"
            }));
        }
    };

    let cache_key = format!("{}:{}", sesion_id, propiedad_id);
    let score = state.scoring_cache.get(&cache_key).map(|s| *s).unwrap_or(0);

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "data": {
            "sesion_id": sesion_id,
            "propiedad_id": propiedad_id,
            "score": score,
            "umbral_lead": scoring::UMBRAL_LEAD
        }
    }))
}
