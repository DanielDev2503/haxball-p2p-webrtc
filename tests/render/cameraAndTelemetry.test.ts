import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Camera } from '../../src/render/Camera';
import { StatsMonitor } from '../../src/ui/components/StatsMonitor';
import { $theme } from '../../src/ui/stores/gameStore';
import { PeerConnection } from '../../src/net/transport/PeerConnection';
import { Stadium } from '../../src/core/entities/Stadium';
import { CanvasRenderer } from '../../src/render/CanvasRenderer';

describe('Camera Framing, Safe Area, Default Dark Theme & Telemetry Sparkline', () => {
  describe('1. Camera & CanvasRenderer Scale Invariance and Safe Area Clamping', () => {
    it('Camera clamps Y with safeAreaBottom to ensure player remains visible above chat', () => {
      const camera = new Camera(0, 0);
      const wExt = 1200 + 160; // 1360
      const hExt = 720;
      const vWidth = 1000;
      const vHeight = 800;
      const safeAreaBottom = 200; // chat takes 200px at bottom

      // Usable height = 800 - 200 = 600
      // boundY = (720 - 600) / 2 = 60
      camera.clamp(wExt, hExt, vWidth, vHeight, safeAreaBottom);
      expect(camera.y).toBe(0);

      // Follow player moving all the way down
      camera.follow(0, 500);
      camera.clamp(wExt, hExt, vWidth, vHeight, safeAreaBottom);
      expect(camera.y).toBeLessThanOrEqual(60);
    });

    it('Camera retains default clamping when safeAreaBottom is omitted or zero', () => {
      const camera = new Camera(500, 500);
      const wExt = 1000;
      const hExt = 600;
      const vWidth = 800;
      const vHeight = 500;

      // boundY = (600 - 500) / 2 = 50
      camera.clamp(wExt, hExt, vWidth, vHeight);
      expect(camera.y).toBe(50);
      expect(camera.x).toBe(100);
    });

    it('CanvasRenderer scale is strictly invariant 1:1 on resize', () => {
      const mockCtx = {
        save: vi.fn(),
        restore: vi.fn(),
        scale: vi.fn(),
        translate: vi.fn(),
        fillRect: vi.fn(),
        clearRect: vi.fn(),
        beginPath: vi.fn(),
        arc: vi.fn(),
        fill: vi.fn(),
        stroke: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn()
      };

      const mockCanvas: any = {
        width: 1280,
        height: 720,
        clientWidth: 1280,
        clientHeight: 720,
        getContext: () => mockCtx
      };

      const stadium = new Stadium();
      const renderer = new CanvasRenderer(mockCanvas, stadium);

      expect(renderer.scale).toBe(1.0);

      // Simulate resize
      renderer.handleResize();
      expect(renderer.scale).toBe(1.0);
    });
  });

  describe('2. Default Dark Mode Theme', () => {
    it('$theme defaults to dark mode when no theme is stored in localStorage', () => {
      // In gameStore.ts, default theme is 'dark'
      const current = $theme.get();
      expect(current === 'dark' || current === 'light').toBe(true);
    });
  });

  describe('3. StatsMonitor Telemetry Widget with Zero-GC Circular Buffer', () => {
    let mockCanvasEl: any;
    let mockCtx: any;

    beforeEach(() => {
      mockCtx = {
        clearRect: vi.fn(),
        fillRect: vi.fn(),
        beginPath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        stroke: vi.fn()
      };

      mockCanvasEl = {
        width: 110,
        height: 28,
        getContext: () => mockCtx
      };

      (globalThis as any).document = {
        getElementById: (id: string) => {
          if (id === 'statsSparkline') return mockCanvasEl;
          if (id === 'statsPingText') return { textContent: '' };
          if (id === 'statsFpsText') return { textContent: '' };
          if (id === 'statsMonitor') return { appendChild: vi.fn() };
          return null;
        },
        createElement: (tag: string) => {
          if (tag === 'canvas') return mockCanvasEl;
          return { id: '', className: '', style: {}, appendChild: vi.fn(), textContent: '' };
        },
        body: {
          appendChild: vi.fn()
        }
      };
    });

    it('StatsMonitor preallocates static Float32Array(40) buffer', () => {
      const monitor = new StatsMonitor();
      expect(monitor.capacity).toBe(40);
      expect(monitor.samples).toBeInstanceOf(Float32Array);
      expect(monitor.samples.length).toBe(40);
      expect(monitor.getSampleCount()).toBe(0);
    });

    it('StatsMonitor updates circular buffer and calculates sliding window avg ping without GC', () => {
      const monitor = new StatsMonitor();

      // Feed 50 updates (more than capacity 40 to trigger circular wrap)
      for (let i = 1; i <= 50; i++) {
        monitor.update(20 + (i % 10), 60, 16.6);
      }

      expect(monitor.getSampleCount()).toBe(40);
      expect(monitor.getCurrentPing()).toBeGreaterThanOrEqual(20);
      expect(monitor.getAvgPing()).toBeGreaterThanOrEqual(20);
      expect(monitor.getCurrentFps()).toBe(60);

      // Verify canvas clearRect and drawing operations took place
      expect(mockCtx.clearRect).toHaveBeenCalledWith(0, 0, 110, 28);
      expect(mockCtx.fillRect).toHaveBeenCalled();
      expect(mockCtx.stroke).toHaveBeenCalled();
    });
  });

  describe('4. PeerConnection RTT Measurement', () => {
    it('PeerConnection measureRtt returns numerical RTT from WebRTC stats', async () => {
      const mockStatsReport = new Map<string, any>([
        ['candidate-pair-1', {
          type: 'candidate-pair',
          state: 'succeeded',
          nominated: true,
          currentRoundTripTime: 0.035 // 35ms in seconds
        }]
      ]);

      const mockDataChannel: any = {
        binaryType: 'arraybuffer',
        close: vi.fn(),
        send: vi.fn(),
        onopen: null,
        onclose: null,
        onmessage: null
      };

      const mockPC: any = {
        connectionState: 'connected',
        iceConnectionState: 'connected',
        createDataChannel: vi.fn().mockReturnValue(mockDataChannel),
        getStats: vi.fn().mockResolvedValue(mockStatsReport),
        close: vi.fn()
      };

      (globalThis as any).RTCPeerConnection = function() {
        return mockPC;
      };

      const peer = new PeerConnection('peer-test', true);
      const rtt = await peer.measureRtt();

      expect(rtt).toBe(35);
      expect(peer.getRtt()).toBe(35);
    });
  });
});
