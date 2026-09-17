import { Player, TeamType } from '../../core/game/Player';
import { MatchPhase, MatchState, toMatchPhase } from '../../core/game/GameFSM';

export class TeamSelectModal {
  private menuEl: HTMLElement | null;
  private closeBtn: HTMLElement | null;
  private returnGameBtn: HTMLElement | null;
  private matchToggleBtn: HTMLButtonElement | null = null;
  private isUserAdmin: boolean = true;
  private redListEl: HTMLElement | null;
  private blueListEl: HTMLElement | null;
  private specListEl: HTMLElement | null;
  private redCountEl: HTMLElement | null;
  private blueCountEl: HTMLElement | null;
  private specCountEl: HTMLElement | null;
  private currentMatchState: MatchPhase = MatchPhase.STOPPED;

  public onSelectTeam?: (team: TeamType) => void;
  public onPlayerClick?: (player: Player, event: MouseEvent) => void;
  public onTeamChangeRequest?: (playerId: string, team: TeamType) => void;
  public onOpenKeybinds?: () => void;
  public onMatchToggle?: () => void;

  constructor() {
    this.menuEl = document.getElementById('ingame-menu');
    this.closeBtn = document.getElementById('menu-close-btn');
    this.returnGameBtn = document.getElementById('btn-return-game');

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

    // Botón de ajustes de teclado (⚙)
    const btnSettings = document.getElementById('btn-settings-toggle') || document.getElementById('btn-settings') || document.querySelector?.('.btn-settings-btn');
    if (btnSettings) {
      btnSettings.addEventListener('click', (e) => {
        e.stopPropagation();
        this.onOpenKeybinds?.();
      });
    }

    // Botón de contingencia para regresar a la partida en curso
    const handleContingencyClose = () => {
      if (this.currentMatchState === MatchPhase.PLAYING || this.currentMatchState === MatchPhase.PAUSED || this.currentMatchState === MatchPhase.COUNTDOWN) {
        this.close();
      }
    };

    if (this.closeBtn) {
      this.closeBtn.addEventListener('click', handleContingencyClose);
    }
    if (this.returnGameBtn) {
      this.returnGameBtn.addEventListener('click', handleContingencyClose);
    }

    this.matchToggleBtn = (document.getElementById('btn-match-toggle') || document.getElementById('btn-start-stop')) as HTMLButtonElement | null;
    if (this.matchToggleBtn && !this.matchToggleBtn.dataset?.listenerBound) {
      if (this.matchToggleBtn.dataset) this.matchToggleBtn.dataset.listenerBound = 'true';
      this.matchToggleBtn.addEventListener('click', (e) => {
        e?.preventDefault?.();
        e?.stopPropagation?.();
        this.onMatchToggle?.();
      });
    }

    this.setupDragAndDropColumns();
  }

  public updateMatchControlButton(phase: MatchPhase, isAdmin?: boolean): void {
    if (isAdmin !== undefined) {
      this.isUserAdmin = isAdmin;
    }
    if (!this.matchToggleBtn) {
      this.matchToggleBtn = (document.getElementById('btn-match-toggle') || document.getElementById('btn-start-stop')) as HTMLButtonElement | null;
      if (this.matchToggleBtn && !this.matchToggleBtn.dataset?.listenerBound) {
        if (this.matchToggleBtn.dataset) this.matchToggleBtn.dataset.listenerBound = 'true';
        this.matchToggleBtn.addEventListener('click', (e) => {
          e?.preventDefault?.();
          e?.stopPropagation?.();
          this.onMatchToggle?.();
        });
      }
    }
    if (!this.matchToggleBtn) return;

    this.matchToggleBtn.disabled = !this.isUserAdmin;
    const isStopped = phase === MatchPhase.STOPPED;

    if (isStopped) {
      this.matchToggleBtn.textContent = '▶ Iniciar Partido';
      this.matchToggleBtn.className = 'btn btn-success btn-match-toggle';
    } else {
      this.matchToggleBtn.textContent = '■ Detener Partido';
      this.matchToggleBtn.className = 'btn btn-danger btn-match-toggle';
    }
  }

