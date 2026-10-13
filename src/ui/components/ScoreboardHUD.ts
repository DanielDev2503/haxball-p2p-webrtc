import { $score, $timer, $ping, $theme, toggleTheme, $matchPhase } from '../stores/gameStore';
import { renderIconHTML, renderIcon, Timer, Wifi, Sun, Moon } from '../utils/icons';
import { MatchPhase } from '../../core/game/GameFSM';
import { UIStateMachine } from '../UIStateMachine';

export class ScoreboardHUD {
  private redScoreEl: HTMLElement | null = null;
  private blueScoreEl: HTMLElement | null = null;
  private timerEl: HTMLElement | null = null;
  private goldenGoalBadgeEl: HTMLElement | null = null;
  private pingEl: HTMLElement | null = null;
  private pingDotEl: HTMLElement | null = null;
  private fpsEl: HTMLElement | null = null;
  private unsubs: Array<() => void> = [];

  private capsuleEl: HTMLElement | null = null;
  private hudContainerEl: HTMLElement | null = null;
  private matchClockContainerEl: HTMLElement | null = null;
  private clockSlot: HTMLElement | null = null;
  private wifiSlot: HTMLElement | null = null;
  private goalBannerEl: HTMLElement | null = null;
  private goalBannerTimeout: any = null;

  // Cyber-Pitch Top Banner & Perimeter
  private roomInfoEl: HTMLElement | null = null;
  private roomNameBadgeEl: HTMLElement | null = null;
  private roomIdEl: HTMLElement | null = null;
  private redTeamTagEl: HTMLElement | null = null;
  private blueTeamTagEl: HTMLElement | null = null;
  private audioBtnEl: HTMLElement | null = null;
  private menuBtnEl: HTMLElement | null = null;
  private settingsBtnEl: HTMLElement | null = null;
  private themeBtnEl: HTMLElement | null = null;

  // Panoramic Full-Viewport Carousel (100vw)
  private carouselViewportEl: HTMLElement | null = null;
  private carouselTrackEl: HTMLElement | null = null;
  private slideStatsEl: HTMLElement | null = null;
  private slideLobbyEl: HTMLElement | null = null;
  private currentSlideIndex: number = 0;

  public onMenuToggle?: () => void;
  public gameApp?: any = null;
  public uiStateMachine?: UIStateMachine | null = null;

  constructor() {
    this.renderSkeleton();
    this.cacheElements();
    this.initEventListeners();
    this.applyTheme($theme.get());
  }

  /**
   * Instancia el esqueleto visual completo del HUD y el carrusel panorámico (100vw).
   */
  public renderSkeleton(): void {
    if (typeof document === 'undefined') return;

    this.ensureCarousel();
    this.ensureTopBanner();
  }

  private ensureCarousel(): void {
    if (typeof document === 'undefined') return;

    this.carouselViewportEl = (document.querySelector('.carousel-viewport') || document.getElementById('carouselViewport')) as HTMLElement | null;
    this.carouselTrackEl = (document.querySelector('.carousel-track') || document.getElementById('carouselTrack')) as HTMLElement | null;
    this.slideStatsEl = document.getElementById('slide-stats') || (document.querySelector('.carousel-slide#slide-stats') as HTMLElement | null);
    this.slideLobbyEl = document.getElementById('slide-lobby') || (document.querySelector('.carousel-slide#slide-lobby') as HTMLElement | null);

    if (!this.carouselViewportEl && document.body) {
      const parent = document.getElementById('app-root') || document.body;
      const viewport = document.createElement('div');
      viewport.className = 'carousel-viewport';
      viewport.id = 'carouselViewport';

      const track = document.createElement('div');
      track.className = 'carousel-track';
      track.id = 'carouselTrack';

      const slideStats = document.createElement('div');
      slideStats.className = 'carousel-slide';
      slideStats.id = 'slide-stats';

      const slideLobby = document.createElement('div');
      slideLobby.className = 'carousel-slide';
      slideLobby.id = 'slide-lobby';

      track.appendChild(slideStats);
      track.appendChild(slideLobby);
      viewport.appendChild(track);
      parent.appendChild(viewport);

      this.carouselViewportEl = viewport;
      this.carouselTrackEl = track;
      this.slideStatsEl = slideStats;
      this.slideLobbyEl = slideLobby;
    }
  }

