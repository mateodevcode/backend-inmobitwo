# Dominios propios con ejecución remota (módulo Dominios del CRM)

El superadmin ejecuta altas y bajas desde `/dominios` sin abrir SSH: el
backend se conecta al VPS, corre `scripts-dominios/*.sh` y devuelve el log
en vivo al CRM. Al terminar en OK, la BD se actualiza sola (`activo` o
`sin_dominio`). Cloudflare (registrar el DNS) sigue siendo manual.

## Instalación única en el VPS (como root o con sudo)

```bash
# 1. Clave SSH dedicada (sin passphrase) para que el backend entre al host.
#    OJO: nunca commitear la privada.
ssh-keygen -t ed25519 -f /srv/infra/inmobitwo/.ssh/dominios_vps -N "" -C "dominios-crm"
chmod 600 /srv/infra/inmobitwo/.ssh/dominios_vps
cat /srv/infra/inmobitwo/.ssh/dominios_vps.pub >> ~/.ssh/authorized_keys

# 2. El usuario del deploy solo puede correr los 2 scripts con sudo (nada más).
#    Archivo: /etc/sudoers.d/dominios-crm (visudo para editar)
deploy ALL=(root) NOPASSWD: /srv/infra/inmobitwo/scripts-dominios/agregar-dominio.sh *
deploy ALL=(root) NOPASSWD: /srv/infra/inmobitwo/scripts-dominios/quitar-dominio.sh *

# 3. Variables en el .env del backend (VPS):
DOMINIOS_SSH_HOST=161.97.146.80
DOMINIOS_SSH_USER=deploy
DOMINIOS_SSH_KEY_PATH=/app/.ssh/dominios_vps
# DOMINIOS_SCRIPT_DIR y DOMINIOS_SERVER_IP ya traen buen defecto.
```

El `deploy.yml` sincroniza `scripts-dominios/` del repo a
`/srv/infra/inmobitwo/scripts-dominios/` en cada push, y el compose monta
`/srv/infra/inmobitwo/.ssh` en `/app/.ssh` (solo lectura). Sin clave, los
endpoints de ejecución responden 503 y la lectura sigue activa.

## En local

Sin `DOMINIOS_SSH_*` el backend responde 503 al ejecutar (esperado). Para
probar lectura: `/dominios/solicitudes` y `/dominios/jobs` funcionan igual.

## Reglas del módulo

- Solo superadmin (rutas y página).
- Una ejecución a la vez (409 si hay otra en curso: el lock de certbot es global).
- Alta: verifica DNS contra `DOMINIOS_SERVER_IP` antes de tocar nginx; si el
  script falla, la BD NO cambia (reintentar cuando Cloudflare propague).
- Baja: borra cert + bloque + reload; la BD pasa a `sin_dominio`.
- Todo queda en `dominios_jobs` (log + quién + cuándo): auditoría.


-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW
AAAEBTNBVAD4jYP65DUF7e97M96+tv6zl2asF7o/SDh4IAkzvTzXXSkuyAT45dgp0qFqzd
5p3esKmpOYPeaw49Qay4AAAADEFTVVNAUk9DS0lUTwE=
-----END OPENSSH PRIVATE KEY-----
