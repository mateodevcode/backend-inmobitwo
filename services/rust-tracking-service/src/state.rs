use sqlx::PgPool;
use redis::aio::Connection;
use dashmap::DashMap;
use std::sync::Arc;

pub struct AppState {
    pub db: PgPool,
    pub redis: Connection,
    pub scoring_cache: Arc<DashMap<String, i32>>,
}