  private ensureTopBanner(): void {
    if (typeof document === 'undefined') return;

    let banner = (document.querySelector('.hud-top-banner') || document.querySelector('.hud-container')) as HTMLElement | null;
    if (banner && !banner.classList.contains('hud-top-banner')) {
      banner.classList.add('hud-top-banner');
    }

    const hasScores = Boolean(document.getElementById('redScore') && document.getElementById('blueScore'));
    if (!hasScores && banner) {
      // 1. Izquierda: Contenedor del nombre de sala y código: [ <Nombre Sala> - ID: <RoomID> ]
      const topLeft = document.createElement('div');
      topLeft.className = 'hud-top-left';

      const roomInfo = document.createElement('div');
      roomInfo.className = 'hud-room-info';
      roomInfo.id = 'hudRoomInfo';

      const leftBracket = document.createElement('span');
      leftBracket.className = 'hud-bracket';
      leftBracket.textContent = '[';

      const roomName = document.createElement('span');
      roomName.id = 'roomNameBadge';
      roomName.className = 'room-name-text';
      roomName.textContent = 'Lobby';

      const roomSep = document.createElement('span');
      roomSep.className = 'hud-room-sep';
      roomSep.id = 'roomSepId';
      roomSep.textContent = ' - ID: ';

      const roomId = document.createElement('span');
      roomId.id = 'roomIdBadge';
      roomId.className = 'room-id-text';
      roomId.textContent = 'LOCAL';

      const rightBracket = document.createElement('span');
      rightBracket.className = 'hud-bracket';
      rightBracket.textContent = ']';

      roomInfo.appendChild(leftBracket);
      roomInfo.appendChild(roomName);
      roomInfo.appendChild(roomSep);
      roomInfo.appendChild(roomId);
      roomInfo.appendChild(rightBracket);
      topLeft.appendChild(roomInfo);

      // 2. Centro: Marcador continuo con acrónimos coloreados y reloj digital de partido
      const capsule = document.createElement('div');
      capsule.className = 'scoreboard-capsule hud-scoreboard-center bg-slate-900/10 border-slate-900/15 text-slate-800 dark:bg-slate-950/70 dark:border-cyan-500/20 dark:text-slate-100 dark:shadow-[0_4px_20px_rgba(0,229,255,0.08)]';
      capsule.id = 'scoreboardCapsule';

      const scoreDisplay = document.createElement('div');
      scoreDisplay.className = 'hud-score-display';

      const tilde1 = document.createElement('span');
      tilde1.className = 'hud-tilde';
      tilde1.textContent = '~';

      const redTeam = document.createElement('span');
      redTeam.className = 'hud-team-tag team-red';
      redTeam.id = 'redTeamTag';
      redTeam.textContent = '[BAR]';

      const redScore = document.createElement('span');
      redScore.id = 'redScore';
      redScore.className = 'team-score score-red';
      redScore.textContent = '0';

      const scoreDiv = document.createElement('span');
      scoreDiv.className = 'score-divider';
      scoreDiv.textContent = '-';

      const blueScore = document.createElement('span');
      blueScore.id = 'blueScore';
      blueScore.className = 'team-score score-blue';
      blueScore.textContent = '0';

      const blueTeam = document.createElement('span');
      blueTeam.className = 'hud-team-tag team-blue';
      blueTeam.id = 'blueTeamTag';
      blueTeam.textContent = '[MAD]';

      const tilde2 = document.createElement('span');
      tilde2.className = 'hud-tilde';
      tilde2.textContent = '~';

      scoreDisplay.appendChild(tilde1);
      scoreDisplay.appendChild(redTeam);
      scoreDisplay.appendChild(redScore);
      scoreDisplay.appendChild(scoreDiv);
      scoreDisplay.appendChild(blueScore);
      scoreDisplay.appendChild(blueTeam);
      scoreDisplay.appendChild(tilde2);

      const clockContainer = document.createElement('div');
      clockContainer.className = 'match-clock-container hud-time-pill';
      clockContainer.id = 'matchClockContainer';

      const clockBracketL = document.createElement('span');
      clockBracketL.className = 'hud-bracket';
      clockBracketL.textContent = '[';

      const clockIcon = document.createElement('span');
      clockIcon.className = 'clock-icon';
      clockIcon.id = 'clockIconSlot';

      const matchTimer = document.createElement('span');
      matchTimer.id = 'matchTimer';
      matchTimer.className = 'match-clock';
      matchTimer.textContent = '00:00';

      const clockBracketR = document.createElement('span');
      clockBracketR.className = 'hud-bracket';
      clockBracketR.textContent = ']';

      clockContainer.appendChild(clockBracketL);
      clockContainer.appendChild(clockIcon);
      clockContainer.appendChild(matchTimer);
      clockContainer.appendChild(clockBracketR);

      const goldenGoal = document.createElement('span');
      goldenGoal.id = 'goldenGoalBadge';
      goldenGoal.className = 'golden-goal-badge u-hidden';
      goldenGoal.textContent = 'GOL DE ORO';

      capsule.appendChild(scoreDisplay);
      capsule.appendChild(clockContainer);
      capsule.appendChild(goldenGoal);

      // 3. Derecha: Los 4 botones circulares de 32x32px
      const topRight = document.createElement('div');
      topRight.className = 'hud-top-right top-bar-right';

      const audioBtn = document.createElement('button');
      audioBtn.id = 'audio-toggle-btn';
      audioBtn.className = 'hud-btn-circle icon-btn';
      audioBtn.title = 'Audio (Mute / Unmute)';
      audioBtn.textContent = '🔊';

      const menuBtn = document.createElement('button');
      menuBtn.id = 'btn-menu';
      menuBtn.className = 'hud-btn-circle icon-btn menu-btn';
      menuBtn.setAttribute('data-alias', 'menu-toggle-btn');
      menuBtn.title = 'Menú (Esc)';
      menuBtn.textContent = '☰';

      const settingsBtn = document.createElement('button');
      settingsBtn.id = 'top-settings-btn';
      settingsBtn.className = 'hud-btn-circle icon-btn';
      settingsBtn.title = 'Ajustes (Teclas)';
      settingsBtn.textContent = '⚙';

      const themeBtn = document.createElement('button');
      themeBtn.id = 'theme-toggle-btn';
      themeBtn.className = 'hud-btn-circle icon-btn theme-toggle-btn';
      themeBtn.title = 'Cambiar Tema (Claro / Oscuro)';

      topRight.appendChild(audioBtn);
      topRight.appendChild(menuBtn);
      topRight.appendChild(settingsBtn);
      topRight.appendChild(themeBtn);

      banner.appendChild(topLeft);
      banner.appendChild(capsule);
      banner.appendChild(topRight);
    }
  }

