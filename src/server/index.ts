import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import { setupSignalingServer } from './signalingServer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = Number(process.env.PORT) || 3000;
const CLIENT_DIST = path.join(__dirname, '../client');

// Servir estáticos del frontend
app.use(express.static(CLIENT_DIST));

// Fallback SPA
app.use((_req, res) => {
  res.sendFile(path.join(CLIENT_DIST, 'index.html'));
});

// Inicializar lógica de señalización WebRTC
setupSignalingServer(wss);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor de juego y señalización escuchando en el puerto ${PORT}`);
});
