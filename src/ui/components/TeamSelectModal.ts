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
    this.blueListEl = document.getElementById('bluePlayersList');
    this.specListEl = document.getElementById('specPlayersList');
    this.redCountEl = document.getElementById('redCount');
    this.blueCountEl = document.getElementById('blueCount');
    this.specCountEl = document.getElementById('specCount');

    const joinRedBtn = document.getElementById('joinRedBtn');
    const joinBlueBtn = document.getElementById('joinBlueBtn');
    const joinSpecBtn = document.getElementById('joinSpecBtn');

    if (joinRedBtn) joinRedBtn.addEventListener('click', () => this.onSelectTeam?.('red'));
    if (joinBlueBtn) joinBlueBtn.addEventListener('click', () => this.onSelectTeam?.('blue'));
    if (joinSpecBtn) joinSpecBtn.addEventListener('click', () => this.onSelectTeam?.('spec'));

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

      if (isLocalAdmin) {
        el.draggable = true;
        el.addEventListener('dragstart', (e: DragEvent) => {
          if (e.dataTransfer) {
            e.dataTransfer.setData('text/plain', p.id);
            e.dataTransfer.effectAllowed = 'move';
          }
        });
      } else {
        el.draggable = false;
      }

      const hostIcon = p.isHost ? '👑 ' : '';
      const adminIcon = (!p.isHost && p.isAdmin) ? '⭐ ' : '';
      el.innerHTML = `
        <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
          ${hostIcon}${adminIcon}<strong>${p.name}</strong> [${p.avatar}]
        </span>
        <span style="font-size: 0.65rem; color: #64748b;">${p.isHost ? 'Host' : (p.isAdmin ? 'Admin' : '')}</span>
      `;

      el.addEventListener('click', (e) => {
        if (this.onPlayerClick) {
          this.onPlayerClick(p, e);
        }
      });

      container.appendChild(el);
    };

    if (this.redListEl) red.forEach(p => renderPlayer(p, this.redListEl!));
    if (this.blueListEl) blue.forEach(p => renderPlayer(p, this.blueListEl!));
    if (this.specListEl) spec.forEach(p => renderPlayer(p, this.specListEl!));
  }
}

