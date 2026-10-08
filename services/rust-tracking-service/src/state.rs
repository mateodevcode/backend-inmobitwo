use sqlx::PgPool;
use redis::aio::MultiplexedConnection;
use dashmap::DashMap;
use std::sync::Arc;

pub struct AppState {
    pub db: PgPool,
    pub redis: MultiplexedConnection,
    pub scoring_cache: Arc<DashMap<String, i32>>,
    /// Dependencias del algoritmo de vista de detalle (Fase 5). `None` solo
    /// en contextos que no sirven `/tracking/vista`.
    pub vista_deps: Option<crate::vista_api::VistaDeps>,
}
