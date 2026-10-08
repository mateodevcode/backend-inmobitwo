//! Token de ficha (Fase 3).
//!
//! Formato: `v1.<payload_b64url>.<sig_hex`
//! - payload JSON: `{"pid","jti","iat","exp"}` (`iat`/`exp` en ms Unix UTC).
//! - firma: `HMAC-SHA256(VIEW_TOKEN_SECRET, "v1.<payload_b64url>")` en hex.
//!
//! Node emite (`backend-inmobitwo/src/lib/viewToken.js`, `crypto` nativo),
//! Rust SOLO verifica aquí. Función pura: sin I/O, el reloj entra como
//! parámetro (`ahora_ms`). El uso único (jti) vive en Redis (Fase 4);
//! aquí `token_reutilizado` se decide en `decidir_vista` con
//! `estado.token_ya_usado` (ver tests de integración abajo).

use base64::Engine as _;
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;

use crate::vista_decision::VistaConfig;

const PREFIJO: &str = "v1";

/// Datos de un token válido.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DatosViewToken {
    pub propiedad_id: i32,
    pub jti: String,
    pub emitido_en_ms: i64,
    pub expira_en_ms: i64,
}

/// Fallo de verificación, mapeado directo a motivos de `decidir_vista`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorViewToken {
    /// → `token_invalido` (formato, firma, futuro, otro contenido inválido).
    Invalido,
    /// → `token_expirado`.
    Expirado,
}

impl ErrorViewToken {
    pub fn motivo(&self) -> &'static str {
        match self {
            ErrorViewToken::Invalido => "token_invalido",
            ErrorViewToken::Expirado => "token_expirado",
        }
    }
}

#[derive(Debug, Deserialize)]
struct PayloadToken {
    pid: i32,
    jti: String,
    iat: i64,
    exp: i64,
}

