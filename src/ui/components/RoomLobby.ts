export interface LobbyRoomConfig {
  name: string;
  maxPlayers: number;
  isPrivate: boolean;
  password?: string | undefined;
  timeLimit: number;
  scoreLimit: number;
  teamsLocked: boolean;
}

export interface LobbyEvents {
  onCreateRoom: (nickname: string, config: LobbyRoomConfig) => void;
  onJoinRoom: (nickname: string, roomId: string, password?: string) => void;
  onSinglePlayer: (nickname: string) => void;
  onRefreshRooms: () => void;
  onEditNickname?: () => void;
  onCancelConnecting?: () => void;
}

export class RoomLobby {
  private overlayEl: HTMLElement | null = null;
  private nicknameInput: HTMLInputElement | null = null;
  private userAvatarEl: HTMLElement | null = null;
  private currentNickEl: HTMLElement | null = null;
  private editNickBtn: HTMLButtonElement | null = null;
  private signalingDotEl: HTMLElement | null = null;
  private signalingTextEl: HTMLElement | null = null;
  private loadingOverlayEl: HTMLElement | null = null;
  private loadingTextEl: HTMLElement | null = null;
  private cancelConnectingBtn: HTMLButtonElement | null = null;

  private roomNameInput: HTMLInputElement | null = null;
  private maxPlayersInput: HTMLInputElement | null = null;
  private timeLimitSelect: HTMLSelectElement | null = null;
  private scoreLimitSelect: HTMLSelectElement | null = null;
  private isPrivateCheckbox: HTMLInputElement | null = null;
  private passwordContainer: HTMLElement | null = null;
  private passwordInput: HTMLInputElement | null = null;
  private roomIdInput: HTMLInputElement | null = null;
  private roomListContainer: HTMLElement | null = null;
  private events: LobbyEvents;

  constructor(events: LobbyEvents) {
    this.events = events;

    this.overlayEl = document.getElementById('lobbyModal') || document.querySelector('.lobby-container');
    if (!this.overlayEl) console.warn('[RoomLobby] Element "#lobbyModal" was not found in DOM.');

    this.nicknameInput = document.getElementById('lobbyNickname') as HTMLInputElement | null;
    if (!this.nicknameInput) console.warn('[RoomLobby] Element "#lobbyNickname" was not found in DOM.');

    this.userAvatarEl = document.getElementById('lobbyUserAvatar');
    if (!this.userAvatarEl) console.warn('[RoomLobby] Element "#lobbyUserAvatar" was not found in DOM.');

    this.currentNickEl = document.getElementById('lobbyCurrentNick');
    if (!this.currentNickEl) console.warn('[RoomLobby] Element "#lobbyCurrentNick" was not found in DOM.');

    this.editNickBtn = document.getElementById('btnEditNickname') as HTMLButtonElement | null;
    if (!this.editNickBtn) console.warn('[RoomLobby] Element "#btnEditNickname" was not found in DOM.');

    this.signalingDotEl = document.getElementById('lobbySignalingDot');
    if (!this.signalingDotEl) console.warn('[RoomLobby] Element "#lobbySignalingDot" was not found in DOM.');

    this.signalingTextEl = document.getElementById('lobbySignalingText');
    if (!this.signalingTextEl) console.warn('[RoomLobby] Element "#lobbySignalingText" was not found in DOM.');

    this.loadingOverlayEl = document.getElementById('lobbyLoadingOverlay');
    if (!this.loadingOverlayEl) console.warn('[RoomLobby] Element "#lobbyLoadingOverlay" was not found in DOM.');

    this.loadingTextEl = document.getElementById('lobbyLoadingText');
    if (!this.loadingTextEl) console.warn('[RoomLobby] Element "#lobbyLoadingText" was not found in DOM.');

    this.cancelConnectingBtn = document.getElementById('btnCancelConnecting') as HTMLButtonElement | null;
    if (!this.cancelConnectingBtn) console.warn('[RoomLobby] Element "#btnCancelConnecting" was not found in DOM.');

    this.roomNameInput = document.getElementById('lobbyRoomName') as HTMLInputElement | null;
    if (!this.roomNameInput) console.warn('[RoomLobby] Element "#lobbyRoomName" was not found in DOM.');

    this.maxPlayersInput = document.getElementById('lobbyMaxPlayers') as HTMLInputElement | null;
    if (!this.maxPlayersInput) console.warn('[RoomLobby] Element "#lobbyMaxPlayers" was not found in DOM.');

    this.timeLimitSelect = document.getElementById('lobbyTimeLimit') as HTMLSelectElement | null;
    if (!this.timeLimitSelect) console.warn('[RoomLobby] Element "#lobbyTimeLimit" was not found in DOM.');

    this.scoreLimitSelect = document.getElementById('lobbyScoreLimit') as HTMLSelectElement | null;
    if (!this.scoreLimitSelect) console.warn('[RoomLobby] Element "#lobbyScoreLimit" was not found in DOM.');

    this.isPrivateCheckbox = document.getElementById('lobbyIsPrivate') as HTMLInputElement | null;
    if (!this.isPrivateCheckbox) console.warn('[RoomLobby] Element "#lobbyIsPrivate" was not found in DOM.');

    this.passwordContainer = document.getElementById('lobbyPasswordContainer');
    if (!this.passwordContainer) console.warn('[RoomLobby] Element "#lobbyPasswordContainer" was not found in DOM.');

    this.passwordInput = document.getElementById('lobbyPassword') as HTMLInputElement | null;
    if (!this.passwordInput) console.warn('[RoomLobby] Element "#lobbyPassword" was not found in DOM.');

    this.roomIdInput = document.getElementById('lobbyRoomId') as HTMLInputElement | null;
    if (!this.roomIdInput) console.warn('[RoomLobby] Element "#lobbyRoomId" was not found in DOM.');

    this.roomListContainer = document.getElementById('lobbyRoomList');
    if (!this.roomListContainer) console.warn('[RoomLobby] Element "#lobbyRoomList" was not found in DOM.');

    this.setupListeners();
  }