  private cacheElements(): void {
    if (typeof document === 'undefined') return;

    this.capsuleEl = (document.querySelector('.scoreboard-capsule') || document.querySelector('.scoreboard')) as HTMLElement | null;
    this.hudContainerEl = (document.querySelector('.hud-top-banner') || document.querySelector('.hud-container')) as HTMLElement | null;
    this.matchClockContainerEl = (document.querySelector('.match-clock-container') || document.getElementById('matchClockContainer')) as HTMLElement | null;
    this.clockSlot = document.getElementById('clockIconSlot');
    this.wifiSlot = document.getElementById('wifiIconSlot');

    this.redScoreEl = document.getElementById('redScore');
    if (!this.redScoreEl) {
      console.warn('[ScoreboardHUD] Element "#redScore" was not found in DOM.');
    }

    this.blueScoreEl = document.getElementById('blueScore');
    if (!this.blueScoreEl) {
      console.warn('[ScoreboardHUD] Element "#blueScore" was not found in DOM.');
    }

    this.timerEl = document.getElementById('matchTimer');
    if (!this.timerEl) {
      console.warn('[ScoreboardHUD] Element "#matchTimer" was not found in DOM.');
    }

    this.goldenGoalBadgeEl = document.getElementById('goldenGoalBadge');

    this.pingEl = document.getElementById('pingValue');
    if (!this.pingEl) {
      console.warn('[ScoreboardHUD] Element "#pingValue" was not found in DOM.');
    }

    this.pingDotEl = document.getElementById('pingDot') || (document.querySelector('.stat-dot') as HTMLElement | null);

    this.fpsEl = document.getElementById('fpsValue');
    if (!this.fpsEl) {
      console.warn('[ScoreboardHUD] Element "#fpsValue" was not found in DOM.');
    }

    // Top banner elements
    this.roomInfoEl = document.getElementById('hudRoomInfo') || (document.querySelector('.hud-room-info') as HTMLElement | null);
    this.roomNameBadgeEl = document.getElementById('roomNameBadge');
    this.roomIdEl = document.getElementById('roomIdBadge') || document.getElementById('roomIdText');
    this.redTeamTagEl = document.getElementById('redTeamTag');
    this.blueTeamTagEl = document.getElementById('blueTeamTag');

    // Botones top right
    this.audioBtnEl = document.getElementById('audio-toggle-btn');
    this.menuBtnEl = document.getElementById('btn-menu') || document.getElementById('menu-toggle-btn');
    this.settingsBtnEl = document.getElementById('top-settings-btn') || document.getElementById('btn-settings-toggle');
    this.themeBtnEl = document.getElementById('theme-toggle-btn');

    // Carrusel
    this.carouselViewportEl = (document.querySelector('.carousel-viewport') || document.getElementById('carouselViewport')) as HTMLElement | null;
    this.carouselTrackEl = (document.querySelector('.carousel-track') || document.getElementById('carouselTrack')) as HTMLElement | null;
    this.slideStatsEl = document.getElementById('slide-stats') || (document.querySelector('.carousel-slide#slide-stats') as HTMLElement | null);
    this.slideLobbyEl = document.getElementById('slide-lobby') || (document.querySelector('.carousel-slide#slide-lobby') as HTMLElement | null);

    // Goal notification banner
    this.goalBannerEl = document.getElementById('hudGoalBanner');
    if (!this.goalBannerEl && document.body) {
      this.goalBannerEl = document.createElement('div');
      this.goalBannerEl.id = 'hudGoalBanner';
      this.goalBannerEl.className = 'hud-goal-banner';
      this.goalBannerEl.style.position = 'fixed';
      this.goalBannerEl.style.top = '60px';
      this.goalBannerEl.style.left = '50%';
      this.goalBannerEl.style.transform = 'translateX(-50%)';
      this.goalBannerEl.style.zIndex = '999';
      this.goalBannerEl.style.pointerEvents = 'none';
      this.goalBannerEl.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
      this.goalBannerEl.style.opacity = '0';
      this.goalBannerEl.style.display = 'none';
      document.body.appendChild(this.goalBannerEl);
    }
  }

