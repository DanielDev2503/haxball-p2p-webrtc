import { CreateRoomModal, CreateRoomModalConfig } from './CreateRoomModal';
import { renderIcon, PlusSquare, Search, RefreshCw, Sun, Moon } from '../utils/icons';
import { $theme, toggleTheme, $matchPhase, $players, $roomConfig } from '../stores/gameStore';
import { PlayerMatchStats } from '../../core/game/GameState';

export interface LobbyRoomConfig {
  name: string;
  maxPlayers: number;
  isPrivate: boolean;
  password?: string | undefined;
  timeLimit: number;
  scoreLimit: number;
  teamsLocked: boolean;
  stadiumId?: string | undefined;
  isPublic?: boolean | undefined;
}

export interface LobbyEvents {
  onCreateRoom: (nickname: string, config: LobbyRoomConfig) => void;
  onJoinRoom: (nickname: string, roomId: string, password?: string) => void | Promise<boolean>;
  onSinglePlayer: (nickname: string) => void;
  onRefreshRooms: () => void;
  onEditNickname?: () => void;
  onCancelConnecting?: () => void;
}

export interface RoomListItem {
  id: string;
  name: string;
  playerCount: number;
  maxPlayers?: number;
  isPrivate?: boolean;
  timeLimit?: number;
  scoreLimit?: number;
  stadiumName?: string;
  status?: 'LOBBY' | 'PLAYING' | string;
  ping?: number;
  region?: string;
}

export class RoomLobby {
  private overlayEl: HTMLElement | null = null;
  private slideLobbyEl: HTMLElement | null = null;
  private lobbyWrapperEl: HTMLElement | null = null;
  private lobbyCardEl: HTMLElement | null = null;

  private nicknameInput: HTMLInputElement | null = null;
  private userAvatarEl: HTMLElement | null = null;
  private currentNickEl: HTMLElement | null = null;
  private editNickBtn: HTMLButtonElement | null = null;
  private signalingDotEl: HTMLElement | null = null;
  private signalingTextEl: HTMLElement | null = null;
  private loadingOverlayEl: HTMLElement | null = null;
  private loadingTextEl: HTMLElement | null = null;
  private cancelConnectingBtn: HTMLButtonElement | null = null;

  private openCreateRoomBtn: HTMLButtonElement | null = null;
  private searchInput: HTMLInputElement | null = null;
  private refreshRoomsBtn: HTMLButtonElement | null = null;
  private roomIdInput: HTMLInputElement | null = null;
  private roomListContainer: HTMLElement | null = null;

  // Elementos específicos del Explorador de Salas (#lobbyModal)
  private roomsCountEl: HTMLElement | null = null;
  private playersCountEl: HTMLElement | null = null;
  private hideFullCheckbox: HTMLInputElement | null = null;
  private hideLockedCheckbox: HTMLInputElement | null = null;
  private practiceBtn: HTMLButtonElement | null = null;
  private settingsBtn: HTMLButtonElement | null = null;
  private passwordPromptModal: HTMLElement | null = null;
  private passwordPromptInput: HTMLInputElement | null = null;
  private passwordPromptText: HTMLElement | null = null;
  private confirmPasswordBtn: HTMLButtonElement | null = null;
  private cancelPasswordBtn: HTMLButtonElement | null = null;
  private pendingJoinRoomId: string | null = null;

  public lobbyToStatsBtn: HTMLButtonElement | null = null;
  public get menuToStatsBtn(): HTMLButtonElement | null {
    return this.lobbyToStatsBtn;
  }
  public hasCompletedMatch: boolean = false;
  public lastStats: PlayerMatchStats[] = [];
  public matchStatsPanel?: { show: (stats: PlayerMatchStats[], mvpId?: string | null) => void };

  public createRoomModal: CreateRoomModal;
  private events: LobbyEvents;
  private cachedRooms: RoomListItem[] = [];
  public onShowStats?: () => void;
  public gameApp?: any;

  // Estado reactivo de sala in-game
  public roomName: string = 'Classic Match';
  public roomId: string = 'ROOM-001';
  public maxPlayers: number = 12;
  public timeLimit: number = 3;
  public goalLimit: number = 3;
  public teamsLocked: boolean = false;
  public currentStadiumName: string = 'AF 3v3 Official by Vitão ®';
  public currentMatchPhase: number = 0;

  private unsubs: Array<() => void> = [];

  private getTrack(): HTMLElement | null {
    if (typeof document === 'undefined') return null;
    return (typeof document.getElementById === 'function' ? document.getElementById('carouselTrack') : null) ||
           (typeof document.querySelector === 'function' ? document.querySelector('.carousel-track') : null) as HTMLElement | null;
  }

  constructor(events: LobbyEvents) {
    this.events = events;

    // 1. Inyección de DOM dinámico dentro de #slide-lobby (Diapositiva 2)
    this.buildSlideLobbyDOM();

    // 2. Montar estructura Cyber-Pitch en #lobbyModal (Explorador de salas públicas)
    this.overlayEl = document.getElementById('lobbyModal') || document.querySelector('.lobby-container') || document.querySelector('.room-lobby-container');
    if (this.overlayEl) {
      this.buildLobbyBrowserDOM();
    }

    // Inyección del botón de navegación hacia Estadísticas
    this.renderStatsNavigationTab();

    if (typeof window !== 'undefined') {
      window.addEventListener('chat:resize', (e: Event) => {
        const customEvent = e as CustomEvent<{ height: number }>;
        const h = customEvent?.detail?.height ?? 180;
        const content = this.overlayEl?.querySelector('.room-lobby-modal, .modal-content, .lobby-browser-container') as HTMLElement | null;
        if (content) {
          content.style.maxHeight = `calc(100vh - ${h}px - 90px)`;
        }
        if (this.lobbyCardEl) {
          this.lobbyCardEl.style.maxHeight = `calc(100vh - ${h}px - 70px)`;
        }
      });
    }

    this.cacheBrowserElements();

    // Instancia de CreateRoomModal
    this.createRoomModal = new CreateRoomModal({
      onSubmit: (config: CreateRoomModalConfig) => {
        const nick = this.getNickname();
        const lobbyConfig: LobbyRoomConfig = {
          ...config,
          teamsLocked: config.teamsLocked ?? false,
          stadiumId: config.stadiumId,
          isPublic: config.isPublic ?? true
        };
        this.events.onCreateRoom(nick, lobbyConfig);
      }
    });

    this.renderIcons();
    this.setupThemeToggle();
    this.setupListeners();

    // Suscripciones reactivas a nano stores para actualización en tiempo real
    this.unsubs.push(
      $matchPhase.subscribe((phase) => {
        this.currentMatchPhase = phase;
        this.updateFsmControls(phase);
      })
    );

    this.unsubs.push(
      $players.subscribe((playerList) => {
        if (playerList && Array.isArray(playerList)) {
          this.updateBenches(playerList);
        }
      })
    );

    this.unsubs.push(
      $roomConfig.subscribe((cfg) => {
        if (cfg) {
          this.timeLimit = cfg.timeLimit ?? 3;
          this.goalLimit = cfg.goalLimit ?? 3;
          this.teamsLocked = cfg.teamsLocked ?? false;
          if (cfg.stadiumId) {
            this.currentStadiumName = cfg.stadiumId;
          }
          this.updateConfigElements();
        }
      })
    );
  }

