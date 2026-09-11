export interface LobbyRoomConfig {
  name: string;
  maxPlayers: number;
  isPrivate: boolean;
  password?: string;
  timeLimit: number;
  scoreLimit: number;
  teamsLocked: boolean;
}

export interface LobbyEvents {
  onCreateRoom: (nickname: string, config: LobbyRoomConfig) => void;
  onJoinRoom: (nickname: string, roomId: string, password?: string) => void;
  onSinglePlayer: (nickname: string) => void;
  onRefreshRooms: () => void;
}

export class RoomLobby {
  private overlayEl: HTMLElement;
  private nicknameInput: HTMLInputElement;
  private roomNameInput: HTMLInputElement;
  private maxPlayersInput: HTMLInputElement;
  private timeLimitSelect: HTMLSelectElement;
  private scoreLimitSelect: HTMLSelectElement;
  private isPrivateCheckbox: HTMLInputElement;
  private passwordContainer: HTMLElement;
  private passwordInput: HTMLInputElement;
  private roomIdInput: HTMLInputElement;
  private roomListContainer: HTMLElement;
  private events: LobbyEvents;

  constructor(events: LobbyEvents) {
    this.events = events;
    this.overlayEl = document.getElementById('lobbyModal')!;
    this.nicknameInput = document.getElementById('lobbyNickname') as HTMLInputElement;
    this.roomNameInput = document.getElementById('lobbyRoomName') as HTMLInputElement;
    this.maxPlayersInput = document.getElementById('lobbyMaxPlayers') as HTMLInputElement;
    this.timeLimitSelect = document.getElementById('lobbyTimeLimit') as HTMLSelectElement;
    this.scoreLimitSelect = document.getElementById('lobbyScoreLimit') as HTMLSelectElement;
    this.isPrivateCheckbox = document.getElementById('lobbyIsPrivate') as HTMLInputElement;
    this.passwordContainer = document.getElementById('lobbyPasswordContainer')!;
    this.passwordInput = document.getElementById('lobbyPassword') as HTMLInputElement;
    this.roomIdInput = document.getElementById('lobbyRoomId') as HTMLInputElement;
    this.roomListContainer = document.getElementById('lobbyRoomList')!;

    this.setupListeners();
  }

  private setupListeners(): void {
    const createBtn = document.getElementById('btnCreateRoom');
    const joinBtn = document.getElementById('btnJoinRoom');
    const practiceBtn = document.getElementById('btnPracticeMode');
    const refreshBtn = document.getElementById('btnRefreshRooms');

    // Toggle password input based on private room checkbox
    if (this.isPrivateCheckbox && this.passwordContainer) {
      this.isPrivateCheckbox.addEventListener('change', () => {
        this.passwordContainer.style.display = this.isPrivateCheckbox.checked ? 'block' : 'none';
        if (this.isPrivateCheckbox.checked) {
          this.passwordInput.focus();
        }
      });
    }

    if (createBtn) {
      createBtn.addEventListener('click', () => {
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
    }

    if (joinBtn) {
      joinBtn.addEventListener('click', () => {
        const nick = this.getNickname();
        const roomId = this.roomIdInput.value.trim().toUpperCase();
        if (roomId) {
          this.events.onJoinRoom(nick, roomId);
        } else {
          alert('Por favor introduce el ID de la sala');
        }
      });
    }

    if (practiceBtn) {
      practiceBtn.addEventListener('click', () => {
        const nick = this.getNickname();
        this.events.onSinglePlayer(nick);
      });
    }

    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => {
        this.events.onRefreshRooms();
      });
    }
  }

  public getNickname(): string {
    const fromStorage = localStorage.getItem('haxball_player_name')?.trim();
    if (fromStorage) return fromStorage;
    return this.nicknameInput?.value.trim() || `Player_${Math.floor(Math.random() * 900 + 100)}`;
  }

  public setNickname(nick: string): void {
    if (this.nicknameInput) {
      this.nicknameInput.value = nick;
    }
  }

  public hide(): void {
    if (this.overlayEl) {
      this.overlayEl.style.display = 'none';
    }
  }


  public show(): void {
    if (this.overlayEl) {
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
        this.roomIdInput.value = r.id;
      });

      this.roomListContainer.appendChild(item);
    }
  }
}
