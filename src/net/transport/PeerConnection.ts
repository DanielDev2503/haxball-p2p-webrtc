import { OP_KEEPALIVE } from '../protocol/BinaryProtocol';

export interface PeerConnectionConfig {
  iceServers?: RTCIceServer[];
}

export class PeerConnection {
  public pc: RTCPeerConnection;
  public dataChannel: RTCDataChannel | null = null;
  public remotePeerId: string;
  public isInitiator: boolean;

  public get peerConnection(): RTCPeerConnection {
    return this.pc;
  }

  // Compatibilidad hacia atrás para llamadas que lean reliableChannel o unreliableChannel
  public get reliableChannel(): RTCDataChannel | null {
    return this.dataChannel;
  }

  public get unreliableChannel(): RTCDataChannel | null {
    return this.dataChannel;
  }

  public onUnreliableMessage?: (data: ArrayBuffer) => void;
  public onReliableMessage?: (data: string) => void;
  public onIceCandidate?: (candidate: RTCIceCandidate) => void;
  public onConnected?: () => void;
  public onDisconnected?: () => void;
  public onDataChannelOpen?: () => void;

  // Cola de candidatos ICE para evitar condiciones de carrera en Trickle ICE
  private iceCandidatesQueue: RTCIceCandidateInit[] = [];

  // Timeout para estado 'disconnected' (5 segundos para ICE restart)
  private disconnectTimeoutId: ReturnType<typeof setTimeout> | null = null;

  // DataChannel keep-alive para evitar cierre de puertos NAT
  private keepAliveIntervalId: ReturnType<typeof setInterval> | null = null;
  private lastSendTimestamp: number = 0;

  private static readonly KEEPALIVE_INTERVAL_MS = 5000;
  private static readonly KEEPALIVE_PACKET = new Uint8Array([OP_KEEPALIVE]).buffer;
  private static readonly DISCONNECT_TIMEOUT_MS = 5000;

  constructor(remotePeerId: string, isInitiator: boolean, config: PeerConnectionConfig = {}) {
    this.remotePeerId = remotePeerId;
    this.isInitiator = isInitiator;

    const defaultIceServers: RTCIceServer[] = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun.cloudflare.com:3478' }
    ];

