export type UIState = 'STATE_NICKNAME' | 'STATE_LOBBY' | 'STATE_IN_GAME';

export interface UIStateMachineOptions {
  onStateChange?: (newState: UIState, prevState: UIState) => void;
}

export class UIStateMachine {
  private currentState: UIState;
  private onStateChange?: (newState: UIState, prevState: UIState) => void;

  // DOM Elements
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
      this.applyStateDOM(this.currentState);
    }
  }

  public cacheElements(): void {
    if (typeof document === 'undefined') return;

    this.elNicknameModal = document.getElementById('nicknameGatekeeperModal');
    this.elLobbyModal = document.getElementById('lobbyModal');
    this.elAppRoot = document.getElementById('app-root');
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

    this.applyStateDOM(nextState);

    if (this.onStateChange) {
      this.onStateChange(nextState, prevState);
    }
  }

  /**
   * Aplica clases .ui-screen-hidden estrictas asegurando que sólo la pantalla activa
   * esté visible y reciba eventos de ratón/teclado.
   */
  public applyStateDOM(state: UIState): void {
    if (typeof document === 'undefined') return;

    // Asegurar caché de elementos
    if (!this.elLobbyModal && document.getElementById('lobbyModal')) {
      this.cacheElements();
    }

    const hide = (el: HTMLElement | null) => {
      if (!el) return;
      el.classList.add('ui-screen-hidden');
      el.style.display = 'none';
    };

    const show = (el: HTMLElement | null, displayStyle: string = 'flex') => {
      if (!el) return;
      el.classList.remove('ui-screen-hidden');
      el.style.display = displayStyle;
    };

    switch (state) {
      case 'STATE_NICKNAME': {
        // Exclusivamente el modal de bienvenida
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
        // Exclusivamente la pantalla del Lobby
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
        // Pantalla de juego activa (Canvas, HUD, Chat)
        hide(this.elNicknameModal);
        hide(this.elLobbyModal);
        show(this.elAppRoot, 'flex');
        show(this.elHud, 'flex');
        show(this.elGameView, 'flex');
        show(this.elChatSection, 'flex');

        // Menú in-game: oculto por defecto
        if (this.elIngameMenu) {
          this.elIngameMenu.classList.add('hidden');
          this.elIngameMenu.classList.remove('is-forced-open');
          this.elIngameMenu.style.display = 'none';
        }
        hide(this.elSettingsModal);
        hide(this.elContextMenu);
        break;
      }
    }
  }
}
