# Haxball 2D P2P (WebRTC + Node.js Signaling)

Clon web determinista de Haxball 2D en tiempo real con WebRTC DataChannels y señalización en Node.js, optimizado para producción en **Railway** con arquitectura de puerto único (HTTP + WebSockets).

## Características

- **Motor de Físicas Determinista**: Simulación a 60 Hz con sub-stepping (120 Hz) para colisiones precisas y sin solapamiento.
- **Red P2P de Baja Latencia**: Comunicación directa entre clientes vía WebRTC DataChannels binarios.
- **Arquitectura de Puerto Único**: Express sirve los estáticos compilados del cliente (`dist/client`) y atiende las conexiones de señalización WebSocket (`ws://` / `wss://`) sobre el mismo puerto.
- **Producción Lista para Railway**: Empaquetado en Dockerfile multi-etapa ligero con `railway.json`.
- **Modos de Juego**: Práctica en solitario, anfitrión de sala (Host P2P) y cliente para unirse a salas existentes.

---

## Scripts Disponibles

- `npm run dev`: Inicia el servidor de desarrollo Vite y el backend con `tsx` concurrentemente.
- `npm run build:client`: Compila el frontend en `dist/client`.
- `npm run build:server`: Compila el backend TypeScript en `dist/server`.
- `npm run build`: Ejecuta ambas compilaciones en secuencia.
- `npm start`: Ejecuta el servidor unificado de producción (`node dist/server/index.js`).
- `npm test`: Ejecuta la suite de pruebas unitarias y deterministas con Vitest.

---

## Despliegue en Railway

1. Conecta tu repositorio de GitHub en el panel de Railway.
2. Railway detectará automáticamente el `Dockerfile` y `railway.json`.
3. Genera un dominio público en **Settings > Networking > Generate Domain**.
4. ¡A jugar!
