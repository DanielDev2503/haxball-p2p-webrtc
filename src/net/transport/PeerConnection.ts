import { OP_KEEPALIVE } from '../protocol/BinaryProtocol';
import type { SignalingClient } from '../signaling/SignalingClient';

/**
 * Estado lógico del enlace P2P (más estable que los estados crudos de RTCPeerConnection).
 * - new:          creado, sin negociación completada.
 * - connecting:   SDP intercambiado, esperando ICE/DTLS.
 * - connected:    transporte ICE/DTLS operativo.
 * - reconnecting: enlace caído, ICE restart con backoff exponencial en curso.
 * - failed:       se agotaron los reintentos; desconexión definitiva notificada.
 * - closed:       cerrado localmente de forma intencional.
 */
export type PeerLinkState = 'new' | 'connecting' | 'connected' | 'reconnecting' | 'failed' | 'closed';

export interface PeerConnectionConfig {
  iceServers?: RTCIceServer[] | undefined;
  /** 'relay' fuerza el uso exclusivo de TURN (útil para diagnosticar NAT simétrico). */
  iceTransportPolicy?: RTCIceTransportPolicy | undefined;
  signalingClient?: SignalingClient | null | undefined;
}

/** Canal ordenado/confiable: eventos de partida, chat, handshake, gameConfig. */
export const RELIABLE_CHANNEL_LABEL = 'reliable';
/** Canal sin orden ni retransmisión: InputPacket / SnapshotPacket a 60 Hz. */
export const UNRELIABLE_CHANNEL_LABEL = 'game';

export const DEFAULT_STUN_SERVERS = [
  'stun:stun.l.google.com:19302',
  'stun:stun1.l.google.com:19302'
];

export function parseIceUrls(raw: string | undefined, defaultUrls: string[]): string[] {
  if (!raw || typeof raw !== 'string' || !raw.trim()) {
    return defaultUrls;
  }
  return raw
    .split(',')
    .map((url) => url.trim())
    .filter((url) => url.length > 0);
}

function isValidIceServer(server: unknown): server is RTCIceServer {
  if (!server || typeof server !== 'object') return false;
  const urls = (server as RTCIceServer).urls;
  return typeof urls === 'string' || (Array.isArray(urls) && urls.every((u) => typeof u === 'string'));
}

/** Servidores ICE entregados dinámicamente por la señalización en runtime (mensaje `ice_config`). */
let dynamicIceServers: RTCIceServer[] | null = null;

export function setDynamicIceServers(servers: RTCIceServer[] | null | undefined): void {
  if (Array.isArray(servers) && servers.length > 0) {
    dynamicIceServers = servers.filter(isValidIceServer);
    console.log('[WebRTC] Servidores ICE actualizados dinámicamente desde señalización:', dynamicIceServers);
  } else {
    dynamicIceServers = null;
  }
}

export const setRuntimeIceServers = setDynamicIceServers;

/**
 * Lee servidores TURN definidos en build-time:
 * - VITE_TURN_URL (admite lista separada por comas) + VITE_TURN_USERNAME + VITE_TURN_CREDENTIAL
 * - VITE_TURN_SERVERS (JSON con un array de RTCIceServer, formato legado)
 */
export function readEnvTurnServers(env: Partial<ImportMetaEnv> | undefined = getViteEnv()): RTCIceServer[] {
  if (!env) return [];
  const servers: RTCIceServer[] = [];

  const turnUrl = env.VITE_TURN_URL ? String(env.VITE_TURN_URL).trim() : '';
  if (turnUrl) {
    const urls = turnUrl.split(',').map((u: string) => u.trim()).filter(Boolean);
    const server: RTCIceServer = { urls: urls.length === 1 ? urls[0] : urls };
    if (env.VITE_TURN_USERNAME) server.username = String(env.VITE_TURN_USERNAME);
    if (env.VITE_TURN_CREDENTIAL) server.credential = String(env.VITE_TURN_CREDENTIAL);
    servers.push(server);
  }

  const legacyJson = env.VITE_TURN_SERVERS?.trim();
  if (legacyJson) {
    try {
      const parsed: unknown = JSON.parse(legacyJson);
      if (Array.isArray(parsed)) {
        servers.push(...parsed.filter(isValidIceServer));
      }
    } catch (e) {
      console.warn('[PeerConnection] VITE_TURN_SERVERS no es JSON válido:', e);
    }
  }
  return servers;
}

