import { Player, TeamType } from '../../core/game/Player';
import { MatchPhase, MatchState, toMatchPhase } from '../../core/game/GameFSM';
import { $matchPhase, $players } from '../stores/gameStore';
import { renderIconHTML, Crown, ShieldCheck } from '../utils/icons';
import { StadiumRegistry } from '../../core/stadiums/StadiumRegistry';
import { animate } from 'motion';
import { UIStateMachine } from '../UIStateMachine';

export class TeamSelectModal {
  private menuEl: HTMLElement | null;
  private closeBtn: HTMLElement | null;
  private returnGameBtn: HTMLElement | null;
  private matchToggleBtn: HTMLButtonElement | null = null;
  private isUserAdmin: boolean = true;
  private isUserHost: boolean = false;
  private redListEl: HTMLElement | null;
  private blueListEl: HTMLElement | null;
  private specListEl: HTMLElement | null;
  private redCountEl: HTMLElement | null;
  private blueCountEl: HTMLElement | null;
  private specCountEl: HTMLElement | null;
  private selectStadiumEl: HTMLSelectElement | null = null;
  private currentStadiumNameEl: HTMLElement | null = null;
  private stadiumPickerModalEl: HTMLElement | null = null;
  private currentMatchState: MatchPhase = MatchPhase.STOPPED;
  private currentRoomId: string = '';
  private unsubs: Array<() => void> = [];

  public uiStateMachine?: UIStateMachine | undefined;
  public gameApp?: any;
  public localPlayer?: Player | undefined;

  public onSelectTeam?: (team: TeamType) => void;
  public onPlayerClick?: (player: Player, event: MouseEvent) => void;
  public onTeamChangeRequest?: (playerId: string, team: TeamType) => void;
  public onOpenKeybinds?: () => void;
  public onMatchToggle?: () => void;
  public onMapChange?: (stadiumId: string) => void;
  public onCopyLink?: () => void;
  public onVisibilityChange?: (isOpen: boolean) => void;

