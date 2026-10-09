import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getMeteredIceServers,
  getProvisionedIceServers,
  getRuntimeIceServers,
  resetCachedIceServers,
  setupSignalingServer
} from '../../src/server/signalingServer';
import {
  setDynamicIceServers,
  getIceServers,
  PeerConnection
} from '../../src/net/transport/PeerConnection';
import { SignalingClient } from '../../src/net/signaling/SignalingClient';
import { WebSocketServer } from 'ws';

describe('Metered.ca Dynamic REST ICE Provisioning & Race Condition Guard', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetCachedIceServers();
    setDynamicIceServers(null);
    delete process.env.METERED_DOMAIN;
    delete process.env.METERED_API_KEY;
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetCachedIceServers();
    setDynamicIceServers(null);
    vi.restoreAllMocks();
  });

  describe('getMeteredIceServers', () => {
    it('returns default STUN servers and warns when credentials are not configured', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const servers = await getMeteredIceServers();

      expect(servers).toEqual([
        { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }
      ]);
      expect(warnSpy).toHaveBeenCalledWith(
        '[SignalingServer] METERED_DOMAIN o METERED_API_KEY no configurados. Usando STUN público.'
      );
    });

    it('sanitizes domain, queries Metered REST API, and caches the result for 12 hours', async () => {
      process.env.METERED_DOMAIN = 'https://subdomain.metered.live///';
      process.env.METERED_API_KEY = ' secret_api_key_123 ';

      const mockResponseServers = [
        { urls: 'stun:subdomain.metered.live:3478' },
        { urls: 'turn:subdomain.metered.live:80', username: 'temp_user', credential: 'temp_password' }
      ];

      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockResponseServers
      });
      vi.stubGlobal('fetch', fetchSpy);

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      // Primera llamada: debe llamar a fetch con dominio sanitizado y query params
      const firstResult = await getMeteredIceServers();
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const calledUrl = fetchSpy.mock.calls[0][0];
      expect(calledUrl).toBe('https://subdomain.metered.live/api/v1/turn/credentials?apiKey=secret_api_key_123');
      expect(firstResult).toEqual(mockResponseServers);
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('2 servidores ICE cacheados exitosamente.')
      );

      // Segunda llamada inmediata: debe servir desde caché en memoria sin volver a llamar fetch
      const secondResult = await getMeteredIceServers();
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(secondResult).toBe(firstResult);
    });

    it('refetches from REST API when cache expires after 12 hours', async () => {
      process.env.METERED_DOMAIN = 'metered-app.metered.live';
      process.env.METERED_API_KEY = 'api_key_expiry';

      const initialServers = [{ urls: 'turn:initial.metered.live:80', username: 'u1', credential: 'p1' }];
      const refreshedServers = [{ urls: 'turn:refreshed.metered.live:80', username: 'u2', credential: 'p2' }];

      let fetchCount = 0;
      const fetchSpy = vi.fn().mockImplementation(async () => {
        fetchCount++;
        return {
          ok: true,
          status: 200,
          json: async () => (fetchCount === 1 ? initialServers : refreshedServers)
        };
      });
      vi.stubGlobal('fetch', fetchSpy);

      const now = 1000000000;
      const dateSpy = vi.spyOn(Date, 'now').mockReturnValue(now);

      const res1 = await getMeteredIceServers();
      expect(res1).toEqual(initialServers);
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      // Avanzamos 12 horas y 1 segundo
      dateSpy.mockReturnValue(now + (12 * 60 * 60 * 1000) + 1000);

      const res2 = await getMeteredIceServers();
      expect(res2).toEqual(refreshedServers);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('falls back to default STUN when REST API returns HTTP error', async () => {
      process.env.METERED_DOMAIN = 'fail.metered.live';
      process.env.METERED_API_KEY = 'invalid_key';

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized'
      }));

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const servers = await getMeteredIceServers();

      expect(servers).toEqual([
        { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }
      ]);
      expect(errorSpy).toHaveBeenCalledWith(
        '[SignalingServer] Error consultando Metered.ca:',
        expect.any(Error)
      );
    });

    it('falls back to default STUN on network timeout or abort', async () => {
      process.env.METERED_DOMAIN = 'timeout.metered.live';
      process.env.METERED_API_KEY = 'key';

      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('AbortError: The operation was aborted')));

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const servers = await getMeteredIceServers();

      expect(servers).toEqual([
        { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }
      ]);
      expect(errorSpy).toHaveBeenCalled();
    });

    it('getProvisionedIceServers and getRuntimeIceServers point to getMeteredIceServers', () => {
      expect(getProvisionedIceServers).toBe(getMeteredIceServers);
      expect(getRuntimeIceServers).toBe(getMeteredIceServers);
    });
  });

  describe('SignalingServer emission of ice_config', () => {
    it('sends ice_config message with cached Metered servers on client connection', async () => {
      process.env.METERED_DOMAIN = 'server.metered.live';
      process.env.METERED_API_KEY = 'server_key';

      const mockServers = [
        { urls: 'stun:server.metered.live:3478' },
        { urls: 'turn:server.metered.live:80', username: 'server_u', credential: 'server_p' }
      ];

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockServers
      }));

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

      await connectionHandler(mockWs);

      expect(mockWs.send).toHaveBeenCalled();
      const iceConfigMsg = JSON.parse(sentMessages[0]);
      expect(iceConfigMsg.type).toBe('ice_config');
      expect(iceConfigMsg.iceServers).toEqual(mockServers);
    });
  });

  describe('SignalingClient & PeerConnection Race Condition Guard', () => {
    it('resolves iceConfigReady Promise and sets dynamic ICE servers on ice_config message', async () => {
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

      // Enviar mensaje ice_config
      mockSocketInstance.onmessage({
        data: JSON.stringify({
          type: 'ice_config',
          iceServers: testServers
        })
      });

      const resolvedServers = await client.iceConfigReady;
      expect(resolvedServers).toEqual(testServers);
      expect(consoleSpy).toHaveBeenCalledWith('[WebRTC] Servidores ICE recibidos de señalización:', testServers);
      expect(getIceServers()).toEqual(testServers);
      expect(consoleSpy).toHaveBeenCalledWith('[WebRTC] Credenciales TURN activadas desde Metered.ca API.');
    });

    it('iceConfigReady blocks until ice_config is received, preventing premature PeerConnection', async () => {
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

      let resolved = false;
      client.iceConfigReady.then(() => {
        resolved = true;
      });

      expect(resolved).toBe(false);

      const testServers = [{ urls: 'turn:relay.metered.ca:80', username: 'u', credential: 'p' }];
      mockSocketInstance.onmessage({
        data: JSON.stringify({
          type: 'ice_config',
          iceServers: testServers
        })
      });

      const servers = await client.iceConfigReady;
      expect(resolved).toBe(true);
      expect(servers).toEqual(testServers);
      expect(client.isIceReady).toBe(true);
    });

    it('getIceServers strictly returns default STUN when dynamicIceServers is not set', () => {
      setDynamicIceServers(null);
      const servers = getIceServers();
      expect(servers).toHaveLength(1);
      expect(servers[0].urls).toEqual([
        'stun:stun.l.google.com:19302',
        'stun:stun1.l.google.com:19302'
      ]);
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
