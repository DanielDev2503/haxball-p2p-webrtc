import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  fetchMeteredIceServers,
  resetCachedIceServers,
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

describe('Metered.ca REST API Integration & Dynamic ICE Caching', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetCachedIceServers();
    setDynamicIceServers(null);
    delete process.env.METERED_DOMAIN;
    delete process.env.METERED_API_KEY;
    delete process.env.VITE_TURN_URL;
    delete process.env.VITE_TURN_USERNAME;
    delete process.env.VITE_TURN_CREDENTIAL;
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetCachedIceServers();
    setDynamicIceServers(null);
    vi.restoreAllMocks();
  });

  describe('fetchMeteredIceServers', () => {
    it('falls back to default STUN servers when Metered env vars are not set', async () => {
      const servers = await fetchMeteredIceServers();
      expect(servers).toBeDefined();
      expect(servers.length).toBeGreaterThanOrEqual(1);
      const urls = Array.isArray(servers[0].urls) ? servers[0].urls : [servers[0].urls];
      expect(urls).toContain('stun:stun.l.google.com:19302');
    });

    it('fetches credentials from Metered.ca REST API and sanitizes domain', async () => {
      // Probar que sanitiza prefijo https:// y barra diagonal final
      process.env.METERED_DOMAIN = 'https://ballhax.metered.ca/';
      process.env.METERED_API_KEY = 'secret-api-key-123';

      const mockMeteredResponse = [
        { urls: 'stun:relay.metered.ca:80' },
        { urls: 'turn:relay.metered.ca:80', username: 'temp_user_1', credential: 'temp_pass_1' },
        { urls: 'turn:relay.metered.ca:443', username: 'temp_user_1', credential: 'temp_pass_1' }
      ];

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockMeteredResponse
      });
      globalThis.fetch = fetchMock;

      const logSpy = vi.spyOn(console, 'log');

      const servers = await fetchMeteredIceServers();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith('https://ballhax.metered.ca/api/v1/turn/credentials?apiKey=secret-api-key-123', expect.any(Object));
      expect(logSpy).toHaveBeenCalledWith('[Metered] Solicitando credenciales ICE a Metered.ca...');
      expect(logSpy).toHaveBeenCalledWith('[Metered] 3 servidores ICE recibidos de Metered.ca.');
      expect(servers).toEqual(mockMeteredResponse);
    });

    it('caches credentials in-memory for up to 12 hours without repeating REST requests', async () => {
      process.env.METERED_DOMAIN = 'ballhax.metered.ca';
      process.env.METERED_API_KEY = 'secret-api-key-123';

      const mockMeteredResponse = [
        { urls: 'stun:relay.metered.ca:80' },
        { urls: 'turn:relay.metered.ca:80', username: 'cached_user', credential: 'cached_pass' }
      ];

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockMeteredResponse
      });
      globalThis.fetch = fetchMock;

      // Primera llamada: consulta la API
      const firstResult = await fetchMeteredIceServers();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(firstResult).toEqual(mockMeteredResponse);

      // Segunda llamada inmediata: debe servirse desde la caché
      const secondResult = await fetchMeteredIceServers();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(secondResult).toEqual(mockMeteredResponse);

      // Tercera llamada tras 11 horas: debe seguir usando la caché
      const elevenHoursMs = 11 * 60 * 60 * 1000;
      const originalNow = Date.now;
      vi.spyOn(Date, 'now').mockReturnValue(originalNow() + elevenHoursMs);

      const thirdResult = await fetchMeteredIceServers();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(thirdResult).toEqual(mockMeteredResponse);
    });

    it('refetches from API when cache expires after 12 hours', async () => {
      process.env.METERED_DOMAIN = 'ballhax.metered.ca';
      process.env.METERED_API_KEY = 'secret-api-key-123';

      const mockResponse1 = [
        { urls: 'turn:relay.metered.ca:80', username: 'user_batch1', credential: 'pass_batch1' }
      ];
      const mockResponse2 = [
        { urls: 'turn:relay.metered.ca:80', username: 'user_batch2', credential: 'pass_batch2' }
      ];

      const fetchMock = vi.fn()
        .mockResolvedValueOnce({ ok: true, json: async () => mockResponse1 })
        .mockResolvedValueOnce({ ok: true, json: async () => mockResponse2 });
      globalThis.fetch = fetchMock;

      const initialTime = 1_700_000_000_000;
      vi.spyOn(Date, 'now').mockReturnValue(initialTime);

      const result1 = await fetchMeteredIceServers();
      expect(result1).toEqual(mockResponse1);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Avanzamos 12 horas y 1 segundo: caché expirada
      const twelveHoursOneSec = (12 * 60 * 60 + 1) * 1000;
      vi.spyOn(Date, 'now').mockReturnValue(initialTime + twelveHoursOneSec);

      const result2 = await fetchMeteredIceServers();
      expect(result2).toEqual(mockResponse2);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('warns and verifies contingency static credentials when domain or apiKey is missing', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const servers = await fetchMeteredIceServers();
      expect(warnSpy).toHaveBeenCalledWith('[Metered] Variables de API no encontradas. Verificando credenciales estáticas de contingencia...');
      expect(servers).toBeDefined();
    });

    it('falls back to public STUN servers when fetch fails with network error', async () => {
      process.env.METERED_DOMAIN = 'ballhax.metered.ca';
      process.env.METERED_API_KEY = 'invalid-key';

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network connection refused'));

      const servers = await fetchMeteredIceServers();
      expect(servers).toBeDefined();
      const urls = Array.isArray(servers[0].urls) ? servers[0].urls : [servers[0].urls];
      expect(urls).toContain('stun:stun.l.google.com:19302');
      expect(errorSpy).toHaveBeenCalled();
    });

    it('falls back to public STUN servers when API returns non-200 HTTP status', async () => {
      process.env.METERED_DOMAIN = 'ballhax.metered.ca';
      process.env.METERED_API_KEY = 'invalid-key';

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: async () => 'Invalid credentials'
      });

      const servers = await fetchMeteredIceServers();
      expect(servers).toBeDefined();
      const urls = Array.isArray(servers[0].urls) ? servers[0].urls : [servers[0].urls];
      expect(urls).toContain('stun:stun.l.google.com:19302');
      expect(errorSpy).toHaveBeenCalledWith('[Metered] Error de API: Status 401 - Invalid credentials');
    });

    it('falls back to public STUN servers when API returns invalid format', async () => {
      process.env.METERED_DOMAIN = 'ballhax.metered.ca';
      process.env.METERED_API_KEY = 'key';

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ error: 'Invalid plan' }) // no es array
      });

      const servers = await fetchMeteredIceServers();
      expect(servers).toBeDefined();
      const urls = Array.isArray(servers[0].urls) ? servers[0].urls : [servers[0].urls];
      expect(urls).toContain('stun:stun.l.google.com:19302');
      expect(errorSpy).toHaveBeenCalled();
    });
  });

  describe('SignalingServer emission of ice_config', () => {
    it('emits ice_config message on client connection', async () => {
      process.env.METERED_DOMAIN = 'test.metered.ca';
      process.env.METERED_API_KEY = 'test_key';

      const mockServers = [
        { urls: 'stun:relay.metered.ca:80' },
        { urls: 'turn:relay.metered.ca:80', username: 'u', credential: 'p' }
      ];
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockServers
      });

      const mockWss = {
        clients: new Set(),
        on: vi.fn(),
        close: vi.fn()
      } as unknown as WebSocketServer;

      setupSignalingServer(mockWss);

      // Obtener el handler de conexión registrado
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

  describe('SignalingClient & PeerConnection Dynamic ICE Application', () => {
    it('SignalingClient invokes setDynamicIceServers on ice_config message with data.iceServers', async () => {
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

    it('getRuntimeIceServers includes static contingency TURN servers when credentials exist', () => {
      process.env.VITE_TURN_USERNAME = 'contingency_user';
      process.env.VITE_TURN_CREDENTIAL = 'contingency_pass';

      const servers = getRuntimeIceServers();
      expect(servers).toHaveLength(2);
      expect(servers[0].urls).toEqual([
        'stun:stun.l.google.com:19302',
        'stun:stun1.l.google.com:19302'
      ]);
      expect(servers[1].username).toBe('contingency_user');
      expect(servers[1].credential).toBe('contingency_pass');
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