  /**
   * Monta e inyecta dinámicamente la estructura del Explorador de Salas Públicas dentro de #lobbyModal
   */
  private buildLobbyBrowserDOM(): void {
    if (!this.overlayEl) return;

    this.overlayEl.classList.add('room-lobby-container', 'modal-overlay', 'modal-backdrop');
    this.overlayEl.style.position = 'fixed';
    this.overlayEl.style.inset = '0';
    this.overlayEl.style.zIndex = '250';
    this.overlayEl.style.background = 'rgba(0, 0, 0, 0.75)';
    this.overlayEl.style.display = 'none';
    this.overlayEl.style.alignItems = 'center';
    this.overlayEl.style.justifyContent = 'center';

    let browserContainer = this.overlayEl.querySelector('.lobby-browser-container') as HTMLElement | null;
    if (!browserContainer) {
      browserContainer = document.createElement('div');
      browserContainer.className = 'lobby-browser-container';
      this.overlayEl.innerHTML = '';
      this.overlayEl.appendChild(browserContainer);
    }

    browserContainer.innerHTML = `
      <!-- A. Barra Superior del Lobby -->
      <header class="lobby-browser-topbar">
        <!-- Izquierda: Logo compacto y badge de usuario activo -->
        <div class="lobby-top-left" style="display: flex; align-items: center; gap: 14px;">
          <span class="lobby-brand-logo font-sports" style="font-size: 20px; font-weight: 800; color: #00e5ff; text-shadow: 0 0 10px rgba(0,229,255,0.6); letter-spacing: 1.5px;">
            LEGACYX-GO
          </span>
          <div class="lobby-user-badge" id="lobbyUserBadge" style="display: flex; align-items: center; gap: 8px; background: rgba(18, 26, 41, 0.85); border: 1px solid var(--border-cyan); border-radius: 20px; padding: 4px 12px;">
            <span style="font-size: 13px;">👤</span>
            <span id="lobbyCurrentNick" style="font-size: 13px; font-weight: 700; color: #f0f8ff;">Player</span>
            <button id="btnEditNickname" class="btn-subtle-edit" title="Editar Nickname" style="background: none; border: none; color: var(--neon-cyan); cursor: pointer; padding: 0 2px; font-size: 12px;">✏️</button>
          </div>
          <!-- Indicador sutil de señalización -->
          <div class="lobby-signaling-status" id="lobbySignalingStatus" style="display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--text-secondary);">
            <span class="status-dot-connected" id="lobbySignalingDot"></span>
            <span id="lobbySignalingText">Online</span>
          </div>
        </div>

        <!-- Centro: Contador en tiempo real -->
        <div class="lobby-top-center font-mono" id="lobbyCountersBadge" style="font-size: 12px; font-weight: 700; color: #cbd5e1; background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(0, 229, 255, 0.2); border-radius: 6px; padding: 6px 14px;">
          Salas Activas: <span id="lobbyRoomsCount" style="color: var(--neon-cyan);">0</span> | Jugadores Online: <span id="lobbyPlayersCount" style="color: #2ecc71;">0</span>
        </div>

        <!-- Derecha: Práctica, Ajustes, Tema, CTA [+ CREAR SALA] -->
        <div class="lobby-top-right" style="display: flex; align-items: center; gap: 10px;">
          <button id="btnPracticeMode" class="btn btn-secondary btn-xs" style="padding: 7px 12px; font-size: 12px; font-weight: 700;" title="Jugar en Solitario / Práctica">
            ⚽ Práctica
          </button>
          <button id="btnLobbySettings" class="hud-btn-circle icon-btn" title="Ajustes (⚙)">
            ⚙
          </button>
          <button id="lobbyThemeToggleBtn" class="hud-btn-circle icon-btn theme-toggle-btn" title="Alternar Tema (☼ / ☾)">
            ☼
          </button>
          <button id="btnOpenCreateRoomModal" class="btn btn-primary btn-cta-create-room" style="background: #2ecc71; color: #05150c; height: 40px; padding: 0 16px; font-weight: 800; font-size: 13px; border-radius: 8px; border: none; cursor: pointer; display: flex; align-items: center; gap: 6px; letter-spacing: 0.5px;">
            <span>+ CREAR SALA</span>
          </button>
        </div>
      </header>

      <!-- B. Barra de Filtros y Búsqueda -->
      <div class="lobby-filter-bar">
        <!-- Input de búsqueda rápida -->
        <div style="flex: 1; position: relative; display: flex; align-items: center;">
          <span style="position: absolute; left: 12px; color: var(--neon-cyan); font-size: 13px;">🔍</span>
          <input id="lobbySearchInput" type="text" placeholder="Buscar por nombre de sala..." class="form-input" style="width: 100%; padding-left: 34px; height: 38px; background: rgba(10, 16, 26, 0.85); border: 1px solid var(--border-cyan); border-radius: 6px; color: #fff; font-size: 13px;" />
        </div>

        <!-- Toggles de filtro y Refresco manual -->
        <div style="display: flex; align-items: center; gap: 16px;">
          <label style="display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-secondary); cursor: pointer; font-weight: 600; user-select: none;">
            <input type="checkbox" id="filterHideFullRooms" />
            <span>Ocultar salas llenas</span>
          </label>
          <label style="display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-secondary); cursor: pointer; font-weight: 600; user-select: none;">
            <input type="checkbox" id="filterHideLockedRooms" />
            <span>Ocultar salas con contraseña</span>
          </label>
          <button id="btnRefreshRooms" class="btn btn-secondary btn-xs" style="height: 38px; padding: 0 14px; display: flex; align-items: center; gap: 6px; font-weight: 700; font-size: 12px;" title="Actualizar lista de salas">
            <span>⟳ Actualizar</span>
          </button>
        </div>
      </div>

      <!-- C. Tabla de Servidores / Salas Públicas -->
      <div class="room-table-container cyber-scrollbar">
        <table class="room-table">
          <thead>
            <tr>
              <th style="width: 110px;">ESTADO</th>
              <th>NOMBRE DE LA SALA</th>
              <th style="width: 180px;">ESTADIO</th>
              <th style="width: 120px; text-align: center;">JUGADORES</th>
              <th style="width: 120px; text-align: center;">PING / REGIÓN</th>
              <th style="width: 110px; text-align: right;">ACCIÓN</th>
            </tr>
          </thead>
          <tbody id="lobbyRoomList">
          </tbody>
        </table>
      </div>

      <!-- Barra Inferior de Conexión Directa -->
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 10px; padding-top: 8px; border-top: 1px solid rgba(0, 229, 255, 0.15); font-size: 12px;">
        <span style="color: var(--text-secondary);">¿Tienes un ID de sala directo?</span>
        <div style="display: flex; gap: 8px; align-items: center;">
          <input id="lobbyRoomId" type="text" placeholder="ID de sala (ej. ROOM-123)" class="form-input" style="width: 220px; height: 32px; font-size: 12px; font-family: var(--font-mono); text-transform: uppercase;" />
          <button id="btnJoinRoom" class="btn btn-secondary btn-xs" style="height: 32px; padding: 0 14px; font-weight: 700;">Unirse</button>
        </div>
      </div>

      <!-- Mini-Prompt Modal Flotante para Contraseña de Sala -->
      <div id="roomPasswordPromptModal" class="modal-overlay u-hidden" style="display: none; position: absolute; inset: 0; background: rgba(0,0,0,0.8); z-index: 50; align-items: center; justify-content: center;">
        <div style="background: rgba(10, 16, 26, 0.98); border: 1px solid var(--border-cyan); border-radius: 10px; padding: 22px; width: 340px; display: flex; flex-direction: column; gap: 14px; box-shadow: 0 10px 30px rgba(0,0,0,0.9);">
          <h3 style="margin: 0; font-size: 14px; font-weight: 800; color: #fff; display: flex; align-items: center; gap: 6px;">
            <span>🔒 Sala Protegida</span>
          </h3>
          <p id="roomPasswordPromptText" style="margin: 0; font-size: 12px; color: var(--text-secondary);">Ingresa la clave para acceder a la sala.</p>
          <input id="roomPasswordPromptInput" type="password" placeholder="Contraseña..." class="form-input" style="height: 36px; background: rgba(18, 26, 41, 0.9); border: 1px solid var(--border-cyan); border-radius: 6px; color: #fff; padding: 0 10px; font-size: 13px;" />
          <div style="display: flex; gap: 10px; justify-content: flex-end;">
            <button id="btnCancelRoomPassword" class="btn btn-secondary btn-xs" style="padding: 6px 14px;">Cancelar</button>
            <button id="btnConfirmRoomPassword" class="btn btn-primary btn-xs" style="padding: 6px 14px; background: var(--neon-cyan); color: #05150c; font-weight: 700;">Entrar</button>
          </div>
        </div>
      </div>

      <!-- Overlay Transitorio de Conexión P2P -->
      <div id="lobbyLoadingOverlay" class="lobby-loading-overlay" style="display: none;">
        <div class="loading-spinner"></div>
        <span id="lobbyLoadingText" class="loading-text" style="color: var(--neon-cyan); font-weight: 700;">Conectando P2P...</span>
        <button id="btnCancelConnecting" class="btn btn-danger btn-xs" type="button" style="margin-top: 6px;">Cancelar</button>
      </div>
    `;
  }

