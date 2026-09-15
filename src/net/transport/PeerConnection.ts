import { OP_KEEPALIVE } from '../protocol/BinaryProtocol';

export interface PeerConnectionConfig {
  iceServers?: RTCIceServer[];
}

export class PeerConnection {
  public pc: RTCPeerConnection;
  public reliableChannel: RTCDataChannel | null = null;
  public unreliableChannel: RTCDataChannel | null = null;
  public remotePeerId: string;
  public isInitiator: boolean;

  public onUnreliableMessage?: (data: ArrayBuffer) => void;
  public onReliableMessage?: (data: string) => void;
  public onIceCandidate?: (candidate: RTCIceCandidate) => void;
  public onConnected?: () => void;
  public onDisconnected?: () => void;
  public onDataChannelOpen?: () => void;

  // ICE candidate queue — holds candidates that arrive before remoteDescription is set
  private iceCandidateQueue: RTCIceCandidateInit[] = [];

  // Reconnection timeout for 'disconnected' state (5 seconds before giving up)
  private disconnectTimeoutId: ReturnType<typeof setTimeout> | null = null;

  // DataChannel keep-alive to prevent NAT port closure
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

    this.pc = new RTCPeerConnection({
      iceServers: config.iceServers ?? defaultIceServers
    });

    this.pc.onicecandidate = (event) => {
      if (event.candidate && this.onIceCandidate) {
        this.onIceCandidate(event.candidate);
      }
    };

    this.pc.onconnectionstatechange = () => {
      const state = this.pc.connectionState;
      switch (state) {
        case 'connected':
          // Connection recovered or established — cancel any pending disconnect timeout
          this.clearDisconnectTimeout();
          if (this.onConnected) this.onConnected();
          break;

        case 'disconnected':
          // Transient state — don't close immediately.
          // If we're the initiator (host), attempt ICE restart.
          // Give 5 seconds for recovery before declaring dead.
          if (this.isInitiator) {
            try {
              this.pc.restartIce();
            } catch (_e) {
              // restartIce may throw if pc is already closed
            }
          }
          this.clearDisconnectTimeout();
          this.disconnectTimeoutId = setTimeout(() => {
            // Still disconnected after timeout — treat as failed
            if (this.pc.connectionState === 'disconnected' || this.pc.connectionState === 'failed') {
              if (this.onDisconnected) this.onDisconnected();
            }
          }, PeerConnection.DISCONNECT_TIMEOUT_MS);
          break;

        case 'failed':
          // Irrecoverable — notify immediately
          this.clearDisconnectTimeout();
          if (this.onDisconnected) this.onDisconnected();
          break;

        case 'closed':
          // Silent cleanup
          this.clearDisconnectTimeout();
          break;
      }
    };

    if (this.isInitiator) {
      // Host creates the channels
      this.setupReliableChannel(
        this.pc.createDataChannel('reliable', { ordered: true })
      );
      this.setupUnreliableChannel(
        this.pc.createDataChannel('unreliable', { ordered: false, maxRetransmits: 0 })
      );
    } else {
      // Client receives incoming channels from Host
      this.pc.ondatachannel = (event) => {
        if (event.channel.label === 'reliable') {
          this.setupReliableChannel(event.channel);
        } else if (event.channel.label === 'unreliable') {
          this.setupUnreliableChannel(event.channel);
        }
      };
    }
  }

  private setupReliableChannel(channel: RTCDataChannel): void {
    this.reliableChannel = channel;
    channel.onopen = () => {
      if (this.onDataChannelOpen) {
        this.onDataChannelOpen();
      }
    };
    channel.onmessage = (event) => {
      if (typeof event.data === 'string' && this.onReliableMessage) {
        this.onReliableMessage(event.data);
      }
    };
  }


  private setupUnreliableChannel(channel: RTCDataChannel): void {
    this.unreliableChannel = channel;
    channel.binaryType = 'arraybuffer';

    channel.onopen = () => {
      this.startKeepAlive();
    };

    channel.onclose = () => {
      this.stopKeepAlive();
    };

    channel.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        // Filter out keep-alive packets (1-byte 0xFF)
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

  // --- ICE Candidate Queue ---

  private flushIceCandidateQueue(): void {
    while (this.iceCandidateQueue.length > 0) {
      const candidate = this.iceCandidateQueue.shift()!;
      this.pc.addIceCandidate(new RTCIceCandidate(candidate)).catch((err) => {
        console.warn('Error adding queued ICE candidate', err);
      });
    }
  }

  public async createOffer(): Promise<RTCSessionDescriptionInit> {
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    return offer;
  }

  public async handleOffer(offer: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit> {
    await this.pc.setRemoteDescription(new RTCSessionDescription(offer));
    this.flushIceCandidateQueue();
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    return answer;
  }

  public async handleAnswer(answer: RTCSessionDescriptionInit): Promise<void> {
    await this.pc.setRemoteDescription(new RTCSessionDescription(answer));
    this.flushIceCandidateQueue();
  }

  public async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    if (!this.pc.remoteDescription) {
      // Remote description not set yet — queue the candidate for later
      this.iceCandidateQueue.push(candidate);
      return;
    }
    try {
      await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      console.warn('Error adding ICE candidate', err);
    }
  }

  // --- Keep-Alive ---

  private startKeepAlive(): void {
    this.stopKeepAlive();
    this.keepAliveIntervalId = setInterval(() => {
      const now = performance.now();
      // Only send keep-alive if no other traffic was sent recently
      if (now - this.lastSendTimestamp >= PeerConnection.KEEPALIVE_INTERVAL_MS) {
        if (this.unreliableChannel && this.unreliableChannel.readyState === 'open') {
          try {
            this.unreliableChannel.send(PeerConnection.KEEPALIVE_PACKET);
          } catch (_e) {
            // Channel may have closed between check and send
          }
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

  // --- Send helpers ---

  public sendUnreliable(buffer: ArrayBuffer): void {
    if (this.unreliableChannel && this.unreliableChannel.readyState === 'open') {
      this.unreliableChannel.send(buffer);
      this.lastSendTimestamp = performance.now();
    }
  }

  public sendReliable(text: string): void {
    if (this.reliableChannel && this.reliableChannel.readyState === 'open') {
      this.reliableChannel.send(text);
    }
  }

  // --- Cleanup ---

  private clearDisconnectTimeout(): void {
    if (this.disconnectTimeoutId !== null) {
      clearTimeout(this.disconnectTimeoutId);
      this.disconnectTimeoutId = null;
    }
  }

  public close(): void {
    this.clearDisconnectTimeout();
    this.stopKeepAlive();

    // Clean up listeners to prevent memory leaks on reconnection
    this.pc.onicecandidate = null;
    this.pc.onconnectionstatechange = null;
    this.pc.ondatachannel = null;

    if (this.unreliableChannel) {
      this.unreliableChannel.onopen = null;
      this.unreliableChannel.onclose = null;
      this.unreliableChannel.onmessage = null;
      this.unreliableChannel.close();
    }
    if (this.reliableChannel) {
      this.reliableChannel.onopen = null;
      this.reliableChannel.onmessage = null;
      this.reliableChannel.close();
    }
    this.pc.close();

    // Clear the queue
    this.iceCandidateQueue.length = 0;
  }
}
