import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NicknameGatekeeper, STORAGE_KEY_LEGACYX_NICKNAME, STORAGE_KEY_NICKNAME } from '../../src/ui/components/NicknameGatekeeper';
import { RoomLobby, RoomListItem } from '../../src/ui/components/RoomLobby';
import { CreateRoomModal } from '../../src/ui/components/CreateRoomModal';

describe('FASE 4: Flujo de Entrada, Explorador de Salas y Creador de Salas (I, L, C)', () => {
  let createdElements: Record<string, any>;
  let originalDoc: any;
  let originalWin: any;
  let originalStorage: any;
  let storageStore: Map<string, string>;

  const createMockElement = (tag: string, id: string = '', className: string = ''): any => {
    const classSet = new Set(className.split(' ').filter(Boolean));
    const listeners: Record<string, Function[]> = {};
    const attributes = new Map<string, string>();

    const el: any = {
      tagName: tag.toUpperCase(),
      id,
      get className(): string {
        return Array.from(classSet).join(' ');
      },
      set className(val: string) {
        classSet.clear();
        (val || '').split(' ').filter(Boolean).forEach(c => classSet.add(c));
      },
      style: {} as Record<string, string>,
      children: [] as any[],
      parentElement: null as any,
      dataset: {} as Record<string, string>,
      value: '',
      checked: false,
      disabled: false,
      width: 560,
      height: 280,
      maxLength: 15,
      placeholder: '',
      type: 'text',
      _innerHTML: '',
      _textContent: '',
      get textContent(): string {
        if (this._textContent) return this._textContent;
        if (this.children.length > 0) {
          return this.children.map((c: any) => c.textContent).join(' ');
        }
        return this._innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      },
      set textContent(val: string) {
        this._textContent = val;
        this.children = [];
      },
      get innerHTML(): string {
        return this._innerHTML;
      },
      set innerHTML(val: string) {
        this._innerHTML = val;
        this.children = [];
        this._textContent = '';

        // Parser flexible para etiquetas y atributos
        const tagRegex = /<([a-zA-Z0-9\-]+)([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>|>)/g;
        let match;
        while ((match = tagRegex.exec(val)) !== null) {
          const [, tagName, rawAttrs, innerContent] = match;
          if (tagName.toLowerCase() === 'option') continue; // opciones simples

          const idMatch = rawAttrs.match(/id="([^"]+)"/);
          const parsedId = idMatch ? idMatch[1] : '';

          const classMatch = rawAttrs.match(/class="([^"]+)"/);
          const parsedClass = classMatch ? classMatch[1] : '';

          const child = createMockElement(tagName, parsedId, parsedClass);

          const phMatch = rawAttrs.match(/placeholder="([^"]+)"/);
          if (phMatch) child.placeholder = phMatch[1];

          const mlMatch = rawAttrs.match(/maxlength="([^"]+)"/);
          if (mlMatch) child.maxLength = parseInt(mlMatch[1], 10);

          const typeMatch = rawAttrs.match(/type="([^"]+)"/);
          if (typeMatch) child.type = typeMatch[1];

          const valueMatch = rawAttrs.match(/value="([^"]+)"/);
          if (valueMatch) child.value = valueMatch[1];

          if (/\bchecked\b/.test(rawAttrs)) {
            child.checked = true;
          }

          if (innerContent !== undefined && innerContent.trim()) {
            if (innerContent.includes('<')) {
              child.innerHTML = innerContent;
            } else {
              child.textContent = innerContent.trim();
            }
          }

          if (parsedId) {
            createdElements[parsedId] = child;
          }
          child.parentElement = el;
          el.children.push(child);
        }
      },
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
      setAttribute: (name: string, v: string) => attributes.set(name, v),
      getAttribute: (name: string) => attributes.get(name) || null,
      removeAttribute: (name: string) => attributes.delete(name),
      appendChild: (child: any) => {
        if (child.id) createdElements[child.id] = child;
        child.parentElement = el;
        el.children.push(child);
        return child;
      },
      removeChild: (child: any) => {
        const idx = el.children.indexOf(child);
        if (idx !== -1) el.children.splice(idx, 1);
        child.parentElement = null;
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
        const eventType = typeof event === 'string' ? event : event?.type || 'click';
        const cbs = listeners[eventType] || [];
        const evtObj = typeof event === 'object' ? event : { type: eventType, target: el };
        cbs.forEach(cb => cb(evtObj));
        return true;
      },
      click: () => {
        const cbs = listeners['click'] || [];
        const evt = {
          type: 'click',
          preventDefault: vi.fn(),
          stopPropagation: vi.fn(),
          target: el
        };
        cbs.forEach(cb => cb(evt));
      },
      focus: vi.fn(),
      select: vi.fn(),
      querySelector: (sel: string) => {
        const all = el.querySelectorAll(sel);
        return all.length > 0 ? all[0] : null;
      },
      querySelectorAll: (sel: string) => {
        const matchNode = (node: any, selector: string): boolean => {
          if (!node) return false;
          let target = selector.trim();
          let tag = '';
          let id = '';
          let cls: string[] = [];

          const tagM = target.match(/^([a-zA-Z0-9]+)/);
          if (tagM) {
            tag = tagM[1].toUpperCase();
            target = target.substring(tagM[1].length);
          }
          const idM = target.match(/#([a-zA-Z0-9\-_]+)/);
          if (idM) {
            id = idM[1];
            target = target.replace('#' + id, '');
          }
          const clsM = target.match(/\.([a-zA-Z0-9\-_]+)/g);
          if (clsM) {
            cls = clsM.map(c => c.substring(1));
          }

          if (tag && node.tagName !== tag) return false;
          if (id && node.id !== id) return false;
          if (cls.length > 0 && !cls.every(c => node.classList?.contains?.(c))) return false;
          return true;
        };

        const parts = sel.trim().split(/\s+/);
        let currentLevel = [el];
        for (const part of parts) {
          const nextLevel: any[] = [];
          for (const parent of currentLevel) {
            const search = (node: any) => {
              for (const c of node.children || []) {
                if (matchNode(c, part)) {
                  nextLevel.push(c);
                }
                search(c);
              }
            };
            search(parent);
          }
          currentLevel = nextLevel;
        }
        return currentLevel;
      }
    };

    if (id) createdElements[id] = el;
    return el;
  };

  beforeEach(() => {
    createdElements = {};
    storageStore = new Map();
    originalDoc = (globalThis as any).document;
    originalWin = (globalThis as any).window;
    originalStorage = (globalThis as any).localStorage;

    const mockStorage = {
      getItem: (key: string) => storageStore.get(key) ?? null,
      setItem: (key: string, val: string) => storageStore.set(key, String(val)),
      removeItem: (key: string) => storageStore.delete(key),
      clear: () => storageStore.clear()
    };
    (globalThis as any).localStorage = mockStorage;

    const bodyEl = createMockElement('body');
    const docEl = createMockElement('html');

    // Elementos base requeridos por los componentes
    const nickModal = createMockElement('div', 'nicknameGatekeeperModal', 'modal-overlay modal-backdrop modal-nickname u-hidden');
    const nickCard = createMockElement('div', 'gatekeeperModalContent', 'gatekeeper-card modal-content');
    nickModal.appendChild(nickCard);
    bodyEl.appendChild(nickModal);

    const lobbyModal = createMockElement('div', 'lobbyModal', 'modal-overlay modal-backdrop lobby-container room-lobby-container u-hidden');
    const lobbyBrowser = createMockElement('div', '', 'lobby-browser-container');
    lobbyModal.appendChild(lobbyBrowser);
    bodyEl.appendChild(lobbyModal);

    const createModal = createMockElement('div', 'createRoomModal', 'modal-overlay modal-backdrop u-hidden');
    const createCard = createMockElement('div', 'createRoomCard', 'create-room-card modal-container');
    createModal.appendChild(createCard);
    bodyEl.appendChild(createModal);

    const slideLobby = createMockElement('div', 'slide-lobby', 'carousel-slide');
    bodyEl.appendChild(slideLobby);

    (globalThis as any).document = {
      body: bodyEl,
      documentElement: docEl,
      getElementById: (id: string) => createdElements[id] || null,
      querySelector: (sel: string) => {
        if (sel.startsWith('#')) return createdElements[sel.substring(1)] || null;
        return bodyEl.querySelector(sel);
      },
      querySelectorAll: (sel: string) => bodyEl.querySelectorAll(sel),
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
    (globalThis as any).localStorage = originalStorage;
  });

  describe('Pantalla 1: [I] INICIO (NicknameGatekeeper)', () => {
    it('construye la tarjeta central Cyber-Pitch con logo LEGACYX-GO, subtítulo y estilos deportivos', () => {
      const gatekeeper = new NicknameGatekeeper();
      expect(gatekeeper).toBeTruthy();
      const modal = document.getElementById('nicknameGatekeeperModal');
      expect(modal).toBeTruthy();

      const card = modal?.querySelector('.gatekeeper-card');
      expect(card).toBeTruthy();

      const title = card?.querySelector('.gatekeeper-title');
      expect(title?.textContent?.trim()).toBe('LEGACYX-GO');

      const subtitle = card?.querySelector('.gatekeeper-subtitle');
      expect(subtitle?.textContent?.trim()).toContain('Simulador de Fútbol Físico P2P WebRTC');

      const input = card?.querySelector('#gatekeeperNicknameInput') as any;
      expect(input).toBeTruthy();
      expect(input.placeholder).toBe('Ej. Vitão_10');
      expect(input.maxLength).toBe(15);

      const ctaBtn = card?.querySelector('#btnSaveNickname') as any;
      expect(ctaBtn).toBeTruthy();
      expect(ctaBtn.textContent?.trim()).toContain('ENTRAR AL JUEGO ▶');
    });

    it('valida estrictamente la longitud de nickname (2 a 15 caracteres) mostrando advertencia discreta', () => {
      const gatekeeper = new NicknameGatekeeper();
      const input = document.getElementById('gatekeeperNicknameInput') as any;
      const ctaBtn = document.getElementById('btnSaveNickname') as any;
      const errorEl = document.getElementById('gatekeeperError') as any;

      const confirmedSpy = vi.fn();
      gatekeeper.onNicknameConfirmed = confirmedSpy;

      // Intento con 1 carácter (inválido según requerimiento)
      input.value = 'A';
      ctaBtn.click();
      expect(errorEl.style.display).toBe('block');
      expect(errorEl.textContent).toContain('El nick debe tener entre 2 y 15 caracteres');
      expect(confirmedSpy).not.toHaveBeenCalled();

      // Intento con espacios en blanco (inválido)
      input.value = '   ';
      ctaBtn.click();
      expect(errorEl.style.display).toBe('block');
      expect(confirmedSpy).not.toHaveBeenCalled();

      // Intento válido (2 a 15 caracteres)
      input.value = 'Vitão_10';
      ctaBtn.click();
      expect(errorEl.style.display).toBe('none');
      expect(confirmedSpy).toHaveBeenCalledWith('Vitão_10');
      expect(localStorage.getItem(STORAGE_KEY_LEGACYX_NICKNAME)).toBe('Vitão_10');
      expect(localStorage.getItem(STORAGE_KEY_NICKNAME)).toBe('Vitão_10');
    });

    it('recupera automáticamente el apodo guardado en localStorage al instanciar o mostrar', () => {
      localStorage.setItem(STORAGE_KEY_LEGACYX_NICKNAME, 'Striker_9');
      const gatekeeper = new NicknameGatekeeper();
      gatekeeper.show();

      const input = document.getElementById('gatekeeperNicknameInput') as any;
      expect(input.value).toBe('Striker_9');
    });
  });

  describe('Pantalla 2: [L] LOBBY (Explorador / Navegador de Servidores)', () => {
    it('monta el contenedor de gran formato .lobby-browser-container con barra superior y contadores', () => {
      const mockEvents = {
        onCreateRoom: vi.fn(),
        onJoinRoom: vi.fn(),
        onSinglePlayer: vi.fn(),
        onRefreshRooms: vi.fn(),
        onEditNickname: vi.fn()
      };

      const lobby = new RoomLobby(mockEvents);
      lobby.updateUserBar('Captain_7');

      const nickEl = document.getElementById('lobbyCurrentNick');
      expect(nickEl?.textContent).toBe('Captain_7');

      const editBtn = document.getElementById('btnEditNickname');
      expect(editBtn).toBeTruthy();
      editBtn?.click();
      expect(mockEvents.onEditNickname).toHaveBeenCalled();

      const createBtn = document.getElementById('btnOpenCreateRoomModal');
      expect(createBtn).toBeTruthy();
      expect(createBtn?.textContent).toContain('+ CREAR SALA');
    });

    it('renderiza reactivamente la tabla de salas públicas con estado, estadio, jugadores y ping', () => {
      const mockEvents = {
        onCreateRoom: vi.fn(),
        onJoinRoom: vi.fn(),
        onSinglePlayer: vi.fn(),
        onRefreshRooms: vi.fn()
      };

      const lobby = new RoomLobby(mockEvents);

      const rooms: RoomListItem[] = [
        {
          id: 'ROOM-101',
          name: 'Liga Pro 3v3',
          playerCount: 4,
          maxPlayers: 6,
          isPrivate: false,
          stadiumName: 'AF 3v3 Official',
          status: 'PLAYING',
          ping: 18,
          region: 'SA'
        },
        {
          id: 'ROOM-102',
          name: 'Privada Clásica',
          playerCount: 2,
          maxPlayers: 4,
          isPrivate: true,
          stadiumName: 'Mediano (3v3 Clásico)',
          status: 'LOBBY',
          ping: 28
        }
      ];

      lobby.setRoomList(rooms);

      // Comprobar contadores en tiempo real
      const roomsCount = document.getElementById('lobbyRoomsCount');
      const playersCount = document.getElementById('lobbyPlayersCount');
      expect(roomsCount?.textContent).toBe('2');
      expect(playersCount?.textContent).toBe('6'); // 4 + 2

      const tableRows = document.querySelectorAll('#lobbyRoomList tr.room-row');
      expect(tableRows.length).toBe(2);

      // Primera fila
      const firstRow = tableRows[0];
      expect(firstRow.textContent).toContain('EN JUEGO');
      expect(firstRow.textContent).toContain('Liga Pro 3v3');
      expect(firstRow.textContent).toContain('AF 3v3 Official');
      expect(firstRow.textContent).toContain('4');
      expect(firstRow.textContent).toContain('18ms');

      // Click en unirse a sala pública directa
      const joinBtnFirst = firstRow.querySelector('.btn-join-room-row') as any;
      joinBtnFirst.click();
      expect(mockEvents.onJoinRoom).toHaveBeenCalledWith(expect.any(String), 'ROOM-101');
    });

    it('filtra salas por búsqueda rápida, ocultar llenas y ocultar salas con contraseña', () => {
      const lobby = new RoomLobby({
        onCreateRoom: vi.fn(),
        onJoinRoom: vi.fn(),
        onSinglePlayer: vi.fn(),
        onRefreshRooms: vi.fn()
      });

      const rooms: RoomListItem[] = [
        { id: 'R1', name: 'Sala Abierta', playerCount: 2, maxPlayers: 6, isPrivate: false },
        { id: 'R2', name: 'Sala Llena', playerCount: 6, maxPlayers: 6, isPrivate: false },
        { id: 'R3', name: 'Sala Secreta', playerCount: 1, maxPlayers: 6, isPrivate: true }
      ];

      lobby.setRoomList(rooms);
      expect(document.querySelectorAll('#lobbyRoomList tr.room-row').length).toBe(3);

      // Filtro ocultar llenas
      const hideFull = document.getElementById('filterHideFullRooms') as any;
      hideFull.checked = true;
      hideFull.dispatchEvent('change');
      expect(document.querySelectorAll('#lobbyRoomList tr.room-row').length).toBe(2);

      // Filtro ocultar privadas
      const hideLocked = document.getElementById('filterHideLockedRooms') as any;
      hideLocked.checked = true;
      hideLocked.dispatchEvent('change');
      expect(document.querySelectorAll('#lobbyRoomList tr.room-row').length).toBe(1);

      // Búsqueda por texto
      const search = document.getElementById('lobbySearchInput') as any;
      search.value = 'Inexistente';
      search.dispatchEvent('input');
      expect(document.querySelectorAll('#lobbyRoomList tr.room-row').length).toBe(0);

      // Empty State visible
      const emptyText = document.getElementById('lobbyRoomList')?.textContent;
      expect(emptyText).toContain('No hay salas públicas abiertas en este momento');
    });

    it('muestra el modal flotante de contraseña para unirse a salas protegidas', () => {
      const mockEvents = {
        onCreateRoom: vi.fn(),
        onJoinRoom: vi.fn(),
        onSinglePlayer: vi.fn(),
        onRefreshRooms: vi.fn()
      };

      const lobby = new RoomLobby(mockEvents);
      lobby.setRoomList([
        { id: 'R-LOCK', name: 'Sala VIP', playerCount: 1, maxPlayers: 6, isPrivate: true }
      ]);

      const joinBtn = document.querySelector('.btn-join-room-row') as any;
      joinBtn.click();

      const passModal = document.getElementById('roomPasswordPromptModal');
      expect(passModal?.style.display).toBe('flex');

      const passInput = document.getElementById('roomPasswordPromptInput') as any;
      passInput.value = '1234';

      const confirmBtn = document.getElementById('btnConfirmRoomPassword') as any;
      confirmBtn.click();

      expect(mockEvents.onJoinRoom).toHaveBeenCalledWith(expect.any(String), 'R-LOCK', '1234');
      expect(passModal?.style.display).toBe('none');
    });
  });

  describe('Pantalla 3: [C] CREAR SALA (CreateRoomModal)', () => {
    it('monta el chasis superpuesto con navegación exterior, stepper de jugadores y los 4 botones de reglas', () => {
      const submitSpy = vi.fn();
      const closeSpy = vi.fn();

      const createModal = new CreateRoomModal({
        onSubmit: submitSpy,
        onClose: closeSpy
      });

      const modalEl = document.getElementById('createRoomModal');
      expect(modalEl).toBeTruthy();

      // Navegación exterior
      const backBtn = document.getElementById('btnCreateRoomBack');
      expect(backBtn).toBeTruthy();
      backBtn?.click();
      expect(closeSpy).toHaveBeenCalled();

      // Stepper horizontal de jugadores
      const display = document.getElementById('createRoomMaxPlayersDisplay');
      const incBtn = document.getElementById('btnIncMaxPlayersCreate');
      const decBtn = document.getElementById('btnDecMaxPlayersCreate');

      expect(display?.textContent?.trim()).toBe('6');
      incBtn?.click();
      expect(display?.textContent?.trim()).toBe('7');
      decBtn?.click();
      decBtn?.click();
      expect(display?.textContent?.trim()).toBe('5');

      // Fila de 4 Reglas
      const timeSelect = document.getElementById('newRoomTimeLimitInput') as any;
      const scoreSelect = document.getElementById('newRoomScoreLimitInput') as any;
      const lockTeamsBtn = document.getElementById('btnCreateRoomLockTeams') as any;
      const modBtn = document.getElementById('btnCreateRoomModifiers') as any;

      expect(timeSelect).toBeTruthy();
      expect(scoreSelect).toBeTruthy();
      expect(lockTeamsBtn).toBeTruthy();
      expect(modBtn).toBeTruthy();

      // Conmutar bloqueo de equipos
      lockTeamsBtn.click();
      expect(lockTeamsBtn.textContent).toContain('Equipos Bloqueados');

      // Preview 2D Cenital de Estadio
      const canvas = document.getElementById('createRoomStadiumCanvas') as any;
      const stadiumLabel = document.getElementById('createRoomStadiumName');
      expect(canvas).toBeTruthy();
      expect(stadiumLabel?.textContent).toContain('AF 3v3 Official');

      // Conectar con StadiumSelectModal sin desmontar
      const changeStadiumBtn = document.getElementById('btnChangeStadiumInCreate');
      expect(changeStadiumBtn).toBeTruthy();
      expect(createModal.stadiumModal).toBeTruthy();

      // Simular cambio de estadio vía selector
      createModal.setStadium('classic');
      expect(stadiumLabel?.textContent).toContain('Mediano (3v3 Clásico)');

      // Envío CTA Principal
      const roomNameInput = document.getElementById('newRoomNameInput') as any;
      roomNameInput.value = 'Torneo Nocturno';
      timeSelect.value = '5';
      scoreSelect.value = '3';

      const submitBtn = document.getElementById('btnCreateRoomSubmit') as any;
      submitBtn.click();

      expect(submitSpy).toHaveBeenCalledWith({
        name: 'Torneo Nocturno',
        maxPlayers: 5,
        timeLimit: 5,
        scoreLimit: 3,
        isPrivate: false,
        password: '',
        stadiumId: 'classic',
        teamsLocked: true,
        isPublic: true
      });
    });
  });
});