/// Verifica firma y vigencia. `secret` = `VIEW_TOKEN_SECRET` (bytes).
/// No consulta Redis/DB ni el reloj del sistema.
pub fn verificar_view_token(
    token: &str,
    secret: &[u8],
    ahora_ms: i64,
    config: &VistaConfig,
) -> Result<DatosViewToken, ErrorViewToken> {
    // 1. Estructura: 3 partes + prefijo de versión.
    let mut partes = token.split('.');
    let (prefijo, b64, sig_hex) = match (partes.next(), partes.next(), partes.next(), partes.next())
    {
        (Some(p), Some(b), Some(s), None) => (p, b, s),
        _ => return Err(ErrorViewToken::Invalido),
    };
    if prefijo != PREFIJO || b64.is_empty() || sig_hex.is_empty() {
        return Err(ErrorViewToken::Invalido);
    }

    // 2. Payload: base64url (sin padding, como `Buffer.toString('base64url')`) + JSON.
    let payload_bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(b64)
        .map_err(|_| ErrorViewToken::Invalido)?;
    let payload: PayloadToken =
        serde_json::from_slice(&payload_bytes).map_err(|_| ErrorViewToken::Invalido)?;
    if payload.pid <= 0 || payload.jti.is_empty() {
        return Err(ErrorViewToken::Invalido);
    }

    // 3. Firma HMAC-SHA256 con comparación en tiempo constante.
    let cuerpo = format!("{PREFIJO}.{b64}");
    let mut mac =
        Hmac::<Sha256>::new_from_slice(secret).map_err(|_| ErrorViewToken::Invalido)?;
    mac.update(cuerpo.as_bytes());
    let sig_esperada = hex::decode(sig_hex).map_err(|_| ErrorViewToken::Invalido)?;
    mac.verify_slice(&sig_esperada)
        .map_err(|_| ErrorViewToken::Invalido)?;

    // 4. Coherencia temporal (hora del servidor, nunca la del cliente).
    if payload.iat > ahora_ms + config.token_clock_tolerance_ms as i64 {
        return Err(ErrorViewToken::Invalido); // emitido en el futuro: fabricado
    }
    if payload.exp < payload.iat {
        return Err(ErrorViewToken::Invalido);
    }
    let max_vida_ms = (config.token_max_age_minutes as i64).saturating_mul(60_000);
    if payload.exp.saturating_sub(payload.iat) > max_vida_ms {
        return Err(ErrorViewToken::Invalido); // emisor violó la vigencia máxima
    }
    if ahora_ms > payload.exp {
        return Err(ErrorViewToken::Expirado);
    }

    Ok(DatosViewToken {
        propiedad_id: payload.pid,
        jti: payload.jti,
        emitido_en_ms: payload.iat,
        expira_en_ms: payload.exp,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vista_decision::{decidir_vista, VistaEstadoConsultado, VistaEvento};

    const SECRETO: &[u8] = b"vector-fijo-de-prueba-123";
    const IAT: i64 = 1_759_560_000_000;
    const AHORA_OK: i64 = IAT + 10_000; // 10 s después: supera min 3 s

    fn cfg() -> VistaConfig {
        VistaConfig::default()
    }

    /// Replica exacta del emisor Node (solo para tests).
    fn firmar(pid: i32, jti: &str, iat: i64, exp: i64, secret: &[u8]) -> String {
        let payload = serde_json::json!({"pid": pid, "jti": jti, "iat": iat, "exp": exp});
        let b64 = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .encode(payload.to_string().as_bytes());
        let cuerpo = format!("v1.{b64}");
        let mut mac = Hmac::<Sha256>::new_from_slice(secret).unwrap();
        mac.update(cuerpo.as_bytes());
        let sig = hex::encode(mac.finalize().into_bytes());
        format!("{cuerpo}.{sig}")
    }

    fn evento_desde_token(d: &DatosViewToken) -> (VistaEvento, VistaEstadoConsultado) {
        (
            VistaEvento {
                estructura_valida: true,
                token_firma_valida: true,
                property_id: d.propiedad_id,
                token_property_id: d.propiedad_id,
                token_emitido_en_ms: d.emitido_en_ms,
                user_id: Some(1),
                anon_id: Some("anon-t".to_string()),
                ip_hash: Some("iph-t".to_string()),
                es_interno: false,
                es_bot: false,
                visible_seconds: None,
            },
            VistaEstadoConsultado {
                token_ya_usado: false,
                inmueble_existe: true,
                inmueble_activo: true,
                ventana_dedupe_ocupada: false,
                conteo_diario: 0,
                eventos_visitante_ultimo_minuto: 0,
                eventos_ip_ultimo_minuto: 0,
                error_infraestructura: false,
            },
        )
    }

    // --- Vector fijo generado con Node (crypto nativo) el 2026-10-04 ---
    // payload: {"pid":7,"jti":"test-jti-001","iat":1759560000000,"exp":1759563600000}
    // secret : 'vector-fijo-de-prueba-123'
    const VECTOR_NODE: &str = "v1.eyJwaWQiOjcsImp0aSI6InRlc3QtanRpLTAwMSIsImlhdCI6MTc1OTU2MDAwMDAwMCwiZXhwIjoxNzU5NTYzNjAwMDAwfQ.bd388f7278f2342eedc003dc30e4dd3a951aafb04a83072b7db8e69462fd19f7";

    #[test]
    fn acepta_vector_generado_por_node() {
        let d = verificar_view_token(VECTOR_NODE, SECRETO, IAT + 10_000, &cfg()).unwrap();
        assert_eq!(d.propiedad_id, 7);
        assert_eq!(d.jti, "test-jti-001");
        assert_eq!(d.emitido_en_ms, 1_759_560_000_000);
        assert_eq!(d.expira_en_ms, 1_759_563_600_000);
    }

    #[test]
    fn roundtrip_firmar_verificar() {
        let t = firmar(7, "jti-abc", IAT, IAT + 3_600_000, SECRETO);
        let d = verificar_view_token(&t, SECRETO, AHORA_OK, &cfg()).unwrap();
        assert_eq!(
            d,
            DatosViewToken {
                propiedad_id: 7,
                jti: "jti-abc".to_string(),
                emitido_en_ms: IAT,
                expira_en_ms: IAT + 3_600_000,
            }
        );
    }

    #[test]
    fn rechaza_firma_invalida() {
        let mut t = firmar(7, "jti-abc", IAT, IAT + 3_600_000, SECRETO);
        // Cambia el último hex por uno DISTINTO garantizado.
        let ultimo = t.pop().unwrap();
        t.push(if ultimo == '0' { '1' } else { '0' });
        assert_eq!(
            verificar_view_token(&t, SECRETO, AHORA_OK, &cfg()),
            Err(ErrorViewToken::Invalido)
        );
    }

    #[test]
    fn rechaza_secreto_distinto() {
        let t = firmar(7, "jti-abc", IAT, IAT + 3_600_000, SECRETO);
        assert_eq!(
            verificar_view_token(&t, b"otro-secreto", AHORA_OK, &cfg()),
            Err(ErrorViewToken::Invalido)
        );
    }

    #[test]
    fn rechaza_formatos_invalidos() {
        let c = cfg();
        for malo in [
            "sin-puntos",
            "v1.solo-dos",
            "v2.e30.abcd",
            "v1.!!!.abcd",
            "v1.e30.abcd.extra",
            "v1.e30.zz-nohex",
            "",
        ] {
            assert_eq!(verificar_view_token(malo, SECRETO, AHORA_OK, &c), Err(ErrorViewToken::Invalido), "{malo}");
        }
        // JSON válido pero sin campos requeridos / jti vacío.
        let b64_vacio = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(r#"{"pid":7}"#);
        let t = format!("v1.{b64_vacio}.00");
        assert_eq!(verificar_view_token(&t, SECRETO, AHORA_OK, &c), Err(ErrorViewToken::Invalido));
    }

    #[test]
    fn rechaza_expirado() {
        let t = firmar(7, "jti-exp", IAT, IAT + 3_600_000, SECRETO);
        assert_eq!(
            verificar_view_token(&t, SECRETO, IAT + 3_600_001, &cfg()),
            Err(ErrorViewToken::Expirado)
        );
    }

    #[test]
    fn rechaza_emitido_en_futuro() {
        let t = firmar(7, "jti-fut", IAT + 60_000, IAT + 3_660_000, SECRETO);
        assert_eq!(
            verificar_view_token(&t, SECRETO, IAT, &cfg()),
            Err(ErrorViewToken::Invalido)
        );
    }

    #[test]
    fn rechaza_vigencia_mayor_que_config() {
        // exp - iat = 2 h > max 60 min → inválido aunque la firma sea buena.
        let t = firmar(7, "jti-long", IAT, IAT + 2 * 3_600_000, SECRETO);
        assert_eq!(
            verificar_view_token(&t, SECRETO, AHORA_OK, &cfg()),
            Err(ErrorViewToken::Invalido)
        );
    }

    // --- Integración con decidir_vista (los 3 casos que pide la Fase 3) ---

    #[test]
    fn token_verificado_cuenta_en_decision() {
        let t = firmar(7, "jti-ok", IAT, IAT + 3_600_000, SECRETO);
        let d = verificar_view_token(&t, SECRETO, AHORA_OK, &cfg()).unwrap();
        let (e, s) = evento_desde_token(&d);
        let r = decidir_vista(&e, &s, &cfg(), AHORA_OK);
        assert!(r.es_contada(), "esperaba counted, fue {}", r.motivo);
    }

    #[test]
    fn token_de_otro_inmueble_es_token_invalido() {
        let t = firmar(7, "jti-otro", IAT, IAT + 3_600_000, SECRETO);
        let d = verificar_view_token(&t, SECRETO, AHORA_OK, &cfg()).unwrap();
        let (mut e, s) = evento_desde_token(&d);
        e.property_id = 999; // el evento dice otro inmueble que el token
        let r = decidir_vista(&e, &s, &cfg(), AHORA_OK);
        assert_eq!(r.motivo, "token_invalido");
    }

    #[test]
    fn token_reutilizado_es_rechazado_en_decision() {
        let t = firmar(7, "jti-re", IAT, IAT + 3_600_000, SECRETO);
        let d = verificar_view_token(&t, SECRETO, AHORA_OK, &cfg()).unwrap();
        let (e, mut s) = evento_desde_token(&d);
        s.token_ya_usado = true; // Redis (Fase 4) marcó el jti como usado
        let r = decidir_vista(&e, &s, &cfg(), AHORA_OK);
        assert_eq!(r.motivo, "token_reutilizado");
    }

    #[test]
    fn evento_demasiado_pronto_es_tiempo_insuficiente() {
        let t = firmar(7, "jti-fast", IAT, IAT + 3_600_000, SECRETO);
        let d = verificar_view_token(&t, SECRETO, IAT + 1_000, &cfg()).unwrap();
        let (e, s) = evento_desde_token(&d);
        let r = decidir_vista(&e, &s, &cfg(), IAT + 1_000); // 1 s < 3 s
        assert_eq!(r.motivo, "tiempo_insuficiente");
    }
}
