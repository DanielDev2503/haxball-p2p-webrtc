import { Player, TeamType } from '../../core/game/Player';

export class TeamSelectModal {
  private redListEl: HTMLElement;
  private blueListEl: HTMLElement;
  private specListEl: HTMLElement;
  public onSelectTeam?: (team: TeamType) => void;

  constructor() {
    this.redListEl = document.getElementById('redPlayersList')!;
    this.blueListEl = document.getElementById('bluePlayersList')!;
    this.specListEl = document.getElementById('specPlayersList')!;

    const joinRedBtn = document.getElementById('joinRedBtn');
    const joinBlueBtn = document.getElementById('joinBlueBtn');
    const joinSpecBtn = document.getElementById('joinSpecBtn');

    if (joinRedBtn) joinRedBtn.addEventListener('click', () => this.onSelectTeam?.('red'));
    if (joinBlueBtn) joinBlueBtn.addEventListener('click', () => this.onSelectTeam?.('blue'));
    if (joinSpecBtn) joinSpecBtn.addEventListener('click', () => this.onSelectTeam?.('spec'));
  }

  public updateLists(players: Player[]): void {
    if (this.redListEl) this.redListEl.innerHTML = '';
    if (this.blueListEl) this.blueListEl.innerHTML = '';
    if (this.specListEl) this.specListEl.innerHTML = '';

    for (const p of players) {
      const el = document.createElement('div');
      el.className = 'player-item';
      el.textContent = `${p.isHost ? '👑 ' : ''}${p.name} [${p.avatar}]`;

      if (p.team === 'red' && this.redListEl) {
        this.redListEl.appendChild(el);
      } else if (p.team === 'blue' && this.blueListEl) {
        this.blueListEl.appendChild(el);
      } else if (this.specListEl) {
        this.specListEl.appendChild(el);
      }
    }
  }
}
