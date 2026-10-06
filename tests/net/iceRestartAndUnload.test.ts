import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  PeerConnection,
  getIceServers,
  setDynamicIceServers,
  parseIceUrls,
  DEFAULT_STUN_SERVERS
} from '../../src/net/transport/PeerConnection';
import { SignalingClient } from '../../src/net/signaling/SignalingClient';
import { getRuntimeIceServers } from '../../src/server/signalingServer';

describe('ICE Servers Configuration & ExpressTURN', () => {
  it('returns default Google STUN servers when no env vars are defined', () => {
    setDynamicIceServers(null);
    const servers = getIceServers({});
    expect(servers).toHaveLength(1);
    expect(servers[0].urls).toEqual([
      'stun:stun.l.google.com:19302',
      'stun:stun1.l.google.com:19302'
    ]);
  });

  it('correctly constructs STUN and TURN server configuration with credentials', () => {
    setDynamicIceServers(null);
    const servers = getIceServers({
      VITE_STUN_URLS: 'stun:stun.custom.com:3478, stun:stun.fallback.com:3478',
      VITE_TURN_URL: 'turn:relay.expressturn.com:3478',
      VITE_TURN_USERNAME: '000000002106610545',
      VITE_TURN_CREDENTIAL: 'ETT5qfFtieoY5iTpdrs0Ak02YUU='
    });

    expect(servers).toHaveLength(2);
    expect(servers[0].urls).toEqual([
      'stun:stun.custom.com:3478',
      'stun:stun.fallback.com:3478'
    ]);
    expect(servers[1].urls).toEqual(['turn:relay.expressturn.com:3478']);
    expect(servers[1].username).toBe('000000002106610545');
    expect(servers[1].credential).toBe('ETT5qfFtieoY5iTpdrs0Ak02YUU=');
  });

  it('parses comma-separated ICE URLs with trim and empty filtering', () => {
    expect(parseIceUrls(' stun:a.com , , stun:b.com ', DEFAULT_STUN_SERVERS)).toEqual([
      'stun:a.com',
      'stun:b.com'
    ]);
    expect(parseIceUrls('', DEFAULT_STUN_SERVERS)).toEqual(DEFAULT_STUN_SERVERS);
    expect(parseIceUrls(undefined, DEFAULT_STUN_SERVERS)).toEqual(DEFAULT_STUN_SERVERS);
  });

  it('prioritizes dynamic ICE servers from signaling over build-time env', () => {
    const customDynamic: RTCIceServer[] = [
      { urls: ['stun:dynamic.org:3478'] },
      { urls: ['turn:dynamic-relay.org:3478'], username: 'dyn-user', credential: 'dyn-pass' }
    ];
    setDynamicIceServers(customDynamic);
    expect(getIceServers()).toEqual(customDynamic);

    // Resetting dynamic servers returns to default config
    setDynamicIceServers(null);
    expect(getIceServers({})[0].urls).toEqual(DEFAULT_STUN_SERVERS);
  });

  it('getRuntimeIceServers reads environment variables with fallback', () => {
    const originalTurn = process.env.VITE_TURN_URL;
    const originalUser = process.env.VITE_TURN_USERNAME;
    const originalCred = process.env.VITE_TURN_CREDENTIAL;

    process.env.VITE_TURN_URL = 'turn:relay.test.com:3478';
    process.env.VITE_TURN_USERNAME = 'test-user';
    process.env.VITE_TURN_CREDENTIAL = 'test-pass';

    const runtimeServers = getRuntimeIceServers();
    expect(runtimeServers.length).toBeGreaterThanOrEqual(2);
    expect(runtimeServers[1].urls).toEqual(['turn:relay.test.com:3478']);
    expect(runtimeServers[1].username).toBe('test-user');
    expect(runtimeServers[1].credential).toBe('test-pass');

    process.env.VITE_TURN_URL = originalTurn;
    process.env.VITE_TURN_USERNAME = originalUser;
    process.env.VITE_TURN_CREDENTIAL = originalCred;
  });
});

