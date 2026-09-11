export interface LobbyEvents {
  onCreateRoom: (nickname: string, roomName: string) => void;
  onJoinRoom: (nickname: string, roomId: string) => void;
  onSinglePlayer: (nickname: string) => void;
  onRefreshRooms: () => void;
}

export class RoomLobby {
  private overlayEl: HTMLElement;
  private nicknameInput: HTMLInputElement;
  private roomNameInput: HTMLInputElement;
  private roomIdInput: HTMLInputElement;
  private roomListContainer: HTMLElement;
  private events: LobbyEvents;

  constructor(events: LobbyEvents) {
    this.events = events;
    this.overlayEl = document.getElementById('lobbyModal')!;
    this.nicknameInput = document.getElementById('lobbyNickname') as HTMLInputElement;
    this.roomNameInput = document.getElementById('lobbyRoomName') as HTMLInputElement;
    this.roomIdInput = document.getElementById('lobbyRoomId') as HTMLInputElement;
    this.roomListContainer = document.getElementById('lobbyRoomList')!;

    this.setupListeners();
  }

  private setupListeners(): void {
    const createBtn = document.getElementById('btnCreateRoom');
    const joinBtn = document.getElementById('btnJoinRoom');
    const practiceBtn = document.getElementById('btnPracticeMode');
    const refreshBtn = document.getElementById('btnRefreshRooms');

    if (createBtn) {
      createBtn.addEventListener('click', () => {
        const nick = this.getNickname();
        const roomName = this.roomNameInput.value.trim() || `${nick}'s Match`;
        this.events.onCreateRoom(nick, roomName);
      });
    }

    if (joinBtn) {
      joinBtn.addEventListener('click', () => {
        const nick = this.getNickname();
        const roomId = this.roomIdInput.value.trim();
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
    return this.nicknameInput.value.trim() || `Player_${Math.floor(Math.random() * 900 + 100)}`;
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

  public setRoomList(rooms: Array<{ id: string; name: string; playerCount: number }>): void {
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
      item.innerHTML = `
        <div>
          <div style="font-weight: 700; font-size: 0.9rem;">${r.name}</div>
          <div style="font-size: 0.75rem; color: #94a3b8;">ID: ${r.id}</div>
        </div>
        <div style="font-size: 0.8rem; color: #38bdf8;">${r.playerCount} jugador(es)</div>
      `;
      item.addEventListener('click', () => {
        this.roomIdInput.value = r.id;
      });
      this.roomListContainer.appendChild(item);
    }
  }
}
