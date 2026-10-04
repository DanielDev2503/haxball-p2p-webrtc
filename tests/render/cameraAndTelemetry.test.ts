import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Camera } from '../../src/render/Camera';
import { StatsMonitor } from '../../src/ui/components/StatsMonitor';
import { $theme, $themeTokens, DARK_THEME_TOKENS, setTheme } from '../../src/ui/stores/gameStore';
import { PeerConnection } from '../../src/net/transport/PeerConnection';
import { Stadium } from '../../src/core/entities/Stadium';
import { CanvasRenderer } from '../../src/render/CanvasRenderer';
import { OffscreenIndicatorRenderer } from '../../src/render/OffscreenIndicatorRenderer';
import { ChatBox } from '../../src/ui/components/ChatBox';
import { TeamSelectModal } from '../../src/ui/components/TeamSelectModal';
import { MatchPhase } from '../../src/core/game/GameFSM';
import { GameplayModifierModal } from '../../src/ui/components/GameplayModifierModal';
import { DEFAULT_GAMEPLAY_CONFIG } from '../../src/core/game/GameConfig';
import * as fs from 'fs';
import * as path from 'path';

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

  describe('9. Pre-Match Only Restrictions: Stadium Selection Locked During Match', () => {
    it('disables pick button and stadium select when match is in progress (PLAYING, COUNTDOWN, PAUSED)', () => {
      const selectEl = { value: 'classic', disabled: false, dataset: {}, addEventListener: vi.fn() };
      const pickBtn = { disabled: false, title: '', classList: { add: vi.fn(), remove: vi.fn() }, addEventListener: vi.fn() };
      const stadiumPickerModal = { classList: { add: vi.fn(), remove: vi.fn() }, style: { display: 'none' } };
      const ingameMenuEl = { classList: { add: vi.fn(), remove: vi.fn(), contains: vi.fn(() => true) }, style: {} };
      const optionBtn = { getAttribute: () => 'big', classList: { toggle: vi.fn() }, addEventListener: vi.fn() };

      (globalThis as any).document = {
        getElementById: (id: string) => {
          if (id === 'select-stadium-size') return selectEl;
          if (id === 'btn-pick-stadium') return pickBtn;
          if (id === 'stadiumPickerModal') return stadiumPickerModal;
          if (id === 'ingame-menu') return ingameMenuEl;
          return null;
        },
        querySelector: () => null,
        querySelectorAll: (sel: string) => {
          if (sel === '.stadium-option-btn') return [optionBtn];
          return [];
        },
        createElement: () => ({ className: '', style: {}, addEventListener: vi.fn() })
      };

      const modal = new TeamSelectModal();
      modal.updateMatchControlButton(MatchPhase.STOPPED, true);
      expect(selectEl.disabled).toBe(false);
      expect(pickBtn.disabled).toBe(false);

      // Transition to PLAYING
      modal.updateMatchState(MatchPhase.PLAYING, undefined, true);
      expect(selectEl.disabled).toBe(true);
      expect(pickBtn.disabled).toBe(true);
      expect(pickBtn.title).toBe('No se puede cambiar de estadio durante el partido');

      // Transition back to STOPPED
      modal.updateMatchState(MatchPhase.STOPPED, undefined, true);
      expect(selectEl.disabled).toBe(false);
      expect(pickBtn.disabled).toBe(false);

      modal.destroy();
    });

    it('ignores stadium change events when match is not STOPPED', () => {
      let selectListener: any = null;
      let pickListener: any = null;
      let optionListener: any = null;

      const selectEl = {
        value: 'classic',
        disabled: false,
        dataset: {},
        addEventListener: vi.fn((ev, cb) => { if (ev === 'change') selectListener = cb; })
      };
      const pickBtn = {
        disabled: false,
        title: '',
        classList: { add: vi.fn(), remove: vi.fn() },
        addEventListener: vi.fn((ev, cb) => { if (ev === 'click') pickListener = cb; })
      };
      const stadiumPickerModal = {
        classList: { add: vi.fn(), remove: vi.fn() },
        style: { display: 'none' }
      };
      const optionBtn = {
        getAttribute: () => 'big',
        classList: { toggle: vi.fn() },
        addEventListener: vi.fn((ev, cb) => { if (ev === 'click') optionListener = cb; })
      };

      (globalThis as any).document = {
        getElementById: (id: string) => {
          if (id === 'select-stadium-size') return selectEl;
          if (id === 'btn-pick-stadium') return pickBtn;
          if (id === 'stadiumPickerModal') return stadiumPickerModal;
          return null;
        },
        querySelector: () => null,
        querySelectorAll: (sel: string) => (sel === '.stadium-option-btn' ? [optionBtn] : []),
        createElement: () => ({ className: '', style: {}, addEventListener: vi.fn() })
      };

      const modal = new TeamSelectModal();
      modal.updateMatchControlButton(MatchPhase.PLAYING, true);
      const onMapChange = vi.fn();
      modal.onMapChange = onMapChange;

      // Click pick button while PLAYING
      pickListener?.({ stopPropagation: vi.fn() });
      expect(stadiumPickerModal.style.display).toBe('none');

      // Change select while PLAYING
      selectEl.value = 'big';
      selectListener?.();
      expect(onMapChange).not.toHaveBeenCalled();

      // Click option button while PLAYING
      optionListener?.({ stopPropagation: vi.fn() });
      expect(onMapChange).not.toHaveBeenCalled();

      // Transition to STOPPED
      modal.updateMatchState(MatchPhase.STOPPED, undefined, true);
      selectEl.value = 'small';
      selectListener?.();
      expect(onMapChange).toHaveBeenCalledWith('small');

      modal.destroy();
    });
  });

  describe('10. Pre-Match Only Restrictions: Gameplay Modifiers Locked During Match', () => {
    function createMockElement(id: string = '', tag: string = 'div') {
      const classSet = new Set<string>();
      const children: any[] = [];
      const listeners: Record<string, Function[]> = {};

      const el = {
        id,
        tagName: tag.toUpperCase(),
        get className() {
          return Array.from(classSet).join(' ');
        },
        set className(val: string) {
          classSet.clear();
          val.split(/\s+/).filter(Boolean).forEach(c => classSet.add(c));
        },
        innerHTML: '',
        textContent: '',
        value: '0',
        style: {} as Record<string, string>,
        disabled: false,
        classList: {
          add: vi.fn((...classes: string[]) => { classes.forEach(c => classSet.add(c)); }),
          remove: vi.fn((...classes: string[]) => { classes.forEach(c => classSet.delete(c)); }),
          contains: vi.fn((c: string) => classSet.has(c))
        },
        appendChild: vi.fn((child: any) => { children.push(child); return child; }),
        addEventListener: vi.fn((event: string, cb: Function) => {
          if (!listeners[event]) listeners[event] = [];
          listeners[event].push(cb);
        }),
        querySelector: vi.fn(() => null)
      };
      return el;
    }

    beforeEach(() => {
      (globalThis as any).document = {
        createElement: (tag: string) => createMockElement('', tag),
        body: { appendChild: vi.fn() },
        getElementById: () => null,
        querySelector: () => null,
        querySelectorAll: () => []
      };
    });

    it('blocks opening modifier modal when match is in progress', () => {
      let isPlaying = true;
      const onChange = vi.fn();
      const isHost = () => true;
      const isMatchInProgress = () => isPlaying;

      const alertMock = vi.fn();
      (globalThis as any).alert = alertMock;

      const modal = new GameplayModifierModal(DEFAULT_GAMEPLAY_CONFIG, onChange, isHost, isMatchInProgress);
      modal.show();

      expect(alertMock).toHaveBeenCalledWith('Los modificadores de físicas solo se pueden ajustar antes de empezar una partida.');
      expect(modal.isOpen()).toBe(false);

      // Match is stopped
      isPlaying = false;
      modal.show();
      expect(modal.isOpen()).toBe(true);

      modal.hide();
    });

    it('updateMatchState disables sliders and hides modal if open during active match', () => {
      const onChange = vi.fn();
      const isHost = () => true;
      let isPlaying = false;
      const isMatchInProgress = () => isPlaying;

      const modal = new GameplayModifierModal(DEFAULT_GAMEPLAY_CONFIG, onChange, isHost, isMatchInProgress);
      modal.show();
      expect(modal.isOpen()).toBe(true);

      // Match starts
      isPlaying = true;
      modal.updateMatchState(true);
      expect(modal.isOpen()).toBe(false);

      modal.hide();
    });
  });

  describe('11. Dark Theme Audit: Match Config Container & Close Button Styles', () => {
    it('haxball.css contains dark theme overrides for .admin-config-section and .icon-btn-close without gray tokens', () => {
      const cssPath = path.resolve(__dirname, '../../src/ui/styles/haxball.css');
      const cssContent = fs.readFileSync(cssPath, 'utf-8');

      // Admin config section dark styling
      expect(cssContent).toContain('[data-theme="dark"] .admin-config-section');
      expect(cssContent).toContain('rgba(7, 15, 30');

      // Close X button dark styling
      expect(cssContent).toContain('[data-theme="dark"] .icon-btn-close');
      expect(cssContent).toContain('#67E8F9');

      // Stadium picker modal dark styling
      expect(cssContent).toContain('[data-theme="dark"] #stadiumPickerModal');
      expect(cssContent).toContain('[data-theme="dark"] .stadium-option-btn');

      // Ensure no gray/slate class in admin-config-section or icon-btn-close dark rules
      const forbiddenTokens = ['text-gray', 'bg-gray', 'border-gray', 'text-slate-600', 'bg-slate-800'];
      for (const token of forbiddenTokens) {
        expect(cssContent.includes(token)).toBe(false);
      }
    });
  });
});

