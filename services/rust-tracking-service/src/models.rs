use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize)]
pub struct SesionTracking {
    pub session_id: Uuid,
    pub usuario_id: Option<i32>,
    pub ip_address: Option<String>,
    pub user_agent: Option<String>,
    pub consentimiento_dado: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct EventoTracking {
    pub sesion_id: Uuid,
    pub propiedad_id: i32,
    pub tipo_evento: String,
    pub metadata: Option<serde_json::Value>,
}
