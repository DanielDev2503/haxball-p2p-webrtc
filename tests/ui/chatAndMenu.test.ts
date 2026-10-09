import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChatBox } from '../../src/ui/components/ChatBox';
import { SignalingClient } from '../../src/net/signaling/SignalingClient';

describe('ChatBox Enter Cycle & Blur UX', () => {
  let listeners: Record<string, Function>;
  let inputEl: any;
  let formEl: any;
  let container: any;

  beforeEach(() => {
    listeners = {};
    inputEl = {
      value: '',
      focus: vi.fn(),
      blur: vi.fn(),
      addEventListener: vi.fn((event: string, cb: Function) => {
        listeners[event] = cb;
      })
    };
    formEl = {
      addEventListener: vi.fn((event: string, cb: Function) => {
        listeners['form_' + event] = cb;
      })
    };
    container = {
      appendChild: vi.fn()
    };
    (globalThis as any).document = {
      getElementById: (id: string) => {
        if (id === 'chat-messages' || id === 'chatMessages') return container;
        if (id === 'chat-input' || id === 'chatInput') return inputEl;
        if (id === 'chat-form' || id === 'chatForm') return formEl;
        return null;
      },
      createElement: vi.fn(() => ({ className: '', textContent: '', appendChild: vi.fn() })),
      activeElement: null
    };
  });

  it('sends trimmed message on Enter, clears input, and blurs to gameplay', () => {
    const chatBox = new ChatBox();
    const sendSpy = vi.fn();
    chatBox.onSendMessage = sendSpy;

    inputEl.value = '  ¡Buen gol!  ';

    const event = {
      key: 'Enter',
      preventDefault: vi.fn(),
      stopPropagation: vi.fn()
    };

    listeners['keydown'](event);

    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy).toHaveBeenCalledWith('¡Buen gol!');
    expect(inputEl.value).toBe('');
    expect(inputEl.blur).toHaveBeenCalledTimes(1);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalled();
  });

  it('blurs without sending message when Enter is pressed on empty input', () => {
    const chatBox = new ChatBox();
    const sendSpy = vi.fn();
    chatBox.onSendMessage = sendSpy;

    inputEl.value = '    ';

    const event = {
      key: 'Enter',
      preventDefault: vi.fn(),
      stopPropagation: vi.fn()
    };

    listeners['keydown'](event);

    expect(sendSpy).not.toHaveBeenCalled();
    expect(inputEl.value).toBe('');
    expect(inputEl.blur).toHaveBeenCalledTimes(1);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalled();
  });

  it('blurs when Escape is pressed while input is focused', () => {
    new ChatBox();
    const event = {
      key: 'Escape',
      preventDefault: vi.fn(),
      stopPropagation: vi.fn()
    };

    listeners['keydown'](event);

    expect(inputEl.blur).toHaveBeenCalledTimes(1);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalled();
  });
});

describe('SignalingClient leaveRoom Protocol', () => {
  it('sends leave_room message with roomId and peerId over WebSocket', () => {
    const client = new SignalingClient('ws://localhost:9999');
    const sendSpy = vi.fn();

    (client as any).ws = {
      readyState: 1, // WebSocket.OPEN
      send: sendSpy
    };
    (client as any).connected = true;

    client.leaveRoom('room-test-123');

    expect(sendSpy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(sendSpy.mock.calls[0][0]);
    expect(payload.type).toBe('leave_room');
    expect(payload.roomId).toBe('room-test-123');
    expect(payload.peerId).toBe(client.peerId);
  });
});

describe('ChatBox Dynamic Reactivity & chat:resize Dispatch', () => {
  it('updates document.documentElement --chat-height and dispatches chat:resize on height change', () => {
    const rootStyle: Record<string, string> = {};
    const setPropertySpy = vi.fn((prop: string, val: string) => {
      rootStyle[prop] = val;
    });

    const dispatchSpy = vi.fn();
    (globalThis as any).window = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: dispatchSpy,
      innerHeight: 800
    };
    const boxEl = { style: { height: '', maxHeight: '' } };
    const handleEl = {
      id: '',
      className: '',
      title: '',
      addEventListener: vi.fn(),
      classList: { add: vi.fn(), remove: vi.fn() }
    };
    (globalThis as any).document = {
      getElementById: vi.fn((id: string) => {
        if (id === 'chat-container') return boxEl;
        if (id === 'chat-resize-handle') return handleEl;
        return null;
      }),
      querySelector: vi.fn(() => null),
      createElement: vi.fn(() => handleEl),
      documentElement: {
        style: {
          setProperty: setPropertySpy
        }
      }
    };

    const chatBox = new ChatBox();
    dispatchSpy.mockClear();
    setPropertySpy.mockClear();

    chatBox.applyHeight(240);

    expect(setPropertySpy).toHaveBeenCalledWith('--chat-height', '240px');
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    const event = dispatchSpy.mock.calls[0][0];
    expect(event.type).toBe('chat:resize');
    expect(event.detail).toEqual({ height: 240 });
  });
});
