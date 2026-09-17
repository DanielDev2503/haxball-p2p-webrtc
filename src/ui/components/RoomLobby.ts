import { CreateRoomModal, CreateRoomModalConfig } from './CreateRoomModal';
import { renderIcon, PlusSquare, Search, RefreshCw } from '../utils/icons';

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

export interface RoomListItem {
  id: string;
  name: string;
  playerCount: number;
  maxPlayers?: number;
  isPrivate?: boolean;
  timeLimit?: number;
  scoreLimit?: number;
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

  private openCreateRoomBtn: HTMLButtonElement | null = null;
  private searchInput: HTMLInputElement | null = null;
  private refreshRoomsBtn: HTMLButtonElement | null = null;
  private roomIdInput: HTMLInputElement | null = null;
  private roomListContainer: HTMLElement | null = null;

  public createRoomModal: CreateRoomModal;
  private events: LobbyEvents;
  private cachedRooms: RoomListItem[] = [];

  constructor(events: LobbyEvents) {
    this.events = events;

    this.overlayEl = document.getElementById('lobbyModal') || document.querySelector('.lobby-container');
    if (!this.overlayEl) console.warn('[RoomLobby] Element "#lobbyModal" was not found in DOM.');

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

    // Instantiate independent CreateRoomModal
    this.createRoomModal = new CreateRoomModal({
      onSubmit: (config: CreateRoomModalConfig) => {
        const nick = this.getNickname();
        const lobbyConfig: LobbyRoomConfig = {
          ...config,
          teamsLocked: false
        };
        this.events.onCreateRoom(nick, lobbyConfig);
      }
    });

    this.renderIcons();
    this.setupListeners();
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
    const practiceBtn = document.getElementById('btnPracticeMode');

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
    this.createRoomModal.hide();
  }

  public show(): void {
    if (this.overlayEl) {
      this.overlayEl.classList.remove('u-hidden', 'ui-screen-hidden');
      this.overlayEl.style.display = 'flex';
    }
  }

  public setRoomList(rooms: RoomListItem[]): void {
    this.cachedRooms = rooms;
    this.filterAndRenderRooms();
  }

  private filterAndRenderRooms(): void {
    if (!this.roomListContainer) return;
    this.roomListContainer.innerHTML = '';

    const query = this.searchInput?.value.trim().toLowerCase() || '';
    const filtered = this.cachedRooms.filter((r) => {
      if (!query) return true;
      return (
        r.name.toLowerCase().includes(query) ||
        r.id.toLowerCase().includes(query)
      );
    });

    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.style.padding = '14px';
      empty.style.color = 'var(--text-muted)';
      empty.style.textAlign = 'center';
      empty.style.fontSize = '0.85rem';
      empty.style.fontWeight = '600';
      empty.textContent = query
        ? `No se encontraron salas coincidentes con "${query}".`
        : 'No hay salas activas. ¡Crea una o juega en Práctica!';
      this.roomListContainer.appendChild(empty);
      return;
    }

    for (const r of filtered) {
      const item = document.createElement('div');
      item.className = 'room-item';
      const maxP = r.maxPlayers ?? 12;
      const isFull = r.playerCount >= maxP;
      const timeStr = r.timeLimit === 0 ? 'Indef.' : `${r.timeLimit ?? 3}m`;
      const scoreStr = r.scoreLimit === 0 ? 'Indef.' : `${r.scoreLimit ?? 3}g`;

      item.innerHTML = `
        <div style="flex: 1; min-width: 0;">
          <div style="font-weight: 800; font-size: 0.88rem; color: var(--text-primary); display: flex; align-items: center; gap: 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
            <span>${r.isPrivate ? '🔒' : '🌐'}</span>
            <span style="overflow: hidden; text-overflow: ellipsis;">${r.name}</span>
            ${r.isPrivate ? '<span class="badge-private">Privada</span>' : ''}
          </div>
          <div style="font-size: 0.72rem; color: var(--text-secondary); margin-top: 2px;">
            ID: <strong style="color: var(--aero-sky-600);">${r.id}</strong> &bull; ⏱ ${timeStr} &bull; ⚽ ${scoreStr}
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 8px; margin-left: 8px;">
          <span class="${isFull ? 'badge-full' : 'badge-sky'}">
            ${r.playerCount}/${maxP}
          </span>
          <button class="btn btn-secondary btn-xs btn-join-direct" ${isFull ? 'disabled' : ''}>
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
