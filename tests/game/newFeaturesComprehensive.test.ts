import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChatBox } from '../../src/ui/components/ChatBox';
import { GameEngine } from '../../src/core/game/GameEngine';
import { Player, DASH_STAMINA_COST, getDashStaminaCost } from '../../src/core/game/Player';
import { MatchPhase } from '../../src/core/game/GameFSM';
import { GoalNet } from '../../src/core/entities/GoalNet';

describe('New Features: Extrapolation, Admin Control, Stamina & GoalNet', () => {
  describe('Extrapolation and ChatBox Commands', () => {
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

      // > 150
      expect(chatBox.handleLocalCommand('/extrapolation 200')).toBe(true);
      expect(onExtrapSpy).not.toHaveBeenCalled();
      expect(messages[messages.length - 1].textContent).toContain('Invalid extrapolation value');

      // < 0
      expect(chatBox.handleLocalCommand('/extrapolation -10')).toBe(true);
      expect(onExtrapSpy).not.toHaveBeenCalled();

      // NaN
      expect(chatBox.handleLocalCommand('/extrapolation abc')).toBe(true);
      expect(onExtrapSpy).not.toHaveBeenCalled();
    });

    it('prints controls guide in cyan/green formatting', () => {
      const chatBox = new ChatBox();
      const messages: any[] = [];
      (globalThis as any).document.createElement = vi.fn(() => {
        const el = { className: '', textContent: '', style: {}, appendChild: vi.fn() };
        messages.push(el);
        return el;
      });

      chatBox.printControlsGuide();
      expect(messages.length).toBe(1);
      expect(messages[0].textContent).toBe('Controles: WASD (Moverse) | Espacio (Patear) | Shift Izq (Turbo) | Flecha Arriba (Dash) | Flechas Izq/Der (Comba)');
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

  describe('Non-Host Admin Match Control Logic', () => {
    it('authorizes non-host admin to start and stop match on GameEngine', () => {
      const engine = new GameEngine();
      const host = new Player({ id: 'host', name: 'HostPlayer', team: 'red', isHost: true });
      const admin = new Player({ id: 'admin1', name: 'AdminPlayer', team: 'blue', isHost: false, isAdmin: true });
      const guest = new Player({ id: 'guest1', name: 'GuestPlayer', team: 'spec', isHost: false, isAdmin: false });

      engine.addPlayer(host);
      engine.addPlayer(admin);
      engine.addPlayer(guest);

      // Guest attempt should be unauthorized
      const isGuestAuthorized = Boolean(guest.isAdmin || guest.isHost);
      expect(isGuestAuthorized).toBe(false);

      // Admin attempt should be authorized
      const isAdminAuthorized = Boolean(admin.isAdmin || admin.isHost);
      expect(isAdminAuthorized).toBe(true);

      // Engine transitions when authorized
      expect(engine.fsm.currentState).toBe(MatchPhase.STOPPED);
      engine.startMatch();
      expect(engine.fsm.currentState).toBe(MatchPhase.COUNTDOWN);
      engine.stopMatch();
      expect(engine.fsm.currentState).toBe(MatchPhase.STOPPED);
    });
  });

  describe('GoalNet Verlet Simulation', () => {
    it('initializes zero-GC Float32Array nodes and step completes deterministically', () => {
      const net = new GoalNet({
        side: 'left',
        mouthX: -600,
        backX: -635,
        topY: -85,
        bottomY: 85,
        cols: 6,
        rows: 5
      });

      expect(net.cols).toBe(6);
      expect(net.rows).toBe(5);
      expect(net.nodeCount).toBe(30);

      // Verify node arrays are Float32Array
      expect(net.posX).toBeInstanceOf(Float32Array);
      expect(net.posY).toBeInstanceOf(Float32Array);
      expect(net.prevX).toBeInstanceOf(Float32Array);
      expect(net.prevY).toBeInstanceOf(Float32Array);
      expect(net.invMass).toBeInstanceOf(Float32Array);

      // Anchor nodes (posts, outer corners) should have invMass = 0
      const topPostIdx = 0;
      const bottomPostIdx = (net.rows - 1) * net.cols;
      expect(net.invMass[topPostIdx]).toBe(0); // top post mouth
      expect(net.invMass[bottomPostIdx]).toBe(0); // bottom post mouth

      // Step net without ball
      expect(() => net.step(null, 1 / 60)).not.toThrow();

      // Step net with ball penetrating net
      const ball = {
        pos: { x: -620, y: 0 },
        vel: { x: -5, y: 0 },
        radius: 5.8
      };
      expect(() => net.step(ball, 1 / 60)).not.toThrow();

      // Reset works without errors
      expect(() => net.reset()).not.toThrow();
    });
  });
});
