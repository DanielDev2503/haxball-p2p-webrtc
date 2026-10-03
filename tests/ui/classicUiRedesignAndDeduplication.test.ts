import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ChatBox, CHAT_STORAGE_KEY } from '../../src/ui/components/ChatBox';
import { TeamSelectModal } from '../../src/ui/components/TeamSelectModal';

describe('Classic UI Redesign & Stadium Deduplication', () => {
  let localStorageMock: Record<string, string>;

  beforeEach(() => {
    localStorageMock = {};
    (globalThis as any).localStorage = {
      getItem: (key: string) => localStorageMock[key] ?? null,
      setItem: (key: string, val: string) => {
        localStorageMock[key] = val;
      },
      removeItem: (key: string) => {
        delete localStorageMock[key];
      },
      clear: () => {
        localStorageMock = {};
      }
    };
  });

  it('ChatBox initializes with saved height from localStorage', () => {
    localStorageMock[CHAT_STORAGE_KEY] = '180px';

    const boxEl = { style: {} as Record<string, string>, getBoundingClientRect: () => ({ height: 180 }) };
    const container = { appendChild: vi.fn() };
    const inputEl = { value: '', focus: vi.fn(), blur: vi.fn(), addEventListener: vi.fn() };
    const formEl = { addEventListener: vi.fn() };

    (globalThis as any).document = {
      getElementById: (id: string) => {
        if (id === 'chat-container') return boxEl;
        if (id === 'chat-messages') return container;
        if (id === 'chat-input') return inputEl;
        if (id === 'chatForm') return formEl;
        return null;
      },
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: () => ({ className: '', style: {}, addEventListener: vi.fn() })
    };

    const chat = new ChatBox();
    expect(chat).toBeDefined();
    expect(boxEl.style.height).toBe('180px');
  });

  it('ChatBox adjusts dynamically to avoid overlapping open central menu', () => {
    const boxEl = { style: {} as Record<string, string>, getBoundingClientRect: () => ({ height: 150 }) };
    const container = { appendChild: vi.fn() };
    const inputEl = { value: '', focus: vi.fn(), blur: vi.fn(), addEventListener: vi.fn() };
    const formEl = { addEventListener: vi.fn() };

    (globalThis as any).document = {
      getElementById: (id: string) => {
        if (id === 'chat-container') return boxEl;
        if (id === 'chat-messages') return container;
        if (id === 'chat-input') return inputEl;
        if (id === 'chatForm') return formEl;
        return null;
      },
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: () => ({ className: '', style: {}, addEventListener: vi.fn() })
    };

    (globalThis as any).window = {
      innerHeight: 800,
      addEventListener: vi.fn()
    };

    const chat = new ChatBox();
    const mockMenuEl = {
      getBoundingClientRect: () => ({ bottom: 700 })
    } as any;

    // Invarianza Dimensional Estricta del Chat Box:
    // El chat no altera su altura al abrir menús
    chat.adjustForMenu(true, mockMenuEl);
    expect(boxEl.style.height).toBe('130px');
    expect(boxEl.style.maxHeight).toBe('');

    // On menu close, mantiene su altura configurada
    chat.adjustForMenu(false);
    expect(boxEl.style.maxHeight).toBe('');
    expect(boxEl.style.height).toBe('130px');
  });

  it('ChatBox maintains invariant user-configured height on resize and menu toggle', () => {
    const boxEl = { style: {} as Record<string, string>, getBoundingClientRect: () => ({ height: 150 }) };
    const container = { appendChild: vi.fn() };
    const inputEl = { value: '', focus: vi.fn(), blur: vi.fn(), addEventListener: vi.fn() };
    const formEl = { addEventListener: vi.fn() };

    (globalThis as any).document = {
      getElementById: (id: string) => {
        if (id === 'chat-container') return boxEl;
        if (id === 'chat-messages') return container;
        if (id === 'chat-input') return inputEl;
        if (id === 'chatForm') return formEl;
        return null;
      },
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: () => ({ className: '', style: {}, addEventListener: vi.fn() })
    };

    (globalThis as any).window = {
      innerHeight: 600,
      addEventListener: vi.fn()
    };

    const chat = new ChatBox();
    chat.applyHeight(180);
    chat.adjustForMenu(true);
    expect(boxEl.style.height).toBe('180px');
    expect(boxEl.style.maxHeight).toBe('');
  });

  it('ChatBox Escape key clears input, stops event propagation and blurs', () => {
    let keydownListener: Function | null = null;
    const inputEl = {
      value: 'Texto de prueba',
      blur: vi.fn(),
      addEventListener: vi.fn((event: string, cb: Function) => {
        if (event === 'keydown') keydownListener = cb;
      })
    };

    (globalThis as any).document = {
      getElementById: (id: string) => {
        if (id === 'chat-input') return inputEl;
        return null;
      },
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: () => ({ className: '', style: {}, addEventListener: vi.fn() })
    };

    new ChatBox();

    expect(keydownListener).toBeDefined();
    const event = {
      key: 'Escape',
      preventDefault: vi.fn(),
      stopPropagation: vi.fn()
    };

    keydownListener!(event);

    expect(inputEl.value).toBe('');
    expect(event.stopPropagation).toHaveBeenCalled();
    expect(event.preventDefault).toHaveBeenCalled();
    expect(inputEl.blur).toHaveBeenCalled();
  });

  it('TeamSelectModal setStadium updates display and active option', () => {
    const selectEl = { value: 'classic', dataset: {}, addEventListener: vi.fn() };
    const currentNameEl = { textContent: '' };
    const smallBtn = { getAttribute: () => 'small', classList: { toggle: vi.fn() }, addEventListener: vi.fn() };
    const classicBtn = { getAttribute: () => 'classic', classList: { toggle: vi.fn() }, addEventListener: vi.fn() };

    (globalThis as any).document = {
      getElementById: (id: string) => {
        if (id === 'select-stadium-size') return selectEl;
        if (id === 'currentStadiumName') return currentNameEl;
        return null;
      },
      querySelector: () => null,
      querySelectorAll: (sel: string) => {
        if (sel === '.stadium-option-btn') return [smallBtn, classicBtn];
        return [];
      },
      createElement: () => ({ className: '', style: {}, addEventListener: vi.fn() })
    };

    const modal = new TeamSelectModal();
    modal.setStadium('small');

    expect(selectEl.value).toBe('small');
    expect(currentNameEl.textContent).toContain('Pequeño');
    expect(smallBtn.classList.toggle).toHaveBeenCalledWith('active-stadium', true);
    expect(classicBtn.classList.toggle).toHaveBeenCalledWith('active-stadium', false);
  });
});
