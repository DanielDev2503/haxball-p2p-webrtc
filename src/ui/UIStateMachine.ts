import { MatchPhase } from '../core/game/GameFSM';

export type UIState = 'STATE_NICKNAME' | 'STATE_LOBBY' | 'STATE_IN_GAME';

export interface UIStateMachineOptions {
  onStateChange?: ((newState: UIState, prevState: UIState) => void) | undefined;
}

export class UIStateMachine {
  private currentState: UIState;
  private onStateChange?: ((newState: UIState, prevState: UIState) => void) | undefined;

  // DOM Elements cache
  private elNicknameModal: HTMLElement | null = null;
  private elLobbyModal: HTMLElement | null = null;
  private elAppRoot: HTMLElement | null = null;
  private elHud: HTMLElement | null = null;
  private elGameView: HTMLElement | null = null;
  private elChatSection: HTMLElement | null = null;
  private elIngameMenu: HTMLElement | null = null;
  private elSettingsModal: HTMLElement | null = null;
  private elContextMenu: HTMLElement | null = null;

  constructor(initialState: UIState, options: UIStateMachineOptions = {}) {
    this.currentState = initialState;
    this.onStateChange = options.onStateChange;

    if (typeof document !== 'undefined') {
      this.cacheElements();
      this.applyDOMVisibility(this.currentState);
    }
  }

  public cacheElements(): void {
    if (typeof document === 'undefined') return;

    this.elNicknameModal = document.querySelector('.modal-nickname') || document.getElementById('nicknameGatekeeperModal');
    this.elLobbyModal = document.querySelector('.lobby-container') || document.getElementById('lobbyModal');
    this.elAppRoot = document.querySelector('.game-container') || document.getElementById('app-root');
    this.elHud = document.querySelector('.hud-container');
    this.elGameView = document.getElementById('game-view');
    this.elChatSection = document.getElementById('chat-section');
    this.elIngameMenu = document.getElementById('ingame-menu');
    this.elSettingsModal = document.getElementById('settingsModal');
    this.elContextMenu = document.getElementById('playerContextMenu');
  }

  public getState(): UIState {
    return this.currentState;
  }

  public transitionTo(nextState: UIState): void {
    if (this.currentState === nextState) return;

    const prevState = this.currentState;
    this.currentState = nextState;

    this.applyDOMVisibility(nextState);

    if (this.onStateChange) {
      this.onStateChange(nextState, prevState);
    }
  }

  public activeModal: string | null = null;

  /**
   * Conmutación universal de modal de menú de sala para Host y No-Host.
   * Tanto el Host como cualquier jugador No-Host pueden abrir/cerrar el modal
   * durante todas las fases de juego (COUNTDOWN, PLAYING, PAUSED, GOAL_CELEBRATION, MATCH_ENDED).
   * Excepción única: Durante STOPPED permanece abierto para todos de forma fija.
   */
  public toggleModal(modalName: string = 'teamSelect', _isHost?: boolean, matchPhase?: MatchPhase | number): boolean {
    if (modalName === 'teamSelect' || modalName === 'ingameMenu') {
      if (matchPhase === MatchPhase.STOPPED) {
        this.openModal(modalName);
        return true;
      }
      if (this.isModalOpen(modalName)) {
        this.closeModal(modalName);
        return false;
      } else {
        this.openModal(modalName);
        return true;
      }
    }
    return false;
  }

  public openModal(modalName: string = 'teamSelect'): void {
    if (modalName === 'teamSelect' || modalName === 'ingameMenu') {
      this.activeModal = 'teamSelect';
      if (!this.elIngameMenu && typeof document !== 'undefined') {
        this.elIngameMenu = document.getElementById('ingame-menu');
      }
      if (this.elIngameMenu) {
        this.elIngameMenu.classList.remove('hidden', 'u-hidden', 'ui-screen-hidden');
        this.elIngameMenu.style.display = 'flex';
        this.elIngameMenu.style.pointerEvents = 'auto';
      }
    } else {
      this.activeModal = modalName;
    }
  }

