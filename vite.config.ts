import { defineConfig, Plugin } from 'vite';
import { WebSocketServer } from 'ws';
import { setupSignalingServer } from './src/server/signalingServer';

function signalingPlugin(): Plugin {
  return {
    name: 'vite-plugin-signaling',
    configureServer(server) {
      if (!server.httpServer) return;
      const wss = new WebSocketServer({ noServer: true });
      setupSignalingServer(wss);

      server.httpServer.on('upgrade', (req, socket, head) => {
        if (req.headers['sec-websocket-protocol'] === 'vite-hmr') return;
        wss.handleUpgrade(req, socket, head, (ws) => {
          wss.emit('connection', ws, req);
        });
      });
      console.log('[Vite] Embedded Signaling Server listening on WS upgrades');
    }
  };
}

export default defineConfig({
  plugins: [signalingPlugin()],
  server: {
    port: 3000,
    strictPort: true,
    host: '0.0.0.0',
    allowedHosts: true,
    cors: true
  },
  build: {
    target: 'esnext'
  }
});
