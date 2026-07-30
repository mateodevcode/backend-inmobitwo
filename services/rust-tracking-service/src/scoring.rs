pub const PESOS_EVENTOS: &[(&str, i32)] = &[
    ("view", 1),
    ("click", 2),
    ("favorite", 3),
    ("share", 4),
    ("contact", 5),
    ("long_view", 3),
    ("scroll_depth", 1),
];

pub const UMBRAL_LEAD: i32 = 10;
pub const MAX_TIEMPO_PAGINA: i32 = 8;

pub fn calcular_peso_evento(tipo_evento: &str, metadata: &Option<serde_json::Value>) -> i32 {
    let peso_base = PESOS_EVENTOS
        .iter()
        .find(|(t, _)| *t == tipo_evento)
        .map(|(_, p)| *p)
        .unwrap_or(0);

    if tipo_evento == "scroll_depth" {
        if let Some(meta) = metadata {
            if let Some(depth) = meta.get("scroll_percentage").and_then(|v| v.as_i64()) {
                return (depth as i32 / 25).min(MAX_TIEMPO_PAGINA);
            }
        }
    }

    if tipo_evento == "long_view" {
        if let Some(meta) = metadata {
            if let Some(seconds) = meta.get("duration_seconds").and_then(|v| v.as_i64()) {
                return ((seconds / 10) as i32).min(MAX_TIEMPO_PAGINA);
            }
        }
    }

    peso_base
}