  public updateMatchState(newState: MatchPhase | MatchState | string, outcomeText?: string, isAdmin?: boolean): void {
    const phase = typeof newState === 'number' ? newState : toMatchPhase(newState);
    this.currentMatchState = phase;
    this.updateMatchControlButton(phase, isAdmin);

    // Actualizar visibilidad del botón de retorno y botón de cierre ('✕')
    if (this.returnGameBtn?.style) {
      this.returnGameBtn.style.display = (phase === MatchPhase.PLAYING || phase === MatchPhase.PAUSED || phase === MatchPhase.COUNTDOWN || phase === MatchPhase.GOAL_CELEBRATION || phase === MatchPhase.MATCH_ENDED) ? 'inline-block' : 'none';
    }
    if (this.closeBtn?.style) {
      this.closeBtn.style.display = phase === MatchPhase.STOPPED ? 'none' : '';
    }

    // Banner de resultado del partido al finalizar
    const outcomeBanner = document.getElementById('match-outcome-banner');
    if (outcomeBanner) {
      if (phase === MatchPhase.STOPPED && outcomeText) {
        outcomeBanner.style.display = 'block';
        outcomeBanner.textContent = outcomeText;
      } else if (phase !== MatchPhase.STOPPED) {
        outcomeBanner.style.display = 'none';
      }
    }

    if (phase === MatchPhase.COUNTDOWN || phase === MatchPhase.PLAYING || phase === MatchPhase.GOAL_CELEBRATION || phase === MatchPhase.MATCH_ENDED) {
      // 1. Cierre Automático: Despeja la pantalla para ver el campo y la cuenta regresiva
      this.close(true);
    } else if (phase === MatchPhase.STOPPED) {
      // 2. Apertura Forzada Únicamente en STOPPED y Game Over
      this.open(true);
    } else if (phase === MatchPhase.PAUSED) {
      // En pausa se desbloquea el modo forzado, permitiendo alternar con Escape o botón
      if (this.menuEl) {
        this.menuEl.classList.remove('is-forced-open');
      }
    }
  }

  public open(forced: boolean = false): void {
    if (!this.menuEl) return;
    const isForced = forced || this.currentMatchState === MatchPhase.STOPPED;
    this.menuEl.classList.remove('hidden', 'u-hidden', 'ui-screen-hidden');
    if (isForced) {
      this.menuEl.classList.add('is-forced-open');
    } else {
      this.menuEl.classList.remove('is-forced-open');
    }
    this.menuEl.style.display = 'flex';
    this.menuEl.style.pointerEvents = 'auto';
  }

  public close(force: boolean = false): void {
    if (!this.menuEl) return;
    // Bloquear el cierre (ignorar Escape) exclusivamente mientras el estado sea STOPPED
    if (this.currentMatchState === MatchPhase.STOPPED && !force) {
      return;
    }
    this.menuEl.classList.add('hidden');
    this.menuEl.classList.remove('is-forced-open');
    this.menuEl.style.display = 'none';
  }

  public toggle(): void {
    if (this.currentMatchState === MatchPhase.STOPPED) {
      return;
    }
    if (this.isOpen()) {
      this.close();
    } else {
      this.open(false);
    }
  }

  public isOpen(): boolean {
    if (!this.menuEl) return false;
    const isHidden = this.menuEl.classList.contains('hidden') ||
                     this.menuEl.classList.contains('u-hidden') ||
                     this.menuEl.style.display === 'none';
    return !isHidden;
  }

  public getMatchState(): MatchState {
    return this.currentMatchState;
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

  public updateLists(players: Player[], isLocalAdmin: boolean = false, hostId?: string): void {
    this.isUserAdmin = isLocalAdmin;
    this.updateMatchControlButton(this.currentMatchState, isLocalAdmin);

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
      const isHost = Boolean(p.isHost || (hostId && p.id === hostId));
      if (isHost) {
        p.isHost = true;
      }

      const el = document.createElement('div');
      el.className = 'player-item';

      // 1-click drag & drop si el usuario local es Admin
      if (isLocalAdmin) {
        el.draggable = true;
        el.setAttribute('draggable', 'true');
        el.addEventListener('dragstart', (e: DragEvent) => {
          if (e.dataTransfer) {
            e.dataTransfer.setData('text/plain', p.id);
            e.dataTransfer.effectAllowed = 'move';
          }
        });
      } else {
        el.draggable = false;
        el.setAttribute('draggable', 'false');
      }

      const hostIcon = isHost ? '👑 ' : '';
      const adminIcon = (!isHost && p.isAdmin) ? '⭐ ' : '';
      const adminRoleText = isHost ? 'Host' : (p.isAdmin ? 'Admin' : '');

      el.innerHTML = `
        <div style="display: flex; align-items: center; gap: 4px; overflow: hidden; flex: 1;">
          <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
            ${hostIcon}${adminIcon}<strong>${p.name}</strong> [${p.avatar}]
          </span>
          ${adminRoleText ? `<span style="font-size: 0.65rem; color: #64748b;">${adminRoleText}</span>` : ''}
        </div>
        ${isLocalAdmin ? `<button class="btn-player-options player-menu-btn" draggable="false" title="Acciones de Jugador" style="background: transparent; border: none; color: #94a3b8; font-size: 1.1rem; cursor: pointer; padding: 0 6px; border-radius: 4px; line-height: 1;">⋮</button>` : ''}
      `;

      // Botón de 3 puntos exclusivo para opciones de moderación
      const optionsBtn = el.querySelector<HTMLButtonElement>('.player-menu-btn');
      if (optionsBtn) {
        optionsBtn.draggable = false;
        optionsBtn.addEventListener('mousedown', (e) => {
          e.stopPropagation();
        });
        optionsBtn.addEventListener('click', (e: MouseEvent) => {
          e.stopPropagation();
          e.preventDefault();
          if (this.onPlayerClick) {
            this.onPlayerClick(p, e);
          }
        });
      }

      // Clic en la fila del jugador
      el.addEventListener('click', (e: MouseEvent) => {
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