  private setupListeners(): void {
    const createBtn = document.getElementById('btnCreateRoom');
    const joinBtn = document.getElementById('btnJoinRoom');
    const practiceBtn = document.getElementById('btnPracticeMode');
    const refreshBtn = document.getElementById('btnRefreshRooms');

    if (!createBtn) console.warn('[RoomLobby] Element "#btnCreateRoom" was not found in DOM.');
    if (!joinBtn) console.warn('[RoomLobby] Element "#btnJoinRoom" was not found in DOM.');
    if (!practiceBtn) console.warn('[RoomLobby] Element "#btnPracticeMode" was not found in DOM.');
    if (!refreshBtn) console.warn('[RoomLobby] Element "#btnRefreshRooms" was not found in DOM.');

    // Toggle password input based on private room checkbox
    if (this.isPrivateCheckbox && this.passwordContainer) {
      this.isPrivateCheckbox.addEventListener('change', () => {
        if (this.passwordContainer && this.isPrivateCheckbox) {
          this.passwordContainer.style.display = this.isPrivateCheckbox.checked ? 'block' : 'none';
          if (this.isPrivateCheckbox.checked) {
            this.passwordInput?.focus();
          }
        }
      });
    }

    createBtn?.addEventListener('click', () => {
      const nick = this.getNickname();
      const roomName = this.roomNameInput?.value.trim() || `${nick}'s Match`;
      const maxPlayers = parseInt(this.maxPlayersInput?.value || '12', 10);
      const timeLimit = parseInt(this.timeLimitSelect?.value || '3', 10);
      const scoreLimit = parseInt(this.scoreLimitSelect?.value || '3', 10);
      const isPrivate = this.isPrivateCheckbox ? this.isPrivateCheckbox.checked : false;
      const password = this.passwordInput?.value.trim();

      if (isPrivate && !password) {
        alert('Debes ingresar una contraseña para crear una sala privada');
        return;
      }

      const config: LobbyRoomConfig = {
        name: roomName,
        maxPlayers: Math.max(2, Math.min(16, isNaN(maxPlayers) ? 12 : maxPlayers)),
        timeLimit: isNaN(timeLimit) ? 3 : timeLimit,
        scoreLimit: isNaN(scoreLimit) ? 3 : scoreLimit,
        isPrivate,
        password: isPrivate ? password : '',
        teamsLocked: false
      };

      this.events.onCreateRoom(nick, config);
    });

    joinBtn?.addEventListener('click', () => {
      const nick = this.getNickname();
      const roomId = this.roomIdInput?.value.trim().toUpperCase() || '';
      if (roomId) {
        this.events.onJoinRoom(nick, roomId);
      } else {
        alert('Por favor introduce el ID de la sala');
      }
    });

    practiceBtn?.addEventListener('click', () => {
      const nick = this.getNickname();
      this.events.onSinglePlayer(nick);
    });

    refreshBtn?.addEventListener('click', () => {
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

  public showConnecting(message: string = 'Conectando P2P...'): void {
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

  public getNickname(): string {
    if (typeof localStorage !== 'undefined') {
      const fromStorage = localStorage.getItem('haxball_nickname')?.trim() ||
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
  }

  public show(): void {
    if (this.overlayEl) {
      this.overlayEl.classList.remove('u-hidden', 'ui-screen-hidden');
      this.overlayEl.style.display = 'flex';
    }
  }

  public setRoomList(rooms: Array<{ id: string; name: string; playerCount: number; maxPlayers?: number; isPrivate?: boolean; timeLimit?: number; scoreLimit?: number }>): void {
    if (!this.roomListContainer) return;
    this.roomListContainer.innerHTML = '';

    if (rooms.length === 0) {
      const empty = document.createElement('div');
      empty.style.padding = '12px';
      empty.style.color = '#94a3b8';
      empty.style.textAlign = 'center';
      empty.style.fontSize = '0.85rem';
      empty.textContent = 'No hay salas activas. ¡Crea una o juega en Práctica!';
      this.roomListContainer.appendChild(empty);
      return;
    }

    for (const r of rooms) {
      const item = document.createElement('div');
      item.className = 'room-item';
      const lockIcon = r.isPrivate ? '🔒' : '🌐';
      const maxP = r.maxPlayers ?? 12;
      const isFull = r.playerCount >= maxP;
      const timeStr = r.timeLimit === 0 ? 'Indef.' : `${r.timeLimit ?? 3}m`;
      const scoreStr = r.scoreLimit === 0 ? 'Indef.' : `${r.scoreLimit ?? 3}g`;

      item.innerHTML = `
        <div>
          <div style="font-weight: 700; font-size: 0.85rem; display: flex; align-items: center; gap: 4px;">
            <span>${lockIcon}</span>
            <span>${r.name}</span>
            ${r.isPrivate ? '<span style="font-size: 0.65rem; background: rgba(239, 68, 68, 0.3); color: #ef4444; padding: 1px 4px; border-radius: 4px;">Privada</span>' : ''}
          </div>
          <div style="font-size: 0.7rem; color: #94a3b8;">
            ID: <strong>${r.id}</strong> &bull; ⏱ ${timeStr} &bull; ⚽ ${scoreStr}
          </div>
        </div>
        <div style="text-align: right;">
          <div style="font-size: 0.75rem; font-weight: 600; color: ${isFull ? '#ef4444' : '#38bdf8'};">
            ${r.playerCount}/${maxP} jugadores
          </div>
          <button class="btn btn-secondary btn-join-direct" style="padding: 2px 8px; font-size: 0.7rem; margin-top: 2px;" ${isFull ? 'disabled' : ''}>
            ${isFull ? 'Llena' : 'Entrar'}
          </button>
        </div>
      `;

      item.querySelector('.btn-join-direct')?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (isFull) {
          alert('La sala está llena.');
          return;
        }
        let password = '';
        if (r.isPrivate) {
          const passPrompt = prompt(`La sala "${r.name}" es privada. Ingresa la contraseña:`);
          if (passPrompt === null) return;
          password = passPrompt.trim();
        }
        this.events.onJoinRoom(this.getNickname(), r.id, password);
      });

      item.addEventListener('click', () => {
        if (this.roomIdInput) {
          this.roomIdInput.value = r.id;
        }
      });

      this.roomListContainer.appendChild(item);
    }
  }
}
