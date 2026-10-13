import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ScoreboardHUD } from '../../src/ui/components/ScoreboardHUD';
import { setTheme } from '../../src/ui/stores/gameStore';

describe('FASE 1: ScoreboardHUD Base & Panoramic Carousel (100vw)', () => {
  let createdElements: Record<string, any>;

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
      textContent: '',
      innerHTML: '',
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
          stopImmediatePropagation: vi.fn()
        };
        cbs.forEach(cb => cb(evt));
      },
      querySelector: (sel: string) => {
        if (sel.startsWith('#')) return createdElements[sel.substring(1)] || null;
        if (sel.startsWith('.')) {
          const cls = sel.substring(1).split('#')[0];
          return createdElements[cls] || el.children.find((c: any) => c.classList.contains(cls)) || null;
        }
        return el.children.find((c: any) => c.id === sel || c.tagName?.toLowerCase() === sel) || null;
      },
      querySelectorAll: () => []
    };

    return el;
  };

  beforeEach(() => {
    createdElements = {};

    const docEl = createMockElement('html', 'html');
    const bodyEl = createMockElement('body', 'body');
    const appEl = createMockElement('div', 'app-root', 'game-container');
    const bannerEl = createMockElement('header', 'hudTopBanner', 'hud-container hud-top-banner');

    bodyEl.appendChild(appEl);
    appEl.appendChild(bannerEl);

    (globalThis as any).document = {
      documentElement: docEl,
      body: bodyEl,
      getElementById: (id: string) => createdElements[id] || null,
      querySelector: (sel: string) => {
        if (sel === '.hud-top-banner' || sel === '.hud-container') return bannerEl;
        if (sel.startsWith('#')) return createdElements[sel.substring(1)] || null;
        if (sel.startsWith('.')) {
          const cls = sel.substring(1).split('#')[0];
          return createdElements[cls] || null;
        }
        return null;
      },
      querySelectorAll: () => [],
      createElement: (tag: string) => createMockElement(tag),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    };
  });

  afterEach(() => {
    setTheme('dark');
  });

  it('renders the complete Cyber-Pitch top banner and carousel skeleton if not present', () => {
    const hud = new ScoreboardHUD();

    // Carrusel viewport & track
    const viewport = hud.getViewportElement();
    const track = hud.getTrackElement();
    const slideStats = hud.getStatsSlide();
    const slideLobby = hud.getLobbySlide();

    expect(viewport).toBeDefined();
    expect(track).toBeDefined();
    expect(slideStats).toBeDefined();
    expect(slideLobby).toBeDefined();
    expect(slideStats?.id).toBe('slide-stats');
    expect(slideLobby?.id).toBe('slide-lobby');

    hud.destroy();
  });

  it('controls carousel slide translation with showStatsSlide() and showLobbySlide()', () => {
    const hud = new ScoreboardHUD();
    const track = hud.getTrackElement();

    expect(track).toBeDefined();

    // Default or show stats slide
    hud.showStatsSlide();
    expect(track?.style.transform).toBe('translateX(0vw)');
    expect(hud.getCurrentSlideIndex()).toBe(0);

    // Slide to room lobby
    hud.showLobbySlide();
    expect(track?.style.transform).toBe('translateX(-100vw)');
    expect(hud.getCurrentSlideIndex()).toBe(1);

    // Slide back to stats
    hud.showStatsSlide();
    expect(track?.style.transform).toBe('translateX(0vw)');
    expect(hud.getCurrentSlideIndex()).toBe(0);

    hud.destroy();
  });

  it('updates room info and team tags dynamically', () => {
    const hud = new ScoreboardHUD();

    hud.setRoomInfo('Cyber Arena 3v3', 'CYBER-99');
    const roomBadge = (globalThis as any).document.getElementById('roomNameBadge');
    const roomId = (globalThis as any).document.getElementById('roomIdBadge');

    expect(roomBadge.textContent).toBe('Cyber Arena 3v3');
    expect(roomId.textContent).toBe('CYBER-99');

    hud.setTeamTags('BAR', 'MAD');
    const redTag = (globalThis as any).document.getElementById('redTeamTag');
    const blueTag = (globalThis as any).document.getElementById('blueTeamTag');

    expect(redTag.textContent).toBe('[BAR]');
    expect(blueTag.textContent).toBe('[MAD]');

    hud.destroy();
  });

  it('handles audio toggle correctly via toggleAudio and button click', () => {
    const hud = new ScoreboardHUD();
    const mockAudioManager = { isMuted: false };
    hud.gameApp = { audioManager: mockAudioManager };

    const audioBtn = (globalThis as any).document.getElementById('audio-toggle-btn');
    expect(audioBtn).toBeDefined();

    // Toggle mute on
    const isMuted1 = hud.toggleAudio();
    expect(isMuted1).toBe(true);
    expect(mockAudioManager.isMuted).toBe(true);
    expect(audioBtn.textContent).toBe('🔇');

    // Toggle mute off
    const isMuted2 = hud.toggleAudio();
    expect(isMuted2).toBe(false);
    expect(mockAudioManager.isMuted).toBe(false);
    expect(audioBtn.textContent).toBe('🔊');

    hud.destroy();
  });

  it('connects menu button and settings button to UI controls', () => {
    const hud = new ScoreboardHUD();
    const mockUiStateMachine = { toggleModal: vi.fn() };
    hud.uiStateMachine = mockUiStateMachine as any;

    const mockSettingsModal = { open: vi.fn() };
    hud.gameApp = { settingsModal: mockSettingsModal, matchPhase: 2 };

    hud.toggleMenu();
    expect(mockUiStateMachine.toggleModal).toHaveBeenCalledWith('teamSelect');

    hud.openSettings();
    expect(mockSettingsModal.open).toHaveBeenCalled();

    hud.destroy();
  });
});