  constructor(uiStateMachine?: UIStateMachine) {
    this.uiStateMachine = uiStateMachine;
    this.menuEl = document.getElementById('ingame-menu');
    this.closeBtn = document.getElementById('menu-close-btn') || document.getElementById('btn-close-modal');
    this.returnGameBtn = document.getElementById('btn-return-game') || document.getElementById('btn-back');

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
      joinRedBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.onSelectTeam?.('red');
      });
    } else {
      console.warn('[TeamSelectModal] Element "#joinRedBtn" was not found in DOM.');
    }

    const joinBlueBtn = document.getElementById('joinBlueBtn');
    if (joinBlueBtn) {
      joinBlueBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.onSelectTeam?.('blue');
      });
    } else {
      console.warn('[TeamSelectModal] Element "#joinBlueBtn" was not found in DOM.');
    }

    const joinSpecBtn = document.getElementById('joinSpecBtn');
    if (joinSpecBtn) {
      joinSpecBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.onSelectTeam?.('spec');
      });
    } else {
      console.warn('[TeamSelectModal] Element "#joinSpecBtn" was not found in DOM.');
    }

    // Cerrar al hacer clic en el fondo oscuro únicamente si la partida está en curso
    if (this.menuEl && typeof this.menuEl.addEventListener === 'function') {
      this.menuEl.addEventListener('click', (e) => {
        if (e.target === this.menuEl) {
          if (this.currentMatchState !== MatchPhase.STOPPED) {
            if (this.uiStateMachine) {
              this.uiStateMachine.closeModal('teamSelect');
              this.onVisibilityChange?.(false);
            } else {
              this.close();
            }
          }
        }
      });
    }

    // Botón de ajustes de teclado (⚙ Keys)
    const btnSettings = document.getElementById('btn-settings-toggle') || document.getElementById('btn-settings') || document.querySelector?.('.btn-settings-btn');
    if (btnSettings) {
      btnSettings.addEventListener('click', (e) => {
        e.stopPropagation();
        this.onOpenKeybinds?.();
      });
    }

    // Botón de copiar enlace de invitación (🔗 Link)
    const btnCopyLink = document.getElementById('btn-copy-link');
    if (btnCopyLink) {
      btnCopyLink.addEventListener('click', (e) => {
        e.stopPropagation();
        const origin = typeof window !== 'undefined' && window.location ? window.location.origin : '';
        const pathname = typeof window !== 'undefined' && window.location ? window.location.pathname : '';
        const roomUrl = this.currentRoomId
          ? `${origin}${pathname}?room=${this.currentRoomId}`
          : (typeof window !== 'undefined' ? window.location.href : '');
        if (typeof navigator !== 'undefined' && navigator.clipboard) {
          navigator.clipboard.writeText(roomUrl).catch(() => {});
        }
        this.onCopyLink?.();
      });
    }

    // Botón de contingencia para regresar a la partida en curso
    const handleContingencyClose = (e?: Event) => {
      e?.preventDefault?.();
      e?.stopPropagation?.();
      const currentPhase = this.gameApp ? this.gameApp.matchPhase : this.currentMatchState;
      if (currentPhase !== MatchPhase.STOPPED) {
        if (this.uiStateMachine) {
          this.uiStateMachine.closeModal('teamSelect');
        } else {
          this.close(true);
        }
        this.onVisibilityChange?.(false);
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
        if (this.onMatchToggle) {
          this.onMatchToggle();
        } else if (this.gameApp) {
          const isMatchActive = this.gameApp.matchPhase !== MatchPhase.STOPPED;
          if (!isMatchActive) {
            if (this.gameApp.isHost) {
              this.gameApp.engine?.startMatch();
            } else {
              this.gameApp.network?.sendReliable({ type: 'ADMIN_START_MATCH' });
            }
          } else {
            if (this.gameApp.isHost) {
              this.gameApp.engine?.stopMatch();
            } else {
              this.gameApp.network?.sendReliable({ type: 'ADMIN_STOP_MATCH' });
            }
          }
        }
      });
    }

    this.selectStadiumEl = (document.getElementById('select-stadium-size') || document.querySelector('.select-stadium-size')) as HTMLSelectElement | null;
    if (this.selectStadiumEl && !this.selectStadiumEl.dataset?.listenerBound) {
      if (this.selectStadiumEl.dataset) this.selectStadiumEl.dataset.listenerBound = 'true';
      this.selectStadiumEl.addEventListener('change', () => {
        if (this.currentMatchState !== MatchPhase.STOPPED) return;
        if (this.selectStadiumEl && this.onMapChange) {
          this.setStadium(this.selectStadiumEl.value);
          this.onMapChange(this.selectStadiumEl.value);
        }
      });
    }

    this.currentStadiumNameEl = document.getElementById('currentStadiumName');
    this.stadiumPickerModalEl = document.getElementById('stadiumPickerModal');

    // Botón de Pick para selector modal de mapa
    const btnPickStadium = document.getElementById('btn-pick-stadium') as HTMLButtonElement | null;
    if (btnPickStadium && this.stadiumPickerModalEl) {
      btnPickStadium.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!this.isUserAdmin) return;
        if (this.currentMatchState !== MatchPhase.STOPPED) return;
        this.stadiumPickerModalEl?.classList.remove('u-hidden');
        if (this.stadiumPickerModalEl) this.stadiumPickerModalEl.style.display = 'flex';
      });
    }

    const btnCloseStadiumPicker = document.getElementById('btnCloseStadiumPicker');
    if (btnCloseStadiumPicker && this.stadiumPickerModalEl) {
      btnCloseStadiumPicker.addEventListener('click', (e) => {
        e.stopPropagation();
        this.stadiumPickerModalEl?.classList.add('u-hidden');
        if (this.stadiumPickerModalEl) this.stadiumPickerModalEl.style.display = 'none';
      });
    }

    // Opciones del selector modal de mapa
    const stadiumOptionBtns = document.querySelectorAll<HTMLButtonElement>('.stadium-option-btn');
    stadiumOptionBtns.forEach((btn) => {
      btn.addEventListener?.('click', (e) => {
        e.stopPropagation();
        if (!this.isUserAdmin) return;
        if (this.currentMatchState !== MatchPhase.STOPPED) return;
        const stadiumId = btn.getAttribute('data-stadium');
        if (stadiumId) {
          this.setStadium(stadiumId);
          if (this.onMapChange) {
            this.onMapChange(stadiumId);
          }
          if (this.stadiumPickerModalEl) {
            this.stadiumPickerModalEl.classList.add('u-hidden');
            this.stadiumPickerModalEl.style.display = 'none';
          }
        }
      });
    });

    this.setupDragAndDropColumns();

    // Suscripción reactiva universal con Nano Stores
    this.unsubs.push(
      $matchPhase.subscribe((phase) => {
        this.updateMatchControlButton(phase, this.isUserAdmin, this.isUserHost);
        this.updateMatchToggleButton(phase);
      })
    );

    this.unsubs.push(
      $players.subscribe((playerList) => {
        if (playerList && playerList.length > 0) {
          this.updateLists([...playerList] as Player[], this.isUserAdmin);
        }
      })
    );
  }

  public getElement(): HTMLElement | null {
    return this.menuEl;
  }

  public setRoomName(name: string): void {
    const roomNameHeader = document.getElementById('roomNameHeader');
    if (roomNameHeader) {
      roomNameHeader.textContent = name;
    }
    const roomNameBadge = document.getElementById('roomNameBadge');
    if (roomNameBadge) {
      roomNameBadge.textContent = name;
    }
  }

  public setRoomId(roomId: string): void {
    this.currentRoomId = roomId;
  }

  public setStadium(stadiumId: string): void {
    if (this.selectStadiumEl) {
      this.selectStadiumEl.value = stadiumId;
    }
    const stadiumName = StadiumRegistry[stadiumId]?.name || stadiumId;
    if (this.currentStadiumNameEl) {
      this.currentStadiumNameEl.textContent = stadiumName;
    }
    const optionBtns = document.querySelectorAll<HTMLButtonElement>('.stadium-option-btn');
    optionBtns.forEach((btn) => {
      btn.classList.toggle('active-stadium', btn.getAttribute('data-stadium') === stadiumId);
    });
  }

  public setHost(isHost: boolean): void {
    this.isUserHost = isHost;
    const currentPhase = this.gameApp ? this.gameApp.matchPhase : this.currentMatchState;
    this.currentMatchState = currentPhase;
    this.updateMatchControlButton(currentPhase, this.isUserAdmin, isHost);
    this.updateMatchToggleButton(currentPhase);
  }

  public updateStadiumControls(phase: MatchPhase, isAdmin?: boolean, isHost?: boolean): void {
    if (isAdmin !== undefined) {
      this.isUserAdmin = isAdmin;
    }
    if (isHost !== undefined) {
      this.isUserHost = isHost;
    }
    const isStopped = phase === MatchPhase.STOPPED;
    const canChangeStadium = (this.isUserHost || this.isUserAdmin) && isStopped;

    if (this.selectStadiumEl) {
      this.selectStadiumEl.disabled = !canChangeStadium;
    }
    const pickBtn = document.getElementById('btn-pick-stadium') as HTMLButtonElement | null;
    if (pickBtn) {
      if (!this.isUserHost && !this.isUserAdmin) {
        if (pickBtn.style) pickBtn.style.display = 'none';
        pickBtn.disabled = true;
      } else {
        if (pickBtn.style) pickBtn.style.display = '';
        pickBtn.disabled = !canChangeStadium;
        if (!isStopped) {
          pickBtn.title = 'No se puede cambiar de estadio durante el partido';
          pickBtn.classList?.add?.('opacity-50', 'cursor-not-allowed');
        } else {
          pickBtn.title = 'Seleccionar estadio';
          pickBtn.classList?.remove?.('opacity-50', 'cursor-not-allowed');
        }
      }
    }

    if ((!isStopped || (!this.isUserHost && !this.isUserAdmin)) && this.stadiumPickerModalEl) {
      this.stadiumPickerModalEl.classList?.add?.('u-hidden');
      if (this.stadiumPickerModalEl.style) this.stadiumPickerModalEl.style.display = 'none';
    }
  }

  public updateMatchControlButton(phase: MatchPhase, isAdmin?: boolean, isHost?: boolean): void {
    this.currentMatchState = phase;
    const effectiveAdmin = isAdmin !== undefined
      ? isAdmin
      : Boolean(this.isUserAdmin || this.localPlayer?.isAdmin || this.gameApp?.localPlayer?.isAdmin);
    const effectiveHost = isHost !== undefined
      ? isHost
      : Boolean(this.isUserHost || this.localPlayer?.isHost || this.gameApp?.isHost);

    this.isUserAdmin = effectiveAdmin;
    this.isUserHost = effectiveHost;
    this.updateStadiumControls(phase, this.isUserAdmin, this.isUserHost);

    const isStopped = phase === MatchPhase.STOPPED;
    const canModifySettings = (this.isUserHost || this.isUserAdmin) && isStopped;

    if (this.menuEl) {
      if (!isStopped) {
        this.menuEl.classList.remove('is-forced-open');
      } else {
        this.menuEl.classList.add('is-forced-open');
      }
    }

    if (this.closeBtn?.style) {
      this.closeBtn.style.display = isStopped ? 'none' : '';
    }

    if (this.returnGameBtn?.style) {
      this.returnGameBtn.style.display = 'none';
    }

    const timeLimitSelect = document.getElementById('select-time-limit') as HTMLSelectElement | null;
    if (timeLimitSelect) {
      timeLimitSelect.disabled = !canModifySettings;
    }
    const goalLimitSelect = document.getElementById('select-goal-limit') as HTMLSelectElement | null;
    if (goalLimitSelect) {
      goalLimitSelect.disabled = !canModifySettings;
    }
    const canControlMatch = Boolean(this.isUserHost || this.isUserAdmin);
    const pauseBtn = document.getElementById('btn-pause-resume') as HTMLButtonElement | null;
    if (pauseBtn) {
      pauseBtn.disabled = !canControlMatch;
      if (pauseBtn.style) pauseBtn.style.display = canControlMatch ? '' : 'none';
    }
    const lockBtn = document.getElementById('btn-lock-teams') as HTMLButtonElement | null;
    if (lockBtn) {
      lockBtn.disabled = !this.isUserHost && !this.isUserAdmin;
      if (lockBtn.style) lockBtn.style.display = (this.isUserHost || this.isUserAdmin) ? '' : 'none';
    }
    const modBtn = document.getElementById('btn-open-physics-modifiers') as HTMLButtonElement | null;
    if (modBtn) {
      if (!this.isUserHost && !this.isUserAdmin) {
        if (modBtn.style) modBtn.style.display = 'none';
        modBtn.disabled = true;
      } else {
        if (modBtn.style) modBtn.style.display = '';
        modBtn.disabled = !canModifySettings;
        if (!isStopped) {
          modBtn.title = 'Los modificadores de físicas solo se pueden ajustar antes de empezar la partida';
          modBtn.classList?.add?.('opacity-50', 'cursor-not-allowed');
        } else {
          modBtn.title = 'Modificadores de Físicas';
          modBtn.classList?.remove?.('opacity-50', 'cursor-not-allowed');
        }
      }
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

    const prevClass = this.matchToggleBtn.className;
    if (isStopped) {
      this.matchToggleBtn.textContent = '▶ Iniciar Partido';
      this.matchToggleBtn.className = 'btn btn-success btn-match-toggle';
      if (this.matchToggleBtn.style) {
        this.matchToggleBtn.style.backgroundColor = '#10B981';
        this.matchToggleBtn.style.borderColor = '#059669';
      }
    } else {
      this.matchToggleBtn.textContent = '■ Detener Partido';
      this.matchToggleBtn.className = 'btn btn-danger btn-match-toggle';
      if (this.matchToggleBtn.style) {
        this.matchToggleBtn.style.backgroundColor = '#FF0055';
        this.matchToggleBtn.style.borderColor = '#E11D48';
      }
    }

    if (!canControlMatch) {
      this.matchToggleBtn.disabled = true;
      if (this.matchToggleBtn.style) this.matchToggleBtn.style.display = 'none';
      return;
    }

    if (this.matchToggleBtn.style) this.matchToggleBtn.style.display = '';
    this.matchToggleBtn.disabled = false;

    // Micro-animación de pulso con Motion si la clase cambió
    if (prevClass && prevClass !== this.matchToggleBtn.className) {
      try {
        if (typeof this.matchToggleBtn.animate === 'function') {
          animate(this.matchToggleBtn, { scale: [0.96, 1.02, 1] }, { duration: 0.25 });
        }
      } catch {
        // En entornos sin Web Animations API continúa sin fallar
      }
    }

    this.updateMatchToggleButton(phase);
  }

  public updateMatchState(newState: MatchPhase | MatchState | string, outcomeText?: string, isAdmin?: boolean, isHost?: boolean): void {
    const prevPhase = this.currentMatchState;
    const phase = typeof newState === 'number' ? newState : toMatchPhase(newState);
    this.currentMatchState = phase;
    $matchPhase.set(phase);
    this.updateMatchControlButton(phase, isAdmin, isHost);

    // Actualizar visibilidad del botón de retorno y botón de cierre ('✕')
    if (this.returnGameBtn?.style) {
      this.returnGameBtn.style.display = 'none';
    }
    if (this.closeBtn?.style) {
      this.closeBtn.style.display = phase === MatchPhase.STOPPED ? 'none' : '';
    }
    if (this.menuEl) {
      if (phase !== MatchPhase.STOPPED) {
        this.menuEl.classList.remove('is-forced-open');
      } else {
        this.menuEl.classList.add('is-forced-open');
      }
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

    // Cierre o apertura reactiva basada en transición de fase:
    if (phase === MatchPhase.STOPPED) {
      // Apertura Forzada Únicamente en STOPPED y Game Over
      this.open(true);
    } else if (prevPhase !== phase) {
      if (phase === MatchPhase.COUNTDOWN || phase === MatchPhase.PLAYING) {
        // Cierre Automático: Solo en transición al iniciar o tras la cuenta regresiva hacia el partido
        this.close(true);
      } else if (phase === MatchPhase.PAUSED) {
        // En pausa se desbloquea el modo forzado, permitiendo alternar con Escape o botón
        if (this.menuEl) {
          this.menuEl.classList.remove('is-forced-open');
        }
      }
    }
  }

  public updateMatchToggleButton(phase: MatchPhase): void {
    const btn = (
      (typeof this.menuEl?.querySelector === 'function' ? this.menuEl.querySelector('#btn-match-toggle') : null) ||
      (typeof document !== 'undefined' ? (document.getElementById('btn-match-toggle') || document.getElementById('btn-start-stop')) : null) ||
      this.matchToggleBtn
    ) as HTMLButtonElement | null;
    if (!btn) return;

    const canManage = Boolean(this.isUserHost || this.isUserAdmin || this.gameApp?.isHost || this.localPlayer?.isAdmin || this.gameApp?.localPlayer?.isAdmin);
    btn.disabled = !canManage;
    if (btn.style) {
      btn.style.opacity = canManage ? '1' : '0.5';
      btn.style.display = canManage ? '' : 'none';
    }

    if (phase === MatchPhase.STOPPED) {
      btn.textContent = '▶ Iniciar Partido';
      btn.innerHTML = '▶ Iniciar Partido';
      btn.className = 'btn btn-success btn-match-toggle';
      if (btn.style) {
        btn.style.backgroundColor = '#10B981';
        btn.style.borderColor = '#059669';
      }
    } else {
      btn.textContent = '■ Detener Partido';
      btn.innerHTML = '■ Detener Partido';
      btn.className = 'btn btn-danger btn-match-toggle';
      if (btn.style) {
        btn.style.backgroundColor = '#FF0055';
        btn.style.borderColor = '#E11D48';
      }
    }
  }

  public open(forced: boolean = false): void {
    if (!this.menuEl) return;
    const currentPhase = this.gameApp ? this.gameApp.matchPhase : this.currentMatchState;
    this.currentMatchState = currentPhase;
    const isForced = forced || currentPhase === MatchPhase.STOPPED;
    if (this.uiStateMachine) {
      this.uiStateMachine.openModal('teamSelect', isForced);
    } else {
      this.menuEl.classList.remove('hidden', 'u-hidden', 'ui-screen-hidden');
      this.menuEl.style.display = 'flex';
      this.menuEl.style.pointerEvents = 'auto';
    }
    if (isForced) {
      this.menuEl.classList.add('is-forced-open');
      if (this.closeBtn?.style) this.closeBtn.style.display = 'none';
    } else {
      this.menuEl.classList.remove('is-forced-open');
      if (this.closeBtn?.style) this.closeBtn.style.display = '';
    }
    if (this.returnGameBtn?.style) {
      this.returnGameBtn.style.display = 'none';
    }
    this.updateMatchControlButton(currentPhase, this.isUserAdmin, this.isUserHost);
    this.updateMatchToggleButton(currentPhase);
    this.onVisibilityChange?.(true);
  }

  public close(force: boolean = false): void {
    if (!this.menuEl) return;
    // Blindaje del Estado Inicial (STOPPED): Mientras la partida no haya iniciado, el menú permanece abierto por defecto.
    // Ignora cualquier llamada a close() o eventos de backdrop/Escape en esta fase, salvo forzado explícito
    if (this.currentMatchState === MatchPhase.STOPPED && !force) {
      return;
    }
    if (this.uiStateMachine) {
      this.uiStateMachine.closeModal('teamSelect');
    } else {
      this.menuEl.classList.add('hidden');
      this.menuEl.classList.remove('is-forced-open');
      this.menuEl.style.display = 'none';
    }
    this.onVisibilityChange?.(false);
  }

  public toggle(): void {
    if (this.currentMatchState === MatchPhase.STOPPED) {
      return;
    }
    if (this.uiStateMachine) {
      this.uiStateMachine.toggleModal('teamSelect', this.isUserHost, this.currentMatchState);
      this.onVisibilityChange?.(this.isOpen());
    } else {
      if (this.isOpen()) {
        this.close();
      } else {
        this.open(false);
      }
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

  public updateLists(players: Player[], isLocalAdmin: boolean = false, hostId?: string, isLocalHost?: boolean): void {
    this.isUserAdmin = isLocalAdmin;
    if (isLocalHost !== undefined) {
      this.isUserHost = isLocalHost;
    }
    this.updateMatchControlButton(this.currentMatchState, isLocalAdmin, this.isUserHost);
    this.updateMatchToggleButton(this.currentMatchState);

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

      // Iconos Lucide estilizados
      const hostIcon = isHost ? renderIconHTML(Crown, { width: 14, height: 14, stroke: '#f59e0b', class: 'icon-host' }) + ' ' : '';
      const adminIcon = (!isHost && p.isAdmin) ? renderIconHTML(ShieldCheck, { width: 14, height: 14, stroke: '#00C2FF', class: 'icon-admin' }) + ' ' : '';
      const adminRoleText = isHost ? 'Host' : (p.isAdmin ? 'Admin' : '');

      el.innerHTML = `
        <div style="display: flex; align-items: center; gap: 6px; overflow: hidden; flex: 1;">
          <div class="player-avatar-circle" style="width: 20px; height: 20px; border-radius: 50%; background: rgba(255,255,255,0.12); display: flex; align-items: center; justify-content: center; font-size: 0.65rem; font-weight: 800; border: 1px solid rgba(255,255,255,0.25); flex-shrink: 0;">
            ${p.avatar || '⚽'}
          </div>
          <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600;">
            ${hostIcon}${adminIcon}${p.name}
          </span>
          ${adminRoleText ? `<span style="font-size: 0.65rem; color: #67E8F9; font-family: var(--font-sans); font-weight: 700;">${adminRoleText}</span>` : ''}
        </div>
        ${isLocalAdmin ? `<button class="btn-player-options player-menu-btn" draggable="false" title="Acciones de Jugador" style="background: transparent; border: none; color: #67E8F9; font-size: 1.1rem; cursor: pointer; padding: 0 6px; border-radius: 4px; line-height: 1;">⋮</button>` : ''}
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

  public destroy(): void {
    for (const unsub of this.unsubs) {
      unsub();
    }
    this.unsubs = [];
  }
}