  private cacheBrowserElements(): void {
    if (typeof document === 'undefined') return;
    this.nicknameInput = document.getElementById('lobbyNickname') as HTMLInputElement | null;
    this.userAvatarEl = document.getElementById('lobbyUserAvatar');
    this.currentNickEl = document.getElementById('lobbyCurrentNick');
    this.editNickBtn = document.getElementById('btnEditNickname') as HTMLButtonElement | null;
    this.signalingDotEl = document.getElementById('lobbySignalingDot');
    this.signalingTextEl = document.getElementById('lobbySignalingText');
    this.loadingOverlayEl = document.getElementById('lobbyLoadingOverlay');
    this.loadingTextEl = document.getElementById('lobbyLoadingText');
    this.cancelConnectingBtn = document.getElementById('btnCancelConnecting') as HTMLButtonElement | null;

    this.openCreateRoomBtn = document.getElementById('btnOpenCreateRoomModal') as HTMLButtonElement | null;
    this.searchInput = document.getElementById('lobbySearchInput') as HTMLInputElement | null;
    this.refreshRoomsBtn = document.getElementById('btnRefreshRooms') as HTMLButtonElement | null;
    this.roomIdInput = document.getElementById('lobbyRoomId') as HTMLInputElement | null;
    this.roomListContainer = document.getElementById('lobbyRoomList');

    this.roomsCountEl = document.getElementById('lobbyRoomsCount');
    this.playersCountEl = document.getElementById('lobbyPlayersCount');
    this.hideFullCheckbox = document.getElementById('filterHideFullRooms') as HTMLInputElement | null;
    this.hideLockedCheckbox = document.getElementById('filterHideLockedRooms') as HTMLInputElement | null;
    this.settingsBtn = document.getElementById('btnLobbySettings') as HTMLButtonElement | null;
    this.practiceBtn = document.getElementById('btnPracticeMode') as HTMLButtonElement | null;

    this.passwordPromptModal = document.getElementById('roomPasswordPromptModal');
    this.passwordPromptInput = document.getElementById('roomPasswordPromptInput') as HTMLInputElement | null;
    this.passwordPromptText = document.getElementById('roomPasswordPromptText');
    this.confirmPasswordBtn = document.getElementById('btnConfirmRoomPassword') as HTMLButtonElement | null;
    this.cancelPasswordBtn = document.getElementById('btnCancelRoomPassword') as HTMLButtonElement | null;
  }

