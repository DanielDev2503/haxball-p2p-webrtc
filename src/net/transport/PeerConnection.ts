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
      if (this.pc.connectionState === 'connected') {
        if (this.onConnected) this.onConnected();
      } else if (this.pc.connectionState === 'disconnected' || this.pc.connectionState === 'failed') {
        if (this.onDisconnected) this.onDisconnected();
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
    channel.onmessage = (event) => {
      if (typeof event.data === 'string' && this.onReliableMessage) {
        this.onReliableMessage(event.data);
      }
    };
  }

  private setupUnreliableChannel(channel: RTCDataChannel): void {
    this.unreliableChannel = channel;
    channel.binaryType = 'arraybuffer';
    channel.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer && this.onUnreliableMessage) {
        this.onUnreliableMessage(event.data);
      }
    };
  }

  public async createOffer(): Promise<RTCSessionDescriptionInit> {
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    return offer;
  }

  public async handleOffer(offer: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit> {
    await this.pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    return answer;
  }

  public async handleAnswer(answer: RTCSessionDescriptionInit): Promise<void> {
    await this.pc.setRemoteDescription(new RTCSessionDescription(answer));
  }

  public async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    try {
      await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      console.warn('Error adding ICE candidate', err);
    }
  }

  public sendUnreliable(buffer: ArrayBuffer): void {
    if (this.unreliableChannel && this.unreliableChannel.readyState === 'open') {
      this.unreliableChannel.send(buffer);
    }
  }

  public sendReliable(text: string): void {
    if (this.reliableChannel && this.reliableChannel.readyState === 'open') {
      this.reliableChannel.send(text);
    }
  }

  public close(): void {
    if (this.unreliableChannel) this.unreliableChannel.close();
    if (this.reliableChannel) this.reliableChannel.close();
    this.pc.close();
  }
}
