use sqlx::PgPool;
use redis::aio::Connection;
use dashmap::DashMap;
use std::sync::Arc;

pub struct AppState {
    pub db: PgPool,
    pub redis: Connection,
    pub rooms: Arc<DashMap<String, Vec<uuid::Uuid>>>,
}
