import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChatBox } from '../../src/ui/components/ChatBox';

describe('ChatBox System Messages and Notifications', () => {
  let container: any;
  let inputEl: any;
  let formEl: any;

  beforeEach(() => {
    container = {
      appendChild: vi.fn(),
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
        appendChild: vi.fn()
      })),
      activeElement: null
    };
  });

  it('renders a system message with chat-msg--system class and auto-scrolls', () => {
    const chatBox = new ChatBox();
    const createdElements: any[] = [];
    (globalThis as any).document.createElement = vi.fn(() => {
      const el = { className: '', textContent: '', appendChild: vi.fn() };
      createdElements.push(el);
      return el;
    });

    chatBox.addSystemMessage('Messi se ha unido a la sala.');

    expect(createdElements.length).toBe(1);
    expect(createdElements[0].className).toBe('chat-msg chat-msg--system');
    expect(createdElements[0].textContent).toBe('[Sistema] Messi se ha unido a la sala.');
    expect(container.appendChild).toHaveBeenCalledWith(createdElements[0]);
    expect(container.scrollTop).toBe(1200);
  });

  it('delegates addMessage with team="sys" to addSystemMessage', () => {
    const chatBox = new ChatBox();
    const createdElements: any[] = [];
    (globalThis as any).document.createElement = vi.fn(() => {
      const el = { className: '', textContent: '', appendChild: vi.fn() };
      createdElements.push(el);
      return el;
    });

    chatBox.addMessage({
      author: 'Sistema',
      text: 'Mbappe ha abandonado la sala.',
      team: 'sys'
    });

    expect(createdElements.length).toBe(1);
    expect(createdElements[0].className).toBe('chat-msg chat-msg--system');
    expect(createdElements[0].textContent).toBe('[Sistema] Mbappe ha abandonado la sala.');
  });

  it('correctly handles kick and ban alert system messages', () => {
    const chatBox = new ChatBox();
    const createdElements: any[] = [];
    (globalThis as any).document.createElement = vi.fn(() => {
      const el = { className: '', textContent: '', appendChild: vi.fn() };
      createdElements.push(el);
      return el;
    });

    chatBox.addSystemMessage('Troll1 fue expulsado de la sala por un administrador.');
    chatBox.addSystemMessage('Cheater2 fue baneado de la sala por un administrador.');

    expect(createdElements.length).toBe(2);
    expect(createdElements[0].textContent).toBe('[Sistema] Troll1 fue expulsado de la sala por un administrador.');
    expect(createdElements[1].textContent).toBe('[Sistema] Cheater2 fue baneado de la sala por un administrador.');
  });
});
