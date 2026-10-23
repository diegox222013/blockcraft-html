# BlockCraft — Sandbox 2D multijugador

BlockCraft es un sandbox 2D de bloques con modo individual, salas privadas por código y salas públicas PvP. La interfaz es responsive y ofrece controles de teclado, ratón y pantalla táctil.

## Funciones
- Terreno procedural determinista: los jugadores de una sala reciben el mismo mundo.
- Minería y colocación de bloques sincronizadas entre los miembros de la sala.
- Salas privadas con código de seis caracteres y salas públicas PvP.
- Sincronización de posición, lista de jugadores, chat y combate PvP básico.
- Barra de inventario, salud, ciclo día/noche, gráficos Canvas y controles táctiles.
- Modo individual disponible sin conectar a un servidor.

## Ejecutar localmente
Necesitas Node.js 18 o superior. Desde la carpeta del proyecto, ejecuta npm install y npm start. Después abre http://localhost:3000. Para probar el multijugador, abre esa dirección en dos pestañas o en dos dispositivos de la misma red usando la IP local del computador que ejecuta el servidor.

## Publicar en Render
Este proyecto **no es un Static Site**: el multijugador necesita un proceso Node.js activo y conexiones WebSocket.

1. En Render, crea un **Web Service** conectado a este repositorio.
2. Runtime: **Node** (no Docker).
3. Build Command: npm install
4. Start Command: npm start
5. Render entrega la variable PORT; el servidor la utiliza automáticamente.
6. Despliega la rama feat/multiplayer-visual-overhaul para probar esta versión. Tras verificarla, integra la rama en main y deja el servicio apuntando a main.

No necesitas definir una URL WebSocket a mano: el cliente la construye a partir del origen donde se sirve la página y cambia automáticamente a wss:// cuando la web usa HTTPS.

## Controles
- A / D o flechas: moverse.
- W, flecha arriba o espacio: saltar.
- Clic izquierdo: minar.
- Clic derecho: colocar el bloque seleccionado.
- 1–6: elegir un bloque.
- F: atacar al jugador más cercano en una sala PvP.
- R: regenerar el mundo solo en modo individual.
- En móvil aparecen controles táctiles; mantén pulsado movimiento para desplazarte.

## Límites de esta beta
El servidor mantiene las salas y los cambios de bloques en memoria. Si el proceso se reinicia, las salas terminan y los mundos se regeneran. La sincronización es una base multijugador funcional para prototipos; todavía no incluye persistencia, cuentas, protección anti-cheat avanzada ni garantías para un servidor público de gran escala.

El juego usa gráficos originales dibujados en Canvas y CSS, sin recursos oficiales de Minecraft.