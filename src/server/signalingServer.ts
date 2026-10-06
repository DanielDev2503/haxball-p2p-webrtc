import { WebSocketServer, WebSocket } from 'ws';

export interface RoomConfig {
  name: string;
  maxPlayers: number; // 2 a 16
  isPrivate: boolean;
  password?: string | undefined;
  timeLimit: number; // En minutos; 0 = Indefinido
  scoreLimit: number; // Goles; 0 = Indefinido
  teamsLocked: boolean;
  stadiumId?: string | undefined;
}

export interface Room {
  id: string;
  config: RoomConfig;
  hostId: string;
  hostWs: WebSocket;
  peers: Map<string, WebSocket>;
  pendingPeers?: Map<string, WebSocket>;
}

// Latido bidireccional cada 15 segundos exactos
const HEARTBEAT_INTERVAL_MS = 15_000;

interface AliveWebSocket extends WebSocket {
  isAlive: boolean;
  peerId?: string | undefined;
}

export interface RTCIceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export function getRuntimeIceServers(): RTCIceServer[] {
  const stunRaw = process.env.VITE_STUN_URLS || process.env.STUN_URLS;
  const stunUrls = stunRaw
    ? stunRaw.split(',').map(s => s.trim()).filter(Boolean)
    : ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'];

  const servers: RTCIceServer[] = [{ urls: stunUrls }];

  const turnUrl = process.env.VITE_TURN_URL || process.env.TURN_URL;
  const turnUser = process.env.VITE_TURN_USERNAME || process.env.TURN_USERNAME;
  const turnPass = process.env.VITE_TURN_CREDENTIAL || process.env.TURN_CREDENTIAL;

  if (turnUrl && turnUser && turnPass) {
    servers.push({
      urls: turnUrl.split(',').map(s => s.trim()).filter(Boolean),
      username: turnUser.trim(),
      credential: turnPass.trim()
    });
  }

  return servers;
}