describe('SignalingClient status and reconnect', () => {
  it('reports isOpen() true only when connected and WebSocket is OPEN (1)', () => {
    const client = new SignalingClient('ws://localhost:9999');
    expect(client.isOpen()).toBe(false);

    (client as any).isConnected = true;
    (client as any).ws = { readyState: 1 };
    expect(client.isOpen()).toBe(true);

    (client as any).ws = { readyState: 3 }; // CLOSED
    expect(client.isOpen()).toBe(false);
  });

  it('triggers reconnect if not already open or connecting', async () => {
    const client = new SignalingClient('ws://localhost:9999');
    const connectSpy = vi.spyOn(client, 'connect').mockResolvedValue(undefined as any);

    client.reconnect();
    expect(connectSpy).toHaveBeenCalledTimes(1);

    // If already open, reconnect does not duplicate connect()
    (client as any).ws = { readyState: 1 };
    client.reconnect();
    expect(connectSpy).toHaveBeenCalledTimes(1);
  });
});

describe('PeerConnection ICE Restart Debounce & Exponential Backoff', () => {
  let mockPc: any;
  let mockSignaling: any;

  beforeEach(() => {
    vi.useFakeTimers();

    mockPc = {
      remoteDescription: null,
      localDescription: null,
      iceConnectionState: 'connected',
      connectionState: 'connected',
      signalingState: 'stable',
      createDataChannel: vi.fn(() => ({
        label: 'game',
        readyState: 'open',
        send: vi.fn(),
        close: vi.fn()
      })),
      createOffer: vi.fn(async () => ({ type: 'offer', sdp: 'dummy-restart-offer' })),
      createAnswer: vi.fn(async () => ({ type: 'answer', sdp: 'dummy-answer' })),
      setLocalDescription: vi.fn(async (desc) => { mockPc.localDescription = desc; }),
      setRemoteDescription: vi.fn(async (desc) => { mockPc.remoteDescription = desc; }),
      addIceCandidate: vi.fn(async () => {}),
      restartIce: vi.fn(),
      close: vi.fn(),
      onicecandidate: null,
      oniceconnectionstatechange: null,
      onconnectionstatechange: null,
      ondatachannel: null
    };

    (globalThis as any).RTCPeerConnection = vi.fn(() => mockPc);
    (globalThis as any).RTCSessionDescription = vi.fn((desc) => desc);
    (globalThis as any).RTCIceCandidate = vi.fn((cand) => cand);

    mockSignaling = {
      isOpen: vi.fn(() => true),
      reconnect: vi.fn()
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('suppresses scheduleRecovery and ICE restarts if connection has never opened (hasEverConnected = false)', () => {
    const peer = new PeerConnection('peer_test', true, { signalingClient: mockSignaling });
    expect(peer.hasEverConnected).toBe(false);

    mockPc.iceConnectionState = 'failed';
    mockPc.connectionState = 'failed';
    mockPc.oniceconnectionstatechange();

    expect(peer.isRecoveryActive).toBe(false);
    expect(peer.currentRecoveryAttempts).toBe(0);
    expect(mockPc.restartIce).not.toHaveBeenCalled();
  });

  it('applies 2000ms grace period on disconnected and aborts recovery if reconnected', () => {
    const peer = new PeerConnection('peer_test', true, { signalingClient: mockSignaling });
    (peer.reliableChannel as any)?.onopen?.();
    expect(peer.hasEverConnected).toBe(true);

    // Connection starts connected
    mockPc.iceConnectionState = 'connected';
    mockPc.connectionState = 'connected';
    mockPc.onconnectionstatechange();

    // Sudden disconnected state
    mockPc.iceConnectionState = 'disconnected';
    mockPc.connectionState = 'disconnected';
    mockPc.oniceconnectionstatechange();

    expect(peer.isRecoveryActive).toBe(false);
    expect(mockPc.restartIce).not.toHaveBeenCalled();

    // Advance 1000ms (< 2000ms grace period) and reconnect
    vi.advanceTimersByTime(1000);
    mockPc.iceConnectionState = 'connected';
    mockPc.connectionState = 'connected';
    mockPc.oniceconnectionstatechange();

    // Advance remaining time; recovery should not run
    vi.advanceTimersByTime(3000);
    expect(mockPc.restartIce).not.toHaveBeenCalled();
    expect(peer.currentRecoveryAttempts).toBe(0);
    expect(peer.isRecoveryActive).toBe(false);
  });

  it('debounces rapid cascading events and executes ICE restart with backoff', async () => {
    const peer = new PeerConnection('peer_test', true, { signalingClient: mockSignaling });
    (peer.reliableChannel as any)?.onopen?.();

    // Network fails
    mockPc.iceConnectionState = 'failed';
    mockPc.connectionState = 'failed';
    mockPc.oniceconnectionstatechange();

    // Simulate multiple cascading event fires in milliseconds
    mockPc.onconnectionstatechange();
    mockPc.oniceconnectionstatechange();
    mockPc.onconnectionstatechange();

    expect(peer.isRecoveryActive).toBe(true);
    expect(peer.currentRecoveryAttempts).toBe(1);
    // Should NOT have called restartIce synchronously (must wait delay)
    expect(mockPc.restartIce).not.toHaveBeenCalled();

    // Attempt 1 delay is 2000ms
    await vi.advanceTimersByTimeAsync(2000);
    expect(mockPc.restartIce).toHaveBeenCalledTimes(1);
    expect(mockPc.createOffer).toHaveBeenCalledWith({ iceRestart: true });

    // Negotiation window (4000ms) with no recovery -> triggers Attempt 2
    await vi.advanceTimersByTimeAsync(4000);
    expect(peer.currentRecoveryAttempts).toBe(2);

    // Attempt 2 delay is Math.min(2000 * 2^1, 6000) = 4000ms
    await vi.advanceTimersByTimeAsync(3999);
    expect(mockPc.restartIce).toHaveBeenCalledTimes(1); // not yet
    await vi.advanceTimersByTimeAsync(1);
    expect(mockPc.restartIce).toHaveBeenCalledTimes(2); // attempt 2 executed

    // Negotiation window (4000ms) -> triggers Attempt 3
    await vi.advanceTimersByTimeAsync(4000);
    expect(peer.currentRecoveryAttempts).toBe(3);

    // Attempt 3 delay is Math.min(2000 * 2^2, 6000) = 6000ms
    await vi.advanceTimersByTimeAsync(6000);
    expect(mockPc.restartIce).toHaveBeenCalledTimes(3);

    // Negotiation window (4000ms) expires with attempts exhausted (>= 3)
    const onDisconnectedSpy = vi.fn();
    peer.onDisconnected = onDisconnectedSpy;

    await vi.advanceTimersByTimeAsync(4000);
    expect(onDisconnectedSpy).toHaveBeenCalledTimes(1);
    expect(peer.linkState).toBe('failed');
  });

  it('checks signaling client readiness before executing ICE restart', async () => {
    mockSignaling.isOpen.mockReturnValue(false);
    const peer = new PeerConnection('peer_test', true, { signalingClient: mockSignaling });
    (peer.reliableChannel as any)?.onopen?.();

    mockPc.iceConnectionState = 'failed';
    mockPc.connectionState = 'failed';
    mockPc.oniceconnectionstatechange();

    // Advance attempt 1 delay
    await vi.advanceTimersByTimeAsync(2000);

    // Should NOT restart ICE because signaling is down; must call signalingClient.reconnect()
    expect(mockPc.restartIce).not.toHaveBeenCalled();
    expect(mockSignaling.reconnect).toHaveBeenCalledTimes(1);
  });
});