  /**
   * Monta e inyecta dinámicamente la estructura del DOM de la Diapositiva 2 (#slide-lobby)
   */
  private buildSlideLobbyDOM(): void {
    if (typeof document === 'undefined') return;

    const slideLobby = document.getElementById('slide-lobby');
    if (!slideLobby) return;
    this.slideLobbyEl = slideLobby;

    let wrapper = slideLobby.querySelector('.lobby-slide-wrapper') as HTMLElement | null;
    if (!wrapper) {
      wrapper = document.createElement('div');
      wrapper.className = 'room-lobby-wrapper lobby-slide-wrapper';
      wrapper.style.display = 'flex';
      wrapper.style.alignItems = 'center';
      wrapper.style.justifyContent = 'center';
      wrapper.style.position = 'relative';
      wrapper.style.width = '100%';
      wrapper.style.height = '100%';
      slideLobby.appendChild(wrapper);
    }
    this.lobbyWrapperEl = wrapper;

    // 1. Botón Flotante Exterior [ < STATS ] a la IZQUIERDA de la tarjeta
    let statsBtn = wrapper.querySelector('#lobby-to-stats-btn') as HTMLButtonElement | null;
    if (!statsBtn) {
      statsBtn = document.createElement('button');
      statsBtn.id = 'lobby-to-stats-btn';
      statsBtn.className = 'floating-nav-btn external-nav-tab left-tab right-tab';
      statsBtn.innerHTML = '&lt; STATS';
      statsBtn.title = 'Ver estadísticas del partido';
      statsBtn.style.display = 'none';
      wrapper.appendChild(statsBtn);
    }
    this.lobbyToStatsBtn = statsBtn;

    // 2. Tarjeta Central del Menú de Sala (.lobby-card)
    let card = wrapper.querySelector('.lobby-card') as HTMLElement | null;
    if (!card) {
      card = document.createElement('div');
      card.className = 'lobby-card modal-content room-lobby-modal';
      wrapper.appendChild(card);
    }
    this.lobbyCardEl = card;

    // Estructura interna de .lobby-card
    card.innerHTML = `
      <!-- Cabecera de Sala (Top Bar interior) -->
      <div class="lobby-card-topbar" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border-cyan); padding-bottom: 12px;">
        <div class="lobby-card-room-badge font-mono" style="display: flex; align-items: center; gap: 6px; font-weight: 700; font-size: 14px; color: var(--text-primary);">
          <span style="color: var(--neon-cyan);">[</span>
          <span id="roomNameHeader" class="room-title-text">${this.roomName}</span>
          <span style="color: var(--text-secondary);">- ID:</span>
          <span id="lobbyCardRoomId" style="color: var(--neon-cyan);">${this.roomId}</span>
          <span style="color: var(--neon-cyan);">]</span>
        </div>
        <div style="display: flex; gap: 10px; align-items: center;">
          <button id="btn-copy-link" class="btn btn-secondary btn-xs" style="padding: 6px 14px; font-size: 12px; font-weight: 700; border-radius: 6px; border: 1px solid var(--border-cyan); background: rgba(0, 229, 255, 0.1); color: var(--neon-cyan); cursor: pointer;" title="Copiar enlace WebRTC">
            🔗 Copiar Link
          </button>
          <button id="btn-leave-room" class="btn btn-danger btn-xs" style="padding: 6px 14px; font-size: 12px; font-weight: 700; border-radius: 6px; border: none; background: #ff4757; color: #ffffff; cursor: pointer;" title="Salir de la sala">
            ✕ Leave
          </button>
        </div>
      </div>

      <!-- Cuerpo Asimétrico en 2 Zonas -->
      <div class="lobby-card-body" style="display: flex; gap: 18px; width: 100%; flex: 1; min-height: 0;">
        <!-- ZONA IZQUIERDA (~42% del ancho): Reglas, Sala Avanzada y Control FSM -->
        <div class="lobby-zone-left" style="flex: 0 0 42%; max-width: 42%; display: flex; flex-direction: column; justify-content: space-between; gap: 12px; min-height: 0;">
          <!-- Subsección Superior con Scroll Vertical Estricto -->
          <div class="lobby-rules-scroll cyber-scrollbar" style="overflow-y: auto !important; overflow-x: hidden !important; max-height: 310px; padding-right: 6px; display: flex; flex-direction: column; gap: 12px;">
            <!-- Cuadrícula de 4 Reglas (Grid 2x2) -->
            <div class="lobby-rules-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
              <!-- 1. Dropdown Tiempo -->
              <div class="rule-field" style="display: flex; flex-direction: column; gap: 4px;">
                <label class="form-label" style="font-size: 11px; color: var(--text-secondary); font-weight: 700;">⏱ Tiempo</label>
                <select id="select-time-limit" class="form-input-inline cyber-select" style="background: rgba(15, 23, 42, 0.7); border: 1px solid var(--border-cyan); border-radius: 6px; color: #fff; padding: 6px 8px; font-size: 12px;">
                  <option value="0" ${this.timeLimit === 0 ? 'selected' : ''}>Sin límite</option>
                  <option value="3" ${this.timeLimit === 3 ? 'selected' : ''}>3m</option>
                  <option value="5" ${this.timeLimit === 5 ? 'selected' : ''}>5m</option>
                  <option value="7" ${this.timeLimit === 7 ? 'selected' : ''}>7m</option>
                  <option value="10" ${this.timeLimit === 10 ? 'selected' : ''}>10m</option>
                </select>
              </div>
              <!-- 2. Dropdown Goles -->
              <div class="rule-field" style="display: flex; flex-direction: column; gap: 4px;">
                <label class="form-label" style="font-size: 11px; color: var(--text-secondary); font-weight: 700;">⚽ Goles</label>
                <select id="select-goal-limit" class="form-input-inline cyber-select" style="background: rgba(15, 23, 42, 0.7); border: 1px solid var(--border-cyan); border-radius: 6px; color: #fff; padding: 6px 8px; font-size: 12px;">
                  <option value="0" ${this.goalLimit === 0 ? 'selected' : ''}>Sin límite</option>
                  <option value="1" ${this.goalLimit === 1 ? 'selected' : ''}>1</option>
                  <option value="3" ${this.goalLimit === 3 ? 'selected' : ''}>3</option>
                  <option value="5" ${this.goalLimit === 5 ? 'selected' : ''}>5</option>
                  <option value="10" ${this.goalLimit === 10 ? 'selected' : ''}>10</option>
                </select>
              </div>
              <!-- 3. Conmutador Equipos Libres / Bloqueados -->
              <div class="rule-field" style="display: flex; flex-direction: column; gap: 4px;">
                <label class="form-label" style="font-size: 11px; color: var(--text-secondary); font-weight: 700;">Equipos</label>
                <button id="btn-lock-teams" class="btn btn-secondary btn-xs cyber-btn-toggle" style="background: rgba(15, 23, 42, 0.7); border: 1px solid var(--border-cyan); border-radius: 6px; color: var(--neon-cyan); padding: 6px 8px; font-size: 12px; font-weight: 600; cursor: pointer; text-align: center;">
                  ${this.teamsLocked ? '🔒 Equipos Bloqueados' : '🔓 Equipos Libres'}
                </button>
              </div>
              <!-- 4. Botón Modifiers -->
              <div class="rule-field" style="display: flex; flex-direction: column; gap: 4px;">
                <label class="form-label" style="font-size: 11px; color: var(--text-secondary); font-weight: 700;">Físicas</label>
                <button id="btn-open-physics-modifiers" class="btn btn-secondary btn-xs" style="background: rgba(15, 23, 42, 0.7); border: 1px solid var(--border-cyan); border-radius: 6px; color: #f1c40f; padding: 6px 8px; font-size: 12px; font-weight: 700; cursor: pointer; text-align: center;" title="Modificadores de Físicas">
                  ⚡ Modifiers
                </button>
              </div>
            </div>

            <!-- Selector de Estadio (Debajo de las 4 reglas) -->
            <div class="stadium-selector-wrap" style="display: flex; flex-direction: column; gap: 4px;">
              <label class="form-label" style="font-size: 11px; color: var(--text-secondary); font-weight: 700;">Estadio</label>
              <button id="btn-pick-stadium" class="stadium-picker-btn" style="width: 100%; display: flex; justify-content: space-between; align-items: center; background: rgba(15, 23, 42, 0.7); border: 1px solid var(--border-cyan); border-radius: 6px; color: #fff; padding: 8px 12px; font-size: 12px; font-weight: 600; cursor: pointer;">
                <span id="currentStadiumName">${this.currentStadiumName}</span>
                <span style="color: var(--neon-cyan);">▾</span>
              </button>
              <select id="select-stadium-size" class="u-hidden" style="display: none;">
                <option value="AF 3v3 Official" selected>AF 3v3 Official by Vitão ®</option>
                <option value="classic">Mediano (3v3 Clásico)</option>
                <option value="small">Pequeño (1v1 / 2v2)</option>
                <option value="big">Grande (4v4)</option>
              </select>
            </div>

            <!-- Ajustes Avanzados de Sala (Debajo del selector de estadio) -->
            <div class="advanced-settings-box" style="background: rgba(15, 23, 42, 0.4); border: 1px solid rgba(0, 229, 255, 0.15); border-radius: 8px; padding: 10px; display: flex; flex-direction: column; gap: 8px;">
              <div style="font-size: 11px; font-weight: 800; color: var(--neon-cyan); letter-spacing: 0.05em; text-transform: uppercase;">Ajustes Avanzados</div>
              
              <!-- Renombrar sala -->
              <div style="display: flex; flex-direction: column; gap: 4px;">
                <label class="form-label" style="font-size: 11px; color: var(--text-secondary);">Renombrar Sala</label>
                <input id="lobbyRenameRoomInput" class="form-input" type="text" value="${this.roomName}" maxlength="30" style="background: rgba(10, 16, 26, 0.8); border: 1px solid var(--border-cyan); border-radius: 6px; color: #fff; padding: 6px 8px; font-size: 12px;" />
              </div>

              <!-- Stepper horizontal: Límite máx jugadores [-] <MAX> [+] -->
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <span style="font-size: 11px; color: var(--text-secondary);">Máx. Jugadores</span>
                <div class="player-stepper" style="display: flex; align-items: center; gap: 8px;">
                  <button id="btnDecMaxPlayers" type="button" style="width: 24px; height: 24px; background: rgba(0, 229, 255, 0.15); border: 1px solid var(--border-cyan); border-radius: 4px; color: #fff; font-weight: 800; cursor: pointer; display: flex; align-items: center; justify-content: center;">-</button>
                  <span id="lobbyMaxPlayersDisplay" style="font-size: 12px; font-weight: 800; min-width: 20px; text-align: center; color: var(--neon-cyan);">${this.maxPlayers}</span>
                  <button id="btnIncMaxPlayers" type="button" style="width: 24px; height: 24px; background: rgba(0, 229, 255, 0.15); border: 1px solid var(--border-cyan); border-radius: 4px; color: #fff; font-weight: 800; cursor: pointer; display: flex; align-items: center; justify-content: center;">+</button>
                </div>
              </div>

              <!-- Toggle con campo condicional contraseña -->
              <div style="display: flex; flex-direction: column; gap: 6px;">
                <label style="display: flex; align-items: center; gap: 8px; font-size: 11px; color: var(--text-secondary); cursor: pointer;">
                  <input type="checkbox" id="togglePasswordCheckbox" />
                  <span>🔒 Proteger con contraseña</span>
                </label>
                <input type="password" id="lobbyPasswordInput" placeholder="Contraseña..." style="display: none; background: rgba(10, 16, 26, 0.8); border: 1px solid var(--border-cyan); border-radius: 6px; color: #fff; padding: 6px 8px; font-size: 12px;" />
              </div>

              <!-- Toggle mostrar en lista pública -->
              <label style="display: flex; align-items: center; gap: 8px; font-size: 11px; color: var(--text-secondary); cursor: pointer;">
                <input type="checkbox" id="togglePublicRoomCheckbox" checked />
                <span>Mostrar en lista pública</span>
              </label>
            </div>
          </div>

          <!-- Subsección Inferior: Controles FSM de Juego -->
          <div id="lobbyFsmControls" style="margin-top: auto; padding-top: 10px; border-top: 1px solid rgba(0, 229, 255, 0.15); display: flex; gap: 10px;">
          </div>
        </div>

        <!-- ZONA DERECHA (~58% del ancho): Banquillos de Jugadores -->
        <div class="lobby-zone-right" style="flex: 1; display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; min-height: 0;">
          <!-- Columna RED -->
          <div class="bench-column bench-red" style="background: rgba(15, 23, 42, 0.45); border: 1px solid rgba(239, 68, 68, 0.25); border-radius: 8px; display: flex; flex-direction: column; overflow: hidden;">
            <div class="bench-header red-header" style="background: rgba(239, 68, 68, 0.18); border-bottom: 1px solid rgba(239, 68, 68, 0.3); padding: 8px; display: flex; justify-content: space-between; align-items: center;">
              <span style="font-weight: 800; font-size: 12px; color: #f87171;">RED (<span id="redCount">0</span>)</span>
              <button id="joinRedBtn" class="btn btn-red btn-xs" style="padding: 4px 8px; font-size: 11px; font-weight: 700; border-radius: 4px; background: #ef4444; color: #fff; border: none; cursor: pointer;">Red ►</button>
            </div>
            <div id="redPlayersList" class="team-players-list cyber-scrollbar" style="flex: 1; overflow-y: auto !important; overflow-x: hidden !important; max-height: 330px; padding: 8px; display: flex; flex-direction: column; gap: 6px;"></div>
          </div>

          <!-- Columna SPECTATORS -->
          <div class="bench-column bench-spec" style="background: rgba(15, 23, 42, 0.45); border: 1px solid rgba(100, 116, 139, 0.25); border-radius: 8px; display: flex; flex-direction: column; overflow: hidden;">
            <div class="bench-header spec-header" style="background: rgba(100, 116, 139, 0.18); border-bottom: 1px solid rgba(100, 116, 139, 0.3); padding: 8px; display: flex; justify-content: space-between; align-items: center;">
              <span style="font-weight: 800; font-size: 12px; color: #cbd5e1;">SPECTATORS (<span id="specCount">0</span>)</span>
              <button id="joinSpecBtn" class="btn btn-secondary btn-xs" style="padding: 4px 8px; font-size: 11px; font-weight: 700; border-radius: 4px; background: rgba(100, 116, 139, 0.3); color: #e2e8f0; border: 1px solid rgba(100, 116, 139, 0.4); cursor: pointer;">Spectators</button>
            </div>
            <div id="specPlayersList" class="team-players-list cyber-scrollbar" style="flex: 1; overflow-y: auto !important; overflow-x: hidden !important; max-height: 330px; padding: 8px; display: flex; flex-direction: column; gap: 6px;"></div>
          </div>

          <!-- Columna BLUE -->
          <div class="bench-column bench-blue" style="background: rgba(15, 23, 42, 0.45); border: 1px solid rgba(59, 130, 246, 0.25); border-radius: 8px; display: flex; flex-direction: column; overflow: hidden;">
            <div class="bench-header blue-header" style="background: rgba(59, 130, 246, 0.18); border-bottom: 1px solid rgba(59, 130, 246, 0.3); padding: 8px; display: flex; justify-content: space-between; align-items: center;">
              <span style="font-weight: 800; font-size: 12px; color: #60a5fa;">BLUE (<span id="blueCount">0</span>)</span>
              <button id="joinBlueBtn" class="btn btn-blue btn-xs" style="padding: 4px 8px; font-size: 11px; font-weight: 700; border-radius: 4px; background: #3b82f6; color: #fff; border: none; cursor: pointer;">◄ Blue</button>
            </div>
            <div id="bluePlayersList" class="team-players-list cyber-scrollbar" style="flex: 1; overflow-y: auto !important; overflow-x: hidden !important; max-height: 330px; padding: 8px; display: flex; flex-direction: column; gap: 6px;"></div>
          </div>
        </div>
      </div>
    `;

    // Conectar eventos de la tarjeta de sala
    this.setupSlideLobbyListeners();
    this.updateFsmControls(this.currentMatchPhase);
  }

