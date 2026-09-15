export interface SignalingMessage {
  type: string;
  peerId?: string;
  senderId?: string;
  targetId?: string;
  roomId?: string;
  roomName?: string;
  nickname?: string;
  payload?: any;
  rooms?: Array<{ id: string; name: string; playerCount: number; maxPlayers: number; isPrivate: boolean; teamsLocked?: boolean; timeLimit?: number; scoreLimit?: number }>;
  message?: string;
  code?: string;
  config?: any;
  password?: string;
}


export class SignalingClient {
  public ws: WebSocket | null = null;
  public peerId: string;
  public serverUrl: string;
  public isConnected: boolean = false;

  public onMessage?: (msg: SignalingMessage) => void;
  public onOpen?: () => void;
  public onClose?: () => void;
  public onReconnected?: () => void;

  // Heartbeat interval to keep the connection alive through proxies
  private heartbeatIntervalId: ReturnType<typeof setInterval> | null = null;
  private static readonly HEARTBEAT_INTERVAL_MS = 15_000;

  // Auto-reconnection
  private intentionalClose: boolean = false;
  private reconnectAttempts: number = 0;
  private static readonly MAX_RECONNECT_ATTEMPTS = 3;
  private reconnectTimeoutId: ReturnType<typeof setTimeout> | null = null;

  constructor(serverUrl?: string) {
    if (serverUrl) {
      this.serverUrl = serverUrl;
    } else {
      const defaultWsUrl = typeof window !== 'undefined' && window.location?.origin
        ? window.location.origin.replace(/^http/, 'ws')
        : 'ws://localhost:3000';
      this.serverUrl = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SIGNALING_URL) || defaultWsUrl;
    }
    this.peerId = 'peer_' + Math.random().toString(36).substring(2, 9);
  }

  public connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.intentionalClose = false;
        this.ws = new WebSocket(this.serverUrl);

        this.ws.onopen = () => {
          this.isConnected = true;
          this.reconnectAttempts = 0;
          this.startHeartbeat();
          if (this.onOpen) this.onOpen();
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const data: SignalingMessage = JSON.parse(event.data);
            if (this.onMessage) {
              this.onMessage(data);
            }
          } catch (err) {
            console.error('Failed to parse signaling message', err);
          }
        };

        this.ws.onclose = () => {
          this.isConnected = false;
          this.stopHeartbeat();
          if (this.onClose) this.onClose();

          // Auto-reconnect if not intentional
          if (!this.intentionalClose && this.reconnectAttempts < SignalingClient.MAX_RECONNECT_ATTEMPTS) {
            this.scheduleReconnect();
          }
        };

        this.ws.onerror = (err) => {
          console.warn('Signaling WebSocket error', err);
          reject(err);
        };
      } catch (err) {
        reject(err);
      }
    });
  }

  // --- Heartbeat ---

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatIntervalId = setInterval(() => {
      this.send({ type: 'heartbeat' });
    }, SignalingClient.HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatIntervalId !== null) {
      clearInterval(this.heartbeatIntervalId);
      this.heartbeatIntervalId = null;
    }
  }

  // --- Auto-Reconnect ---

  private scheduleReconnect(): void {
    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 4000); // 1s, 2s, 4s
    console.log(`[SignalingClient] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${SignalingClient.MAX_RECONNECT_ATTEMPTS})...`);

    this.reconnectTimeoutId = setTimeout(() => {
      this.reconnectTimeoutId = null;
      this.connect()
        .then(() => {
          console.log('[SignalingClient] Reconnected successfully.');
          if (this.onReconnected) this.onReconnected();
        })
        .catch((err) => {
          console.warn('[SignalingClient] Reconnect failed:', err);
          // onclose handler will schedule next attempt if under limit
        });
    }, delay);
  }

  // --- Send ---

  public send(data: object): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ ...data, peerId: this.peerId }));
    }
  }

  public createRoom(roomConfig: string | { name: string; maxPlayers?: number; isPrivate?: boolean; password?: string | undefined; timeLimit?: number; scoreLimit?: number; teamsLocked?: boolean }, roomId?: string, nickname?: string): void {
    if (typeof roomConfig === 'string') {
      this.send({ type: 'create_room', roomName: roomConfig, roomId, nickname });
    } else {
      this.send({ type: 'create_room', config: roomConfig, roomName: roomConfig.name, roomId, nickname });
    }
  }

  public joinRoom(roomId: string, password?: string, nickname?: string): void {
    this.send({ type: 'join_room', roomId, password, nickname });
  }

  public leaveRoom(roomId?: string): void {
    this.send({ type: 'leave_room', roomId });
  }

  public rejoinRoom(roomId: string): void {
    this.send({ type: 'rejoin_room', roomId });
  }

  public updateRoomConfig(config: any): void {
    this.send({ type: 'update_room_config', config });
  }

  public requestRoomList(): void {
    this.send({ type: 'list_rooms' });
  }

  public sendOffer(targetId: string, offer: RTCSessionDescriptionInit): void {
    this.send({ type: 'signal_offer', targetId, payload: offer });
  }

  public sendAnswer(targetId: string, answer: RTCSessionDescriptionInit): void {
    this.send({ type: 'signal_answer', targetId, payload: answer });
  }

  public sendIceCandidate(targetId: string, candidate: RTCIceCandidate): void {
    this.send({ type: 'signal_ice', targetId, payload: candidate });
  }

  public disconnect(): void {
    this.intentionalClose = true;
    this.stopHeartbeat();

    // Cancel any pending reconnect
    if (this.reconnectTimeoutId !== null) {
      clearTimeout(this.reconnectTimeoutId);
      this.reconnectTimeoutId = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
