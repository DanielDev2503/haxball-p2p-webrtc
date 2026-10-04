import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AudioManager } from '../../src/client/AudioManager';
import { ChatBox } from '../../src/ui/components/ChatBox';

describe('Procedural Audio Synthesis and ChatBox Resizer Clamp', () => {
  let boxEl: any;
  let handleEl: any;
  let listeners: Record<string, Function>;
  let windowListeners: Record<string, Function>;

  beforeEach(() => {
    listeners = {};
    windowListeners = {};

    handleEl = {
      addEventListener: (type: string, fn: Function) => {
        listeners[type] = fn;
      },
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
      classList: {
        add: vi.fn(),
        remove: vi.fn()
      }
    };

    boxEl = {
      style: { height: '130px' },
      getBoundingClientRect: () => ({ height: 130 }),
      querySelector: (selector: string) => {
        if (selector === '.chat-resize-handle') return handleEl;
        return null;
      },
      classList: {
        add: vi.fn(),
        remove: vi.fn()
      }
    };

    (globalThis as any).document = {
      getElementById: (id: string) => {
        if (id === 'chat-container') return boxEl;
        if (id === 'chat-resize-handle') return handleEl;
        if (id === 'chat-messages' || id === 'chatMessages') return { appendChild: vi.fn() };
        if (id === 'chat-input' || id === 'chatInput') return { value: '', focus: vi.fn(), blur: vi.fn(), addEventListener: vi.fn() };
        if (id === 'chat-form' || id === 'chatForm') return { addEventListener: vi.fn() };
        return null;
      },
      body: {
        style: {},
        classList: {
          add: vi.fn(),
          remove: vi.fn()
        }
      },
      createElement: vi.fn(() => ({
        className: '',
        textContent: '',
        appendChild: vi.fn()
      }))
    };

    (globalThis as any).window = {
      addEventListener: (type: string, fn: Function) => {
        windowListeners[type] = fn;
      },
      removeEventListener: vi.fn(),
      innerHeight: 800,
      localStorage: {
        getItem: vi.fn(() => null),
        setItem: vi.fn()
      }
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('AudioManager Procedural Synthesis', () => {
    it('executes playChatMessageSound without throwing exceptions when muted or active', () => {
      const audio = new AudioManager();

      // Muted
      audio.setMuted(true);
      expect(() => audio.playChatMessageSound()).not.toThrow();

      // Unmuted
      audio.setMuted(false);
      expect(() => audio.playChatMessageSound()).not.toThrow();
      expect(() => audio.play('chat')).not.toThrow();
    });

    it('executes playPlayerJoinedSound without throwing exceptions when muted or active', () => {
      const audio = new AudioManager();

      // Muted
      audio.setMuted(true);
      expect(() => audio.playPlayerJoinedSound()).not.toThrow();

      // Unmuted
      audio.setMuted(false);
      expect(() => audio.playPlayerJoinedSound()).not.toThrow();
      expect(() => audio.play('player_joined')).not.toThrow();
    });
  });

  describe('ChatBox Resizer Handle Clamp', () => {
    it('enforces MIN_CHAT_HEIGHT of 64px when dragging handle downwards', () => {
      const chat = new ChatBox();

      expect(chat.getHeight()).toBe(130);
      expect(listeners['pointerdown']).toBeDefined();

      // Pointer down at clientY = 100 with button 0
      listeners['pointerdown']({
        button: 0,
        preventDefault: vi.fn(),
        clientY: 100,
        pointerId: 1
      });

      expect(handleEl.setPointerCapture).toHaveBeenCalledWith(1);
      expect(windowListeners['pointermove']).toBeDefined();
      expect(windowListeners['pointerup']).toBeDefined();

      // Drag downwards to clientY = 300 (excessive downward movement)
      windowListeners['pointermove']({
        clientY: 300
      });

      // Height clamped to 64px
      expect(chat.getHeight()).toBe(64);
      expect(boxEl.style.height).toBe('64px');

      // Pointer up release
      windowListeners['pointerup']({
        pointerId: 1
      });

      expect(handleEl.releasePointerCapture).toHaveBeenCalledWith(1);
      expect(chat.getHeight()).toBe(64);
    });
  });
});
