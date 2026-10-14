#!/bin/bash
# ============================================================================
# quitar-dominio.sh (v2 — NO interactivo, para ejecución remota desde el CRM)
# Elimina el bloque Nginx y el certificado SSL de un dominio propio.
#
# Uso:
#   sudo ./quitar-dominio.sh <dominio-base>
#
# Salida: líneas de progreso [OK]/[AVISO]/[ERROR]. Exit 0 = bloque y cert
# eliminados + nginx recargado. NO toca la base de datos: el backend limpia
# custom_domain y vuelve a 'sin_dominio' solo si este script termina en 0.
# ============================================================================

set -u

NGINX_AVAILABLE="/etc/nginx/sites-available"
NGINX_ENABLED="/etc/nginx/sites-enabled"

log_ok() { echo "[OK] $1"; }
log_aviso() { echo "[AVISO] $1"; }
log_error() { echo "[ERROR] $1"; }

if [ "$EUID" -ne 0 ]; then
    log_error "Debe correrse como root (sudo)."
    exit 1
fi

DOMINIO_BASE="${1:-}"

if [ -z "$DOMINIO_BASE" ]; then
    log_error "Falta el dominio base. Uso: $0 <dominio-base>"
    exit 1
fi

if ! echo "$DOMINIO_BASE" | grep -Eq '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'; then
    log_error "Dominio inválido: '$DOMINIO_BASE'."
    exit 1
fi

ARCHIVO_CONF="$NGINX_AVAILABLE/$DOMINIO_BASE"
ENLACE="$NGINX_ENABLED/$DOMINIO_BASE"

if [ ! -f "$ARCHIVO_CONF" ]; then
    log_aviso "No existe bloque Nginx para '$DOMINIO_BASE'. Se continúa con el certificado."
else
    log_ok "Bloque encontrado: $ARCHIVO_CONF"
fi

# --- 1. Certificado SSL ---
if certbot certificates 2>/dev/null | grep -q "Domains: .*$DOMINIO_BASE"; then
    if certbot delete --cert-name "$DOMINIO_BASE" --non-interactive; then
        log_ok "Certificado eliminado"
    else
        log_aviso "certbot delete falló (¿nombre distinto? revise con: certbot certificates). Se continúa."
    fi
else
    log_aviso "Sin certificado activo para este dominio. Se continúa."
fi

# --- 2. Bloque Nginx ---
if [ -L "$ENLACE" ]; then
    rm "$ENLACE"
    log_ok "Symlink eliminado de sites-enabled"
fi

if [ -f "$ARCHIVO_CONF" ]; then
    rm "$ARCHIVO_CONF"
    log_ok "Archivo eliminado de sites-available"
fi

if ! nginx -t; then
    log_error "Nginx con error tras borrar el bloque. Revisión manual antes de recargar."
    exit 3
fi

systemctl reload nginx
log_ok "Nginx recargado"

# --- 3. Verificación ---
CODIGO=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "http://$DOMINIO_BASE")
log_ok "http://$DOMINIO_BASE ahora responde HTTP $CODIGO (esperado: ya no sirve el sitio)"
log_ok "Baja completa. El backend ya puede limpiar el dominio en BD."
exit 0
