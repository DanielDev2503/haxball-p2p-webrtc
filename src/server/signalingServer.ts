import { WebSocketServer, WebSocket } from 'ws';

export interface Room {
  id: string;
  name: string;
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
        const { type, peerId, targetId, roomId, roomName, payload } = msg;

        if (peerId) {
          currentPeerId = peerId;
        }

        switch (type) {
          case 'create_room': {
            const newRoomId = roomId || Math.random().toString(36).substring(2, 8).toUpperCase();
            const room: Room = {
              id: newRoomId,
              name: roomName || `Room #${newRoomId}`,
              hostId: peerId,
              hostWs: ws,
              peers: new Map()
            };
            rooms.set(newRoomId, room);
            peerToRoom.set(peerId, newRoomId);

            console.log(`[SignalingServer] Room created: ${newRoomId} by ${peerId}`);
            send(ws, { type: 'room_created', roomId: newRoomId, roomName: room.name });
            break;
          }

          case 'list_rooms': {
            const list = Array.from(rooms.values()).map(r => ({
              id: r.id,
              name: r.name,
              playerCount: r.peers.size + 1
            }));
            send(ws, { type: 'room_list', rooms: list });
            break;
          }

          case 'join_room': {
            const room = rooms.get(roomId);
            if (!room) {
              send(ws, { type: 'error', message: 'Room not found' });
              return;
            }

            room.peers.set(peerId, ws);
            peerToRoom.set(peerId, roomId);

            console.log(`[SignalingServer] Peer ${peerId} joining room ${roomId}`);
            // Notify the host that a new peer wants to connect
            send(room.hostWs, { type: 'peer_joined', peerId });
            send(ws, { type: 'room_joined', roomId: room.id, roomName: room.name, hostId: room.hostId });
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
