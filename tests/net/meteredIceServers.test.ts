import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getProvisionedIceServers,
  getRuntimeIceServers,
  setupSignalingServer
} from '../../src/server/signalingServer';
import {
  setDynamicIceServers,
  getIceServers,
  PeerConnection
} from '../../src/net/transport/PeerConnection';
import { SignalingClient } from '../../src/net/signaling/SignalingClient';
import { WebSocketServer } from 'ws';

describe('Metered TURN Provisioning & Signaling Dispatch', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    setDynamicIceServers(null);
    delete process.env.TURN_URL;
    delete process.env.TURN_USERNAME;
    delete process.env.TURN_CREDENTIAL;
    delete process.env.VITE_TURN_URL;
    delete process.env.VITE_TURN_USERNAME;
    delete process.env.VITE_TURN_CREDENTIAL;
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    setDynamicIceServers(null);
    vi.restoreAllMocks();
  });

  describe('getProvisionedIceServers', () => {
    it('returns default STUN servers and logs warning when no TURN env vars are configured', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const servers = getProvisionedIceServers();

      expect(servers).toHaveLength(1);
      expect(servers[0].urls).toEqual([
        'stun:stun.l.google.com:19302',
        'stun:stun1.l.google.com:19302'
      ]);
      expect(warnSpy).toHaveBeenCalledWith('[SignalingServer] AVISO: No hay variables TURN configuradas en el entorno.');
    });

    it('provisions Metered TURN servers from TURN_* environment variables', () => {
      process.env.TURN_URL = 'turn:relay.metered.ca:80,turn:relay.metered.ca:443';
      process.env.TURN_USERNAME = 'metered_user';
      process.env.TURN_CREDENTIAL = 'metered_pass';

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const servers = getProvisionedIceServers();

      expect(servers).toHaveLength(2);
      expect(servers[0].urls).toEqual([
        'stun:stun.l.google.com:19302',
        'stun:stun1.l.google.com:19302'
      ]);
      expect(servers[1].urls).toEqual([
        'turn:relay.metered.ca:80',
        'turn:relay.metered.ca:443'
      ]);
      expect(servers[1].username).toBe('metered_user');
      expect(servers[1].credential).toBe('metered_pass');
      expect(logSpy).toHaveBeenCalledWith('[SignalingServer] Servidor TURN de Metered.ca configurado y activo.');
    });

    it('provisions Metered TURN servers from VITE_TURN_* fallback environment variables', () => {
      process.env.VITE_TURN_URL = 'turn:relay.metered.ca:80';
      process.env.VITE_TURN_USERNAME = 'vite_metered_user';
      process.env.VITE_TURN_CREDENTIAL = 'vite_metered_pass';

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const servers = getProvisionedIceServers();

      expect(servers).toHaveLength(2);
      expect(servers[1].urls).toEqual(['turn:relay.metered.ca:80']);
      expect(servers[1].username).toBe('vite_metered_user');
      expect(servers[1].credential).toBe('vite_metered_pass');
      expect(logSpy).toHaveBeenCalledWith('[SignalingServer] Servidor TURN de Metered.ca configurado y activo.');
    });

    it('getRuntimeIceServers acts as an alias to getProvisionedIceServers', () => {
      expect(getRuntimeIceServers).toBe(getProvisionedIceServers);
    });
  });

  describe('SignalingServer emission of ice_config', () => {
    it('emits ice_config message on client connection without external HTTP fetch', () => {
      process.env.TURN_URL = 'turn:relay.metered.ca:80';
      process.env.TURN_USERNAME = 'user_direct';
      process.env.TURN_CREDENTIAL = 'pass_direct';

      const mockWss = {
        clients: new Set(),
        on: vi.fn(),
        close: vi.fn()
      } as unknown as WebSocketServer;

      setupSignalingServer(mockWss);

      const connectionHandler = (mockWss.on as any).mock.calls.find((c: any) => c[0] === 'connection')?.[1];
      expect(connectionHandler).toBeDefined();

      const sentMessages: string[] = [];
      const mockWs = {
        readyState: 1, // OPEN
        send: vi.fn((data: string) => sentMessages.push(data)),
        on: vi.fn()
      };

      connectionHandler(mockWs);

      expect(mockWs.send).toHaveBeenCalled();
      const iceConfigMsg = JSON.parse(sentMessages[0]);
      expect(iceConfigMsg.type).toBe('ice_config');
      expect(iceConfigMsg.iceServers).toEqual(getProvisionedIceServers());
    });
  });

  describe('SignalingClient & PeerConnection Dynamic ICE Application', () => {
    it('SignalingClient invokes setDynamicIceServers and logs received iceServers on ice_config message', async () => {
      let mockSocketInstance: any = null;
      class MockWebSocket {
        static OPEN = 1;
        public onmessage: ((event: any) => void) | null = null;
        public onopen: (() => void) | null = null;
        public onclose: (() => void) | null = null;
        public onerror: ((err: any) => void) | null = null;
        public readyState = 1;
        public send = vi.fn();
        public close = vi.fn();
        constructor() {
          mockSocketInstance = this;
        }
      }
      vi.stubGlobal('WebSocket', MockWebSocket);

      const client = new SignalingClient('ws://localhost:9999');
      const connectPromise = client.connect();
      mockSocketInstance.onopen();
      await connectPromise;

      const testServers = [
        { urls: 'turn:relay.metered.ca:80', username: 'client_user', credential: 'client_pass' }
      ];

      const consoleSpy = vi.spyOn(console, 'log');
      mockSocketInstance.onmessage({
        data: JSON.stringify({
          type: 'ice_config',
          iceServers: testServers
        })
      });

      expect(consoleSpy).toHaveBeenCalledWith('[WebRTC] Servidores ICE actualizados desde señalización:', testServers);
      expect(getIceServers()).toEqual(testServers);
      expect(consoleSpy).toHaveBeenCalledWith('[WebRTC] Credenciales TURN activadas desde Metered.ca API.');
    });

    it('SignalingClient iceConfigReady resolves upon receiving ice_config and unblocks createRoom/joinRoom', async () => {
      let mockSocketInstance: any = null;
      class MockWebSocket {
        static OPEN = 1;
        public onmessage: ((event: any) => void) | null = null;
        public onopen: (() => void) | null = null;
        public onclose: (() => void) | null = null;
        public onerror: ((err: any) => void) | null = null;
        public readyState = 1;
        public send = vi.fn();
        public close = vi.fn();
        constructor() {
          mockSocketInstance = this;
        }
      }
      vi.stubGlobal('WebSocket', MockWebSocket);

      const client = new SignalingClient('ws://localhost:9999');
      const connectPromise = client.connect();
      mockSocketInstance.onopen();
      await connectPromise;

      let isReadyFired = false;
      client.iceConfigReady.then(() => {
        isReadyFired = true;
      });

      expect(isReadyFired).toBe(false);

      // Emitir ice_config
      mockSocketInstance.onmessage({
        data: JSON.stringify({
          type: 'ice_config',
          iceServers: [{ urls: 'turn:relay.metered.ca:80', username: 'u', credential: 'p' }]
        })
      });

      await client.iceConfigReady;
      expect(isReadyFired).toBe(true);
      expect(client.isIceReady).toBe(true);

      // createRoom y joinRoom envían mensajes después de que iceConfigReady está resuelto
      await client.createRoom('Mi Sala');
      expect(mockSocketInstance.send).toHaveBeenCalled();
    });

    it('getIceServers strictly returns default STUN when dynamicIceServers is null, ignoring static TURN env', () => {
      setDynamicIceServers(null);
      const servers = getIceServers();
      expect(servers).toHaveLength(1);
      expect(servers[0].urls).toEqual([
        'stun:stun.l.google.com:19302',
        'stun:stun1.l.google.com:19302'
      ]);
    });

    it('setDynamicIceServers does not print Metered log if URLs do not contain relay.metered.ca', () => {
      const nonMeteredServers = [
        { urls: 'turn:other-relay.company.com:3478', username: 'u', credential: 'p' }
      ];

      const consoleSpy = vi.spyOn(console, 'log');
      setDynamicIceServers(nonMeteredServers);

      expect(consoleSpy).not.toHaveBeenCalledWith('[WebRTC] Credenciales TURN activadas desde Metered.ca API.');
      expect(getIceServers()).toEqual(nonMeteredServers);
    });

    it('PeerConnection constructor logs Metered activation when servers contain relay.metered.ca', () => {
      const mockPc = {
        createDataChannel: vi.fn(() => ({ readyState: 'open', close: vi.fn() })),
        close: vi.fn()
      };
      vi.stubGlobal('RTCPeerConnection', vi.fn(() => mockPc));

      const consoleSpy = vi.spyOn(console, 'log');
      const mockServers = [
        { urls: 'turn:relay.metered.ca:80', username: 'direct_user', credential: 'direct_pass' }
      ];
      const peer = new PeerConnection('peer_direct', true, { iceServers: mockServers });
      expect(peer).toBeDefined();
      expect(consoleSpy).toHaveBeenCalledWith('[WebRTC] Credenciales TURN activadas desde Metered.ca API.');
    });
  });
});