  /**
   * Conecta los listeners interactivos de los elementos de la tarjeta de sala
   */
  private setupSlideLobbyListeners(): void {
    if (!this.lobbyCardEl) return;

    // Copiar Link
    const copyBtn = this.lobbyCardEl.querySelector('#btn-copy-link');
    copyBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      const origin = typeof window !== 'undefined' && window.location ? window.location.origin : '';
      const pathname = typeof window !== 'undefined' && window.location ? window.location.pathname : '';
      const roomUrl = this.roomId ? `${origin}${pathname}?room=${this.roomId}` : (typeof window !== 'undefined' ? window.location.href : '');
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        navigator.clipboard.writeText(roomUrl).catch(() => {});
      }
      this.showToast('¡Enlace de sala copiado al portapapeles!', 'info', 3000);
    });

    // Salir de la sala (Leave)
    const leaveBtn = this.lobbyCardEl.querySelector('#btn-leave-room');
    leaveBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.gameApp && typeof this.gameApp.leaveCurrentRoom === 'function') {
        this.gameApp.leaveCurrentRoom();
      } else if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('lobby:leave-room'));
      }
    });

    // Dropdown Tiempo
    const selectTime = this.lobbyCardEl.querySelector('#select-time-limit') as HTMLSelectElement | null;
    selectTime?.addEventListener('change', () => {
      const mins = parseInt(selectTime.value, 10);
      this.timeLimit = isNaN(mins) ? 3 : mins;
      $roomConfig.set({ ...$roomConfig.get(), timeLimit: this.timeLimit });
      if (this.gameApp && typeof this.gameApp.updateRoomConfig === 'function') {
        this.gameApp.updateRoomConfig({ timeLimit: this.timeLimit });
      }
    });

    // Dropdown Goles
    const selectGoal = this.lobbyCardEl.querySelector('#select-goal-limit') as HTMLSelectElement | null;
    selectGoal?.addEventListener('change', () => {
      const goals = parseInt(selectGoal.value, 10);
      this.goalLimit = isNaN(goals) ? 3 : goals;
      $roomConfig.set({ ...$roomConfig.get(), goalLimit: this.goalLimit });
      if (this.gameApp && typeof this.gameApp.updateRoomConfig === 'function') {
        this.gameApp.updateRoomConfig({ scoreLimit: this.goalLimit });
      }
    });

    // Conmutador Equipos Libres / Bloqueados
    const lockBtn = this.lobbyCardEl.querySelector('#btn-lock-teams') as HTMLButtonElement | null;
    lockBtn?.addEventListener('click', () => {
      this.teamsLocked = !this.teamsLocked;
      if (lockBtn) {
        lockBtn.textContent = this.teamsLocked ? '🔒 Equipos Bloqueados' : '🔓 Equipos Libres';
      }
      $roomConfig.set({ ...$roomConfig.get(), teamsLocked: this.teamsLocked });
      if (this.gameApp && typeof this.gameApp.updateRoomConfig === 'function') {
        this.gameApp.updateRoomConfig({ teamsLocked: this.teamsLocked });
      }
    });

    // Botón Modifiers
    const modBtn = this.lobbyCardEl.querySelector('#btn-open-physics-modifiers') as HTMLButtonElement | null;
    modBtn?.addEventListener('click', () => {
      if (this.gameApp?.modifierModal) {
        this.gameApp.modifierModal.show();
      } else {
        const modModal = document.getElementById('physicsModifierModal');
        if (modModal) {
          modModal.classList.remove('u-hidden');
          modModal.style.display = 'flex';
        }
      }
    });

    // Botón Selector de Estadio
    const pickStadiumBtn = this.lobbyCardEl.querySelector('#btn-pick-stadium') as HTMLButtonElement | null;
    pickStadiumBtn?.addEventListener('click', () => {
      const stadiumPicker = document.getElementById('stadiumPickerModal');
      if (stadiumPicker) {
        stadiumPicker.classList.remove('u-hidden');
        stadiumPicker.style.display = 'flex';
      }
    });

    // Renombrar sala
    const renameInput = this.lobbyCardEl.querySelector('#lobbyRenameRoomInput') as HTMLInputElement | null;
    renameInput?.addEventListener('change', () => {
      const val = renameInput.value.trim();
      if (val) {
        this.setRoomName(val);
      }
    });

    // Stepper máx jugadores
    const decBtn = this.lobbyCardEl.querySelector('#btn-decMaxPlayers') || this.lobbyCardEl.querySelector('#btnDecMaxPlayers');
    const incBtn = this.lobbyCardEl.querySelector('#btn-incMaxPlayers') || this.lobbyCardEl.querySelector('#btnIncMaxPlayers');
    const maxDisplay = this.lobbyCardEl.querySelector('#lobbyMaxPlayersDisplay');

    decBtn?.addEventListener('click', () => {
      if (this.maxPlayers > 2) {
        this.maxPlayers--;
        if (maxDisplay) maxDisplay.textContent = this.maxPlayers.toString();
        if (this.gameApp && typeof this.gameApp.updateRoomConfig === 'function') {
          this.gameApp.updateRoomConfig({ maxPlayers: this.maxPlayers });
        }
      }
    });

    incBtn?.addEventListener('click', () => {
      if (this.maxPlayers < 16) {
        this.maxPlayers++;
        if (maxDisplay) maxDisplay.textContent = this.maxPlayers.toString();
        if (this.gameApp && typeof this.gameApp.updateRoomConfig === 'function') {
          this.gameApp.updateRoomConfig({ maxPlayers: this.maxPlayers });
        }
      }
    });

    // Toggle contraseña
    const passCheck = this.lobbyCardEl.querySelector('#togglePasswordCheckbox') as HTMLInputElement | null;
    const passInput = this.lobbyCardEl.querySelector('#lobbyPasswordInput') as HTMLInputElement | null;
    passCheck?.addEventListener('change', () => {
      if (passInput) {
        passInput.style.display = passCheck.checked ? 'block' : 'none';
        if (passCheck.checked) passInput.focus();
      }
    });

    // Botones de unirse a equipo
    const joinRed = this.lobbyCardEl.querySelector('#joinRedBtn');
    joinRed?.addEventListener('click', () => {
      if (this.gameApp && typeof this.gameApp.setTeam === 'function') {
        this.gameApp.setTeam('red');
      } else if (this.gameApp?.teamSelect?.onSelectTeam) {
        this.gameApp.teamSelect.onSelectTeam('red');
      }
    });

    const joinSpec = this.lobbyCardEl.querySelector('#joinSpecBtn');
    joinSpec?.addEventListener('click', () => {
      if (this.gameApp && typeof this.gameApp.setTeam === 'function') {
        this.gameApp.setTeam('spec');
      } else if (this.gameApp?.teamSelect?.onSelectTeam) {
        this.gameApp.teamSelect.onSelectTeam('spec');
      }
    });

    const joinBlue = this.lobbyCardEl.querySelector('#joinBlueBtn');
    joinBlue?.addEventListener('click', () => {
      if (this.gameApp && typeof this.gameApp.setTeam === 'function') {
        this.gameApp.setTeam('blue');
      } else if (this.gameApp?.teamSelect?.onSelectTeam) {
        this.gameApp.teamSelect.onSelectTeam('blue');
      }
    });
  }

  /**
   * Renderiza reactivamente los controles FSM de juego en el pie de la columna izquierda
   */
  public updateFsmControls(phase: number): void {
    const fsmContainer = this.lobbyCardEl?.querySelector('#lobbyFsmControls');
    if (!fsmContainer) return;

    if (phase === 0) {
      // Estado 0 (STOP / Sala esperando): UN SOLO botón de ancho completo [ ▶ INICIAR PARTIDO ]
      fsmContainer.innerHTML = `
        <button id="btn-match-toggle" class="fsm-btn-start btn-match-toggle" type="button">
          ▶ INICIAR PARTIDO
        </button>
      `;

      const startBtn = fsmContainer.querySelector('#btn-match-toggle');
      startBtn?.addEventListener('click', () => {
        if (this.gameApp && typeof this.gameApp.startGame === 'function') {
          this.gameApp.startGame();
        } else {
          const globalToggle = document.getElementById('btn-match-toggle');
          if (globalToggle && globalToggle !== startBtn) {
            globalToggle.click();
          }
        }
      });
    } else {
      // Estados Activos (KICKOFF, PLAYING, PAUSE, GOAL): Dos botones paralelos 50-50
      const isPaused = phase === 3;
      fsmContainer.innerHTML = `
        <button id="btn-match-stop" class="fsm-btn-stop" type="button">
          ■ DETENER
        </button>
        <button id="btn-pause-resume" class="fsm-btn-pause" type="button">
          ${isPaused ? '▶ REANUDAR' : '⏸ PAUSAR'}
        </button>
      `;

      const stopBtn = fsmContainer.querySelector('#btn-match-stop');
      stopBtn?.addEventListener('click', () => {
        if (this.gameApp) {
          if (this.gameApp.isHost) {
            this.gameApp.engine?.stopMatch();
          } else {
            this.gameApp.network?.sendReliable({ type: 'ADMIN_STOP_MATCH' });
          }
        }
      });

      const pauseBtn = fsmContainer.querySelector('#btn-pause-resume');
      pauseBtn?.addEventListener('click', () => {
        if (this.gameApp && typeof this.gameApp.requestTogglePause === 'function') {
          this.gameApp.requestTogglePause();
        } else {
          const globalPause = document.getElementById('btn-pause-resume');
          if (globalPause && globalPause !== pauseBtn) {
            globalPause.click();
          }
        }
      });
    }
  }

  /**
   * Actualiza los banquillos de jugadores (RED, SPECTATORS, BLUE)
   */
  public updateBenches(players: any[]): void {
    if (!this.lobbyCardEl) return;

    const redList = this.lobbyCardEl.querySelector('#redPlayersList');
    const specList = this.lobbyCardEl.querySelector('#specPlayersList');
    const blueList = this.lobbyCardEl.querySelector('#bluePlayersList');

    const redCount = this.lobbyCardEl.querySelector('#redCount');
    const specCount = this.lobbyCardEl.querySelector('#specCount');
    const blueCount = this.lobbyCardEl.querySelector('#blueCount');

    const redPlayers = players.filter((p) => p.team === 'red' || p.team === 1);
    const bluePlayers = players.filter((p) => p.team === 'blue' || p.team === 2);
    const specPlayers = players.filter((p) => p.team === 'spec' || p.team === 'spectators' || p.team === 0 || !p.team);

    if (redCount) redCount.textContent = redPlayers.length.toString();
    if (blueCount) blueCount.textContent = bluePlayers.length.toString();
    if (specCount) specCount.textContent = specPlayers.length.toString();

    const renderPlayerItem = (p: any, teamColor: string) => {
      const name = p.name || p.nickname || 'Player';
      const initials = name.substring(0, 2).toUpperCase();
      return `
        <div class="bench-player-item" data-player-id="${p.id}" style="display: flex; align-items: center; gap: 8px; padding: 6px 8px; background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(0, 229, 255, 0.1); border-radius: 6px;">
          <div class="player-avatar-circle" style="background: ${teamColor}; color: #ffffff;">
            ${initials}
          </div>
          <span style="font-size: 12px; font-weight: 600; color: #f8fafc; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
            ${name}
          </span>
          ${p.isHost ? '<span title="Anfitrión" style="font-size: 12px;">👑</span>' : ''}
          ${p.isAdmin ? '<span title="Capitán / Administrador" style="font-size: 11px; font-weight: 800; color: #38bdf8; background: rgba(56, 189, 248, 0.2); padding: 1px 4px; border-radius: 4px;">©</span>' : ''}
        </div>
      `;
    };

    if (redList) {
      redList.innerHTML = redPlayers.length > 0
        ? redPlayers.map((p) => renderPlayerItem(p, 'rgba(239, 68, 68, 0.7)')).join('')
        : '<div style="color: var(--text-muted); font-size: 11px; text-align: center; padding: 12px;">Vacío</div>';
    }

    if (blueList) {
      blueList.innerHTML = bluePlayers.length > 0
        ? bluePlayers.map((p) => renderPlayerItem(p, 'rgba(59, 130, 246, 0.7)')).join('')
        : '<div style="color: var(--text-muted); font-size: 11px; text-align: center; padding: 12px;">Vacío</div>';
    }

    if (specList) {
      specList.innerHTML = specPlayers.length > 0
        ? specPlayers.map((p) => renderPlayerItem(p, 'rgba(100, 116, 139, 0.6)')).join('')
        : '<div style="color: var(--text-muted); font-size: 11px; text-align: center; padding: 12px;">Vacío</div>';
    }
  }

  private updateConfigElements(): void {
    if (!this.lobbyCardEl) return;
    const timeSelect = this.lobbyCardEl.querySelector('#select-time-limit') as HTMLSelectElement | null;
    if (timeSelect && timeSelect.value !== this.timeLimit.toString()) {
      timeSelect.value = this.timeLimit.toString();
    }
    const goalSelect = this.lobbyCardEl.querySelector('#select-goal-limit') as HTMLSelectElement | null;
    if (goalSelect && goalSelect.value !== this.goalLimit.toString()) {
      goalSelect.value = this.goalLimit.toString();
    }
    const lockBtn = this.lobbyCardEl.querySelector('#btn-lock-teams') as HTMLButtonElement | null;
    if (lockBtn) {
      lockBtn.textContent = this.teamsLocked ? '🔒 Equipos Bloqueados' : '🔓 Equipos Libres';
    }
    const stadiumName = this.lobbyCardEl.querySelector('#currentStadiumName');
    if (stadiumName) {
      stadiumName.textContent = this.currentStadiumName;
    }
  }

  public setRoomName(name: string): void {
    this.roomName = name;
    const roomHeader = document.getElementById('roomNameHeader');
    if (roomHeader) roomHeader.textContent = name;
    const inputEl = this.lobbyCardEl?.querySelector('#lobbyRenameRoomInput') as HTMLInputElement | null;
    if (inputEl && inputEl.value !== name) inputEl.value = name;
  }

  public setRoomId(roomId: string): void {
    this.roomId = roomId;
    const idDisplay = document.getElementById('lobbyCardRoomId');
    if (idDisplay) idDisplay.textContent = roomId;
  }

  public setStadium(stadiumName: string): void {
    this.currentStadiumName = stadiumName;
    const stadiumEl = document.getElementById('currentStadiumName');
    if (stadiumEl) stadiumEl.textContent = stadiumName;
  }

  private setupThemeToggle(): void {
    const lobbyThemeBtn = document.getElementById('lobbyThemeToggleBtn') as HTMLButtonElement | null;
    if (lobbyThemeBtn) {
      lobbyThemeBtn.addEventListener('click', () => {
        toggleTheme();
      });
      this.unsubs.push(
        $theme.subscribe((theme) => {
          const isDark = theme === 'dark';
          lobbyThemeBtn.innerHTML = '';
          renderIcon(lobbyThemeBtn, isDark ? Sun : Moon, { size: 18, color: isDark ? '#F59E0B' : '#0284C7' });
          lobbyThemeBtn.title = isDark ? 'Cambiar a Modo Claro' : 'Cambiar a Modo Oscuro';
        })
      );
    }
  }

  private renderIcons(): void {
    const createIconSlot = document.getElementById('openCreateRoomIconSlot');
    if (createIconSlot) {
      renderIcon(createIconSlot, PlusSquare, { size: 16, color: '#FFFFFF' });
    }

    const searchIconSlot = document.getElementById('lobbySearchIconSlot');
    if (searchIconSlot) {
      renderIcon(searchIconSlot, Search, { size: 16, color: '#0EA5E9' });
    }

    const refreshIconSlot = document.getElementById('refreshRoomsIconSlot');
    if (refreshIconSlot) {
      renderIcon(refreshIconSlot, RefreshCw, { size: 16, color: '#0284C7' });
    }
  }

  private setupListeners(): void {
    const joinBtn = document.getElementById('btnJoinRoom');
    const practiceBtn = this.practiceBtn || (document.getElementById('btnPracticeMode') as HTMLButtonElement | null);

    // Open dedicated Create Room Modal
    this.openCreateRoomBtn?.addEventListener('click', () => {
      const nick = this.getNickname();
      this.createRoomModal.show(`${nick}'s Match`);
    });

    // Fallback legacy create button if present in DOM
    const legacyCreateBtn = document.getElementById('btnCreateRoom');
    legacyCreateBtn?.addEventListener('click', () => {
      const nick = this.getNickname();
      this.createRoomModal.show(`${nick}'s Match`);
    });

    joinBtn?.addEventListener('click', () => {
      const nick = this.getNickname();
      const roomId = this.roomIdInput?.value.trim().toUpperCase() || '';
      if (roomId) {
        this.showConnecting('Conectando (P2P / Relay)...');
        this.events.onJoinRoom(nick, roomId);
      } else {
        alert('Por favor introduce el ID de la sala');
      }
    });

    practiceBtn?.addEventListener('click', () => {
      const nick = this.getNickname();
      this.events.onSinglePlayer(nick);
    });

    this.refreshRoomsBtn?.addEventListener('click', () => {
      this.events.onRefreshRooms();
    });

    this.editNickBtn?.addEventListener('click', () => {
      if (this.events.onEditNickname) {
        this.events.onEditNickname();
      }
    });

    this.cancelConnectingBtn?.addEventListener('click', () => {
      this.hideConnecting();
      if (this.events.onCancelConnecting) {
        this.events.onCancelConnecting();
      }
    });

    // Real-time room filtering
    this.searchInput?.addEventListener('input', () => {
      this.filterAndRenderRooms();
    });

    this.hideFullCheckbox?.addEventListener('change', () => {
      this.filterAndRenderRooms();
    });

    this.hideLockedCheckbox?.addEventListener('change', () => {
      this.filterAndRenderRooms();
    });

    this.settingsBtn?.addEventListener('click', () => {
      if (this.gameApp?.settingsModal) {
        this.gameApp.settingsModal.open();
      } else if (this.gameApp?.keybindModal) {
        this.gameApp.keybindModal.open();
      } else {
        const modal = document.getElementById('settingsModal');
        if (modal) {
          modal.classList.remove('u-hidden');
          modal.style.display = 'flex';
        }
      }
    });

    this.confirmPasswordBtn?.addEventListener('click', () => {
      if (!this.pendingJoinRoomId) return;
      const pass = this.passwordPromptInput?.value.trim() || '';
      const roomId = this.pendingJoinRoomId;
      this.hidePasswordPrompt();
      this.showConnecting('Conectando (P2P / Relay)...');
      this.events.onJoinRoom(this.getNickname(), roomId, pass);
    });

    this.cancelPasswordBtn?.addEventListener('click', () => {
      this.hidePasswordPrompt();
    });

    this.passwordPromptInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.confirmPasswordBtn?.click();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.hidePasswordPrompt();
      }
    });
  }

  public showPasswordPrompt(roomId: string, roomName: string): void {
    this.pendingJoinRoomId = roomId;
    if (this.passwordPromptText) {
      this.passwordPromptText.textContent = `La sala "${roomName}" requiere contraseña para unirse.`;
    }
    if (this.passwordPromptInput) {
      this.passwordPromptInput.value = '';
    }
    if (this.passwordPromptModal) {
      this.passwordPromptModal.classList.remove('u-hidden');
      this.passwordPromptModal.style.display = 'flex';
      setTimeout(() => {
        this.passwordPromptInput?.focus();
      }, 50);
    } else {
      const pass = prompt(`La sala "${roomName}" es privada. Ingresa la contraseña:`);
      if (pass !== null) {
        this.showConnecting('Conectando (P2P / Relay)...');
        this.events.onJoinRoom(this.getNickname(), roomId, pass.trim());
      }
    }
  }

  public hidePasswordPrompt(): void {
    this.pendingJoinRoomId = null;
    if (this.passwordPromptModal) {
      this.passwordPromptModal.classList.add('u-hidden');
      this.passwordPromptModal.style.display = 'none';
    }
  }

  public updateUserBar(nick: string): void {
    const trimmed = nick.trim();
    if (this.currentNickEl) {
      this.currentNickEl.textContent = trimmed || 'Player';
    }
    if (this.userAvatarEl) {
      this.userAvatarEl.textContent = (trimmed || 'PL').substring(0, 2).toUpperCase();
    }
    if (this.nicknameInput) {
      this.nicknameInput.value = trimmed;
    }
  }

  public setSignalingStatus(status: 'connected' | 'connecting' | 'disconnected', text?: string): void {
    if (this.signalingDotEl) {
      this.signalingDotEl.className =
        status === 'connected' ? 'status-dot-connected' :
        status === 'connecting' ? 'status-dot-connecting' : 'status-dot-disconnected';
    }
    if (this.signalingTextEl) {
      if (text) {
        this.signalingTextEl.textContent = text;
      } else {
        this.signalingTextEl.textContent =
          status === 'connected' ? 'Conectado' :
          status === 'connecting' ? 'Conectando...' : 'Desconectado';
      }
    }
  }

  public setConnectingStep(step: 1 | 2 | 3, detail?: string): void {
    let msg = '';
    switch (step) {
      case 1:
        msg = '1/3 Conectando con servidor de señalización...';
        break;
      case 2:
        msg = '2/3 Conectando (P2P / Relay)...';
        break;
      case 3:
        msg = '3/3 Sincronizando sala...';
        break;
    }
    if (detail) {
      msg = `${msg} (${detail})`;
    }
    this.showConnecting(msg);
  }

  public showConnecting(message: string = 'Conectando (P2P / Relay)...'): void {
    if (this.loadingTextEl) {
      this.loadingTextEl.textContent = message;
    }
    if (this.loadingOverlayEl) {
      this.loadingOverlayEl.style.display = 'flex';
    }
  }

  public hideConnecting(): void {
    if (this.loadingOverlayEl) {
      this.loadingOverlayEl.style.display = 'none';
    }
  }

  public showToast(message: string, type: 'info' | 'error' | 'warning' = 'info', durationMs: number = 6000): void {
    let container = document.getElementById('haxballToastContainer');
    if (!container) {
      container = document.createElement('div');
      container.id = 'haxballToastContainer';
      container.className = 'toast-container';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `haxball-toast toast-${type}`;
    const icon = type === 'error' ? '⚠️' : (type === 'warning' ? '⚡' : 'ℹ️');

    toast.innerHTML = `
      <span class="toast-icon">${icon}</span>
      <span class="toast-message">${message}</span>
    `;

    container.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('toast-fade-out');
      setTimeout(() => {
        toast.remove();
        if (container && container.children.length === 0) {
          container.remove();
        }
      }, 400);
    }, durationMs);
  }

  public getNickname(): string {
    if (typeof localStorage !== 'undefined') {
      const fromStorage = localStorage.getItem('legacyx_nickname')?.trim() ||
                          localStorage.getItem('haxball_nickname')?.trim() ||
                          localStorage.getItem('haxball_player_name')?.trim();
      if (fromStorage) return fromStorage;
    }
    return this.nicknameInput?.value.trim() || `Player_${Math.floor(Math.random() * 900 + 100)}`;
  }

  public setNickname(nick: string): void {
    this.updateUserBar(nick);
  }

  public hide(): void {
    if (this.overlayEl) {
      this.overlayEl.classList.add('u-hidden', 'ui-screen-hidden');
      this.overlayEl.style.display = 'none';
    }
    this.createRoomModal.hide();
  }

  /**
   * Renderiza el botón flotante exterior hacia las Estadísticas
   */
  public renderStatsNavigationTab(): void {
    if (this.overlayEl && typeof this.overlayEl.querySelectorAll === 'function') {
      const oldLeftButtons = this.overlayEl.querySelectorAll('.left-tab:not(#lobby-to-stats-btn), #menu-to-stats-btn, #teamselect-to-stats-btn, .sliding-tab-btn');
      oldLeftButtons.forEach((btn) => btn.remove());
    }

    const wrapper = this.lobbyWrapperEl || this.overlayEl?.querySelector('.room-lobby-wrapper') as HTMLElement | null;
    const content = this.lobbyCardEl || this.overlayEl?.querySelector('.room-lobby-modal, .modal-content') as HTMLElement | null;
    const container = wrapper || content || this.overlayEl;

    if (container) {
      let statsBtn = (document.getElementById('lobby-to-stats-btn') || container.querySelector('#lobby-to-stats-btn')) as HTMLButtonElement | null;
      if (!statsBtn && typeof document !== 'undefined') {
        statsBtn = document.createElement('button');
        statsBtn.id = 'lobby-to-stats-btn';
        statsBtn.className = 'floating-nav-btn external-nav-tab left-tab right-tab';
        statsBtn.innerHTML = '&lt; STATS';
        statsBtn.title = 'Ver estadísticas del partido';
        statsBtn.style.display = 'none';
        container.appendChild(statsBtn);
      }
      this.lobbyToStatsBtn = statsBtn;
      if (this.lobbyToStatsBtn && !(this.lobbyToStatsBtn as any)._boundNav) {
        (this.lobbyToStatsBtn as any)._boundNav = true;
        this.lobbyToStatsBtn.addEventListener('click', (e) => {
          e.stopPropagation();

          // Desplazar carrusel a Diapositiva 1 (0vw)
          const track = this.getTrack();
          if (track) {
            track.style.transform = 'translateX(0vw)';
          }
          if (typeof window !== 'undefined' && typeof (window as any).scoreboardHUD?.showStatsSlide === 'function') {
            (window as any).scoreboardHUD.showStatsSlide();
          }

          this.hide();
          if (this.matchStatsPanel && this.lastStats) {
            this.matchStatsPanel.show(this.lastStats);
          }
          this.onShowStats?.();
          if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
            window.dispatchEvent(new CustomEvent('stats:navigate-to-stats'));
          }
        });
      }
      if (this.lobbyToStatsBtn) {
        this.lobbyToStatsBtn.style.display = this.hasCompletedMatch ? 'inline-flex' : 'none';
      }
    }
  }

  public show(): void {
    this.renderStatsNavigationTab();
    if (this.lobbyToStatsBtn) {
      this.lobbyToStatsBtn.style.display = this.hasCompletedMatch ? 'inline-flex' : 'none';
    }
    if (this.overlayEl) {
      this.overlayEl.classList.remove('u-hidden', 'ui-screen-hidden');
      this.overlayEl.style.display = 'flex';
      this.updateUserBar(this.getNickname());
      this.filterAndRenderRooms();
      this.events.onRefreshRooms();
    }
    // Asegurar que el carrusel esté en la Diapositiva 2 (Lobby)
    const track = this.getTrack();
    if (track) {
      track.style.transform = 'translateX(-100vw)';
    }
    if (typeof window !== 'undefined' && typeof (window as any).scoreboardHUD?.showLobbySlide === 'function') {
      (window as any).scoreboardHUD.showLobbySlide();
    }
  }

  public setStatsAvailable(available: boolean, stats?: PlayerMatchStats[]): void {
    this.hasCompletedMatch = available;
    if (stats) {
      this.lastStats = stats;
    }
    this.renderStatsNavigationTab();
    if (this.lobbyToStatsBtn) {
      this.lobbyToStatsBtn.style.display = available ? 'inline-flex' : 'none';
    }
  }

  public setCompletedMatch(stats: PlayerMatchStats[]): void {
    this.hasCompletedMatch = true;
    this.lastStats = stats;
    this.renderStatsNavigationTab();
    if (this.lobbyToStatsBtn) {
      this.lobbyToStatsBtn.style.display = 'inline-flex';
    }
  }

  public hideStatsNavigationButton(): void {
    this.hasCompletedMatch = false;
    if (this.lobbyToStatsBtn) {
      this.lobbyToStatsBtn.style.display = 'none';
    }
  }

  public setRoomList(rooms: RoomListItem[]): void {
    this.cachedRooms = rooms;
    this.filterAndRenderRooms();
  }

  public filterAndRenderRooms(): void {
    if (!this.roomListContainer) return;
    this.roomListContainer.innerHTML = '';

    // Actualizar contadores en tiempo real
    const totalRooms = this.cachedRooms.length;
    const totalPlayers = this.cachedRooms.reduce((acc, r) => acc + (r.playerCount || 0), 0);
    if (this.roomsCountEl) this.roomsCountEl.textContent = totalRooms.toString();
    if (this.playersCountEl) this.playersCountEl.textContent = totalPlayers.toString();

    const query = this.searchInput?.value.trim().toLowerCase() || '';
    const hideFull = !!this.hideFullCheckbox?.checked;
    const hideLocked = !!this.hideLockedCheckbox?.checked;

    const filtered = this.cachedRooms.filter((r) => {
      const maxP = r.maxPlayers ?? 12;
      if (hideFull && r.playerCount >= maxP) return false;
      if (hideLocked && r.isPrivate) return false;
      if (!query) return true;
      return (
        r.name.toLowerCase().includes(query) ||
        r.id.toLowerCase().includes(query)
      );
    });

    if (filtered.length === 0) {
      const emptyTr = document.createElement('tr');
      emptyTr.innerHTML = `
        <td colspan="6" style="padding: 40px 20px; text-align: center;">
          <div style="display: flex; flex-direction: column; align-items: center; gap: 12px; color: var(--text-secondary);">
            <span style="font-size: 28px;">🌐</span>
            <span style="font-size: 14px; font-weight: 600; color: #cbd5e1;">
              No hay salas públicas abiertas en este momento. ¡Sé el primero en crear una!
            </span>
            <button id="btnEmptyCreateRoom" class="btn btn-primary" style="background: #2ecc71; color: #05150c; font-weight: 800; padding: 8px 18px; border-radius: 6px; margin-top: 6px; cursor: pointer; border: none; font-size: 13px;">
              + Crear Sala
            </button>
          </div>
        </td>
      `;
      emptyTr.querySelector('#btnEmptyCreateRoom')?.addEventListener('click', () => {
        const nick = this.getNickname();
        this.createRoomModal.show(`${nick}'s Match`);
      });
      this.roomListContainer.appendChild(emptyTr);
      return;
    }

    for (const r of filtered) {
      const tr = document.createElement('tr');
      tr.className = 'room-row';
      tr.setAttribute('data-room-id', r.id);

      const maxP = r.maxPlayers ?? 12;
      const isFull = r.playerCount >= maxP;
      const statusText = r.status ? (r.status === 'PLAYING' ? 'EN JUEGO' : 'LOBBY') : 'LOBBY';
      const statusClass = statusText === 'EN JUEGO' ? 'status-playing' : 'status-lobby';
      const stadium = r.stadiumName || 'AF 3v3 Official';
      const pingText = r.ping !== undefined ? `${r.ping}ms` : '24ms';
      const regionText = r.region ? ` / ${r.region}` : '';

      tr.innerHTML = `
        <td>
          <span class="room-badge-status ${statusClass}">
            ${statusText}
          </span>
        </td>
        <td>
          <div style="display: flex; align-items: center; gap: 6px; font-weight: 700; color: #fff;">
            <span>${r.isPrivate ? '🔒' : '🌐'}</span>
            <span style="overflow: hidden; text-overflow: ellipsis; max-width: 260px; white-space: nowrap;">${r.name}</span>
          </div>
          <div style="font-size: 11px; color: var(--text-secondary); margin-top: 2px;" class="font-mono">
            ID: <span style="color: var(--neon-cyan);">${r.id}</span>
          </div>
        </td>
        <td style="color: #cbd5e1; font-weight: 600; font-size: 12px;">
          ${stadium}
        </td>
        <td style="text-align: center;">
          <span style="font-weight: 800; font-size: 13px; color: ${isFull ? '#ef4444' : '#2ecc71'};">
            ${r.playerCount}
          </span>
          <span style="color: var(--text-secondary); font-size: 12px;"> / ${maxP}</span>
        </td>
        <td style="text-align: center; font-family: var(--font-mono); font-size: 12px; color: #94a3b8;">
          ${pingText}${regionText}
        </td>
        <td style="text-align: right;">
          <button class="btn btn-primary btn-xs btn-join-room-row btn-join-direct" ${isFull ? 'disabled' : ''} style="padding: 6px 14px; background: ${isFull ? 'rgba(100, 116, 139, 0.3)' : 'var(--neon-cyan)'}; color: ${isFull ? '#64748b' : '#05150c'}; font-weight: 800; border-radius: 6px; border: none; cursor: ${isFull ? 'not-allowed' : 'pointer'};">
            ${isFull ? 'Llena' : 'UNIRSE'}
          </button>
        </td>
      `;

      tr.querySelector('.btn-join-room-row')?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (isFull) {
          alert('La sala está llena.');
          return;
        }
        if (r.isPrivate) {
          this.showPasswordPrompt(r.id, r.name);
          return;
        }
        this.showConnecting('Conectando (P2P / Relay)...');
        this.events.onJoinRoom(this.getNickname(), r.id);
      });

      tr.addEventListener('click', () => {
        if (this.roomIdInput) {
          this.roomIdInput.value = r.id;
        }
      });

      this.roomListContainer.appendChild(tr);
    }
  }

  public getSlideLobbyElement(): HTMLElement | null {
    return this.slideLobbyEl;
  }

  public getLobbyWrapperElement(): HTMLElement | null {
    return this.lobbyWrapperEl;
  }

  public getLobbyCardElement(): HTMLElement | null {
    return this.lobbyCardEl;
  }

  public destroy(): void {
    for (const unsub of this.unsubs) {
      unsub();
    }
    this.unsubs = [];
    if (this.lobbyCardEl && this.lobbyCardEl.parentNode) {
      this.lobbyCardEl.parentNode.removeChild(this.lobbyCardEl);
    }
  }
}
