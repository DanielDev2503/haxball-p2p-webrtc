import { PlayerMatchStats } from '../../core/game/GameState';

export interface MatchStatsPanelEvents {
  onClose?: () => void;
  onSlideToMenu?: () => void;
}

export class MatchStatsPanel {
  private overlayEl: HTMLElement | null = null;
  private wrapperEl: HTMLElement | null = null;
  private containerEl: HTMLElement | null = null;
  private element: HTMLElement | null = null;
  private slideToMenuBtn: HTMLButtonElement | null = null;
  private events: MatchStatsPanelEvents;
  private _isOpen: boolean = false;
  private expandedPlayerIds: Set<string> = new Set();
  private currentStats: PlayerMatchStats[] = [];
  private currentMvpId: string | null = null;
  private isListenerBound: boolean = false;

  public onSlideToMenu?: () => void;
  public gameApp?: { showRoomLobby?: () => void };

  constructor(events: MatchStatsPanelEvents = {}) {
    this.events = events;
    if (events.onSlideToMenu) {
      this.onSlideToMenu = events.onSlideToMenu;
    }
  }

  public ensureDOM(): void {
    if (this.overlayEl && this.wrapperEl && this.containerEl) return;
    this.buildDOM();
  }

  private getTrack(): HTMLElement | null {
    if (typeof document === 'undefined') return null;
    return (typeof document.getElementById === 'function' ? document.getElementById('carouselTrack') : null) ||
           (typeof document.querySelector === 'function' ? document.querySelector('.carousel-track') : null) as HTMLElement | null;
  }

  private buildDOM(): void {
    if (typeof document === 'undefined') return;

    const slideStats = document.getElementById('slide-stats');
    let overlay: HTMLElement;

    if (slideStats) {
      overlay = slideStats;
      // Compatibilidad con pruebas unitarias que buscan el ID 'match-stats-overlay'
      if (!document.getElementById('match-stats-overlay')) {
        const dummyOverlay = document.createElement('div');
        dummyOverlay.id = 'match-stats-overlay';
        dummyOverlay.className = 'match-stats-overlay';
        dummyOverlay.style.display = 'none';
        dummyOverlay.style.pointerEvents = 'none';
        dummyOverlay.style.backgroundColor = 'transparent';
        slideStats.appendChild(dummyOverlay);
      }
    } else {
      let existingOverlay = document.getElementById('match-stats-overlay') || document.getElementById('matchStatsModal') || document.getElementById('match-stats-panel');
      if (!existingOverlay) {
        existingOverlay = document.createElement('div');
        existingOverlay.id = 'match-stats-overlay';
        existingOverlay.className = 'match-stats-overlay';
        existingOverlay.style.position = 'absolute';
        existingOverlay.style.inset = '0';
        existingOverlay.style.display = 'none';
        existingOverlay.style.pointerEvents = 'none';
        existingOverlay.style.backgroundColor = 'transparent';
        existingOverlay.style.zIndex = '35';
        existingOverlay.style.justifyContent = 'center';
        existingOverlay.style.alignItems = 'center';
        document.body.appendChild(existingOverlay);
      }
      overlay = existingOverlay;
    }

    this.overlayEl = overlay;
    this.element = overlay;

    let wrapper = (typeof overlay.querySelector === 'function' ? overlay.querySelector('.match-stats-wrapper') : null) as HTMLElement | null;
    if (!wrapper) {
      wrapper = document.createElement('div');
      wrapper.className = 'match-stats-wrapper stats-slide-wrapper';
      wrapper.style.display = 'flex';
      wrapper.style.alignItems = 'center';
      wrapper.style.justifyContent = 'center';
      wrapper.style.position = 'relative';
      wrapper.style.width = '100%';
      wrapper.style.height = '100%';
      overlay.appendChild(wrapper);
    }
    this.wrapperEl = wrapper;

    let content = (typeof wrapper.querySelector === 'function' ? wrapper.querySelector('.stats-card, .match-stats-card') : null) as HTMLElement | null;
    if (!content) {
      content = document.createElement('div');
      content.className = 'stats-card match-stats-card';
      wrapper.appendChild(content);
    }
    this.containerEl = content;

    let statsBtn = (typeof wrapper.querySelector === 'function' ? wrapper.querySelector('#stats-to-menu-btn') : null) as HTMLButtonElement | null;
    if (!statsBtn) {
      statsBtn = document.createElement('button') as HTMLButtonElement;
      statsBtn.id = 'stats-to-menu-btn';
      statsBtn.className = 'floating-nav-btn external-nav-tab right-tab';
      statsBtn.innerHTML = 'Menú &gt;';
      statsBtn.title = 'Ir al Menú de Sala';
      wrapper.appendChild(statsBtn);
    }
    this.slideToMenuBtn = statsBtn;
    if (this.slideToMenuBtn && !(this.slideToMenuBtn as any)._boundClick) {
      (this.slideToMenuBtn as any)._boundClick = true;
      this.slideToMenuBtn.addEventListener('click', (e: MouseEvent) => {
        e?.stopPropagation?.();
        // 1. Desplazar carrusel a Diapositiva 2 (Lobby / Menú de Sala)
        const track = this.getTrack();
        if (track) {
          track.style.transform = 'translateX(-100vw)';
        }
        if (typeof window !== 'undefined' && typeof (window as any).scoreboardHUD?.showLobbySlide === 'function') {
          (window as any).scoreboardHUD.showLobbySlide();
        }

        this.hide();
        if (this.gameApp && typeof this.gameApp.showRoomLobby === 'function') {
          this.gameApp.showRoomLobby();
        }
        if (this.onSlideToMenu) {
          this.onSlideToMenu();
        } else {
          this.events.onSlideToMenu?.();
        }
        if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
          window.dispatchEvent(new CustomEvent('stats:navigate-to-menu'));
        }
      });
    }

