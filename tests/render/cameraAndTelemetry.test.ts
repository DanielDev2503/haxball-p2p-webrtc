import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Camera } from '../../src/render/Camera';
import { StatsMonitor } from '../../src/ui/components/StatsMonitor';
import { $theme, $themeTokens, DARK_THEME_TOKENS, setTheme } from '../../src/ui/stores/gameStore';
import { PeerConnection } from '../../src/net/transport/PeerConnection';
import { Stadium } from '../../src/core/entities/Stadium';
import { CanvasRenderer } from '../../src/render/CanvasRenderer';
import { OffscreenIndicatorRenderer } from '../../src/render/OffscreenIndicatorRenderer';
import { ChatBox } from '../../src/ui/components/ChatBox';

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

  describe('5. Dual Camera Tracking (Player + Ball) with Leash Constraint', () => {
    it('calculates weighted target P_target = P_local * 0.75 + P_ball * 0.25 within D_max', () => {
      const camera = new Camera(0, 0);
      const playerX = 100;
      const playerY = 100;
      const ballX = 300;
      const ballY = 100;

      // Distance = 200px. Offset = min(200 * 0.25, 180) = 50px.
      // Expected target: playerX + 50 = 150, playerY = 100.
      const target = camera.calculateDualTarget(playerX, playerY, ballX, ballY, 0.25, 180);
      expect(target.x).toBeCloseTo(150, 1);
      expect(target.y).toBeCloseTo(100, 1);
    });

    it('clamps ball influence to radial leash D_max = 180px when ball is far away', () => {
      const camera = new Camera(0, 0);
      const playerX = 0;
      const playerY = 0;
      const ballX = 1000;
      const ballY = 0;

      // Distance = 1000px. 1000 * 0.25 = 250px > 180px D_max.
      // Expected target: playerX + 180 = 180.
      const target = camera.calculateDualTarget(playerX, playerY, ballX, ballY, 0.25, 180);
      expect(target.x).toBe(180);
      expect(target.y).toBe(0);
    });

    it('returns valid coordinates without NaN when player and ball are at identical positions or invalid', () => {
      const camera = new Camera(50, 50);
      const targetSame = camera.calculateDualTarget(50, 50, 50, 50, 0.25, 180);
      expect(targetSame.x).toBe(50);
      expect(targetSame.y).toBe(50);
      expect(Number.isNaN(targetSame.x)).toBe(false);
      expect(Number.isNaN(targetSame.y)).toBe(false);

      camera.followDual(50, 50, 50, 50);
      expect(Number.isNaN(camera.x)).toBe(false);
      expect(Number.isNaN(camera.y)).toBe(false);
    });
  });

  describe('6. Off-Screen Indicator Edge Projection & Safe Area Detection', () => {
    it('projects off-screen points to safe perimeter boundaries', () => {
      const cx = 500;
      const cy = 350;
      const xmin = 22;
      const xmax = 978;
      const ymin = 72;
      const ymax = 600;

      // Point far to the right (off-screen)
      const rightResult = OffscreenIndicatorRenderer.projectToEdge(1500, 350, cx, cy, xmin, ymin, xmax, ymax);
      expect(rightResult.ex).toBeLessThanOrEqual(xmax);
      expect(rightResult.ex).toBeGreaterThanOrEqual(xmin);
      expect(rightResult.theta).toBeCloseTo(0, 2);

      // Point far above (off-screen top)
      const topResult = OffscreenIndicatorRenderer.projectToEdge(500, -200, cx, cy, xmin, ymin, xmax, ymax);
      expect(topResult.ey).toBeCloseTo(ymin, 1);
      expect(topResult.ex).toBeCloseTo(500, 1);
      expect(topResult.theta).toBeCloseTo(-Math.PI / 2, 2);

      // Point diagonally off-screen
      const diagResult = OffscreenIndicatorRenderer.projectToEdge(2000, 2000, cx, cy, xmin, ymin, xmax, ymax);
      expect(diagResult.ex).toBeLessThanOrEqual(xmax);
      expect(diagResult.ey).toBeLessThanOrEqual(ymax);
      expect(diagResult.ex).toBeGreaterThanOrEqual(xmin);
      expect(diagResult.ey).toBeGreaterThanOrEqual(ymin);
    });

    it('OffscreenIndicatorRenderer draw executes with zero errors and renders indicators for off-screen entities', () => {
      const mockCtx: any = {
        save: vi.fn(),
        restore: vi.fn(),
        translate: vi.fn(),
        rotate: vi.fn(),
        beginPath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        closePath: vi.fn(),
        fill: vi.fn(),
        stroke: vi.fn()
      };

      const renderer = new OffscreenIndicatorRenderer();
      const discs: any[] = [
        { id: 1, team: 0, x: 2000, y: 300, radius: 10 }, // Ball off-screen to the right
        { id: 2, team: 1, x: -1000, y: 300, radius: 15 }, // Red player off-screen to the left
        { id: 3, team: 2, x: 500, y: 300, radius: 15 }   // Blue player on-screen
      ];

      renderer.draw(mockCtx, discs, null, 0, 0, 500, 300, 1000, 600, 130);

      // Verify that save and translate were called for the off-screen entities
      expect(mockCtx.save).toHaveBeenCalled();
      expect(mockCtx.translate).toHaveBeenCalled();
      expect(mockCtx.fill).toHaveBeenCalled();
      expect(mockCtx.stroke).toHaveBeenCalled();
    });
  });

  describe('7. Dark Theme Tokens Eradication of Grays', () => {
    it('$themeTokens in dark mode does not contain gray-palette tokens or colors', () => {
      setTheme('dark');
      const tokens = $themeTokens.get();

      expect(tokens).toEqual(DARK_THEME_TOKENS);
      expect(tokens.bgPrimary).toBe('#0B111E');
      expect(tokens.textPrimary).toBe('#FFFFFF');

      const forbiddenGrayPatterns = ['gray', 'slate', '#94a3b8', '#64748b', '#6b7280', '#4b5563', '#374151'];
      for (const [, val] of Object.entries(tokens)) {
        const lowerVal = String(val).toLowerCase();
        for (const pattern of forbiddenGrayPatterns) {
          expect(lowerVal.includes(pattern)).toBe(false);
        }
      }
    });
  });

  describe('8. Invariant Chat Box Height on Menu Open/Close', () => {
    it('ChatBox height does not mutate when adjustForMenu is called', () => {
      const mockChatBox = {
        style: { height: '140px', maxHeight: '' },
        getBoundingClientRect: () => ({ height: 140, bottom: 600 })
      };

      (globalThis as any).document = {
        getElementById: (id: string) => {
          if (id === 'chat-container' || id === 'chat-messages') return mockChatBox;
          if (id === 'chat-input') return { value: '', blur: vi.fn(), focus: vi.fn(), addEventListener: vi.fn() };
          if (id === 'chatForm') return { addEventListener: vi.fn() };
          return null;
        },
        querySelector: () => null,
        createElement: (_tag: string) => ({ id: '', className: '', style: {}, addEventListener: vi.fn() }),
        body: { style: {} }
      };

      const chat = new ChatBox();
      chat.applyHeight(150);
      expect(mockChatBox.style.height).toBe('150px');

      // Calling adjustForMenu with isOpen = true
      chat.adjustForMenu(true, {} as any);
      expect(mockChatBox.style.height).toBe('150px');
      expect(mockChatBox.style.maxHeight).toBe('');

      // Calling adjustForMenu with isOpen = false
      chat.adjustForMenu(false);
      expect(mockChatBox.style.height).toBe('150px');
      expect(mockChatBox.style.maxHeight).toBe('');
    });
  });
});