  private initEventListeners(): void {
    // Botón 1 (Audio): Alterna mute
    if (this.audioBtnEl && !this.audioBtnEl.dataset?.listenerBound) {
      if (this.audioBtnEl.dataset) this.audioBtnEl.dataset.listenerBound = 'true';
      this.audioBtnEl.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        this.toggleAudio();
      });
    }

    // Botón 2 (Menú): Alterna el despliegue del panel central
    if (this.menuBtnEl && !this.menuBtnEl.dataset?.listenerBound) {
      if (this.menuBtnEl.dataset) this.menuBtnEl.dataset.listenerBound = 'true';
      this.menuBtnEl.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.toggleMenu();
      });
    }

    // Botón 3 (Ajustes): Abre el modal de configuración
    if (this.settingsBtnEl && !this.settingsBtnEl.dataset?.listenerBound) {
      if (this.settingsBtnEl.dataset) this.settingsBtnEl.dataset.listenerBound = 'true';
      this.settingsBtnEl.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        this.openSettings();
      });
    }

    // Botón 4 (Tema): Conmuta modo oscuro/claro
    if (this.themeBtnEl && !this.themeBtnEl.dataset?.listenerBound) {
      if (this.themeBtnEl.dataset) this.themeBtnEl.dataset.listenerBound = 'true';
      this.themeBtnEl.addEventListener('click', () => {
        toggleTheme();
      });

      this.unsubs.push(
        $theme.subscribe((theme) => {
          const isDark = theme === 'dark';
          if (this.themeBtnEl) {
            this.themeBtnEl.innerHTML = '';
            renderIcon(this.themeBtnEl, isDark ? Sun : Moon, { width: 16, height: 16, stroke: isDark ? '#F59E0B' : '#0284C7' });
            this.themeBtnEl.title = isDark ? 'Cambiar a Modo Claro' : 'Cambiar a Modo Oscuro';
          }
        })
      );
    }

    // Suscripción atómica a $theme para sincronización total de ScoreboardHUD
    this.unsubs.push(
      $theme.subscribe((theme) => {
        this.applyTheme(theme);
      })
    );

    // Suscripción atómica y granular a Nano Stores para actualizaciones quirúrgicas
    this.unsubs.push(
      $score.subscribe(({ red, blue }) => {
        if (this.redScoreEl && this.redScoreEl.textContent !== red.toString()) {
          this.redScoreEl.textContent = red.toString();
        }
        if (this.blueScoreEl && this.blueScoreEl.textContent !== blue.toString()) {
          this.blueScoreEl.textContent = blue.toString();
        }
      })
    );

    this.unsubs.push(
      $timer.subscribe((timeStr) => {
        if (this.timerEl && this.timerEl.textContent !== timeStr) {
          this.timerEl.textContent = timeStr;
        }
      })
    );

    this.unsubs.push(
      $ping.subscribe((pingMs) => {
        if (this.pingEl) {
          this.pingEl.textContent = `${Math.round(pingMs)}ms`;
        }
        this.updatePingDot(pingMs);
      })
    );
  }

  // ==========================================================================
  // MÉTODOS PÚBLICOS DEL CARRUSEL PANORÁMICO
  // ==========================================================================

  /**
   * Muestra la diapositiva de Estadísticas aplicando translateX(0vw)
   */
  public showStatsSlide(): void {
    this.currentSlideIndex = 0;
    if (this.carouselTrackEl) {
      this.carouselTrackEl.style.transform = 'translateX(0vw)';
    }
  }

  /**
   * Muestra la diapositiva de Lobby / Menú de Sala aplicando translateX(-100vw)
   */
  public showLobbySlide(): void {
    this.currentSlideIndex = 1;
    if (this.carouselTrackEl) {
      this.carouselTrackEl.style.transform = 'translateX(-100vw)';
    }
  }

  public getTrackElement(): HTMLElement | null {
    return this.carouselTrackEl;
  }

  public getViewportElement(): HTMLElement | null {
    return this.carouselViewportEl;
  }

  public getStatsSlide(): HTMLElement | null {
    return this.slideStatsEl;
  }

  public getLobbySlide(): HTMLElement | null {
    return this.slideLobbyEl;
  }

  public getCurrentSlideIndex(): number {
    return this.currentSlideIndex;
  }

  // ==========================================================================
  // ACCIONES Y DISPARADORES DE EVENTOS
  // ==========================================================================

  public toggleAudio(): boolean {
    if (this.gameApp?.audioManager) {
      this.gameApp.audioManager.isMuted = !this.gameApp.audioManager.isMuted;
      const isMuted = this.gameApp.audioManager.isMuted;
      this.updateAudioButtonState(isMuted);
      return isMuted;
    }
    return false;
  }

  public updateAudioButtonState(isMuted: boolean): void {
    if (this.audioBtnEl) {
      this.audioBtnEl.textContent = isMuted ? '🔇' : '🔊';
      this.audioBtnEl.title = isMuted ? 'Audio Silenciado' : 'Audio Activado';
    }
  }

  public toggleMenu(): void {
    const phase = this.gameApp?.matchPhase ?? ($matchPhase.get());
    if (phase === MatchPhase.STOPPED) return;
    if (this.uiStateMachine) {
      this.uiStateMachine.toggleModal('teamSelect');
    } else if (this.onMenuToggle) {
      this.onMenuToggle();
    }
  }

  public openSettings(): void {
    if (this.gameApp?.settingsModal) {
      this.gameApp.settingsModal.open();
    } else if (this.gameApp?.keybindModal) {
      this.gameApp.keybindModal.open();
    } else {
      const modal = document.getElementById('settingsModal');
      if (modal) {
        modal.classList.remove('u-hidden');
        modal.style.display = 'flex';
      }
    }
  }

  public getRoomInfoElement(): HTMLElement | null {
    return this.roomInfoEl;
  }

  public setRoomInfo(name: string, roomId?: string): void {
    if (this.roomNameBadgeEl) {
      this.roomNameBadgeEl.textContent = name;
    }
    if (this.roomIdEl && roomId !== undefined) {
      this.roomIdEl.textContent = roomId;
    }
    if (this.roomInfoEl) {
      this.roomInfoEl.setAttribute('data-room-name', name);
    }
  }

  public setTeamTags(redTag: string = 'BAR', blueTag: string = 'MAD'): void {
    if (this.redTeamTagEl) {
      this.redTeamTagEl.textContent = `[${redTag}]`;
    }
    if (this.blueTeamTagEl) {
      this.blueTeamTagEl.textContent = `[${blueTag}]`;
    }
  }

  // ==========================================================================
  // TEMAS Y ESTADOS DE PARTIDO
  // ==========================================================================

  public applyTheme(theme: 'light' | 'dark'): void {
    const isDark = theme === 'dark';

    // Inyectar iconos con el tono cromático adecuado según el modo
    const iconStroke = isDark ? '#00E5FF' : '#0EA5E9';
    if (this.clockSlot) {
      this.clockSlot.innerHTML = renderIconHTML(Timer, { width: 14, height: 14, stroke: iconStroke });
    }
    if (this.wifiSlot) {
      this.wifiSlot.innerHTML = renderIconHTML(Wifi, { width: 14, height: 14, stroke: iconStroke });
    }

    if (this.capsuleEl) {
      this.capsuleEl.setAttribute('data-theme', theme);
      this.capsuleEl.classList.toggle('dark', isDark);
      this.capsuleEl.classList.toggle('scoreboard-dark', isDark);
      this.capsuleEl.classList.toggle('scoreboard-light', !isDark);

      // Compatibilidad con pruebas reactivas de clases de Tailwind
      const lightTokens = ['bg-slate-900/10', 'border-slate-900/15', 'text-slate-800'];
      const darkTokens = ['dark:bg-slate-950/70', 'dark:border-cyan-500/20', 'dark:text-slate-100', 'dark:shadow-[0_4px_20px_rgba(0,229,255,0.08)]'];

      for (const t of [...lightTokens, ...darkTokens]) {
        if (!this.capsuleEl.classList.contains(t)) {
          this.capsuleEl.classList.add(t);
        }
      }
    }

    if (this.hudContainerEl) {
      this.hudContainerEl.setAttribute('data-theme', theme);
      this.hudContainerEl.classList.toggle('dark', isDark);
    }

    if (this.matchClockContainerEl) {
      this.matchClockContainerEl.setAttribute('data-theme', theme);
      this.matchClockContainerEl.classList.toggle('dark', isDark);
    }
  }

  private updatePingDot(pingMs: number): void {
    if (!this.pingDotEl) return;
    this.pingDotEl.classList.remove('stat-dot--warning', 'stat-dot--danger');
    if (pingMs >= 120) {
      this.pingDotEl.classList.add('stat-dot--danger');
    } else if (pingMs >= 50) {
      this.pingDotEl.classList.add('stat-dot--warning');
    }
  }

  public update(
    redScore: number,
    blueScore: number,
    timerSeconds: number,
    isGoldenGoal?: boolean,
    matchPhase?: MatchPhase,
    targetTeam?: number
  ): void {
    const mins = Math.floor(timerSeconds / 60);
    const secs = timerSeconds % 60;
    const prefix = isGoldenGoal ? '+' : '';
    const timeStr = `${prefix}${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;

    // Sincronizar átomos en el almacén reactivo
    $score.set({ red: redScore, blue: blueScore });
    $timer.set(timeStr);

    // Actualización de nodo DOM directa para consistencia determinista y tests síncronos
    if (this.redScoreEl) this.redScoreEl.textContent = redScore.toString();
    if (this.blueScoreEl) this.blueScoreEl.textContent = blueScore.toString();
    if (this.timerEl) this.timerEl.textContent = timeStr;

    if (this.goldenGoalBadgeEl) {
      if (matchPhase === MatchPhase.VICTORY_CELEBRATION || matchPhase === MatchPhase.MATCH_ENDED) {
        const winText = isGoldenGoal
          ? 'GOL DE ORO'
          : (targetTeam === 1 ? 'VICTORIA ROJO' : (targetTeam === 2 ? 'VICTORIA AZUL' : 'VICTORIA'));
        this.goldenGoalBadgeEl.textContent = winText;
        this.goldenGoalBadgeEl.classList.remove('u-hidden', 'ui-screen-hidden');
        this.goldenGoalBadgeEl.style.display = 'inline-flex';
      } else if (isGoldenGoal) {
        this.goldenGoalBadgeEl.textContent = 'GOL DE ORO';
        this.goldenGoalBadgeEl.classList.remove('u-hidden', 'ui-screen-hidden');
        this.goldenGoalBadgeEl.style.display = 'inline-flex';
      } else {
        this.goldenGoalBadgeEl.classList.add('u-hidden');
        this.goldenGoalBadgeEl.style.display = 'none';
      }
    }
  }

  public updateStats(pingMs: number, fps: number): void {
    $ping.set(pingMs);

    if (this.pingEl) this.pingEl.textContent = `${Math.round(pingMs)}ms`;
    if (this.fpsEl) this.fpsEl.textContent = `Fps: ${Math.round(fps)}`;
    this.updatePingDot(pingMs);
  }

  public showGoalNotification(scorer: string, assister: string | null = null): void {
    if (!this.goalBannerEl) return;
    const assistText = assister ? `(Asistencia: ${assister})` : '(Sin asistencia)';
    this.goalBannerEl.innerHTML = `
      <div style="background: rgba(10, 16, 26, 0.96); border: 2px solid #00E5FF; box-shadow: 0 0 20px rgba(0, 229, 255, 0.4); border-radius: 12px; padding: 10px 24px; text-align: center; color: #fff; font-family: 'Space Grotesk', var(--font-mono), sans-serif;">
        <div style="font-size: 1.25rem; font-weight: 900; color: #00E5FF; text-shadow: 0 0 10px #00E5FF;">¡GOL DE ${scorer.toUpperCase()}!</div>
        <div style="font-size: 0.85rem; color: #8fa0b5; margin-top: 4px;">${assistText}</div>
      </div>
    `;
    this.goalBannerEl.style.display = 'block';
    this.goalBannerEl.style.opacity = '1';
    this.goalBannerEl.style.transform = 'translateX(-50%) translateY(0)';
    if (this.goalBannerTimeout) clearTimeout(this.goalBannerTimeout);
    this.goalBannerTimeout = setTimeout(() => {
      if (this.goalBannerEl) {
        this.goalBannerEl.style.opacity = '0';
        this.goalBannerEl.style.transform = 'translateX(-50%) translateY(-10px)';
        setTimeout(() => {
          if (this.goalBannerEl) this.goalBannerEl.style.display = 'none';
        }, 300);
      }
    }, 3500);
  }

  public destroy(): void {
    if (this.goalBannerTimeout) {
      clearTimeout(this.goalBannerTimeout);
    }
    if (this.goalBannerEl && this.goalBannerEl.parentNode) {
      this.goalBannerEl.parentNode.removeChild(this.goalBannerEl);
    }
    for (const unsub of this.unsubs) {
      unsub();
    }
    this.unsubs = [];
  }
}
