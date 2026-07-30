use sqlx::PgPool;
use redis::aio::MultiplexedConnection;
use dashmap::DashMap;
use std::sync::Arc;

pub struct AppState {
    pub db: PgPool,
    pub redis: MultiplexedConnection,
    pub scoring_cache: Arc<DashMap<String, i32>>,
}
