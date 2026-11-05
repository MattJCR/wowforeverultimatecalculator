# WFUC_ItemCache

Addon manual para completar la caché local de hotfixes de objetos (`DBCache.bin`) cuando faltan objetos que conocemos pero que el servidor aún no ha enviado a este cliente.

- **Es una excepción puntual a «el cliente es solo lectura»:** las herramientas del proyecto nunca lo instalan. Lo copia el usuario a `Interface\AddOns` con el juego cerrado, si decide usarlo.
- Se regenera con `node tools/extract/build-itemcache-addon.mjs [build]` (la lista de ids sale de lo que la caché aún no trae, así que se acorta con cada lectura). Cada lista lleva un identificador: con otra lista (otro parche) empieza de cero, con la misma retoma.
- **Botón en el minimapa** (v3): clic izquierdo empieza o para; clic derecho muestra el estado en el chat; Mayús + clic derecho empieza de cero; arrastrar lo mueve. Colores: **rojo** sin empezar · **naranja** trabajando · **amarillo** pendiente (parado a mitad o en pausa por combate) · **verde** terminado. El tooltip enseña el avance, el tiempo que falta y, al terminar, cuántos objetos ha recibido el cliente.
- Comandos: `/wfucitems start | stop | status | reset`. No se inicia solo. 5 peticiones cada 2 segundos, se pausa en combate y al cambiar de zona, y no pide los objetos que el cliente ya conoce.
- El avance se guarda en `WFUC_ItemCacheDB` (variables guardadas del juego, se escriben al salir o recargar). Ojo: esas variables se cargan **después** de ejecutar el código del addon, por eso la base se inicializa en `ADDON_LOADED` (la v2 no lo hacía y no habría guardado el avance).
- Al terminar: esperar 1 minuto, `/logout` normal (sin cierre forzado), repetir la lectura de hotfixes (docs/EXTRACTION.md) y `npm run patch-check -- --hotfix <build>`. Los objetos que el servidor no devuelve probablemente ya no existen: marcarlos como retirados, no darlos por vigentes.
- **Sin probar en el juego:** solo se ha comprobado que el Lua no tiene errores de sintaxis (analizador independiente). Si da un error al cargar, corregir la plantilla del generador, no el `.lua` generado.