  public closeModal(modalName: string = 'teamSelect'): void {
    if (modalName === 'teamSelect' || modalName === 'ingameMenu') {
      if (this.activeModal === 'teamSelect' || this.activeModal === 'ingameMenu' || !modalName) {
        this.activeModal = null;
      } else if (this.activeModal === modalName) {
        this.activeModal = null;
      }
      if (!this.elIngameMenu && typeof document !== 'undefined') {
        this.elIngameMenu = document.getElementById('ingame-menu');
      }
      if (this.elIngameMenu) {
        this.elIngameMenu.classList.add('hidden');
        this.elIngameMenu.classList.remove('is-forced-open');
        this.elIngameMenu.style.display = 'none';
      }
    } else {
      if (this.activeModal === modalName) {
        this.activeModal = null;
      }
    }
  }

  public isModalOpen(modalName: string = 'teamSelect'): boolean {
    if (modalName === 'teamSelect' || modalName === 'ingameMenu') {
      if (!this.elIngameMenu && typeof document !== 'undefined') {
        this.elIngameMenu = document.getElementById('ingame-menu');
      }
      if (!this.elIngameMenu) return this.activeModal === 'teamSelect' || this.activeModal === 'ingameMenu';
      const isHidden = this.elIngameMenu.classList.contains('hidden') ||
                       this.elIngameMenu.classList.contains('u-hidden') ||
                       this.elIngameMenu.classList.contains('ui-screen-hidden') ||
                       this.elIngameMenu.style.display === 'none';
      return !isHidden;
    }
    return this.activeModal === modalName;
  }

  /**
   * Aplica o retira la clase utilitaria .u-hidden de los contenedores
   * de forma determinista para evitar pantallas en blanco o elementos superpuestos.
   */
  public applyDOMVisibility(state?: UIState): void {
    if (typeof document === 'undefined') return;

    const targetState = state ?? this.currentState;

    if (!this.elNicknameModal && (document.getElementById('nicknameGatekeeperModal') || document.querySelector('.modal-nickname'))) {
      this.cacheElements();
    }

    const hide = (el: HTMLElement | null) => {
      if (!el) return;
      el.classList.add('u-hidden', 'ui-screen-hidden');
      el.style.display = 'none';
    };

    const show = (el: HTMLElement | null, displayStyle: string = 'flex') => {
      if (!el) return;
      el.classList.remove('u-hidden', 'ui-screen-hidden');
      el.style.display = displayStyle;
    };

    switch (targetState) {
      case 'STATE_NICKNAME': {
        this.activeModal = null;
        // Modal de alias activo; canvas y lobby apagados
        show(this.elNicknameModal, 'flex');
        hide(this.elLobbyModal);
        hide(this.elAppRoot);
        hide(this.elHud);
        hide(this.elGameView);
        hide(this.elChatSection);
        hide(this.elIngameMenu);
        hide(this.elSettingsModal);
        hide(this.elContextMenu);
        break;
      }

      case 'STATE_LOBBY': {
        this.activeModal = null;
        // Lobby activo; modal de alias y juego (canvas/HUD) apagados
        hide(this.elNicknameModal);
        show(this.elLobbyModal, 'flex');
        hide(this.elAppRoot);
        hide(this.elHud);
        hide(this.elGameView);
        hide(this.elChatSection);
        hide(this.elIngameMenu);
        hide(this.elSettingsModal);
        hide(this.elContextMenu);
        break;
      }

      case 'STATE_IN_GAME': {
        // Juego activo: Canvas visible, marcador HUD visible y Chat Box visible
        hide(this.elNicknameModal);
        hide(this.elLobbyModal);
        show(this.elAppRoot, 'flex');
        show(this.elHud, 'flex');
        show(this.elGameView, 'flex');
        show(this.elChatSection, 'flex');

        // TeamSelect / In-game menu: no mostrar automáticamente a menos que esté forzado
        if (this.elIngameMenu && !this.elIngameMenu.classList.contains('is-forced-open')) {
          hide(this.elIngameMenu);
          this.activeModal = null;
        }
        hide(this.elSettingsModal);
        // NOTE: Do NOT hide elContextMenu here — it is managed by GameApp
        break;
      }
    }
  }

  // Alias para mantener compatibilidad con código existente
  public applyStateDOM(state: UIState): void {
    this.applyDOMVisibility(state);
  }
}
