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

  constructor(serverUrl?: string) {
    if (serverUrl) {
      this.serverUrl = serverUrl;
    } else {
      const protocol = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = typeof window !== 'undefined' && window.location.host ? window.location.host : 'localhost:3000';
      this.serverUrl = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SIGNALING_URL) || `${protocol}//${host}`;
    }
    this.peerId = 'peer_' + Math.random().toString(36).substring(2, 9);
  }

  public connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.serverUrl);

        this.ws.onopen = () => {
          this.isConnected = true;
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
          if (this.onClose) this.onClose();
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

  public send(data: object): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ ...data, peerId: this.peerId }));
    }
  }

  public createRoom(roomConfig: string | { name: string; maxPlayers?: number; isPrivate?: boolean; password?: string; timeLimit?: number; scoreLimit?: number; teamsLocked?: boolean }, roomId?: string, nickname?: string): void {
    if (typeof roomConfig === 'string') {
      this.send({ type: 'create_room', roomName: roomConfig, roomId, nickname });
    } else {
      this.send({ type: 'create_room', config: roomConfig, roomName: roomConfig.name, roomId, nickname });
    }
  }

  public joinRoom(roomId: string, password?: string, nickname?: string): void {
    this.send({ type: 'join_room', roomId, password, nickname });
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
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
