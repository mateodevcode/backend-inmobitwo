use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct MediaResponse {
    pub success: bool,
    pub message: String,
    pub data: Option<serde_json::Value>,
}
