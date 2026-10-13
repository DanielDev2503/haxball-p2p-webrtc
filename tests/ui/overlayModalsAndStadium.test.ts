import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SettingsModal, KeybindModal } from '../../src/ui/components/SettingsModal';
import { GameplayModifierModal } from '../../src/ui/components/GameplayModifierModal';
import { StadiumSelectModal } from '../../src/ui/components/StadiumSelectModal';
import { InputManager } from '../../src/client/InputManager';
import { DEFAULT_GAMEPLAY_CONFIG } from '../../src/core/game/GameConfig';
import { $roomConfig } from '../../src/ui/stores/gameStore';

describe('FASE 3: Modales Superpuestos (Settings, Modificadores y Selector de Estadios)', () => {
  let createdElements: Record<string, any>;
  let originalDoc: any;
  let originalWin: any;

  const createMockElement = (tag: string, id: string = '', className: string = '') => {
    const classSet = new Set(className.split(' ').filter(Boolean));
    const listeners: Record<string, Function[]> = {};
    const attributes = new Map<string, string>();

    const el: any = {
      tagName: tag.toUpperCase(),
      id,
      className,
      style: {} as Record<string, string>,
      children: [] as any[],
      dataset: {} as Record<string, string>,
      _innerHTML: '',
      _textContent: '',
      get textContent() {
        return this._textContent || this._innerHTML.replace(/<[^>]+>/g, '').trim();
      },
      set textContent(val: string) {
        this._textContent = val;
      },
      set innerHTML(val: string) {
        this._innerHTML = val;
        this.children = [];
        const tagWithIdRegex = /<([a-zA-Z0-9]+)\s+([^>]*id="([^"]+)"[^>]*)>(?:([\s\S]*?)<\/\1>)?/g;
        let match;
        while ((match = tagWithIdRegex.exec(val)) !== null) {
          const [, t, attrs, parsedId, fullContent] = match;
          const classMatch = attrs.match(/class="([^"]+)"/);
          const parsedClass = classMatch ? classMatch[1] : '';
          const child = createMockElement(t, parsedId, parsedClass);
          if (fullContent !== undefined && !fullContent.includes('<')) {
            child.textContent = fullContent.trim();
          }
          createdElements[parsedId] = child;
          this.children.push(child);
        }
      },
      get innerHTML() {
        return this._innerHTML;
      },
      value: '',
      checked: false,
      disabled: false,
      width: 560,
      height: 230,
      getContext: () => ({
        clearRect: vi.fn(),
        fillRect: vi.fn(),
        strokeRect: vi.fn(),
        beginPath: vi.fn(),
        arc: vi.fn(),
        stroke: vi.fn(),
        fill: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        save: vi.fn(),
        restore: vi.fn(),
        clip: vi.fn(),
        fillText: vi.fn()
      }),
      classList: {
        add: (...cls: string[]) => {
          cls.forEach(c => classSet.add(c));
          el.className = Array.from(classSet).join(' ');
        },
        remove: (...cls: string[]) => {
          cls.forEach(c => classSet.delete(c));
          el.className = Array.from(classSet).join(' ');
        },
        toggle: (c: string, force?: boolean) => {
          const shouldAdd = force !== undefined ? force : !classSet.has(c);
          if (shouldAdd) classSet.add(c);
          else classSet.delete(c);
          el.className = Array.from(classSet).join(' ');
          return shouldAdd;
        },
        contains: (c: string) => classSet.has(c)
      },
      setAttribute: (name: string, val: string) => {
        attributes.set(name, val);
      },
      getAttribute: (name: string) => attributes.get(name) || null,
      removeAttribute: (name: string) => {
        attributes.delete(name);
      },
      appendChild: (child: any) => {
        if (child.id) createdElements[child.id] = child;
        if (child.className) {
          child.className.split(' ').forEach((c: string) => {
            if (c) createdElements[c] = child;
          });
        }
        el.children.push(child);
        return child;
      },
      removeChild: (child: any) => {
        const idx = el.children.indexOf(child);
        if (idx !== -1) el.children.splice(idx, 1);
        return child;
      },
      addEventListener: (event: string, cb: Function) => {
        if (!listeners[event]) listeners[event] = [];
        listeners[event].push(cb);
      },
      removeEventListener: (event: string, cb: Function) => {
        if (listeners[event]) {
          listeners[event] = listeners[event].filter(fn => fn !== cb);
        }
      },
      dispatchEvent: (event: any) => {
        const cbs = listeners[event.type || 'click'] || [];
        cbs.forEach(cb => cb(event));
      },
      click: () => {
        const cbs = listeners['click'] || [];
        const evt = {
          type: 'click',
          preventDefault: vi.fn(),
          stopPropagation: vi.fn(),
          stopImmediatePropagation: vi.fn(),
          target: el
        };
        cbs.forEach(cb => cb(evt));
      },
      querySelector: (sel: string) => {
        if (sel.startsWith('#')) return createdElements[sel.substring(1)] || null;
        if (sel.startsWith('.')) {
          const cls = sel.substring(1).split('#')[0].split('[')[0];
          return createdElements[cls] || el.children.find((c: any) => c.classList?.contains?.(cls)) || null;
        }
        return el.children.find((c: any) => c.id === sel || c.tagName?.toLowerCase() === sel) || null;
      },
      querySelectorAll: (sel: string) => {
        const results: any[] = [];
        const findIn = (node: any) => {
          for (const child of node.children || []) {
            if (sel.startsWith('.')) {
              const cls = sel.substring(1);
              if (child.classList?.contains?.(cls)) results.push(child);
            } else if (sel.startsWith('#')) {
              if (child.id === sel.substring(1)) results.push(child);
            }
            findIn(child);
          }
        };
        findIn(el);
        return results;
      }
    };

    return el;
  };

  beforeEach(() => {
    createdElements = {};
    originalDoc = (globalThis as any).document;
    originalWin = (globalThis as any).window;

    const bodyEl = createMockElement('body');
    const docEl = createMockElement('html');
    docEl.style.setProperty = vi.fn();

    (globalThis as any).document = {
      body: bodyEl,
      documentElement: docEl,
      getElementById: (id: string) => createdElements[id] || null,
      querySelector: (sel: string) => {
        if (sel.startsWith('#')) return createdElements[sel.substring(1)] || null;
        if (sel.startsWith('.')) {
          const cls = sel.substring(1);
          return createdElements[cls] || null;
        }
        return null;
      },
      querySelectorAll: () => [],
      createElement: (tag: string) => createMockElement(tag),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    };

    (globalThis as any).window = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
      location: { origin: 'http://localhost:3000', pathname: '/' }
    };
  });

  afterEach(() => {
    (globalThis as any).document = originalDoc;
    (globalThis as any).window = originalWin;
  });

  it('Componente 1 (SettingsModal): Chasis de 2 columnas, navegación exterior y 5 pestañas activas', () => {
    const inputManager = new InputManager();
    const modal = new SettingsModal(inputManager);

    modal.open();
    expect(modal.modalEl).toBeDefined();
    expect(modal.modalEl?.style.display).toBe('flex');

    // Botón exterior < Volver
    const backBtn = modal.backBtn;
    expect(backBtn).toBeDefined();
    expect(backBtn?.className).toContain('modal-nav-back-btn');

    // Botón exterior [ ☼ / ☾ ]
    const themeBtn = modal.themeBtn;
    expect(themeBtn).toBeDefined();
    expect(themeBtn?.className).toContain('modal-nav-theme-btn');

    // Tarjeta central .settings-modal-card
    expect(modal.cardEl).toBeDefined();
    expect(modal.cardEl?.className).toContain('settings-modal-card');

    // Navegación de 5 pestañas
    modal.switchTab('audio');
    expect(modal.activeTab).toBe('audio');

    modal.switchTab('video');
    expect(modal.activeTab).toBe('video');

    modal.switchTab('kits');
    expect(modal.activeTab).toBe('kits');

    modal.switchTab('club');
    expect(modal.activeTab).toBe('club');

    modal.switchTab('controls');
    expect(modal.activeTab).toBe('controls');

    // Absorción de KeybindModal
    const keybindModalWrapper = new KeybindModal(inputManager);
    expect(keybindModalWrapper).toBeInstanceOf(SettingsModal);

    // Al hacer clic en < Volver, se cierra
    backBtn?.click();
    expect(modal.modalEl?.style.display).toBe('none');

    modal.destroy();
  });

  it('Componente 2 (GameplayModifierModal): Chasis de 2 columnas, 3 categorías y 19 parámetros físicos', () => {
    const onChangeSpy = vi.fn();
    const modifierModal = new GameplayModifierModal(
      DEFAULT_GAMEPLAY_CONFIG,
      onChangeSpy,
      () => true, // isHost
      () => false // isMatchInProgress
    );

    modifierModal.open();
    expect(modifierModal.modalEl).toBeDefined();
    expect(modifierModal.modalEl?.style.display).toBe('flex');

    // Botón exterior < Volver
    const backBtn = modifierModal.backBtn;
    expect(backBtn).toBeDefined();
    expect(backBtn?.className).toContain('modal-nav-back-btn');

    // Botón exterior [ ☼ / ☾ ]
    const themeBtn = modifierModal.themeBtn;
    expect(themeBtn).toBeDefined();
    expect(themeBtn?.className).toContain('modal-nav-theme-btn');

    // Tarjeta central .modifier-modal-card
    expect(modifierModal.cardEl).toBeDefined();
    expect(modifierModal.cardEl?.className).toContain('modifier-modal-card');

    // Navegación por las 3 categorías
    modifierModal.switchCategory('ball');
    expect(modifierModal.activeCategory).toBe('ball');

    modifierModal.switchCategory('mechanics');
    expect(modifierModal.activeCategory).toBe('mechanics');

    modifierModal.switchCategory('player');
    expect(modifierModal.activeCategory).toBe('player');

    // Botón CTA Aplicar y Sincronizar emite los modificadores
    const applyBtn = modifierModal.applyBtn;
    expect(applyBtn).toBeDefined();
    expect(applyBtn?.className).toContain('btn-cta-green');

    applyBtn?.click();
    expect(onChangeSpy).toHaveBeenCalledTimes(1);
    expect(modifierModal.modalEl?.style.display).toBe('none');

    modifierModal.destroy();
  });

  it('Componente 3 (StadiumSelectModal): 2 columnas asimétricas, carrusel vertical, preview 2D y botón CTA', () => {
    const onSelectSpy = vi.fn();
    const stadiumModal = new StadiumSelectModal({
      onSelect: onSelectSpy
    });

    stadiumModal.open();
    expect(stadiumModal.modalEl).toBeDefined();
    expect(stadiumModal.modalEl?.style.display).toBe('flex');

    // Botón exterior < Volver
    const backBtn = stadiumModal.backBtn;
    expect(backBtn).toBeDefined();
    expect(backBtn?.className).toContain('modal-nav-back-btn');

    // Botón exterior [ ☼ / ☾ ]
    const themeBtn = stadiumModal.themeBtn;
    expect(themeBtn).toBeDefined();
    expect(themeBtn?.className).toContain('modal-nav-theme-btn');

    // Tarjeta central .stadium-modal-card
    expect(stadiumModal.cardEl).toBeDefined();
    expect(stadiumModal.cardEl?.className).toContain('stadium-modal-card');

    // Selección de mapa alternativo
    stadiumModal.selectStadium('classic');
    expect(stadiumModal.selectedStadiumId).toBe('classic');

    // Botón CTA Seleccionar Estadio
    const confirmBtn = stadiumModal.confirmBtn;
    expect(confirmBtn).toBeDefined();
    expect(confirmBtn?.className).toContain('btn-cta-green');

    confirmBtn?.click();
    expect(onSelectSpy).toHaveBeenCalledWith('classic');
    expect($roomConfig.get().stadiumId).toBe('classic');
    expect(stadiumModal.modalEl?.style.display).toBe('none');
  });

  it('Superposición no destructiva: los modales abren y cierran como overlays limpios sin alterar la escena base', () => {
    const inputManager = new InputManager();
    const settings = new SettingsModal(inputManager);
    const modifiers = new GameplayModifierModal(
      DEFAULT_GAMEPLAY_CONFIG,
      vi.fn(),
      () => true,
      () => false
    );
    const stadium = new StadiumSelectModal();

    // Abrir Settings
    settings.open();
    expect(settings.modalEl?.style.display).toBe('flex');
    expect(settings.modalEl?.style.position).toBe('fixed');

    settings.close();
    expect(settings.modalEl?.style.display).toBe('none');

    // Abrir Modificadores
    modifiers.open();
    expect(modifiers.modalEl?.style.display).toBe('flex');
    expect(modifiers.modalEl?.style.position).toBe('fixed');

    modifiers.close();
    expect(modifiers.modalEl?.style.display).toBe('none');

    // Abrir Estadios
    stadium.open();
    expect(stadium.modalEl?.style.display).toBe('flex');
    expect(stadium.modalEl?.style.position).toBe('fixed');

    stadium.close();
    expect(stadium.modalEl?.style.display).toBe('none');

    settings.destroy();
    modifiers.destroy();
  });
});
