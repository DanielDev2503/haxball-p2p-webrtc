import { WebSocketServer, WebSocket } from 'ws';

export interface RoomConfig {
  name: string;
  maxPlayers: number; // 2 a 16
  isPrivate: boolean;
  password?: string | undefined;
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
  // Grace period: when the host disconnects temporarily, we wait before destroying the room
  graceTimeoutId?: ReturnType<typeof setTimeout> | undefined;
}

// Heartbeat constants
const HEARTBEAT_INTERVAL_MS = 20_000; // Ping every 20 seconds
const HOST_GRACE_PERIOD_MS = 15_000;  // Wait 15s before destroying room on host disconnect

// Extend WebSocket with isAlive flag for heartbeat tracking
interface AliveWebSocket extends WebSocket {
  isAlive: boolean;
  peerId?: string | undefined;
}

export function setupSignalingServer(wss: WebSocketServer) {
  const rooms = new Map<string, Room>();
  const peerToRoom = new Map<string, string>();

  function send(ws: WebSocket, data: object): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }

  function getRoomList() {
    return Array.from(rooms.values())
      .filter(r => !r.graceTimeoutId) // Don't show rooms in grace period
      .map(r => ({
        id: r.id,
        name: r.config.name,
        playerCount: r.peers.size + 1,
        maxPlayers: r.config.maxPlayers,
        isPrivate: r.config.isPrivate,
        teamsLocked: r.config.teamsLocked,
        timeLimit: r.config.timeLimit,
        scoreLimit: r.config.scoreLimit
      }));
  }

  function broadcastRoomList(): void {
    const list = getRoomList();
    const payload = JSON.stringify({ type: 'room_list', rooms: list });
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }

  function destroyRoom(roomId: string): void {
    const room = rooms.get(roomId);
    if (!room) return;

    // Clear grace timeout if any
    if (room.graceTimeoutId) {
      clearTimeout(room.graceTimeoutId);
      room.graceTimeoutId = undefined;
    }

    console.log(`[SignalingServer] Destroying room ${roomId}`);
    for (const peerWs of room.peers.values()) {
      send(peerWs, { type: 'host_left' });
    }

    // Clean up peer-to-room mappings
    for (const peerId of room.peers.keys()) {
      peerToRoom.delete(peerId);
    }
    peerToRoom.delete(room.hostId);

    rooms.delete(roomId);
    broadcastRoomList();
  }

  function handleDisconnect(peerId: string, closingWs?: WebSocket): void {
    let activeRoomId = peerId ? peerToRoom.get(peerId) : undefined;
    if (!activeRoomId && closingWs) {
      for (const [rId, r] of rooms.entries()) {
        if (r.hostWs === closingWs || (peerId && r.peers.has(peerId))) {
          activeRoomId = rId;
          break;
        }
      }
    }

    if (activeRoomId) {
      const room = rooms.get(activeRoomId);
      if (room) {
        const isHost = room.hostId === peerId || (closingWs && room.hostWs === closingWs);
        if (isHost) {
          // Host disconnected — start grace period instead of immediate destruction
          if (!room.graceTimeoutId) {
            console.log(`[SignalingServer] Host lost for room ${activeRoomId}. Starting ${HOST_GRACE_PERIOD_MS / 1000}s grace period...`);
            room.graceTimeoutId = setTimeout(() => {
              console.log(`[SignalingServer] Grace period expired for room ${activeRoomId}. Destroying.`);
              destroyRoom(activeRoomId!);
            }, HOST_GRACE_PERIOD_MS);
            // Hide room from public list during grace period
            broadcastRoomList();
          }
        } else {
          room.peers.delete(peerId);
          send(room.hostWs, { type: 'peer_left', peerId });
          broadcastRoomList();
        }
      }
      if (peerId && !rooms.get(activeRoomId)) {
        peerToRoom.delete(peerId);
      }
    }
  }

  // --- Heartbeat: Ping/Pong mechanism ---
  const heartbeatInterval = setInterval(() => {
    for (const client of wss.clients) {
      const ws = client as AliveWebSocket;
      if (!ws.isAlive) {
        // No pong received since last ping — terminate
        console.log(`[SignalingServer] Heartbeat timeout for peer: ${ws.peerId || 'unknown'}`);
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, HEARTBEAT_INTERVAL_MS);

  // Additional safety: terminate sockets that don't respond to ping within HEARTBEAT_TIMEOUT_MS
  // The ws library handles native ping/pong, so the isAlive flag check above is sufficient.

  wss.on('close', () => {
    clearInterval(heartbeatInterval);
  });

  wss.on('connection', (rawWs: WebSocket) => {
    const ws = rawWs as AliveWebSocket;
    ws.isAlive = true;
    let currentPeerId = '';

    // Respond to native pong frames (automatic via ws library)
    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('message', (raw: string) => {
      try {
        const msg = JSON.parse(raw.toString());
        const { type, peerId, targetId, roomId, roomName, payload, config, password, nickname } = msg;

        if (peerId) {
          currentPeerId = peerId;
          ws.peerId = peerId;
        }

        switch (type) {
          case 'heartbeat': {
            // Client heartbeat — no-op, the message itself keeps the socket alive
            break;
          }

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
            broadcastRoomList();
            break;
          }

          case 'rejoin_room': {
            // Host reconnection during grace period
            const rejoinRoomId = peerToRoom.get(peerId) || roomId;
            if (!rejoinRoomId) {
              send(ws, { type: 'error', code: 'ROOM_NOT_FOUND', message: 'No room to rejoin' });
              return;
            }
            const room = rooms.get(rejoinRoomId);
            if (!room || room.hostId !== peerId) {
              send(ws, { type: 'error', code: 'ROOM_NOT_FOUND', message: 'Room not found or you are not the host' });
              return;
            }
            // Cancel grace period
            if (room.graceTimeoutId) {
              clearTimeout(room.graceTimeoutId);
              room.graceTimeoutId = undefined;
              console.log(`[SignalingServer] Host ${peerId} reconnected to room ${rejoinRoomId}. Grace period cancelled.`);
            }
            // Update host WebSocket reference
            room.hostWs = ws;
            send(ws, { type: 'room_rejoined', roomId: rejoinRoomId, config: room.config });
            broadcastRoomList();
            break;
          }

          case 'list_rooms': {
            send(ws, { type: 'room_list', rooms: getRoomList() });
            break;
          }

          case 'join_room': {
            const room = rooms.get(roomId);
            if (!room) {
              send(ws, { type: 'error', code: 'ROOM_NOT_FOUND', message: 'Sala no encontrada' });
              return;
            }

            // Don't allow joining rooms in grace period
            if (room.graceTimeoutId) {
              send(ws, { type: 'error', code: 'ROOM_NOT_FOUND', message: 'El host no está disponible' });
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
            broadcastRoomList();
            break;
          }

          case 'leave_room': {
            handleDisconnect(peerId || currentPeerId, ws);
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
              broadcastRoomList();
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
      handleDisconnect(currentPeerId, ws);
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
