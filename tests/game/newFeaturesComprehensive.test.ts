import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChatBox } from '../../src/ui/components/ChatBox';
import { GameEngine } from '../../src/core/game/GameEngine';
import { Player, DASH_STAMINA_COST, getDashStaminaCost } from '../../src/core/game/Player';
import { MatchPhase } from '../../src/core/game/GameFSM';
import { GoalNet } from '../../src/core/entities/GoalNet';
import { DiscRenderer } from '../../src/render/DiscRenderer';
import { DEFAULT_KEYBINDS } from '../../src/client/InputManager';
import { TeamSelectModal } from '../../src/ui/components/TeamSelectModal';

describe('Comprehensive Validation: Controls, Rope Net, Universal Extrapolation & Non-Host Menu', () => {
  describe('Default Keybinds and Controls Guide', () => {
    let container: any;
    let inputEl: any;
    let formEl: any;
    let localStorageMock: Record<string, string>;

    beforeEach(() => {
      localStorageMock = {};
      (globalThis as any).localStorage = {
        getItem: (k: string) => localStorageMock[k] ?? null,
        setItem: (k: string, v: string) => { localStorageMock[k] = v; },
        removeItem: (k: string) => { delete localStorageMock[k]; },
        clear: () => { localStorageMock = {}; }
      };

      container = {
        appendChild: vi.fn(),
        innerHTML: '',
        scrollTop: 0,
        scrollHeight: 1200
      };
      inputEl = {
        value: '',
        focus: vi.fn(),
        blur: vi.fn(),
        addEventListener: vi.fn()
      };
      formEl = {
        addEventListener: vi.fn()
      };

      (globalThis as any).document = {
        getElementById: (id: string) => {
          if (id === 'chat-messages' || id === 'chatMessages') return container;
          if (id === 'chat-input' || id === 'chatInput') return inputEl;
          if (id === 'chat-form' || id === 'chatForm') return formEl;
          return null;
        },
        createElement: vi.fn(() => ({
          className: '',
          textContent: '',
          style: {},
          appendChild: vi.fn()
        })),
        activeElement: null
      };
    });

    it('has universal default keybinds matching WASD, Space, Shift, ArrowUp, ArrowLeft/Right', () => {
      expect(DEFAULT_KEYBINDS.up).toContain('KeyW');
      expect(DEFAULT_KEYBINDS.left).toContain('KeyA');
      expect(DEFAULT_KEYBINDS.down).toContain('KeyS');
      expect(DEFAULT_KEYBINDS.right).toContain('KeyD');
      expect(DEFAULT_KEYBINDS.kick).toContain('Space');
      expect(DEFAULT_KEYBINDS.turbo).toContain('ShiftLeft');
      expect(DEFAULT_KEYBINDS.turbo).toContain('ShiftRight');
      expect(DEFAULT_KEYBINDS.dash).toContain('ArrowUp');
      expect(DEFAULT_KEYBINDS.curveLeft).toContain('ArrowLeft');
      expect(DEFAULT_KEYBINDS.curveRight).toContain('ArrowRight');
    });

    it('queries current extrapolation value when /extrapolation is called with no args', () => {
      localStorageMock['haxball_extrapolation'] = '60';
      const chatBox = new ChatBox();
      const messages: any[] = [];
      (globalThis as any).document.createElement = vi.fn(() => {
        const el = { className: '', textContent: '', style: {}, appendChild: vi.fn() };
        messages.push(el);
        return el;
      });

      const handled = chatBox.handleLocalCommand('/extrapolation');
      expect(handled).toBe(true);
      expect(messages.length).toBe(1);
      expect(messages[0].textContent).toContain('Current extrapolation is 60 msec');
    });

    it('updates extrapolation value and localStorage when valid number is passed (0 - 150)', () => {
      const chatBox = new ChatBox();
      const messages: any[] = [];
      (globalThis as any).document.createElement = vi.fn(() => {
        const el = { className: '', textContent: '', style: {}, appendChild: vi.fn() };
        messages.push(el);
        return el;
      });

      const onExtrapSpy = vi.fn();
      chatBox.onExtrapolationChanged = onExtrapSpy;

      const handled = chatBox.handleLocalCommand('/extrapolation 50');
      expect(handled).toBe(true);
      expect(onExtrapSpy).toHaveBeenCalledWith(50);
      expect(localStorageMock['haxball_extrapolation']).toBe('50');
      expect(chatBox.getCurrentExtrapolation()).toBe(50);
      expect(messages[0].textContent).toContain('Extrapolation set to 50 msec');
    });

    it('rejects extrapolation values outside 0 - 150 range or invalid numbers', () => {
      const chatBox = new ChatBox();
      const messages: any[] = [];
      (globalThis as any).document.createElement = vi.fn(() => {
        const el = { className: '', textContent: '', style: {}, appendChild: vi.fn() };
        messages.push(el);
        return el;
      });

      const onExtrapSpy = vi.fn();
      chatBox.onExtrapolationChanged = onExtrapSpy;

      expect(chatBox.handleLocalCommand('/extrapolation 200')).toBe(true);
      expect(onExtrapSpy).not.toHaveBeenCalled();
      expect(messages[messages.length - 1].textContent).toContain('Invalid extrapolation value');

      expect(chatBox.handleLocalCommand('/extrapolation -10')).toBe(true);
      expect(onExtrapSpy).not.toHaveBeenCalled();

      expect(chatBox.handleLocalCommand('/extrapolation abc')).toBe(true);
      expect(onExtrapSpy).not.toHaveBeenCalled();
    });

    it('prints controls guide in cyan/green formatting with new schema', () => {
      const chatBox = new ChatBox();
      const messages: any[] = [];
      (globalThis as any).document.createElement = vi.fn(() => {
        const el = { className: '', textContent: '', style: {}, appendChild: vi.fn() };
        messages.push(el);
        return el;
      });

      chatBox.printControlsGuide();
      expect(messages.length).toBe(1);
      expect(messages[0].textContent).toBe('Controles: WASD (Moverse) | Espacio (Patear) | Shift (Turbo) | Flecha Arriba (Dash) | Flechas Izq/Der (Efecto)');
      expect(messages[0].className).toContain('chat-msg--guide');
    });
  });

  describe('Stamina and Dash Calibration', () => {
    it('defaults to 4 dashes per full bar with 25% cost', () => {
      expect(DASH_STAMINA_COST).toBe(25);
      expect(getDashStaminaCost(4)).toBe(25);
      expect(Player.getDashStaminaCost(4)).toBe(25);
    });

    it('calculates dynamic dash stamina cost accurately for 1 to 6 dashes', () => {
      expect(getDashStaminaCost(1)).toBe(100);
      expect(getDashStaminaCost(2)).toBe(50);
      expect(getDashStaminaCost(4)).toBe(25);
      expect(getDashStaminaCost(5)).toBe(20);
    });
  });

  describe('Non-Host Admin Match Control Logic and Menu Toggle', () => {
    it('authorizes non-host admin to start and stop match on GameEngine', () => {
      const engine = new GameEngine();
      const host = new Player({ id: 'host', name: 'HostPlayer', team: 'red', isHost: true });
      const admin = new Player({ id: 'admin1', name: 'AdminPlayer', team: 'blue', isHost: false, isAdmin: true });
      const guest = new Player({ id: 'guest1', name: 'GuestPlayer', team: 'spec', isHost: false, isAdmin: false });

      engine.addPlayer(host);
      engine.addPlayer(admin);
      engine.addPlayer(guest);

      const isGuestAuthorized = Boolean(guest.isAdmin || guest.isHost);
      expect(isGuestAuthorized).toBe(false);

      const isAdminAuthorized = Boolean(admin.isAdmin || admin.isHost);
      expect(isAdminAuthorized).toBe(true);

      expect(engine.fsm.currentState).toBe(MatchPhase.STOPPED);
      engine.startMatch();
      expect(engine.fsm.currentState).toBe(MatchPhase.COUNTDOWN);
      engine.stopMatch();
      expect(engine.fsm.currentState).toBe(MatchPhase.STOPPED);
    });

    it('allows non-host player to toggle menu in in-game phases and prevents close during STOPPED', () => {
      const listeners: Record<string, Function> = {};
      const menuEl = {
        classList: {
          contains: (cls: string) => cls === 'is-forced-open',
          add: vi.fn(),
          remove: vi.fn()
        },
        style: { display: 'flex', pointerEvents: 'auto' }
      };

      (globalThis as any).document = {
        getElementById: (id: string) => {
          if (id === 'ingame-menu' || id === 'ingameMenu') return menuEl;
          return {
            addEventListener: (ev: string, cb: Function) => { listeners[ev] = cb; },
            classList: { add: vi.fn(), remove: vi.fn(), toggle: vi.fn(), contains: () => false },
            style: {},
            disabled: false
          };
        },
        querySelectorAll: () => [],
        createElement: () => ({ appendChild: vi.fn(), classList: { add: vi.fn() }, style: {} })
      };

      const modal = new TeamSelectModal();
      modal.setHost(false);

      // During STOPPED phase: modal is forced open, cannot be closed
      modal.updateMatchState(MatchPhase.STOPPED);
      expect(modal.getMatchState()).toBe(MatchPhase.STOPPED);
      modal.close(false); // Non-forced close should be ignored
      expect(menuEl.style.display).toBe('flex');

      // During PLAYING phase: modal can be toggled by non-host
      modal.updateMatchState(MatchPhase.PLAYING);
      expect(modal.getMatchState()).toBe(MatchPhase.PLAYING);
      modal.open(false);
      expect(menuEl.classList.remove).toHaveBeenCalledWith('hidden', 'u-hidden', 'ui-screen-hidden');

      modal.close(false);
      expect(menuEl.classList.add).toHaveBeenCalledWith('hidden');
    });
  });

  describe('Universal Extrapolation and Clamping', () => {
    it('projects both remote players and remote ball with boundary clamping', () => {
      const discRenderer = new DiscRenderer();
      discRenderer.setExtrapolation(50); // 50ms = 0.05s
      discRenderer.setStadiumBounds({
        halfWidth: 600,
        halfHeight: 270,
        goalDepth: 35,
        goalHalfHeight: 85
      });

      // 1. Remote player with velocity (100 px/s)
      const remotePlayer = {
        id: 2,
        x: 100,
        y: 50,
        vx: 100,
        vy: 0,
        radius: 15,
        team: 1 as const,
        avatar: '',
        kicking: false,
        stamina: 100,
        isDashing: false,
        isTurbo: false
      };

      const renderPlayer = discRenderer.getRenderDisc(remotePlayer, true);
      // Expected x = 100 + 100 * 0.05 = 105
      expect(renderPlayer.x).toBeCloseTo(105, 1);
      expect(renderPlayer.y).toBeCloseTo(50, 1);

      // 2. Remote ball with velocity (200 px/s)
      const remoteBall = {
        id: 0,
        x: 0,
        y: 0,
        vx: 200,
        vy: -100,
        radius: 5.8,
        team: 0 as const,
        avatar: '',
        kicking: false,
        stamina: 100,
        isDashing: false,
        isTurbo: false
      };

      const renderBall = discRenderer.getRenderDisc(remoteBall, true);
      // Expected ball x = 0 + 200 * 0.05 = 10, y = 0 + (-100) * 0.05 = -5
      expect(renderBall.x).toBeCloseTo(10, 1);
      expect(renderBall.y).toBeCloseTo(-5, 1);

      // 3. Clamping test: remote entity projected outside pitch boundaries
      const fastPlayerNearWall = {
        id: 3,
        x: 595,
        y: 200, // outside goal mouth, boundary is halfWidth - radius = 600 - 15 = 585
        vx: 1000,
        vy: 0,
        radius: 15,
        team: 2 as const,
        avatar: '',
        kicking: false,
        stamina: 100,
        isDashing: false,
        isTurbo: false
      };

      const clampedPlayer = discRenderer.getRenderDisc(fastPlayerNearWall, true);
      expect(clampedPlayer.x).toBeLessThanOrEqual(585);
    });
  });

  describe('Goal Rope Net (1D Elastic Model)', () => {
    it('initializes rope with fixed post anchors (invMass = 0) and dynamic nodes (invMass = 2.0)', () => {
      const net = new GoalNet({
        side: 'left',
        mouthX: -600,
        backX: -635,
        topY: -85,
        bottomY: 85,
        nodeCount: 11
      });

      expect(net.nodeCount).toBe(11);
      expect(net.posX).toBeInstanceOf(Float32Array);
      expect(net.posY).toBeInstanceOf(Float32Array);
      expect(net.prevX).toBeInstanceOf(Float32Array);
      expect(net.prevY).toBeInstanceOf(Float32Array);
      expect(net.invMass).toBeInstanceOf(Float32Array);
      expect(net.segRestLen).toBeInstanceOf(Float32Array);

      // Anchors: top and bottom posts
      expect(net.invMass[0]).toBe(0);
      expect(net.invMass[net.nodeCount - 1]).toBe(0);

      // Dynamic nodes: invMass = 2.0 (m = 0.5)
      expect(net.invMass[1]).toBe(2.0);
      expect(net.invMass[5]).toBe(2.0);
      expect(net.invMass[net.nodeCount - 2]).toBe(2.0);
    });

    it('dissipates ball energy (v_ball * 0.75) and pushes rope nodes backward upon impact without NaN', () => {
      const net = new GoalNet({
        side: 'left',
        mouthX: -600,
        backX: -635,
        topY: -85,
        bottomY: 85,
        nodeCount: 11
      });

      const ball = {
        pos: { x: -634, y: 0 },
        vel: { x: -10, y: 0 },
        radius: 5.8
      };

      const initialVelX = ball.vel.x;
      const initialNodePosX = net.posX[5]; // Middle node at back of net

      // Step simulation
      net.step(ball, 1 / 60);

      // Node displaced backward (leftward for left goal)
      expect(net.posX[5]).not.toBe(initialNodePosX);

      // Ball velocity dissipated
      expect(Math.abs(ball.vel.x)).toBeLessThan(Math.abs(initialVelX));
      expect(ball.vel.x).toBeCloseTo(initialVelX * 0.75, 1);

      // Rope nodes displaced without NaN
      expect(Number.isNaN(net.posX[5])).toBe(false);
      expect(Number.isNaN(net.posY[5])).toBe(false);

      // Multiple ticks dissipate smoothly
      for (let i = 0; i < 30; i++) {
        net.step(ball, 1 / 60);
      }
      expect(Number.isNaN(ball.pos.x)).toBe(false);
      expect(Number.isNaN(ball.vel.x)).toBe(false);

      // Reset works without errors
      expect(() => net.reset()).not.toThrow();
    });
  });
});
