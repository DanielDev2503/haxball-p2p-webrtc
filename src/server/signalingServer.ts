import { WebSocketServer, WebSocket } from 'ws';

export interface RoomConfig {
  name: string;
  maxPlayers: number; // 2 a 16
  isPrivate: boolean;
  password?: string;
  timeLimit: number; // En minutos; 0 = Indefinido
  scoreLimit: number; // Goles; 0 = Indefinido
  teamsLocked: boolean;
}

export interface Room {
  id: string;
  config: RoomConfig;
  hostId: string;
  hostWs: WebSocket;
  peers: Map<string, WebSocket>;
}

export function setupSignalingServer(wss: WebSocketServer) {
  const rooms = new Map<string, Room>();
  const peerToRoom = new Map<string, string>();

  function send(ws: WebSocket, data: object): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }

  wss.on('connection', (ws: WebSocket) => {
    let currentPeerId = '';

    ws.on('message', (raw: string) => {
      try {
        const msg = JSON.parse(raw.toString());
        const { type, peerId, targetId, roomId, roomName, payload, config, password, nickname } = msg;

        if (peerId) {
          currentPeerId = peerId;
        }

        switch (type) {
          case 'create_room': {
            const newRoomId = roomId || Math.random().toString(36).substring(2, 8).toUpperCase();
            const roomConf: RoomConfig = {
              name: config?.name || roomName || `Room #${newRoomId}`,
              maxPlayers: Math.max(2, Math.min(16, config?.maxPlayers ?? 12)),
              isPrivate: Boolean(config?.isPrivate),
              password: config?.password || '',
              timeLimit: config?.timeLimit ?? 3,
              scoreLimit: config?.scoreLimit ?? 3,
              teamsLocked: Boolean(config?.teamsLocked)
            };
            const room: Room = {
              id: newRoomId,
              config: roomConf,
              hostId: peerId,
              hostWs: ws,
              peers: new Map()
            };
            rooms.set(newRoomId, room);
            peerToRoom.set(peerId, newRoomId);

            console.log(`[SignalingServer] Room created: ${newRoomId} (${roomConf.name}, max: ${roomConf.maxPlayers}) by ${peerId}`);
            send(ws, { type: 'room_created', roomId: newRoomId, roomName: roomConf.name, config: roomConf });
            break;
          }

          case 'list_rooms': {
            const list = Array.from(rooms.values()).map(r => ({
              id: r.id,
              name: r.config.name,
              playerCount: r.peers.size + 1,
              maxPlayers: r.config.maxPlayers,
              isPrivate: r.config.isPrivate,
              teamsLocked: r.config.teamsLocked,
              timeLimit: r.config.timeLimit,
              scoreLimit: r.config.scoreLimit
            }));
            send(ws, { type: 'room_list', rooms: list });
            break;
          }

          case 'join_room': {
            const room = rooms.get(roomId);
            if (!room) {
              send(ws, { type: 'error', code: 'ROOM_NOT_FOUND', message: 'Sala no encontrada' });
              return;
            }

            // Capacidad máxima de jugadores
            if (room.peers.size + 1 >= room.config.maxPlayers) {
              send(ws, { type: 'error', code: 'ROOM_FULL', message: 'La sala está llena' });
              return;
            }

            // Validación de contraseña si es privada
            if (room.config.isPrivate) {
              const providedPass = password || '';
              if (providedPass !== room.config.password) {
                send(ws, { type: 'error', code: 'INVALID_PASSWORD', message: 'Contraseña incorrecta' });
                return;
              }
            }

            room.peers.set(peerId, ws);
            peerToRoom.set(peerId, roomId);

            console.log(`[SignalingServer] Peer ${peerId} joining room ${roomId} (nickname: ${nickname})`);
            send(room.hostWs, { type: 'peer_joined', peerId, nickname });

            send(ws, {
              type: 'room_joined',
              roomId: room.id,
              roomName: room.config.name,
              hostId: room.hostId,
              config: room.config
            });
            break;
          }

          case 'update_room_config': {
            const activeRoomId = peerToRoom.get(peerId);
            if (!activeRoomId) return;
            const room = rooms.get(activeRoomId);
            if (!room || room.hostId !== peerId) return;

            if (config) {
              room.config = { ...room.config, ...config };
              for (const peerWs of room.peers.values()) {
                send(peerWs, { type: 'room_config_updated', config: room.config });
              }
            }
            break;
          }

          case 'signal_offer':
          case 'signal_answer':
          case 'signal_ice': {
            const activeRoomId = peerToRoom.get(peerId);
            if (!activeRoomId) return;
            const room = rooms.get(activeRoomId);
            if (!room) return;

            let targetWs: WebSocket | undefined;
            if (targetId === room.hostId) {
              targetWs = room.hostWs;
            } else {
              targetWs = room.peers.get(targetId);
            }

            if (targetWs) {
              send(targetWs, {
                type,
                senderId: peerId,
                payload
              });
            }
            break;
          }
        }
      } catch (err) {
        console.error('[SignalingServer] Error processing message:', err);
      }
    });

    ws.on('close', () => {
      if (currentPeerId) {
        const activeRoomId = peerToRoom.get(currentPeerId);
        if (activeRoomId) {
          const room = rooms.get(activeRoomId);
          if (room) {
            if (room.hostId === currentPeerId) {
              console.log(`[SignalingServer] Host left. Closing room ${activeRoomId}`);
              for (const peerWs of room.peers.values()) {
                send(peerWs, { type: 'host_left' });
              }
              rooms.delete(activeRoomId);
            } else {
              room.peers.delete(currentPeerId);
              send(room.hostWs, { type: 'peer_left', peerId: currentPeerId });
            }
          }
          peerToRoom.delete(currentPeerId);
        }
      }
    });
  });

  return { rooms, peerToRoom };
}

export const setupSignaling = setupSignalingServer;

// Iniciar servidor independiente solo si este script se invoca directamente desde CLI
const isDirectCliRun = typeof process !== 'undefined' && process.argv[1]?.includes('signalingServer');
if (isDirectCliRun) {
  const PORT = 8080;
  const standaloneWss = new WebSocketServer({ port: PORT, host: '0.0.0.0' });
  console.log(`[SignalingServer] Standalone Haxball Signaling Server started on ws://0.0.0.0:${PORT}`);
  setupSignalingServer(standaloneWss);
}