    // Soporte para servidores TURN configurados vía variables de entorno (p. ej. Metered)
    let envTurnServers: RTCIceServer[] = [];
    try {
      if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_TURN_SERVERS) {
        envTurnServers = JSON.parse(import.meta.env.VITE_TURN_SERVERS);
      }
    } catch (e) {
      console.warn('[PeerConnection] Error parsing VITE_TURN_SERVERS:', e);
    }

    const iceServers: RTCIceServer[] = config.iceServers ?? [
      ...defaultIceServers,
      ...(Array.isArray(envTurnServers) ? envTurnServers : [])
    ];

    this.pc = new RTCPeerConnection({ iceServers });

    this.pc.onicecandidate = (event) => {
      if (event.candidate && this.onIceCandidate) {
        this.onIceCandidate(event.candidate);
      }
    };

    this.pc.oniceconnectionstatechange = () => {
      const state = this.pc.iceConnectionState;
      if (state === 'connected' || state === 'completed') {
        this.clearDisconnectTimeout();
        if (this.onConnected) this.onConnected();
      } else if (state === 'failed') {
        this.clearDisconnectTimeout();
        if (this.onDisconnected) this.onDisconnected();
      }
    };

    this.pc.onconnectionstatechange = () => {
      const state = this.pc.connectionState;
      switch (state) {
        case 'connected':
          this.clearDisconnectTimeout();
          if (this.onConnected) this.onConnected();
          break;

        case 'disconnected':
          if (this.isInitiator) {
            try {
              this.pc.restartIce();
            } catch (_e) {}
          }
          this.clearDisconnectTimeout();
          this.disconnectTimeoutId = setTimeout(() => {
            if (this.pc.connectionState === 'disconnected' || this.pc.connectionState === 'failed') {
              if (this.onDisconnected) this.onDisconnected();
            }
          }, PeerConnection.DISCONNECT_TIMEOUT_MS);
          break;

        case 'failed':
          this.clearDisconnectTimeout();
          if (this.onDisconnected) this.onDisconnected();
          break;

        case 'closed':
          this.clearDisconnectTimeout();
          break;
      }
    };

    if (this.isInitiator) {
      // El Host (creador de la sala / initiator) es el único encargado de invocar createDataChannel
      const dc = this.pc.createDataChannel('game', { ordered: false, maxRetransmits: 0 });
      this.setupDataChannel(dc);
    } else {
      // El Cliente Invitado debe configurar el listener ondatachannel
      this.pc.ondatachannel = (event) => {
        this.setupDataChannel(event.channel);
      };
    }
  }

  private setupDataChannel(channel: RTCDataChannel): void {
    this.dataChannel = channel;
    channel.binaryType = 'arraybuffer';

    channel.onopen = () => {
      this.startKeepAlive();
      if (this.onDataChannelOpen) {
        this.onDataChannelOpen();
      }
    };

    channel.onclose = () => {
      this.stopKeepAlive();
    };

    channel.onmessage = (event) => {
      if (typeof event.data === 'string') {
        if (this.onReliableMessage) {
          this.onReliableMessage(event.data);
        }
      } else if (event.data instanceof ArrayBuffer) {
        // Filtrar paquetes keep-alive (1 byte 0xFF)
        if (event.data.byteLength === 1) {
          const byte = new Uint8Array(event.data)[0];
          if (byte === OP_KEEPALIVE) return;
        }
        if (this.onUnreliableMessage) {
          this.onUnreliableMessage(event.data);
        }
      }
    };
  }

  // --- Cola de Candidatos ICE (Fix para Trickle ICE Race Condition) ---

  private async flushIceCandidatesQueue(): Promise<void> {
    while (this.iceCandidatesQueue.length > 0) {
      const candidate = this.iceCandidatesQueue.shift()!;
      try {
        await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.warn('[PeerConnection] Error adding queued ICE candidate:', err);
      }
    }
  }

  public async handleRemoteCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    if (!this.pc.remoteDescription) {
      // Si remoteDescription es null o undefined, encolar el candidato
      this.iceCandidatesQueue.push(candidate);
      return;
    }
    try {
      await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      console.warn('[PeerConnection] Error adding ICE candidate:', err);
    }
  }

  public async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    return this.handleRemoteCandidate(candidate);
  }

  public async createOffer(): Promise<RTCSessionDescriptionInit> {
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    return offer;
  }

  public async handleOffer(offer: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit> {
    await this.pc.setRemoteDescription(new RTCSessionDescription(offer));
    await this.flushIceCandidatesQueue();
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    return answer;
  }

  public async handleAnswer(answer: RTCSessionDescriptionInit): Promise<void> {
    await this.pc.setRemoteDescription(new RTCSessionDescription(answer));
    await this.flushIceCandidatesQueue();
  }

  // --- Keep-Alive ---

  private startKeepAlive(): void {
    this.stopKeepAlive();
    this.keepAliveIntervalId = setInterval(() => {
      const now = performance.now();
      if (now - this.lastSendTimestamp >= PeerConnection.KEEPALIVE_INTERVAL_MS) {
        if (this.dataChannel && this.dataChannel.readyState === 'open') {
          try {
            this.dataChannel.send(PeerConnection.KEEPALIVE_PACKET);
          } catch (_e) {}
        }
      }
    }, PeerConnection.KEEPALIVE_INTERVAL_MS);
  }

  private stopKeepAlive(): void {
    if (this.keepAliveIntervalId !== null) {
      clearInterval(this.keepAliveIntervalId);
      this.keepAliveIntervalId = null;
    }
  }

  // --- Helpers de Envío ---

  public sendUnreliable(buffer: ArrayBuffer): void {
    if (this.dataChannel && this.dataChannel.readyState === 'open') {
      this.dataChannel.send(buffer);
      this.lastSendTimestamp = performance.now();
    }
  }

  public sendReliable(text: string): void {
    if (this.dataChannel && this.dataChannel.readyState === 'open') {
      this.dataChannel.send(text);
    }
  }

  // --- Limpieza ---

  private clearDisconnectTimeout(): void {
    if (this.disconnectTimeoutId !== null) {
      clearTimeout(this.disconnectTimeoutId);
      this.disconnectTimeoutId = null;
    }
  }

  public close(): void {
    this.clearDisconnectTimeout();
    this.stopKeepAlive();

    this.pc.onicecandidate = null;
    this.pc.onconnectionstatechange = null;
    this.pc.oniceconnectionstatechange = null;
    this.pc.ondatachannel = null;

    if (this.dataChannel) {
      this.dataChannel.onopen = null;
      this.dataChannel.onclose = null;
      this.dataChannel.onmessage = null;
      try {
        this.dataChannel.close();
      } catch (_e) {}
      this.dataChannel = null;
    }
    try {
      this.pc.close();
    } catch (_e) {}

    this.iceCandidatesQueue.length = 0;
  }
}
