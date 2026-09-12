import { Player, TeamType } from '../../core/game/Player';

export class TeamSelectModal {
  private redListEl: HTMLElement | null;
  private blueListEl: HTMLElement | null;
  private specListEl: HTMLElement | null;
  private redCountEl: HTMLElement | null;
  private blueCountEl: HTMLElement | null;
  private specCountEl: HTMLElement | null;

  public onSelectTeam?: (team: TeamType) => void;
  public onPlayerClick?: (player: Player, event: MouseEvent) => void;
  public onTeamChangeRequest?: (playerId: string, team: TeamType) => void;

  constructor() {
    this.redListEl = document.getElementById('redPlayersList');
    if (!this.redListEl) console.warn('[TeamSelectModal] Element "#redPlayersList" was not found in DOM.');

    this.blueListEl = document.getElementById('bluePlayersList');
    if (!this.blueListEl) console.warn('[TeamSelectModal] Element "#bluePlayersList" was not found in DOM.');

    this.specListEl = document.getElementById('specPlayersList');
    if (!this.specListEl) console.warn('[TeamSelectModal] Element "#specPlayersList" was not found in DOM.');

    this.redCountEl = document.getElementById('redCount');
    if (!this.redCountEl) console.warn('[TeamSelectModal] Element "#redCount" was not found in DOM.');

    this.blueCountEl = document.getElementById('blueCount');
    if (!this.blueCountEl) console.warn('[TeamSelectModal] Element "#blueCount" was not found in DOM.');

    this.specCountEl = document.getElementById('specCount');
    if (!this.specCountEl) console.warn('[TeamSelectModal] Element "#specCount" was not found in DOM.');

    const joinRedBtn = document.getElementById('joinRedBtn');
    if (joinRedBtn) {
      joinRedBtn.addEventListener('click', () => this.onSelectTeam?.('red'));
    } else {
      console.warn('[TeamSelectModal] Element "#joinRedBtn" was not found in DOM.');
    }

    const joinBlueBtn = document.getElementById('joinBlueBtn');
    if (joinBlueBtn) {
      joinBlueBtn.addEventListener('click', () => this.onSelectTeam?.('blue'));
    } else {
      console.warn('[TeamSelectModal] Element "#joinBlueBtn" was not found in DOM.');
    }

    const joinSpecBtn = document.getElementById('joinSpecBtn');
    if (joinSpecBtn) {
      joinSpecBtn.addEventListener('click', () => this.onSelectTeam?.('spec'));
    } else {
      console.warn('[TeamSelectModal] Element "#joinSpecBtn" was not found in DOM.');
    }

    this.setupDragAndDropColumns();
  }

  private setupDragAndDropColumns(): void {
    const columns = document.querySelectorAll<HTMLElement>('.team-col');
    columns.forEach(col => {
      col.addEventListener('dragover', (e: DragEvent) => {
        e.preventDefault();
        if (e.dataTransfer) {
          e.dataTransfer.dropEffect = 'move';
        }
        col.classList.add('drag-over');
      });

      col.addEventListener('dragleave', () => {
        col.classList.remove('drag-over');
      });

      col.addEventListener('drop', (e: DragEvent) => {
        e.preventDefault();
        col.classList.remove('drag-over');
        const playerId = e.dataTransfer?.getData('text/plain');
        const rawTeam = col.getAttribute('data-team');
        const targetTeam: TeamType = rawTeam === 'spectators' ? 'spec' : (rawTeam as TeamType);

        if (playerId && targetTeam && this.onTeamChangeRequest) {
          this.onTeamChangeRequest(playerId, targetTeam);
        }
      });
    });
  }

