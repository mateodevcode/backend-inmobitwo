use actix::prelude::*;
use actix_web_actors::ws;
use futures::StreamExt;
use uuid::Uuid;

pub struct WebSocketSession {
    pub id: Uuid,
    pub room: String,
    pub redis_client: redis::Client,
}

pub struct BroadcastMessage(pub String);

impl actix::Message for BroadcastMessage {
    type Result = ();
}

impl Actor for WebSocketSession {
    type Context = ws::WebsocketContext<Self>;

    fn started(&mut self, ctx: &mut Self::Context) {
        tracing::info!("WebSocket client {} connected to room {}", self.id, self.room);

        let room = self.room.clone();
        let addr = ctx.address();
        let redis_client = self.redis_client.clone();

        actix::spawn(async move {
            let channel = format!("ws:room:{}", room);

            let mut pubsub = match redis_client.get_async_pubsub().await {
                Ok(p) => p,
                Err(e) => {
                    tracing::error!("Error creando conexion pubsub de Redis: {}", e);
                    return;
                }
            };

            if let Err(e) = pubsub.subscribe(&channel).await {
                tracing::error!("Error suscribiendo al canal {}: {}", channel, e);
                return;
            }

            let mut stream = pubsub.on_message();
            while let Some(msg) = stream.next().await {
                let payload: String = match msg.get_payload() {
                    Ok(p) => p,
                    Err(_) => continue,
                };

                if addr.try_send(BroadcastMessage(payload)).is_err() {
                    break;
                }
            }
        });

        ctx.text(
            serde_json::json!({
                "type": "connected",
                "session_id": self.id.to_string(),
                "room": self.room
            })
            .to_string(),
        );
    }

    fn stopped(&mut self, _: &mut Self::Context) {
        tracing::info!("WebSocket client {} disconnected", self.id);
    }
}

impl Handler<BroadcastMessage> for WebSocketSession {
    type Result = ();

    fn handle(&mut self, msg: BroadcastMessage, ctx: &mut Self::Context) {
        ctx.text(msg.0);
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
