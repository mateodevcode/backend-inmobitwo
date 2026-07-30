use actix::prelude::*;
use actix_web_actors::ws;
use redis::AsyncCommands;
use uuid::Uuid;

pub struct WebSocketSession {
    pub id: Uuid,
    pub room: String,
}

impl Actor for WebSocketSession {
    type Context = ws::WebsocketContext<Self>;

    fn started(&mut self, ctx: &mut Self::Context) {
        tracing::info!(
            "WebSocket client {} connected to room {}",
            self.id,
            self.room
        );

        let room = self.room.clone();
        let id = self.id;

        ctx.add_stream(async_stream::stream! {
            tracing::info!("Suscripcion a Redis para room {}", room);
        });

        ctx.text(
            serde_json::json!({
                "type": "connected",
                "session_id": id.to_string(),
                "room": room
            })
            .to_string(),
        );
    }

    fn stopped(&mut self, _: &mut Self::Context) {
        tracing::info!("WebSocket client {} disconnected", self.id);
    }
}

impl StreamHandler<Result<ws::Message, ws::ProtocolError>> for WebSocketSession {
    fn handle(&mut self, msg: Result<ws::Message, ws::ProtocolError>, ctx: &mut Self::Context) {
        match msg {
            Ok(ws::Message::Ping(msg)) => ctx.pong(&msg),
            Ok(ws::Message::Text(text)) => {
                ctx.text(text);
            }
            Ok(ws::Message::Close(_)) => {
                ctx.stop();
            }
            _ => {}
        }
    }
}
