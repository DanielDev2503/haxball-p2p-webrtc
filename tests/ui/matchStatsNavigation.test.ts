import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MatchStatsPanel } from '../../src/ui/components/MatchStatsPanel';
import { RoomLobby } from '../../src/ui/components/RoomLobby';
import { PlayerMatchStats } from '../../src/core/game/GameState';

describe('MatchStatsPanel & RoomLobby Navigation Lifecycle', () => {
  let createdElements: Record<string, any>;
  let originalDoc: any;

  const createMockElement = (tag: string, id: string = '', className: string = '') => {
    const classSet = new Set(className.split(' ').filter(Boolean));
    const listeners: Record<string, Function[]> = {};
    const el: any = {
      tagName: tag.toUpperCase(),
      id,
      className,
      style: {} as Record<string, string>,
      children: [] as any[],
      innerHTML: '',
      classList: {
        add: (...cls: string[]) => cls.forEach(c => classSet.add(c)),
        remove: (...cls: string[]) => cls.forEach(c => classSet.delete(c)),
        contains: (c: string) => classSet.has(c)
      },
      appendChild: (child: any) => {
        if (child.id) createdElements[child.id] = child;
        if (child.className && child.className.includes('match-stats-card')) {
          createdElements['match-stats-card'] = child;
        }
        if (child.className && child.className.includes('match-stats-wrapper')) {
          createdElements['match-stats-wrapper'] = child;
        }
        el.children.push(child);
        return child;
      },
      removeChild: (child: any) => {
        const idx = el.children.indexOf(child);
        if (idx !== -1) el.children.splice(idx, 1);
        return child;
      },
      querySelector: (sel: string) => {
        if (sel === '.match-stats-card') return createdElements['match-stats-card'];
        if (sel === '.match-stats-wrapper') return createdElements['match-stats-wrapper'];
        if (sel === '#stats-to-menu-btn') return createdElements['stats-to-menu-btn'];
        if (sel === '#menu-to-stats-btn') return createdElements['menu-to-stats-btn'];
        if (sel.includes('modal-content') || sel.includes('room-lobby-modal')) {
          return el.children.find((c: any) => c.className?.includes('modal-content') || c.className?.includes('room-lobby-modal')) || null;
        }
        if (sel.startsWith('#')) return createdElements[sel.substring(1)] || null;
        return el.children.find((c: any) => c.id === sel.replace('#', '') || c.className?.includes(sel.replace('.', ''))) || null;
      },
      querySelectorAll: (sel: string) => {
        if (sel === '.accordion-toggle-btn') {
          return el.children.flatMap((c: any) => c.querySelectorAll ? c.querySelectorAll(sel) : []);
        }
        return [];
      },
      addEventListener: (event: string, cb: Function) => {
        if (!listeners[event]) listeners[event] = [];
        listeners[event].push(cb);
      },
      dispatchEvent: (event: { type: string; stopPropagation?: Function }) => {
        const cbs = listeners[event.type] || [];
        cbs.forEach(cb => cb(event));
      }
    };
    return el;
  };

  beforeEach(() => {
    createdElements = {};
    originalDoc = (globalThis as any).document;

    const bodyEl = createMockElement('body');
    (globalThis as any).document = {
      body: bodyEl,
      getElementById: (id: string) => createdElements[id] || null,
      createElement: (tag: string) => {
        const el = createMockElement(tag);
        return el;
      },
      querySelector: (sel: string) => {
        if (sel.startsWith('#')) return createdElements[sel.substring(1)] || null;
        return null;
      }
    };
  });

  it('renders dual team tables with MVP badge, scroll container and no dead buttons', () => {
    const panel = new MatchStatsPanel();
    const stats: PlayerMatchStats[] = [
      {
        playerId: 'p1',
        playerName: 'StrikerRed',
        team: 'red',
        points: 240,
        goals: 2,
        assists: 1,
        passes: 4,
        saves: 0,
        shots: 3,
        touches: 15,
        hasHattrickBonus: false
      },
      {
        playerId: 'p2',
        playerName: 'KeeperBlue',
        team: 'blue',
        points: 380,
        goals: 0,
        assists: 0,
        passes: 8,
        saves: 3,
        shots: 0,
        touches: 20,
        hasHattrickBonus: false
      }
    ];

    panel.show(stats);
    expect(panel.isOpen()).toBe(true);

    const overlay = (globalThis as any).document.getElementById('match-stats-overlay') || (globalThis as any).document.getElementById('matchStatsModal');
    expect(overlay).not.toBeNull();
    expect(overlay.style.pointerEvents).toBe('none');
    expect(overlay.style.backgroundColor).toBe('transparent');

    const card = createdElements['match-stats-card'];
    expect(card).not.toBeNull();
    // Dual team headers
    expect(card.innerHTML).toContain('🔴 Equipo Rojo');
    expect(card.innerHTML).toContain('🔵 Equipo Azul');
    // MVP representation
    expect(card.innerHTML).toContain('KeeperBlue');
    expect(card.innerHTML).toContain('👑 MVP');
    expect(card.innerHTML).toContain('380');
    // External navigation tab
    const statsToMenuBtn = createdElements['stats-to-menu-btn'];
    expect(statsToMenuBtn).toBeDefined();
    // No "Continuar" or "X" dead buttons
    expect(card.innerHTML).not.toContain('id="btnCloseMatchStats"');
    expect(card.innerHTML).not.toContain('id="btnDismissMatchStats"');
    expect(card.innerHTML).not.toContain('Continuar');

    panel.destroy();
    (globalThis as any).document = originalDoc;
  });

  it('toggles seamlessly between MatchStatsPanel and RoomLobby via external tabs', () => {
    let slideToMenuCalled = false;
    let showStatsCalled = false;

    const panel = new MatchStatsPanel({
      onSlideToMenu: () => {
        slideToMenuCalled = true;
      }
    });

    const lobbyModalEl = createMockElement('div', 'lobbyModal', 'room-lobby-container');
    const modalContent = createMockElement('div', '', 'modal-content room-lobby-modal');
    lobbyModalEl.children.push(modalContent);
    createdElements['lobbyModal'] = lobbyModalEl;

    const lobby = new RoomLobby({
      onCreateRoom: vi.fn(),
      onJoinRoom: vi.fn(),
      onSinglePlayer: vi.fn(),
      onRefreshRooms: vi.fn()
    });

    lobby.onShowStats = () => {
      showStatsCalled = true;
      panel.slideToCenter();
    };

    // Before stats available, menuToStatsBtn is hidden
    const menuToStatsBtn = createdElements['menu-to-stats-btn'];
    expect(menuToStatsBtn).toBeDefined();
    expect(menuToStatsBtn.style.display).toBe('none');

    // Make stats available
    lobby.setStatsAvailable(true);
    expect(menuToStatsBtn.style.display).toBe('inline-flex');

    // Show stats panel
    panel.show([]);
    expect(panel.isOpen()).toBe(true);

    // Click external "Menú >" button on stats panel
    const statsToMenuBtn = createdElements['stats-to-menu-btn'];
    expect(statsToMenuBtn).toBeDefined();
    statsToMenuBtn.dispatchEvent({ type: 'click', stopPropagation: () => {} });

    expect(slideToMenuCalled).toBe(true);
    expect(panel.isOpen()).toBe(false);

    // Now click external "< Puntuaciones" button on lobby
    menuToStatsBtn.dispatchEvent({ type: 'click', stopPropagation: () => {} });
    expect(showStatsCalled).toBe(true);
    expect(panel.isOpen()).toBe(true);

    panel.destroy();
    (globalThis as any).document = originalDoc;
  });
});