export function setupSignalingServer(wss: WebSocketServer) {
  const rooms = new Map<string, Room>();
  const peerToRoom = new Map<string, string>();
  const pendingPeerToRoom = new Map<string, string>();

  function send(ws: WebSocket, data: object): void {
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(data));
      } catch (err) {
        console.warn('[SignalingServer] Error sending payload:', err);
      }
    }
  }

  function getRoomList() {
    return Array.from(rooms.values()).map((r) => ({
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

  /**
   * Purga inmediata de salas zombi: cuando un Host cae o se desconecta,
   * la sala se elimina de inmediato de la lista pública y se notifica a los miembros.
   */
  function destroyRoom(roomId: string): void {
    const room = rooms.get(roomId);
    if (!room) return;

    console.log(`[SignalingServer] Purgando sala zombi ${roomId} (Host: ${room.hostId})`);

    // Notificar desconexión a todos los peers conectados
    for (const peerWs of room.peers.values()) {
      send(peerWs, { type: 'host_left', roomId });
    }
    if (room.pendingPeers) {
      for (const peerWs of room.pendingPeers.values()) {
        send(peerWs, {
          type: 'error',
          code: 'ROOM_NOT_FOUND',
          message: 'El anfitrión de la sala se ha desconectado.'
        });
      }
    }

    // Limpieza de índices y referencias
    for (const peerId of room.peers.keys()) {
      peerToRoom.delete(peerId);
    }
    if (room.pendingPeers) {
      for (const peerId of room.pendingPeers.keys()) {
        pendingPeerToRoom.delete(peerId);
      }
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

    // Limpieza de peers pendientes de handshake
    if (peerId && pendingPeerToRoom.has(peerId)) {
      const pRoomId = pendingPeerToRoom.get(peerId)!;
      const pRoom = rooms.get(pRoomId);
      if (pRoom?.pendingPeers) {
        pRoom.pendingPeers.delete(peerId);
      }
      pendingPeerToRoom.delete(peerId);
    }

    if (activeRoomId) {
      const room = rooms.get(activeRoomId);
      if (room) {
        const isHost = room.hostId === peerId || (closingWs && room.hostWs === closingWs);
        if (isHost) {
          // Purga inmediata: evitar salas fantasmas y errores de unión
          destroyRoom(activeRoomId);
          return;
        } else {
          room.peers.delete(peerId);
          peerToRoom.delete(peerId);
          send(room.hostWs, { type: 'peer_left', peerId });
          broadcastRoomList();
        }
      }
      if (peerId && !rooms.get(activeRoomId)) {
        peerToRoom.delete(peerId);
      }
    }
  }

  // --- Heartbeat bidireccional cada 15 segundos ---
  const heartbeatInterval = setInterval(() => {
    for (const client of wss.clients) {
      const ws = client as AliveWebSocket;
      if (!ws.isAlive) {
        console.log(`[SignalingServer] Heartbeat timeout para socket: ${ws.peerId || 'desconocido'}`);
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      try {
        ws.ping();
        send(ws, { type: 'ping' });
      } catch {
        ws.terminate();
      }
    }
  }, HEARTBEAT_INTERVAL_MS);

  wss.on('close', () => {
    clearInterval(heartbeatInterval);
  });

  wss.on('connection', (rawWs: WebSocket) => {
    const ws = rawWs as AliveWebSocket;
    ws.isAlive = true;
    let currentPeerId = '';

    // Enviar configuración de servidores ICE (STUN + TURN) inmediatamente al conectar
    send(ws, { type: 'ice_config', iceServers: getRuntimeIceServers() });

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('message', (raw: string) => {
      try {
        ws.isAlive = true;
        const msg = JSON.parse(raw.toString());
        const { type, peerId, targetId, roomId, roomName, payload, config, password, nickname, reason, code } = msg;

        if (peerId) {
          currentPeerId = peerId;
          ws.peerId = peerId;
        }

        switch (type) {
          case 'get_ice_config':
          case 'request_ice_config': {
            send(ws, { type: 'ice_config', iceServers: getRuntimeIceServers() });
            break;
          }

          case 'heartbeat':
          case 'ping': {
            ws.isAlive = true;
            send(ws, { type: 'pong' });
            break;
          }

          case 'pong': {
            ws.isAlive = true;
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
              peers: new Map(),
              pendingPeers: new Map()
            };
            rooms.set(newRoomId, room);
            peerToRoom.set(peerId, newRoomId);

            console.log(`[SignalingServer] Sala creada: ${newRoomId} ("${roomConf.name}", max: ${roomConf.maxPlayers}) por ${peerId}`);
            send(ws, { type: 'room_created', roomId: newRoomId, roomName: roomConf.name, config: roomConf });
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
              send(ws, { type: 'error', code: 'ROOM_NOT_FOUND', message: 'Sala no encontrada o cerrada.' });
              return;
            }

            // Validar que el Host siga vivo
            if (!room.hostWs || room.hostWs.readyState !== WebSocket.OPEN) {
              destroyRoom(roomId);
              send(ws, { type: 'error', code: 'ROOM_NOT_FOUND', message: 'El anfitrión de la sala no está disponible.' });
              return;
            }

            // Capacidad máxima de jugadores
            if (room.peers.size + 1 >= room.config.maxPlayers) {
              send(ws, { type: 'error', code: 'ROOM_FULL', message: 'La sala ha alcanzado su límite máximo de jugadores.' });
              return;
            }

            // Validación de contraseña si es privada
            if (room.config.isPrivate) {
              const providedPass = password || '';
              if (providedPass !== room.config.password) {
                send(ws, { type: 'error', code: 'INVALID_PASSWORD', message: 'Contraseña incorrecta para esta sala privada.' });
                return;
              }
            }

            if (!room.pendingPeers) room.pendingPeers = new Map();
            room.pendingPeers.set(peerId, ws);
            pendingPeerToRoom.set(peerId, roomId);

            // Handshake explícito: el servidor solicita confirmación al Host (JOIN_REQUEST)
            console.log(`[SignalingServer] Solicitud de unión: Peer ${peerId} ("${nickname || 'Guest'}") a sala ${roomId}`);
            send(room.hostWs, {
              type: 'join_request',
              peerId,
              nickname,
              roomId
            });
            break;
          }

          case 'accept_peer':
          case 'join_accepted': {
            // Confirmación explícita del Host (accept_peer / join_accepted)
            const activeRoomId = peerToRoom.get(peerId);
            if (!activeRoomId) return;
            const room = rooms.get(activeRoomId);
            if (!room || room.hostId !== peerId) return;

            const targetPeerWs = room.pendingPeers?.get(targetId);
            if (targetPeerWs && targetPeerWs.readyState === WebSocket.OPEN) {
              room.pendingPeers?.delete(targetId);
              pendingPeerToRoom.delete(targetId);
              room.peers.set(targetId, targetPeerWs);
              peerToRoom.set(targetId, activeRoomId);

              console.log(`[SignalingServer] Host ${peerId} aceptó a ${targetId} en sala ${activeRoomId}`);

              // UNICAST ESTRICTO: Enviar exclusivamente al socket del invitado (targetPeerWs).
              // Queda PROHIBIDO emitir peer_accepted hacia la sala completa o hacia el Host
              // para evitar que el Host instancie un segundo PeerConnection sobre el mismo peerId.
              send(targetPeerWs, {
                type: 'room_joined',
                roomId: room.id,
                roomName: room.config.name,
                hostId: room.hostId,
                config: room.config
              });
              send(targetPeerWs, {
                type: 'peer_accepted',
                roomId: room.id,
                hostId: room.hostId,
                targetId
              });
              broadcastRoomList();
            }
            break;
          }

          case 'join_rejected': {
            // Rechazo explícito del Host (JOIN_REJECTED)
            const activeRoomId = peerToRoom.get(peerId);
            if (!activeRoomId) return;
            const room = rooms.get(activeRoomId);
            if (!room || room.hostId !== peerId) return;

            const targetPeerWs = room.pendingPeers?.get(targetId);
            if (targetPeerWs) {
              room.pendingPeers?.delete(targetId);
              pendingPeerToRoom.delete(targetId);
              send(targetPeerWs, {
                type: 'error',
                code: code || 'JOIN_REJECTED',
                message: reason || 'El anfitrión rechazó la solicitud de unión.'
              });
            }
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
            const activeRoomId = peerToRoom.get(peerId) || peerToRoom.get(currentPeerId) || roomId;
            if (!activeRoomId) return;
            const room = rooms.get(activeRoomId);
            if (!room) return;

            let targetWs: WebSocket | undefined;
            if (targetId === room.hostId) {
              targetWs = room.hostWs;
            } else {
              targetWs = room.peers.get(targetId) || room.pendingPeers?.get(targetId);
            }

            if (targetWs && targetWs.readyState === WebSocket.OPEN) {
              send(targetWs, {
                type,
                senderId: peerId || currentPeerId,
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

    ws.on('error', () => {
      handleDisconnect(currentPeerId, ws);
    });
  });

  return { rooms, peerToRoom };
}

export const setupSignaling = setupSignalingServer;

const isDirectCliRun = typeof process !== 'undefined' && process.argv[1]?.includes('signalingServer');
if (isDirectCliRun) {
  const PORT = 8080;
  const standaloneWss = new WebSocketServer({ port: PORT, host: '0.0.0.0' });
  console.log(`[SignalingServer] Standalone Haxball Signaling Server started on ws://0.0.0.0:${PORT}`);
  setupSignalingServer(standaloneWss);
}
