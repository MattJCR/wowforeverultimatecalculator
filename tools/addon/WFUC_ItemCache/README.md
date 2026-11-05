# WFUC_ItemCache

Addon manual para completar la caché local de hotfixes de objetos (`DBCache.bin`) cuando faltan objetos que conocemos pero que el servidor aún no ha enviado a este cliente.

- **Es una excepción puntual a «el cliente es solo lectura»:** las herramientas del proyecto nunca lo instalan. Lo copia el usuario a `Interface\AddOns` con el juego cerrado, si decide usarlo.
- Se regenera con `node tools/extract/build-itemcache-addon.mjs [build]` (la lista de ids sale de lo que la caché aún no trae, así que se acorta con cada lectura).
- Uso en el juego: `/wfucitems start` (empieza o retoma), `stop`, `status`, `reset`. No se inicia solo. 5 peticiones cada 2 segundos, se pausa en combate y al cambiar de zona, y no pide los objetos que el cliente ya conoce.
- El avance se guarda en `WFUC_ItemCacheDB` (variables guardadas del juego, se escriben al salir o recargar).
- Al terminar: esperar 1 minuto, `/logout` normal (sin cierre forzado), repetir la lectura de hotfixes (docs/EXTRACTION.md) y `npm run patch-check -- --hotfix <build>`. Los objetos que el servidor no devuelve probablemente ya no existen: marcarlos como retirados, no darlos por vigentes.
- Probar primero con pocos y mirar `/wfucitems status`. El addon no se ha ejecutado en el juego al escribirlo.
