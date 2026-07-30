use actix_web::{web, HttpRequest, HttpResponse, Responder};
use actix_web_actors::ws;
use redis::AsyncCommands;
use uuid::Uuid;

use crate::state::AppState;
use crate::websocket::WebSocketSession;

pub async fn health_check() -> impl Responder {
    HttpResponse::Ok().json(serde_json::json!({ "status": "ok", "service": "rust-websocket" }))
}

pub async fn ws_handler(
    req: HttpRequest,
    stream: web::Payload,
    _state: web::Data<AppState>,
) -> impl Responder {
    let session_id = Uuid::new_v4();
    let room = req
        .match_info()
        .get("room")
        .unwrap_or("general")
        .to_string();

    let session = WebSocketSession {
        id: session_id,
        room,
    };

    ws::start(session, &req, stream)
}

pub async fn broadcast_message(
    state: web::Data<AppState>,
    body: web::Json<serde_json::Value>,
) -> impl Responder {
    let room = body
        .get("room")
        .and_then(|r| r.as_str())
        .unwrap_or("general");
    let message = body
        .get("message")
        .and_then(|m| m.as_str())
        .unwrap_or("");

    let _ = state
        .redis
        .clone()
        .publish::<_, _, ()>(format!("ws:room:{}", room), message)
        .await;

    HttpResponse::Ok().json(serde_json::json!({ "success": true, "message": "Mensaje enviado" }))
}
