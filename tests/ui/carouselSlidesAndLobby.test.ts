import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MatchStatsPanel } from '../../src/ui/components/MatchStatsPanel';
import { RoomLobby } from '../../src/ui/components/RoomLobby';
import { PlayerMatchStats } from '../../src/core/game/GameState';
import { $matchPhase, $players } from '../../src/ui/stores/gameStore';

describe('FASE 2: Carousel Slides (Stats + Room Lobby) & Floating Buttons', () => {
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
          const [, tag, attrs, parsedId, fullContent] = match;
          const classMatch = attrs.match(/class="([^"]+)"/);
          const parsedClass = classMatch ? classMatch[1] : '';
          const child = createMockElement(tag, parsedId, parsedClass);
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
      },
      closest: (sel: string) => {
        if (sel.includes(el.id)) return el;
        if (sel.startsWith('.')) {
          const cls = sel.substring(1);
          if (el.classList?.contains?.(cls)) return el;
        }
        return null;
      }
    };

    return el;
  };

  beforeEach(() => {
    createdElements = {};
    originalDoc = (globalThis as any).document;
    originalWin = (globalThis as any).window;

    const bodyEl = createMockElement('body');
    const carouselTrack = createMockElement('div', 'carouselTrack', 'carousel-track');
    const slideStats = createMockElement('div', 'slide-stats', 'carousel-slide');
    const slideLobby = createMockElement('div', 'slide-lobby', 'carousel-slide');

    carouselTrack.appendChild(slideStats);
    carouselTrack.appendChild(slideLobby);
    bodyEl.appendChild(carouselTrack);

    (globalThis as any).document = {
      body: bodyEl,
      documentElement: bodyEl,
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

  it('Componente 1: Mounts MatchStatsPanel inside #slide-stats with .stats-card and [ Menú > ] floating button', () => {
    const panel = new MatchStatsPanel();
    const stats: PlayerMatchStats[] = [
      {
        playerId: 'p1',
        playerName: 'StrikerRed',
        team: 'red',
        points: 450,
        goals: 3,
        assists: 1,
        passes: 5,
        saves: 0,
        shots: 4,
        touches: 22,
        hasHattrickBonus: true
      },
      {
        playerId: 'p2',
        playerName: 'BlueDefender',
        team: 'blue',
        points: 210,
        goals: 1,
        assists: 0,
        passes: 8,
        saves: 2,
        shots: 1,
        touches: 18,
        hasHattrickBonus: false
      }
    ];

    panel.show(stats);

    // Verificación de tarjeta en Diapositiva 1
    const statsCard = createdElements['stats-card'] || createdElements['match-stats-card'];
    expect(statsCard).toBeDefined();

    // Marcador deportivo: RED 3 - 1 BLUE
    expect(statsCard.innerHTML).toContain('RED');
    expect(statsCard.innerHTML).toContain('BLUE');
    expect(statsCard.innerHTML).toContain('3');
    expect(statsCard.innerHTML).toContain('1');

    // Placa destacada de MVP con corona y puntaje
    expect(statsCard.innerHTML).toContain('👑 MVP');
    expect(statsCard.innerHTML).toContain('StrikerRed');
    expect(statsCard.innerHTML).toContain('450 pts');

    // Tablas paralelas RED y BLUE
    expect(statsCard.innerHTML).toContain('🔴 Equipo Rojo');
    expect(statsCard.innerHTML).toContain('🔵 Equipo Azul');

    // Botón flotante exterior [ Menú > ]
    const menuBtn = createdElements['stats-to-menu-btn'];
    expect(menuBtn).toBeDefined();
    expect(menuBtn.className).toContain('floating-nav-btn');
    expect(menuBtn.className).toContain('right-tab');

    // Al hacer click, desplaza el carrusel a -100vw
    menuBtn.click();
    const track = createdElements['carouselTrack'];
    expect(track.style.transform).toBe('translateX(-100vw)');

    panel.destroy();
  });

  it('Componente 2: Mounts RoomLobby inside #slide-lobby with .lobby-card and [ < STATS ] floating button', () => {
    const mockEvents = {
      onCreateRoom: vi.fn(),
      onJoinRoom: vi.fn(),
      onSinglePlayer: vi.fn(),
      onRefreshRooms: vi.fn()
    };

    const lobby = new RoomLobby(mockEvents);

    // Botón flotante exterior [ < STATS ] en Diapositiva 2
    const statsBtn = createdElements['lobby-to-stats-btn'];
    expect(statsBtn).toBeDefined();
    expect(statsBtn.className).toContain('floating-nav-btn');
    expect(statsBtn.className).toContain('left-tab');

    // Inicialmente oculto hasta tener partido completado
    expect(statsBtn.style.display).toBe('none');
    lobby.setStatsAvailable(true);
    expect(statsBtn.style.display).toBe('inline-flex');

    // Al hacer click, desplaza el carrusel a 0vw
    statsBtn.click();
    const track = createdElements['carouselTrack'];
    expect(track.style.transform).toBe('translateX(0vw)');

    // Tarjeta central de lobby .lobby-card
    const lobbyCard = createdElements['lobby-card'];
    expect(lobbyCard).toBeDefined();

    // Cabecera de sala con nombre, ID, Copiar Link y Leave
    expect(lobbyCard.innerHTML).toContain('Classic Match');
    expect(lobbyCard.innerHTML).toContain('btn-copy-link');
    expect(lobbyCard.innerHTML).toContain('btn-leave-room');

    // Zona izquierda: 4 reglas (tiempo, goles, bloqueo, modifiers) y estadio
    expect(lobbyCard.innerHTML).toContain('select-time-limit');
    expect(lobbyCard.innerHTML).toContain('select-goal-limit');
    expect(lobbyCard.innerHTML).toContain('btn-lock-teams');
    expect(lobbyCard.innerHTML).toContain('btn-open-physics-modifiers');
    expect(lobbyCard.innerHTML).toContain('btn-pick-stadium');

    // Ajustes avanzados: renombrar, stepper, password, public
    expect(lobbyCard.innerHTML).toContain('lobbyRenameRoomInput');
    expect(lobbyCard.innerHTML).toContain('btnDecMaxPlayers');
    expect(lobbyCard.innerHTML).toContain('btnIncMaxPlayers');
    expect(lobbyCard.innerHTML).toContain('togglePasswordCheckbox');
    expect(lobbyCard.innerHTML).toContain('togglePublicRoomCheckbox');

    // Zona derecha: Banquillos RED, SPECTATORS, BLUE
    expect(lobbyCard.innerHTML).toContain('joinRedBtn');
    expect(lobbyCard.innerHTML).toContain('joinSpecBtn');
    expect(lobbyCard.innerHTML).toContain('joinBlueBtn');
    expect(lobbyCard.innerHTML).toContain('redPlayersList');
    expect(lobbyCard.innerHTML).toContain('specPlayersList');
    expect(lobbyCard.innerHTML).toContain('bluePlayersList');

    lobby.destroy();
  });

  it('Controles FSM reactivos: Estado 0 renderiza [ ▶ INICIAR PARTIDO ] y Estados activos renderizan [ ■ DETENER ] + [ ⏸ PAUSAR ]', () => {
    const lobby = new RoomLobby({
      onCreateRoom: vi.fn(),
      onJoinRoom: vi.fn(),
      onSinglePlayer: vi.fn(),
      onRefreshRooms: vi.fn()
    });

    const lobbyCard = createdElements['lobby-card'];
    expect(lobbyCard).toBeDefined();

    // Estado 0 (STOPPED): UN SOLO botón de ancho completo verde neón
    $matchPhase.set(0);
    lobby.updateFsmControls(0);
    const startBtn = createdElements['btn-match-toggle'];
    expect(startBtn).toBeDefined();
    expect(startBtn.className).toContain('fsm-btn-start');
    expect(startBtn.textContent).toContain('INICIAR PARTIDO');

    // Estado 2 (PLAYING): Divide 50-50 en Detener + Pausar
    $matchPhase.set(2);
    lobby.updateFsmControls(2);
    const stopBtn = createdElements['btn-match-stop'];
    const pauseBtn = createdElements['btn-pause-resume'];
    expect(stopBtn).toBeDefined();
    expect(pauseBtn).toBeDefined();
    expect(stopBtn.className).toContain('fsm-btn-stop');
    expect(pauseBtn.className).toContain('fsm-btn-pause');
    expect(stopBtn.textContent).toContain('DETENER');
    expect(pauseBtn.textContent).toContain('PAUSAR');

    // Estado 3 (PAUSED): El botón de pausa conmuta a REANUDAR
    $matchPhase.set(3);
    lobby.updateFsmControls(3);
    const resumeBtn = createdElements['btn-pause-resume'];
    expect(resumeBtn.textContent).toContain('REANUDAR');

    lobby.destroy();
  });

  it('Banquillos reactivos: actualiza miembros con avatares circulares, corona de anfitrión 👑 y capitán ©', () => {
    const lobby = new RoomLobby({
      onCreateRoom: vi.fn(),
      onJoinRoom: vi.fn(),
      onSinglePlayer: vi.fn(),
      onRefreshRooms: vi.fn()
    });

    const playersMock = [
      { id: '1', name: 'AliceHost', team: 'red', isHost: true, isAdmin: true },
      { id: '2', name: 'BobCaptain', team: 'blue', isHost: false, isAdmin: true },
      { id: '3', name: 'CharlieSpec', team: 'spec', isHost: false, isAdmin: false }
    ];

    $players.set(playersMock);
    lobby.updateBenches(playersMock);

    const redCount = createdElements['redCount'];
    const blueCount = createdElements['blueCount'];
    const specCount = createdElements['specCount'];

    expect(redCount.textContent).toBe('1');
    expect(blueCount.textContent).toBe('1');
    expect(specCount.textContent).toBe('1');

    const redList = createdElements['redPlayersList'];
    expect(redList.innerHTML).toContain('AliceHost');
    expect(redList.innerHTML).toContain('👑'); // Corona de anfitrión
    expect(redList.innerHTML).toContain('©'); // Capitán / Admin
    expect(redList.innerHTML).toContain('player-avatar-circle');

    const blueList = createdElements['bluePlayersList'];
    expect(blueList.innerHTML).toContain('BobCaptain');
    expect(blueList.innerHTML).toContain('©');

    const specList = createdElements['specPlayersList'];
    expect(specList.innerHTML).toContain('CharlieSpec');

    lobby.destroy();
  });
});
