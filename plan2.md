Crea un script TEMPORAL de prueba para verificar que el cron dispara y que el correo de alerta llega, aunque no haya nada nuevo. No modifiques código de producción ni la BD.

Archivo: src/jobs/test-email-alerta.js
Uso: node --env-file .env src/jobs/test-email-alerta.js --hora=23:30 --busqueda=<ID> [--hasta=23:35] [--ahora]

Comportamiento:
1. Lee la búsqueda guardada con ese id (JOIN usuarios para obtener email y name). Usa SOLO esa búsqueda; no toques las demás.
2. Con node-cron y timezone "America/Bogota", programa la ejecución a la hora indicada (--hora=HH:MM, formato 24 h):
   - Sin --hasta: se ejecuta una sola vez a esa hora y el proceso termina.
   - Con --hasta=HH:MM: se ejecuta cada minuto entre --hora y --hasta (ambas incluidas) y el proceso termina al pasar --hasta.
   - Con --ahora: envía inmediatamente, sin esperar el cron.
3. Cada ejecución arma las "novedades" así, ignorando property_events y last_checked_at:
   - Toma hasta 3 viviendas publicadas más recientes que cumplan los filtros de la búsqueda (usa construirWhereBusqueda con la misma estructura de joins del procesador). Si ninguna cumple, toma las 3 viviendas publicadas más recientes de cualquier zona.
   - Asigna event_type distintos para ver las tres variantes de la plantilla: 'created', 'price_drop' (con precio_anterior = precio * 1.1, solo para la prueba) y 'relisted'.
   - Calcula path y ubicacion igual que el procesador (usa la misma función rutaVivienda y la misma imagen/portada).
4. Llama a enviarEmailAlerta({ busqueda, usuario, items, total }) usando el mismo servicio real, con el asunto prefijado "[PRUEBA] ".
5. NO escribe nada en la BD: no inserta en saved_search_notifications, no actualiza last_checked_at, last_sent_at ni fallos_envio.
6. Loguea con hora de Bogotá: "programado para HH:MM", cada disparo ("disparo 23:31 → enviado a <email>") y cualquier error de Brevo (sin credenciales). Si el envío falla, muestra el error completo.
7. Antes de programar, imprime la hora actual de Bogotá y la del servidor para confirmar que coinciden con lo que esperas.

Después:
- Ejecútalo con --ahora para comprobar que envía y dime qué ve el log.
- Luego déjame el comando exacto listo para correr con mi hora (yo pondré la hora del servidor/Bogotá) y quédate esperando a que yo confirme que el correo llegó.
- Cuando confirme, borra el script. No lo dejes en el repo.