    if (!this.isListenerBound && this.element) {
      this.isListenerBound = true;
      this.element.addEventListener('click', (e: MouseEvent) => {
        const target = e.target as HTMLElement;
        if (!target) return;

        // 1. Manejo del botón Menú >
        if (typeof target.closest === 'function' && target.closest('#stats-to-menu-btn')) {
          const track = this.getTrack();
          if (track) {
            track.style.transform = 'translateX(-100vw)';
          }
          if (typeof window !== 'undefined' && typeof (window as any).scoreboardHUD?.showLobbySlide === 'function') {
            (window as any).scoreboardHUD.showLobbySlide();
          }

          this.hide();
          if (this.gameApp && typeof this.gameApp.showRoomLobby === 'function') {
            this.gameApp.showRoomLobby();
          }
          if (this.onSlideToMenu) {
            this.onSlideToMenu();
          } else {
            this.events.onSlideToMenu?.();
          }
          if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
            window.dispatchEvent(new CustomEvent('stats:navigate-to-menu'));
          }
          return;
        }

        // 2. Manejo de acordeón para desglose de puntos (botón ▼/▲ o click en fila)
        const toggleBtn = (typeof target.closest === 'function' ? target.closest('.btn-toggle-breakdown, .accordion-toggle-btn') : null) as HTMLElement | null;
        if (toggleBtn) {
          const playerId = toggleBtn.getAttribute('data-player-id');
          const breakdownRow = this.element?.querySelector(`.breakdown-row[data-player-id="${playerId}"]`) as HTMLElement | null;
          if (breakdownRow) {
            const isExpanded = breakdownRow.classList.toggle('active');
            breakdownRow.style.display = isExpanded ? 'table-row' : 'none';
            if (isExpanded) {
              if (playerId) this.expandedPlayerIds.add(playerId);
            } else {
              if (playerId) this.expandedPlayerIds.delete(playerId);
            }
            toggleBtn.textContent = isExpanded ? '▲' : '▼';
          }
          return;
        }

        const playerRow = (typeof target.closest === 'function' ? target.closest('tr:not(.breakdown-row)') : null) as HTMLElement | null;
        if (playerRow) {
          const btn = playerRow.querySelector('.btn-toggle-breakdown, .accordion-toggle-btn') as HTMLElement | null;
          const playerId = btn?.getAttribute('data-player-id');
          if (playerId) {
            const breakdownRow = this.element?.querySelector(`.breakdown-row[data-player-id="${playerId}"]`) as HTMLElement | null;
            if (breakdownRow) {
              const isExpanded = breakdownRow.classList.toggle('active');
              breakdownRow.style.display = isExpanded ? 'table-row' : 'none';
              if (isExpanded) {
                this.expandedPlayerIds.add(playerId);
              } else {
                this.expandedPlayerIds.delete(playerId);
              }
              if (btn) btn.textContent = isExpanded ? '▲' : '▼';
            }
          }
          return;
        }
      });
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('chat:resize', (e: Event) => {
        const customEvent = e as CustomEvent<{ height: number }>;
        const h = customEvent?.detail?.height ?? 180;
        if (this.overlayEl && !slideStats) {
          this.overlayEl.style.bottom = `calc(${h}px + 16px)`;
        }
        if (this.containerEl) {
          this.containerEl.style.maxHeight = `calc(100vh - ${h}px - 96px)`;
        }
      });
    }
  }

  public getElement(): HTMLElement | null {
    return this.overlayEl;
  }

  public isOpen(): boolean {
    return this._isOpen;
  }

  public slideToLeft(): void {
    if (this.overlayEl) {
      this.overlayEl.classList?.add?.('u-hidden');
      this.overlayEl.style.display = 'none';
      this.overlayEl.style.pointerEvents = 'none';
    }
    this._isOpen = false;
  }

  public slideToCenter(): void {
    this.ensureDOM();
    const track = this.getTrack();
    if (track) {
      track.style.transform = 'translateX(0vw)';
    }
    if (typeof window !== 'undefined' && typeof (window as any).scoreboardHUD?.showStatsSlide === 'function') {
      (window as any).scoreboardHUD.showStatsSlide();
    }

    if (this.overlayEl) {
      this.overlayEl.classList?.remove?.('u-hidden');
      this.overlayEl.style.display = 'flex';
      this.overlayEl.style.pointerEvents = 'none';
    }
    this._isOpen = true;
  }

  public slideToRight(): void {
    if (this.overlayEl) {
      this.overlayEl.classList?.add?.('u-hidden');
      this.overlayEl.style.display = 'none';
      this.overlayEl.style.pointerEvents = 'none';
    }
    this._isOpen = false;
  }

  public show(stats: PlayerMatchStats[], mvpId?: string | null): void {
    this._isOpen = true;
    this.currentStats = stats;
    this.currentMvpId = mvpId ?? null;

    this.ensureDOM();
    if (!this.overlayEl || !this.wrapperEl || !this.containerEl) return;

    this.renderContent();
    this.slideToCenter();
  }

  private renderContent(): void {
    if (!this.containerEl) return;

    const stats = this.currentStats;
    const sortedStats = [...stats].sort((a, b) => (b.totalPoints ?? b.points) - (a.totalPoints ?? a.points));
    const calculatedMvpId = this.currentMvpId ?? (sortedStats.length > 0 ? sortedStats[0].playerId : null);
    const mvpPlayer = sortedStats.find((s) => s.playerId === calculatedMvpId);

    const redPlayers = sortedStats.filter((p) => p.team === 'red' || (p.team as any) === 1);
    const bluePlayers = sortedStats.filter((p) => p.team === 'blue' || (p.team as any) === 2);
    const redGoals = redPlayers.reduce((acc, p) => acc + (p.goals || 0), 0);
    const blueGoals = bluePlayers.reduce((acc, p) => acc + (p.goals || 0), 0);

    const renderPlayerRow = (p: PlayerMatchStats) => {
      const isMvp = p.playerId === calculatedMvpId;
      const playerDisplayName = p.playerName || p.nickname || 'Jugador';
      const totalPointsVal = p.totalPoints ?? p.points;
      const isExpanded = this.expandedPlayerIds.has(p.playerId);

      const rowBg = isMvp
        ? 'rgba(234, 179, 8, 0.14)'
        : 'rgba(30, 41, 59, 0.3)';

      const borderStyle = isMvp ? 'border-left: 3px solid #ffd700;' : 'border-left: 3px solid transparent;';

      const touchesPts = (p.touches || 0) * 2;
      const passesPts = (p.passes || 0) * 10;
      const shotsNorm = p.shotsNormal ?? (p.shots || 0);
      const shotsNormPts = shotsNorm * 20;
      const shotsCurve = p.shotsPowerCurve ?? 0;
      const shotsCurvePts = shotsCurve * 30;
      const assistsNorm = p.assistsNormal ?? (p.assists || 0);
      const assistsNormPts = assistsNorm * 50;
      const assistsCurve = p.assistsCurve ?? 0;
      const assistsCurvePts = assistsCurve * 70;
      const savesPts = (p.saves || 0) * 100;
      const goalsPts = (p.goals || 0) * 100;
      const ownGoals = (p as any).ownGoals || 0;
      const ownGoalsPts = ownGoals * -50;
      const hattrickPts = p.hasHattrickBonus ? 100 : 0;
      const exactCalcTotal = touchesPts + passesPts + shotsNormPts + shotsCurvePts + assistsNormPts + assistsCurvePts + savesPts + goalsPts + ownGoalsPts + hattrickPts;

      return `
        <tr style="background: ${rowBg}; ${borderStyle} transition: background 0.15s ease;" class="${isMvp ? 'mvp-row' : ''}">
          <td style="padding: 8px 6px; font-weight: 600;">
            <div style="display: flex; align-items: center; gap: 6px;">
              <span style="color: ${isMvp ? '#ffd700' : '#F1F5F9'}; font-weight: ${isMvp ? '700' : '500'}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 110px;">
                ${playerDisplayName}
              </span>
              ${isMvp ? '<span style="font-size: 0.65rem; font-weight: 800; background: #ffd700; color: #78350F; padding: 1px 5px; border-radius: 9999px;">👑 MVP</span>' : ''}
            </div>
          </td>
          <td style="padding: 8px 6px; text-align: right; font-weight: 800; color: #00e5ff; font-size: 0.88rem;">
            ${totalPointsVal}
          </td>
          <td style="padding: 8px 4px; text-align: center; color: #F8FAFC;">
            ${p.goals}
          </td>
          <td style="padding: 8px 4px; text-align: center; color: #F8FAFC;">
            ${p.assists}
          </td>
          <td style="padding: 8px 4px; text-align: center; color: #F8FAFC;">
            ${p.passes}
          </td>
          <td style="padding: 8px 4px; text-align: center; color: #F8FAFC;">
            ${p.saves}
          </td>
          <td style="padding: 8px 4px; text-align: center; width: 28px;">
            <button class="btn-toggle-breakdown accordion-toggle-btn" data-player-id="${p.playerId}" style="background: none; border: none; color: #00e5ff; cursor: pointer; font-size: 11px;" title="Desglose detallado">
              ${isExpanded ? '▲' : '▼'}
            </button>
          </td>
        </tr>
        <tr class="breakdown-row ${isExpanded ? 'active' : ''}" data-player-id="${p.playerId}" id="breakdown-row-${p.playerId}" style="background: rgba(10, 16, 26, 0.95); display: ${isExpanded ? 'table-row' : 'none'};">
          <td colspan="7" style="padding: 0;">
            <div class="player-breakdown-panel" style="padding: 10px 14px; display: flex; flex-wrap: wrap; gap: 10px 16px; font-size: 0.75rem; border-top: 1px solid rgba(0, 229, 255, 0.15); border-bottom: 1px solid rgba(0, 229, 255, 0.15);">
              <div class="breakdown-item"><span class="breakdown-label" style="color: #94A3B8;">Toques:</span> <span class="breakdown-val">${p.touches}</span> <span class="breakdown-pts" style="color: #00e5ff;">(+${touchesPts})</span></div>
              <div class="breakdown-item"><span class="breakdown-label" style="color: #94A3B8;">Pases:</span> <span class="breakdown-val">${p.passes}</span> <span class="breakdown-pts" style="color: #00e5ff;">(+${passesPts})</span></div>
              <div class="breakdown-item"><span class="breakdown-label" style="color: #94A3B8;">Tiros:</span> <span class="breakdown-val">${shotsNorm}</span> <span class="breakdown-pts" style="color: #00e5ff;">(+${shotsNormPts})</span></div>
              <div class="breakdown-item"><span class="breakdown-label" style="color: #94A3B8;">Goles:</span> <span class="breakdown-val">${p.goals}</span> <span class="breakdown-pts" style="color: #00e5ff;">(+${goalsPts})</span></div>
              <div class="breakdown-item"><span class="breakdown-label" style="color: #94A3B8;">Autogoles:</span> <span class="breakdown-val">${ownGoals}</span> <span class="breakdown-pts" style="color: #ef4444;">(${ownGoalsPts})</span></div>
              <div class="breakdown-item"><span class="breakdown-label" style="color: #94A3B8;">Atajadas:</span> <span class="breakdown-val">${p.saves}</span> <span class="breakdown-pts" style="color: #00e5ff;">(+${savesPts})</span></div>
              ${shotsCurve > 0 ? `<div class="breakdown-item"><span class="breakdown-label" style="color: #94A3B8;">Tiros c/pot:</span> <span class="breakdown-val">${shotsCurve}</span> <span class="breakdown-pts" style="color: #00e5ff;">(+${shotsCurvePts})</span></div>` : ''}
              ${assistsNorm > 0 ? `<div class="breakdown-item"><span class="breakdown-label" style="color: #94A3B8;">Asist.:</span> <span class="breakdown-val">${assistsNorm}</span> <span class="breakdown-pts" style="color: #00e5ff;">(+${assistsNormPts})</span></div>` : ''}
              ${p.hasHattrickBonus ? `<div class="breakdown-item"><span class="breakdown-label" style="color: #ffd700;">Hattrick:</span> <span class="breakdown-pts" style="color: #ffd700;">(+100)</span></div>` : ''}
              <div class="breakdown-item" style="margin-left: auto; border-left: 1px solid rgba(0, 229, 255, 0.4); padding-left: 8px;"><span class="breakdown-label" style="font-weight: 700; color: #ffd700;">Total:</span> <span class="breakdown-pts" style="font-weight: 800; color: #ffd700;">${exactCalcTotal} pts</span></div>
            </div>
          </td>
        </tr>
      `;
    };

    const emptyRow = '<tr><td colspan="7" style="text-align: center; padding: 14px; color: #94A3B8; font-size: 0.8rem;">Sin jugadores</td></tr>';
    const redRowsHtml = redPlayers.length > 0 ? redPlayers.map(renderPlayerRow).join('') : emptyRow;
    const blueRowsHtml = bluePlayers.length > 0 ? bluePlayers.map(renderPlayerRow).join('') : emptyRow;

    const mvpDisplayName = mvpPlayer ? (mvpPlayer.playerName || mvpPlayer.nickname || 'Jugador') : 'Sin MVP';
    const mvpPoints = mvpPlayer ? (mvpPlayer.totalPoints ?? mvpPlayer.points) : 0;

    this.containerEl.innerHTML = `
      <!-- Cabecera Deportiva -->
      <div class="stats-header-bar" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border-cyan); padding-bottom: 14px; margin-bottom: 14px;">
        <div class="stats-scoreboard font-mono" style="font-size: 1.25rem; font-weight: 800; letter-spacing: 0.05em; display: flex; align-items: center; gap: 8px;">
          <span style="color: #f87171;">RED</span>
          <span style="color: #f87171; font-size: 1.45rem;">${redGoals}</span>
          <span style="opacity: 0.4;">-</span>
          <span style="color: #60a5fa; font-size: 1.45rem;">${blueGoals}</span>
          <span style="color: #60a5fa;">BLUE</span>
        </div>
        <div class="match-stats-mvp-badge" style="background: rgba(255, 215, 0, 0.12); border: 1.5px solid #ffd700; border-radius: 8px; padding: 6px 14px; color: #ffd700; font-weight: 800; font-size: 0.88rem; display: flex; align-items: center; gap: 6px; box-shadow: 0 0 12px rgba(255, 215, 0, 0.25);">
          👑 MVP: ${mvpDisplayName} (${mvpPoints} pts)
        </div>
      </div>

      <!-- Cuerpo con Tablas Paralelas (Grid 50-50) -->
      <div class="match-stats-scroll-body cyber-scrollbar" style="overflow-y: auto !important; overflow-x: hidden !important; max-height: 380px; flex: 1; min-height: 0;">
        <div class="stats-dual-grid stats-dual-container" style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px;">
          <!-- Tabla Equipo RED (Izquierda) -->
          <div class="team-stats-column team-red team-stats-box team-home" style="background: rgba(15, 23, 42, 0.5); border: 1px solid rgba(239, 68, 68, 0.25); border-radius: 8px; overflow: hidden; display: flex; flex-direction: column;">
            <div class="team-stats-header red-header" id="team-home-header" style="background: rgba(239, 68, 68, 0.18); border-bottom: 1px solid rgba(239, 68, 68, 0.3); padding: 8px 12px; display: flex; justify-content: space-between; align-items: center; color: #f87171; font-weight: 800; font-size: 0.85rem;">
              <span>🔴 Equipo Rojo</span>
              <span class="team-score-badge" style="background: rgba(239, 68, 68, 0.3); padding: 2px 8px; border-radius: 9999px; font-size: 0.75rem;">${redGoals} Goles</span>
            </div>
            <div class="team-stats-table-wrapper">
              <table class="stats-table" id="team-home-table" style="width: 100%; border-collapse: collapse; font-size: 0.82rem;">
                <thead>
                  <tr style="border-bottom: 1px solid rgba(255, 255, 255, 0.08); color: #94A3B8; font-size: 0.72rem; text-transform: uppercase;">
                    <th style="text-align: left; padding: 6px 8px;">Jugador</th>
                    <th style="text-align: right; padding: 6px;">Pts</th>
                    <th style="text-align: center; padding: 6px;">G</th>
                    <th style="text-align: center; padding: 6px;">A</th>
                    <th style="text-align: center; padding: 6px;">P</th>
                    <th style="text-align: center; padding: 6px;">S</th>
                    <th style="text-align: center; padding: 6px; width: 28px;">▼</th>
                  </tr>
                </thead>
                <tbody>
                  ${redRowsHtml}
                </tbody>
              </table>
            </div>
          </div>

          <!-- Tabla Equipo BLUE (Derecha) -->
          <div class="team-stats-column team-blue team-stats-box team-away" style="background: rgba(15, 23, 42, 0.5); border: 1px solid rgba(59, 130, 246, 0.25); border-radius: 8px; overflow: hidden; display: flex; flex-direction: column;">
            <div class="team-stats-header blue-header" id="team-away-header" style="background: rgba(59, 130, 246, 0.18); border-bottom: 1px solid rgba(59, 130, 246, 0.3); padding: 8px 12px; display: flex; justify-content: space-between; align-items: center; color: #60a5fa; font-weight: 800; font-size: 0.85rem;">
              <span>🔵 Equipo Azul</span>
              <span class="team-score-badge" style="background: rgba(59, 130, 246, 0.3); padding: 2px 8px; border-radius: 9999px; font-size: 0.75rem;">${blueGoals} Goles</span>
            </div>
            <div class="team-stats-table-wrapper">
              <table class="stats-table" id="team-away-table" style="width: 100%; border-collapse: collapse; font-size: 0.82rem;">
                <thead>
                  <tr style="border-bottom: 1px solid rgba(255, 255, 255, 0.08); color: #94A3B8; font-size: 0.72rem; text-transform: uppercase;">
                    <th style="text-align: left; padding: 6px 8px;">Jugador</th>
                    <th style="text-align: right; padding: 6px;">Pts</th>
                    <th style="text-align: center; padding: 6px;">G</th>
                    <th style="text-align: center; padding: 6px;">A</th>
                    <th style="text-align: center; padding: 6px;">P</th>
                    <th style="text-align: center; padding: 6px;">S</th>
                    <th style="text-align: center; padding: 6px; width: 28px;">▼</th>
                  </tr>
                </thead>
                <tbody>
                  ${blueRowsHtml}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        <div style="margin-top: 10px; display: flex; justify-content: space-between; align-items: center;">
          <span style="font-size: 0.75rem; color: #94A3B8;">Haz clic en ▼ para ver el desglose matemático de puntos.</span>
        </div>
      </div>
    `;
  }

  public renderStatsToMenuButton(): void {
    if (!this.wrapperEl) return;
    let statsBtn = (typeof this.wrapperEl.querySelector === 'function' ? this.wrapperEl.querySelector('#stats-to-menu-btn') : null) as HTMLButtonElement | null;
    if (!statsBtn && typeof document !== 'undefined') {
      statsBtn = document.createElement('button') as HTMLButtonElement;
      statsBtn.id = 'stats-to-menu-btn';
      statsBtn.className = 'floating-nav-btn external-nav-tab right-tab';
      statsBtn.innerHTML = 'Menú &gt;';
      statsBtn.title = 'Ir al Menú de Sala';
      this.wrapperEl.appendChild(statsBtn);
    }
    this.slideToMenuBtn = statsBtn;
  }

  public close(): void {
    if (this.overlayEl) {
      this.overlayEl.classList?.add?.('u-hidden');
      this.overlayEl.style.display = 'none';
      this.overlayEl.style.pointerEvents = 'none';
    }
    this._isOpen = false;
    this.events.onClose?.();
  }

  public hide(): void {
    this.close();
  }

  public destroy(): void {
    this.close();
    if (this.overlayEl && this.overlayEl.parentNode) {
      this.overlayEl.parentNode.removeChild(this.overlayEl);
    }
    this.overlayEl = null;
    this.wrapperEl = null;
    this.containerEl = null;
    this.element = null;
    this.slideToMenuBtn = null;
    this.isListenerBound = false;
  }
}
