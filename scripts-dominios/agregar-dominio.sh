#!/bin/bash
# ============================================================================
# agregar-dominio.sh (v2 — NO interactivo, para ejecución remota desde el CRM)
# Automatiza: bloque Nginx (proxy al portal Next :3000) + SSL (certbot)
# para un dominio propio de una inmobiliaria.
#
# Uso:
#   sudo ./agregar-dominio.sh <dominio-base> [--www|--sin-www]
#   Ej: sudo ./agregar-dominio.sh inmobiliariaoviedo.com --www
#
# Salida: líneas de progreso [OK]/[AVISO]/[ERROR]. Exit 0 = HTTPS 200 en
# todos los dominios. NO toca la base de datos: el backend marca 'activo'
# solo si este script termina en 0.
# ============================================================================

set -u

SERVER_IP="161.97.146.80"
NGINX_AVAILABLE="/etc/nginx/sites-available"
NGINX_ENABLED="/etc/nginx/sites-enabled"
PORTAL_UPSTREAM="http://127.0.0.1:3000"

log_ok() { echo "[OK] $1"; }
log_aviso() { echo "[AVISO] $1"; }
log_error() { echo "[ERROR] $1"; }

if [ "$EUID" -ne 0 ]; then
    log_error "Debe correrse como root (sudo)."
    exit 1
fi

DOMINIO_BASE="${1:-}"
MODO="${2:---www}"

if [ -z "$DOMINIO_BASE" ]; then
    log_error "Falta el dominio base. Uso: $0 <dominio-base> [--www|--sin-www]"
    exit 1
fi

# Validación estricta: minúsculas, puntos y guiones, sin http/www/rutas.
if ! echo "$DOMINIO_BASE" | grep -Eq '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'; then
    log_error "Dominio inválido: '$DOMINIO_BASE'."
    exit 1
fi

if [ "$MODO" == "--www" ]; then
    DOMINIOS=("$DOMINIO_BASE" "www.$DOMINIO_BASE")
elif [ "$MODO" == "--sin-www" ]; then
    DOMINIOS=("$DOMINIO_BASE")
else
    log_error "Modo inválido '$MODO'. Use --www o --sin-www."
    exit 1
fi

SERVER_NAMES="${DOMINIOS[*]}"
CERTBOT_DOMINIOS=()
for d in "${DOMINIOS[@]}"; do
    CERTBOT_DOMINIOS+=("-d" "$d")
done

log_ok "Dominios a configurar: $SERVER_NAMES"

# --- 1. Verificar DNS antes de tocar nada ---
for d in "${DOMINIOS[@]}"; do
    IP_RESUELTA=$(dig +short "$d" | tail -n1)
    if [ "$IP_RESUELTA" == "$SERVER_IP" ]; then
        log_ok "DNS $d -> $IP_RESUELTA"
    else
        log_error "DNS $d -> ${IP_RESUELTA:-'(no resuelve)'} (esperado: $SERVER_IP). Registre el dominio en Cloudflare y reintente."
        exit 2
    fi
done

# --- 2. Bloque Nginx (HTTP 80 + redirect; certbot agrega el 443) ---
ARCHIVO_CONF="$NGINX_AVAILABLE/$DOMINIO_BASE"

cat > "$ARCHIVO_CONF" <<EOF
# Tenant $DOMINIO_BASE — gestionado por el módulo Dominios del CRM.
server {
    listen 80;
    listen [::]:80;
    server_name $SERVER_NAMES;
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name $SERVER_NAMES;

    client_max_body_size 25M;
    gzip on;
    gzip_types text/css application/javascript application/json image/svg+xml;

    location /_next/static/ {
        proxy_pass $PORTAL_UPSTREAM;
        proxy_cache_valid 200 1y;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    location / {
        proxy_pass $PORTAL_UPSTREAM;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_connect_timeout 30s;
        proxy_read_timeout 60s;
        proxy_send_timeout 60s;
    }
}
EOF

log_ok "Bloque Nginx creado: $ARCHIVO_CONF"

if [ ! -L "$NGINX_ENABLED/$DOMINIO_BASE" ]; then
    ln -s "$ARCHIVO_CONF" "$NGINX_ENABLED/$DOMINIO_BASE"
    log_ok "Sitio habilitado en sites-enabled"
fi

if ! nginx -t; then
    log_error "Nginx rechazó la configuración. Revise $ARCHIVO_CONF."
    exit 3
fi
systemctl reload nginx
log_ok "Nginx recargado (HTTP)"

# --- 3. Certbot (no interactivo) ---
if certbot --nginx "${CERTBOT_DOMINIOS[@]}" --non-interactive --agree-tos -m admin@seventwo.tech; then
    log_ok "Certificado SSL emitido"
else
    log_error "Certbot falló (¿otro certbot en curso? ¿límite de Let's Encrypt?). El bloque quedó creado; reintente."
    exit 4
fi

if ! nginx -t; then
    log_error "Nginx con error tras certbot. Revisión manual."
    exit 3
fi
systemctl reload nginx

# --- 4. Verificación final HTTPS ---
TODO_OK=true
for d in "${DOMINIOS[@]}"; do
    CODIGO=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 "https://$d")
    if [ "$CODIGO" == "200" ]; then
        log_ok "https://$d responde HTTP 200"
    else
        log_error "https://$d respondió HTTP $CODIGO"
        TODO_OK=false
    fi
done

if [ "$TODO_OK" == true ]; then
    log_ok "Dominio operativo por HTTPS. El backend ya puede marcarlo activo."
    exit 0
else
    log_error "Terminado con advertencias. Revise los [ERROR] antes de activar en BD."
    exit 5
fi