  public updateLists(players: Player[], isLocalAdmin: boolean = false): void {
    if (this.redListEl) this.redListEl.innerHTML = '';
    if (this.blueListEl) this.blueListEl.innerHTML = '';
    if (this.specListEl) this.specListEl.innerHTML = '';

    const red = players.filter(p => p.team === 'red');
    const blue = players.filter(p => p.team === 'blue');
    // Estricto orden FIFO para espectadores
    const spec = players.filter(p => p.team === 'spec').sort((a, b) => (a.joinedAt ?? 0) - (b.joinedAt ?? 0));

    if (this.redCountEl) this.redCountEl.textContent = red.length.toString();
    if (this.blueCountEl) this.blueCountEl.textContent = blue.length.toString();
    if (this.specCountEl) this.specCountEl.textContent = spec.length.toString();

    const renderPlayer = (p: Player, container: HTMLElement) => {
      const el = document.createElement('div');
      el.className = 'player-item';
      el.draggable = false;

      let startX = 0;
      let startY = 0;
      let hasMovedBeyondThreshold = false;

      if (isLocalAdmin) {
        el.addEventListener('dragstart', (e: DragEvent) => {
          if (!hasMovedBeyondThreshold) {
            e.preventDefault();
            return;
          }
          if (e.dataTransfer) {
            e.dataTransfer.setData('text/plain', p.id);
            e.dataTransfer.effectAllowed = 'move';
          }
        });

        el.addEventListener('dragend', () => {
          el.draggable = false;
          hasMovedBeyondThreshold = false;
        });
      }

      el.addEventListener('mousedown', (e: MouseEvent) => {
        startX = e.clientX;
        startY = e.clientY;
        hasMovedBeyondThreshold = false;
      });

      el.addEventListener('mousemove', (e: MouseEvent) => {
        if (e.buttons === 1 && isLocalAdmin) {
          const dist = Math.hypot(e.clientX - startX, e.clientY - startY);
          if (dist >= 5) {
            hasMovedBeyondThreshold = true;
            el.draggable = true;
          }
        }
      });

      const hostIcon = p.isHost ? '👑 ' : '';
      const adminIcon = (!p.isHost && p.isAdmin) ? '⭐ ' : '';
      const adminRoleText = p.isHost ? 'Host' : (p.isAdmin ? 'Admin' : '');

      el.innerHTML = `
        <div style="display: flex; align-items: center; gap: 4px; overflow: hidden; flex: 1;">
          <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
            ${hostIcon}${adminIcon}<strong>${p.name}</strong> [${p.avatar}]
          </span>
          ${adminRoleText ? `<span style="font-size: 0.65rem; color: #64748b;">${adminRoleText}</span>` : ''}
        </div>
        ${isLocalAdmin ? `<button class="btn-player-options" title="Acciones de Jugador" style="background: transparent; border: none; color: #94a3b8; font-size: 1rem; cursor: pointer; padding: 0 4px; border-radius: 4px; line-height: 1;">⋮</button>` : ''}
      `;

      // Botón de 3 puntos exclusivo para opciones de moderación
      const optionsBtn = el.querySelector('.btn-player-options');
      if (optionsBtn) {
        optionsBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          e.preventDefault();
          if (this.onPlayerClick) {
            this.onPlayerClick(p, e as MouseEvent);
          }
        });
      }

      // Clic en el elemento entero (siempre que no haya sido arrastre)
      el.addEventListener('click', (e: MouseEvent) => {
        if (hasMovedBeyondThreshold) {
          hasMovedBeyondThreshold = false;
          return;
        }
        e.stopPropagation();
        if (this.onPlayerClick) {
          this.onPlayerClick(p, e);
        }
      });

      container.appendChild(el);
    };

    if (this.redListEl) {
      const el = this.redListEl;
      red.forEach(p => renderPlayer(p, el));
    }
    if (this.blueListEl) {
      const el = this.blueListEl;
      blue.forEach(p => renderPlayer(p, el));
    }
    if (this.specListEl) {
      const el = this.specListEl;
      spec.forEach(p => renderPlayer(p, el));
    }
  }
}