function getViteEnv(): Partial<ImportMetaEnv> | undefined {
  try {
    return typeof import.meta !== 'undefined' ? import.meta.env : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Construye la lista de servidores ICE a partir de las variables de entorno de Vite
 * (STUN y TURN / ExpressTURN) y servidores adicionales de runtime.
 */
export function getIceServers(customEnv?: Record<string, string | undefined>): RTCIceServer[] {
  if (!customEnv && dynamicIceServers && dynamicIceServers.length > 0) {
    return dynamicIceServers;
  }
  const env = customEnv ?? (typeof import.meta !== 'undefined' ? import.meta.env : undefined);
  const stunUrls = parseIceUrls(
    env?.VITE_STUN_URLS,
    DEFAULT_STUN_SERVERS
  );

  const servers: RTCIceServer[] = [{ urls: stunUrls }];

  const turnUrl = env?.VITE_TURN_URL;
  const turnUsername = env?.VITE_TURN_USERNAME;
  const turnCredential = env?.VITE_TURN_CREDENTIAL;

  if (turnUrl && turnUsername && turnCredential) {
    const turnUrls = parseIceUrls(String(turnUrl), []);
    if (turnUrls.length > 0) {
      servers.push({
        urls: turnUrls,
        username: String(turnUsername).trim(),
        credential: String(turnCredential).trim()
      });
    }
  }



  return servers;
}

/** Lista balanceada STUN + TURN (alias para compatibilidad con código existente). */
export const getDefaultIceServers = getIceServers;

export class PeerConnection {
  public pc: RTCPeerConnection;
  /** Canal no confiable / sin orden (snapshots e inputs binarios). */
  public dataChannel: RTCDataChannel | null = null;
  /** Canal confiable / ordenado (mensajes de control JSON). */
  public reliableDataChannel: RTCDataChannel | null = null;
  public remotePeerId: string;
  public isInitiator: boolean;
  public linkState: PeerLinkState = 'new';
  /**
   * Handshake de aplicación completado (CLIENT_READY confirmado).
   * Hasta entonces no se transmite tráfico binario de física.
   */
  public isReady: boolean = false;

  public get peerId(): string {
    return this.remotePeerId;
  }

  public get peerConnection(): RTCPeerConnection {
    return this.pc;
  }

  public get reliableChannel(): RTCDataChannel | null {
    return this.reliableDataChannel;
  }

  public get unreliableChannel(): RTCDataChannel | null {
    return this.dataChannel;
  }

  public onUnreliableMessage?: (data: ArrayBuffer) => void;
  public onReliableMessage?: (data: string) => void;
  public onIceCandidate?: (candidate: RTCIceCandidate) => void;
  public onConnected?: () => void;
  /** Desconexión definitiva (tras agotar los ICE restarts o cierre remoto del canal). */
  public onDisconnected?: () => void;
  /** Ambos DataChannels (confiable y no confiable) están abiertos. */
  public onDataChannelOpen?: () => void;
  /** Oferta de ICE restart generada por el initiator: debe reenviarse por señalización. */
  public onIceRestartOffer?: (offer: RTCSessionDescriptionInit) => void;
  public onLinkStateChange?: (state: PeerLinkState) => void;

  // Cola de candidatos ICE remotos recibidos antes de que setRemoteDescription() resuelva.
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private applyingRemoteDescription: boolean = false;

  // ICE restart con backoff exponencial
  public signalingClient: SignalingClient | null = null;
  private hasConnectedOnce: boolean = false;
  private recoveryAttempts: number = 0;
  private recoveryTimer: ReturnType<typeof setTimeout> | null = null;
  private isRecovering: boolean = false;
  private isClosed: boolean = false;
  private disconnectNotified: boolean = false;
  private channelsOpenNotified: boolean = false;

  // DataChannel keep-alive para evitar el cierre de bindings NAT
  private keepAliveIntervalId: ReturnType<typeof setInterval> | null = null;
  private lastSendTimestamp: number = 0;
  private currentRtt: number = 0;

  public static readonly MAX_ICE_RESTARTS = 3;
  public static readonly RESTART_BASE_DELAY_MS = 2000;
  public static readonly RESTART_WINDOW_MS = 4000;
  public static readonly DISCONNECT_GRACE_MS = 2000;
  /** Si el buffer de envío supera este umbral se descartan snapshots: enviar datos viejos solo añade latencia. */
  public static readonly MAX_UNRELIABLE_BUFFERED_BYTES = 64 * 1024;
  private static readonly MAX_PENDING_CANDIDATES = 64;
  private static readonly KEEPALIVE_INTERVAL_MS = 5000;
  private static readonly KEEPALIVE_PACKET = new Uint8Array([OP_KEEPALIVE]).buffer;

  constructor(remotePeerId: string, isInitiator: boolean, config: PeerConnectionConfig = {}) {
    this.remotePeerId = remotePeerId;
    this.isInitiator = isInitiator;
    this.signalingClient = config.signalingClient ?? null;

    const servers = config.iceServers ?? getIceServers();
    const rtcConfig: RTCConfiguration = {
      iceServers: servers,
      iceTransportPolicy: config.iceTransportPolicy ?? 'all',
      iceCandidatePoolSize: 2
    };
    this.pc = new RTCPeerConnection(rtcConfig);

    console.log(`[WebRTC] Servidores ICE configurados para ${this.peerId}:`, servers.flatMap(s => {
      const urls = Array.isArray(s.urls) ? s.urls : [s.urls];
      return urls.map(u => s.username ? `${u} (Auth: ${s.username})` : u);
    }));

    const hasTurn = servers.some(s => {
      const urls = Array.isArray(s.urls) ? s.urls : [s.urls];
      return urls.some(u => typeof u === 'string' && (u.startsWith('turn:') || u.startsWith('turns:')));
    });
    if (!hasTurn) {
      console.warn('[WebRTC] ATENCIÓN: No hay servidor TURN configurado. Las conexiones bajo NAT simétrico fallarán.');
    }

    this.pc.onicecandidate = (event) => {
      if (event.candidate && this.onIceCandidate) {
        this.onIceCandidate(event.candidate);
      }
    };
    this.pc.oniceconnectionstatechange = () => this.handleTransportState(this.pc.iceConnectionState);
    this.pc.onconnectionstatechange = () => this.handleTransportState(this.pc.connectionState);

    if (this.isInitiator) {
      // El Host (initiator) crea ambos canales antes de la oferta para que el SDP incluya la sección SCTP.
      const reliable = this.pc.createDataChannel(RELIABLE_CHANNEL_LABEL, { ordered: true });
      this.attachChannel(reliable, RELIABLE_CHANNEL_LABEL);
      const unreliable = this.pc.createDataChannel(UNRELIABLE_CHANNEL_LABEL, { ordered: false, maxRetransmits: 0 });
      this.attachChannel(unreliable, UNRELIABLE_CHANNEL_LABEL);
    } else {
      this.pc.ondatachannel = (event) => {
        this.attachChannel(event.channel, event.channel.label);
      };
    }
  }

  // --- DataChannels ---

  private attachChannel(channel: RTCDataChannel, label: string): void {
    if (label === RELIABLE_CHANNEL_LABEL) {
      this.reliableDataChannel = channel;
    } else {
      this.dataChannel = channel;
    }
    channel.binaryType = 'arraybuffer';

    channel.onopen = () => {
      if (channel === this.reliableDataChannel) {
        this.hasConnectedOnce = true;
      }
      if (this.dataChannel?.readyState === 'open') {
        this.startKeepAlive();
      }
      this.notifyChannelsOpenIfReady();
    };

    channel.onclose = () => {
      if (channel === this.dataChannel) {
        this.stopKeepAlive();
      }
      // El cierre del canal confiable indica que el par remoto cerró la conexión.
      if (!this.isClosed && channel === this.reliableDataChannel && this.channelsOpenNotified) {
        this.finalizeDisconnect();
      }
    };

    channel.onerror = (event) => {
      if (!this.isClosed) console.warn(`[PeerConnection] DataChannel "${label}" error:`, event);
    };

    channel.onmessage = (event: MessageEvent) => {
      const data: unknown = event.data;
      if (typeof data === 'string') {
        if (this.onReliableMessage) this.onReliableMessage(data);
      } else if (data instanceof ArrayBuffer) {
        // Filtrar paquetes keep-alive (1 byte 0xFF)
        if (data.byteLength === 1 && new Uint8Array(data)[0] === OP_KEEPALIVE) return;
        if (this.onUnreliableMessage) this.onUnreliableMessage(data);
      }
    };
  }

  private notifyChannelsOpenIfReady(): void {
    if (this.channelsOpenNotified) return;
    if (this.reliableDataChannel?.readyState !== 'open' || this.dataChannel?.readyState !== 'open') return;
    this.channelsOpenNotified = true;
    if (this.onDataChannelOpen) this.onDataChannelOpen();
  }

  public areChannelsOpen(): boolean {
    return this.reliableDataChannel?.readyState === 'open' && this.dataChannel?.readyState === 'open';
  }

  // --- Supervisión de conectividad + ICE restart ---

  private setLinkState(state: PeerLinkState): void {
    if (this.linkState === state) return;
    this.linkState = state;
    if (this.onLinkStateChange) this.onLinkStateChange(state);
  }

  private isTransportHealthy(): boolean {
    const conn = this.pc.connectionState;
    if (conn) return conn === 'connected';
    const ice = this.pc.iceConnectionState;
    return ice === 'connected' || ice === 'completed';
  }

  private handleTransportState(state: RTCPeerConnectionState | RTCIceConnectionState): void {
    if (this.isClosed || this.disconnectNotified) return;
    switch (state) {
      case 'connected':
      case 'completed':
        if (!this.isTransportHealthy()) return; // ICE ok pero DTLS aún no
        this.clearRecoveryTimer();
        this.isRecovering = false;
        this.recoveryAttempts = 0;
        if (this.linkState !== 'connected') {
          this.setLinkState('connected');
          if (this.onConnected) this.onConnected();
        }
        break;
      case 'checking':
      case 'connecting':
        if (this.linkState === 'new') this.setLinkState('connecting');
        break;
      case 'disconnected':
      case 'failed':
        // PROHIBIDO disparar ICE restart si la conexión nunca llegó a abrirse
        if (!this.hasConnectedOnce) {
          console.log(`[PeerConnection] Estado de transporte inicial con ${this.peerId}: ${state} (handshake en curso)`);
          return;
        }

        if (state === 'disconnected') {
          // 'disconnected' suele recuperarse solo: aplicar margen de gracia de 2000 ms.
          if (this.isRecovering) return;
          if (this.recoveryTimer !== null) return;
          this.scheduleRecovery(true);
        } else {
          // Pasa a recuperación; si ya se está ejecutando el ciclo, se mantiene sin cascada
          if (this.isRecovering) return;
          this.scheduleRecovery(false);
        }
        break;
      default:
        break;
    }
  }

  private scheduleRecovery(isGracePeriod: boolean = false): void {
    if (this.isClosed || this.disconnectNotified) return;

    if (this.recoveryTimer !== null) {
      clearTimeout(this.recoveryTimer);
      this.recoveryTimer = null;
    }

    if (isGracePeriod) {
      this.recoveryTimer = setTimeout(() => {
        this.recoveryTimer = null;
        if (this.isClosed || this.disconnectNotified || this.isTransportHealthy()) {
          this.isRecovering = false;
          return;
        }
        // Persiste 'disconnected' tras el periodo de gracia
        this.scheduleRecovery(false);
      }, PeerConnection.DISCONNECT_GRACE_MS);
      return;
    }

    if (this.recoveryAttempts >= PeerConnection.MAX_ICE_RESTARTS) {
      this.finalizeDisconnect();
      return;
    }

    this.isRecovering = true;
    this.setLinkState('reconnecting');
    this.recoveryAttempts++;
    const delay = Math.min(2000 * Math.pow(2, this.recoveryAttempts - 1), 6000);

    console.warn(`[PeerConnection] ICE restart ${this.recoveryAttempts}/${PeerConnection.MAX_ICE_RESTARTS} programado en ${delay}ms con ${this.remotePeerId}`);

    this.recoveryTimer = setTimeout(() => {
      this.recoveryTimer = null;
      if (this.isClosed || this.disconnectNotified || this.isTransportHealthy()) {
        this.isRecovering = false;
        return;
      }
      void this.executeIceRestart();

      // Ventana de renegociación antes del siguiente intento si no vuelve a conectarse
      this.recoveryTimer = setTimeout(() => {
        this.recoveryTimer = null;
        if (this.isClosed || this.disconnectNotified || this.isTransportHealthy()) {
          this.isRecovering = false;
          return;
        }
        if (this.recoveryAttempts >= PeerConnection.MAX_ICE_RESTARTS) {
          this.finalizeDisconnect();
        } else {
          this.scheduleRecovery(false);
        }
      }, PeerConnection.RESTART_WINDOW_MS);
    }, delay);
  }

  /** Solo el initiator (Host) genera la oferta de ICE restart; verifica precondición de señalización. */
  public async executeIceRestart(): Promise<void> {
    if (this.isClosed || this.disconnectNotified) return;

    if (!this.signalingClient || !this.signalingClient.isOpen()) {
      console.warn(`[PeerConnection] No se puede ejecutar ICE restart: Señalización no disponible.`);
      this.signalingClient?.reconnect();
      return;
    }

    if (!this.isInitiator || this.pc.signalingState === 'closed') return;

    try {
      if (typeof this.pc.restartIce === 'function') {
        this.pc.restartIce();
      }
      const offer = await this.pc.createOffer({ iceRestart: true });
      await this.pc.setLocalDescription(offer);
      if (this.onIceRestartOffer && !this.isClosed) {
        this.onIceRestartOffer(this.pc.localDescription?.toJSON?.() ?? offer);
      }
    } catch (err) {
      console.warn('[PeerConnection] ICE restart falló:', err);
    }
  }

  public async performIceRestart(): Promise<void> {
    return this.executeIceRestart();
  }

  private finalizeDisconnect(): void {
    if (this.disconnectNotified || this.isClosed) return;
    this.disconnectNotified = true;
    this.isRecovering = false;
    this.clearRecoveryTimer();
    this.stopKeepAlive();
    this.setLinkState('failed');
    if (this.onDisconnected) this.onDisconnected();
  }

  private clearRecoveryTimer(): void {
    if (this.recoveryTimer !== null) {
      clearTimeout(this.recoveryTimer);
      this.recoveryTimer = null;
    }
  }

  public get isRecoveryActive(): boolean {
    return this.isRecovering;
  }

  public get currentRecoveryAttempts(): number {
    return this.recoveryAttempts;
  }

  public get hasEverConnected(): boolean {
    return this.hasConnectedOnce;
  }

  // --- Cola de Candidatos ICE (Trickle ICE a prueba de carreras) ---

  private async flushPendingCandidates(): Promise<void> {
    if (this.pendingCandidates.length > 0) {
      const candidatesToFlush = [...this.pendingCandidates];
      this.pendingCandidates = [];
      for (const cand of candidatesToFlush) {
        try {
          await this.pc.addIceCandidate(new RTCIceCandidate(cand));
        } catch (err) {
          console.warn('[PeerConnection] Error aplicando candidato pendiente:', err);
        }
      }
    }
  }

  public async handleRemoteCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    if (this.isClosed) return;
    // Encolar mientras no exista remoteDescription o mientras se aplica una nueva (ICE restart).
    if (!this.pc.remoteDescription || this.applyingRemoteDescription) {
      if (this.pendingCandidates.length < PeerConnection.MAX_PENDING_CANDIDATES) {
        this.pendingCandidates.push(candidate);
      }
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

  public async handleCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    return this.handleRemoteCandidate(candidate);
  }

  public getPendingCandidateCount(): number {
    return this.pendingCandidates.length;
  }

  // --- Negociación SDP ---

  public async createOffer(): Promise<RTCSessionDescriptionInit> {
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    if (this.linkState === 'new') this.setLinkState('connecting');
    return offer;
  }

  /** Oferta inicial o de renegociación (ICE restart) proveniente del Host. */
  public async handleOffer(offer: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit> {
    this.applyingRemoteDescription = true;
    try {
      await this.pc.setRemoteDescription(new RTCSessionDescription(offer));
    } finally {
      this.applyingRemoteDescription = false;
    }
    await this.flushPendingCandidates();
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    if (this.linkState === 'new') this.setLinkState('connecting');
    return answer;
  }

  public async handleAnswer(answer: RTCSessionDescriptionInit): Promise<void> {
    // Ignorar respuestas duplicadas o tardías (solo válidas en 'have-local-offer').
    const sigState = this.pc.signalingState;
    if (sigState && sigState !== 'have-local-offer') {
      console.warn(`[PeerConnection] Answer ignorada en signalingState=${sigState}`);
      return;
    }
    this.applyingRemoteDescription = true;
    try {
      await this.pc.setRemoteDescription(new RTCSessionDescription(answer));
    } finally {
      this.applyingRemoteDescription = false;
    }
    await this.flushPendingCandidates();
  }

  // --- Keep-Alive ---

  private startKeepAlive(): void {
    this.stopKeepAlive();
    this.keepAliveIntervalId = setInterval(() => {
      const now = performance.now();
      if (now - this.lastSendTimestamp >= PeerConnection.KEEPALIVE_INTERVAL_MS && this.dataChannel?.readyState === 'open') {
        try {
          this.dataChannel.send(PeerConnection.KEEPALIVE_PACKET);
        } catch (_e) {}
      }
    }, PeerConnection.KEEPALIVE_INTERVAL_MS);
  }

  private stopKeepAlive(): void {
    if (this.keepAliveIntervalId !== null) {
      clearInterval(this.keepAliveIntervalId);
      this.keepAliveIntervalId = null;
    }
  }

  // --- Helpers de Envío (protegidos contra readyState inválido) ---

  /** Envía un paquete binario por el canal no confiable. Devuelve false si se descartó. */
  public sendUnreliable(buffer: ArrayBuffer): boolean {
    const channel = this.dataChannel;
    if (!channel || channel.readyState !== 'open') return false;
    if ((channel.bufferedAmount ?? 0) > PeerConnection.MAX_UNRELIABLE_BUFFERED_BYTES) return false;
    try {
      channel.send(buffer);
      this.lastSendTimestamp = performance.now();
      return true;
    } catch (err) {
      console.warn('[PeerConnection] sendUnreliable falló:', err);
      return false;
    }
  }

  /** Envía un mensaje de control por el canal confiable y ordenado. */
  public sendReliable(text: string): boolean {
    const channel = this.reliableDataChannel;
    if (!channel || channel.readyState !== 'open') return false;
    try {
      channel.send(text);
      return true;
    } catch (err) {
      console.warn('[PeerConnection] sendReliable falló:', err);
      return false;
    }
  }

  // --- Limpieza ---

  public close(): void {
    if (this.isClosed) return;
    this.isClosed = true;
    this.isRecovering = false;
    this.clearRecoveryTimer();
    this.stopKeepAlive();

    this.pc.onicecandidate = null;
    this.pc.onconnectionstatechange = null;
    this.pc.oniceconnectionstatechange = null;
    this.pc.ondatachannel = null;

    for (const channel of [this.reliableDataChannel, this.dataChannel]) {
      if (!channel) continue;
      channel.onopen = null;
      channel.onclose = null;
      channel.onerror = null;
      channel.onmessage = null;
      try {
        channel.close();
      } catch (_e) {}
    }
    this.reliableDataChannel = null;
    this.dataChannel = null;

    try {
      this.pc.close();
    } catch (_e) {}

    this.pendingCandidates.length = 0;
    this.isReady = false;
    this.setLinkState('closed');
  }

  /**
   * Mide el RTT / Ping actual usando la API estándar de WebRTC getStats()
   */
  public async measureRtt(): Promise<number> {
    if (!this.pc || typeof this.pc.getStats !== 'function') {
      return this.currentRtt;
    }
    try {
      const stats = await this.pc.getStats();
      for (const report of stats.values()) {
        if (
          report.type === 'candidate-pair' &&
          (report.state === 'succeeded' || (report as any).nominated) &&
          typeof (report as any).currentRoundTripTime === 'number'
        ) {
          this.currentRtt = Math.round((report as any).currentRoundTripTime * 1000);
          return this.currentRtt;
        }
      }
    } catch {
      // Ignorar excepciones en entornos simulados o mocks
    }
    return this.currentRtt;
  }

  public getRtt(): number {
    return this.currentRtt;
  }
}
