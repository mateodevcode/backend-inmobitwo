use sqlx::PgPool;
use redis::aio::MultiplexedConnection;
use dashmap::DashMap;
use std::sync::Arc;

pub struct AppState {
    pub db: PgPool,
    pub redis: MultiplexedConnection,
    pub redis_client: redis::Client,
    pub rooms: Arc<DashMap<String, Vec<uuid::Uuid>>>,
}
