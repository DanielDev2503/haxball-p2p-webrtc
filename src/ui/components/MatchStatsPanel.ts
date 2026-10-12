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

  private buildDOM(): void {
    if (typeof document === 'undefined') return;

    let overlay = document.getElementById('match-stats-overlay') || document.getElementById('matchStatsModal') || document.getElementById('match-stats-panel');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'match-stats-overlay';
      overlay.className = 'match-stats-overlay';
      overlay.style.position = 'absolute';
      overlay.style.inset = '0';
      overlay.style.display = 'none';
      overlay.style.pointerEvents = 'none';
      overlay.style.backgroundColor = 'transparent';
      overlay.style.zIndex = '35';
      overlay.style.justifyContent = 'center';
      overlay.style.alignItems = 'center';
      document.body.appendChild(overlay);
    } else {
      overlay.id = 'match-stats-overlay';
      overlay.className = 'match-stats-overlay';
      overlay.style.position = 'absolute';
      overlay.style.inset = '0';
      overlay.style.backgroundColor = 'transparent';
      overlay.style.pointerEvents = 'none';
      overlay.style.display = 'none';
      overlay.style.zIndex = '35';
      overlay.style.justifyContent = 'center';
      overlay.style.alignItems = 'center';
    }
    this.overlayEl = overlay;
    this.element = overlay;

    let wrapper = (typeof overlay.querySelector === 'function' ? overlay.querySelector('.match-stats-wrapper') : null) as HTMLElement | null;
    if (!wrapper) {
      wrapper = document.createElement('div');
      wrapper.className = 'match-stats-wrapper';
      overlay.appendChild(wrapper);
    }
    wrapper.style.overflow = 'visible';
    wrapper.style.position = 'relative';
    this.wrapperEl = wrapper;

    let content = (typeof wrapper.querySelector === 'function' ? wrapper.querySelector('.match-stats-card') : null) as HTMLElement | null;
    if (!content) {
      content = document.createElement('div');
      content.className = 'match-stats-card';
      wrapper.appendChild(content);
    }
    this.containerEl = content;

    let statsBtn = (typeof wrapper.querySelector === 'function' ? wrapper.querySelector('#stats-to-menu-btn') : null) as HTMLButtonElement | null;
    if (!statsBtn) {
      statsBtn = document.createElement('button') as HTMLButtonElement;
      statsBtn.id = 'stats-to-menu-btn';
      statsBtn.className = 'external-nav-tab right-tab';
      statsBtn.innerHTML = 'Menú &gt;';
      statsBtn.title = 'Ir al Menú de Sala';
      wrapper.appendChild(statsBtn);
    }
    this.slideToMenuBtn = statsBtn;
    if (this.slideToMenuBtn && !(this.slideToMenuBtn as any)._boundClick) {
      (this.slideToMenuBtn as any)._boundClick = true;
      this.slideToMenuBtn.addEventListener('click', (e: MouseEvent) => {
        e?.stopPropagation?.();
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
          const breakdownRow = this.element?.querySelector(`.breakdown-row[data-player-id="${playerId}"]`);
          if (breakdownRow) {
            const isExpanded = breakdownRow.classList.toggle('active');
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
            const breakdownRow = this.element?.querySelector(`.breakdown-row[data-player-id="${playerId}"]`);
            if (breakdownRow) {
              const isExpanded = breakdownRow.classList.toggle('active');
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
        if (this.overlayEl) {
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
        ? 'linear-gradient(90deg, rgba(234, 179, 8, 0.18) 0%, rgba(234, 179, 8, 0.05) 100%)'
        : 'rgba(30, 41, 59, 0.3)';

      const borderStyle = isMvp ? 'border-left: 3px solid #EAB308;' : 'border-left: 3px solid transparent;';

      const touchesPts = p.touches * 2;
      const passesPts = p.passes * 10;
      const shotsNorm = p.shotsNormal ?? 0;
      const shotsNormPts = shotsNorm * 20;
      const shotsCurve = p.shotsPowerCurve ?? 0;
      const shotsCurvePts = shotsCurve * 30;
      const assistsNorm = p.assistsNormal ?? 0;
      const assistsNormPts = assistsNorm * 50;
      const assistsCurve = p.assistsCurve ?? 0;
      const assistsCurvePts = assistsCurve * 70;
      const savesPts = p.saves * 100;
      const goalsPts = p.goals * 100;
      const hattrickPts = p.hasHattrickBonus ? 100 : 0;
      const exactCalcTotal = touchesPts + passesPts + shotsNormPts + shotsCurvePts + assistsNormPts + assistsCurvePts + savesPts + goalsPts + hattrickPts;

      return `
        <tr style="background: ${rowBg}; ${borderStyle} transition: background 0.15s ease;">
          <td style="padding: 8px 6px; font-weight: 600;">
            <div style="display: flex; align-items: center; gap: 6px;">
              <span style="color: ${isMvp ? '#FEF08A' : '#F1F5F9'}; font-weight: ${isMvp ? '700' : '500'}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 110px;">
                ${playerDisplayName}
              </span>
              ${isMvp ? '<span style="font-size: 0.65rem; font-weight: 800; background: #EAB308; color: #78350F; padding: 1px 5px; border-radius: 9999px;">👑 MVP</span>' : ''}
            </div>
          </td>
          <td style="padding: 8px 6px; text-align: right; font-weight: 800; color: #38BDF8; font-size: 0.88rem;">
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
            <button class="btn-toggle-breakdown accordion-toggle-btn" data-player-id="${p.playerId}" title="Desglose detallado">
              ${isExpanded ? '▲' : '▼'}
            </button>
          </td>
        </tr>
        <tr class="breakdown-row ${isExpanded ? 'active' : ''}" data-player-id="${p.playerId}" id="breakdown-row-${p.playerId}" style="background: rgba(15, 23, 42, 0.85);">
          <td colspan="7" style="padding: 0;">
            <div class="player-breakdown-panel">
              <div class="breakdown-item"><span class="breakdown-label">Toques:</span><span class="breakdown-val">${p.touches}</span><span class="breakdown-pts">+${touchesPts}</span></div>
              <div class="breakdown-item"><span class="breakdown-label">Pases:</span><span class="breakdown-val">${p.passes}</span><span class="breakdown-pts">+${passesPts}</span></div>
              <div class="breakdown-item"><span class="breakdown-label">Tiros:</span><span class="breakdown-val">${shotsNorm}</span><span class="breakdown-pts">+${shotsNormPts}</span></div>
              <div class="breakdown-item"><span class="breakdown-label">Tiros c/pot:</span><span class="breakdown-val">${shotsCurve}</span><span class="breakdown-pts">+${shotsCurvePts}</span></div>
              <div class="breakdown-item"><span class="breakdown-label">Asist.:</span><span class="breakdown-val">${assistsNorm}</span><span class="breakdown-pts">+${assistsNormPts}</span></div>
              <div class="breakdown-item"><span class="breakdown-label">Asist. c:</span><span class="breakdown-val">${assistsCurve}</span><span class="breakdown-pts">+${assistsCurvePts}</span></div>
              <div class="breakdown-item"><span class="breakdown-label">Atajadas:</span><span class="breakdown-val">${p.saves}</span><span class="breakdown-pts">+${savesPts}</span></div>
              <div class="breakdown-item"><span class="breakdown-label">Goles:</span><span class="breakdown-val">${p.goals}</span><span class="breakdown-pts">+${goalsPts}</span></div>
              <div class="breakdown-item"><span class="breakdown-label">Hattrick:</span><span class="breakdown-val">${p.hasHattrickBonus ? 'Sí' : 'No'}</span><span class="breakdown-pts">+${hattrickPts}</span></div>
              <div class="breakdown-item" style="border-left: 1px solid rgba(56, 189, 248, 0.4); padding-left: 6px;"><span class="breakdown-label" style="font-weight: 700; color: #38BDF8;">Total:</span><span class="breakdown-pts" style="font-size: 0.85rem;">${exactCalcTotal} pts</span></div>
            </div>
          </td>
        </tr>
      `;
    };

    const emptyRow = '<tr><td colspan="7" style="text-align: center; padding: 14px; color: #94A3B8; font-size: 0.8rem;">Sin jugadores</td></tr>';
    const redRowsHtml = redPlayers.length > 0 ? redPlayers.map(renderPlayerRow).join('') : emptyRow;
    const blueRowsHtml = bluePlayers.length > 0 ? bluePlayers.map(renderPlayerRow).join('') : emptyRow;

    const mvpBannerHtml = mvpPlayer
      ? `
      <div style="background: linear-gradient(135deg, rgba(234, 179, 8, 0.2) 0%, rgba(202, 138, 4, 0.08) 100%); border: 1.5px solid rgba(234, 179, 8, 0.4); border-radius: 12px; padding: 12px 16px; margin-bottom: 12px; display: flex; align-items: center; justify-content: space-between; box-shadow: 0 4px 20px rgba(234, 179, 8, 0.1);">
        <div style="display: flex; align-items: center; gap: 12px;">
          <div style="font-size: 2rem; filter: drop-shadow(0 0 10px rgba(234, 179, 8, 0.6));">👑</div>
          <div>
            <div style="font-size: 0.7rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; color: #FDE047;">Jugador Más Valioso (MVP)</div>
            <div style="font-size: 1.15rem; font-weight: 800; color: #FFFFFF;">${mvpPlayer.playerName || mvpPlayer.nickname || 'Jugador'}</div>
          </div>
        </div>
        <div style="text-align: right;">
          <div style="font-size: 1.3rem; font-weight: 900; color: #FDE047; font-family: 'Zen Dots', 'Inter', monospace;">${mvpPlayer.totalPoints ?? mvpPlayer.points} <span style="font-size: 0.75rem; font-weight: 600;">pts</span></div>
          <div style="font-size: 0.72rem; color: #CBD5E1;">${mvpPlayer.goals} goles • ${mvpPlayer.assists} asistencias • ${mvpPlayer.saves} atajadas</div>
        </div>
      </div>
    `
      : '';

    this.containerEl.innerHTML = `
      <div class="match-stats-header">
        <div class="match-stats-score-banner">
          <h2 class="stats-title" style="margin: 0;">ESTADÍSTICAS DEL PARTIDO</h2>
          <span style="color: #F87171; font-weight: 800; margin-left: 8px;">${redGoals}</span>
          <span style="opacity: 0.5; font-weight: 800;">-</span>
          <span style="color: #60A5FA; font-weight: 800;">${blueGoals}</span>
        </div>
        <div class="match-stats-mvp-badge">${mvpPlayer ? `👑 MVP: ${mvpPlayer.playerName || mvpPlayer.nickname || 'Jugador'}` : 'Sin MVP'}</div>
      </div>
      
      <!-- Contenedor ÚNICO con scroll vertical -->
      <div class="match-stats-scroll-body">
        ${mvpBannerHtml}
        <div class="stats-dual-grid stats-dual-container">
          <!-- Tabla Equipo RED -->
          <div class="team-stats-column team-red team-stats-box team-home">
            <div class="team-stats-header red-header" id="team-home-header">
              <span>🔴 Equipo Rojo</span>
              <span class="team-score-badge">${redGoals} Goles</span>
            </div>
            <div class="team-stats-table-wrapper">
              <table class="stats-table" id="team-home-table">
                <thead>
                  <tr>
                    <th style="text-align: left; padding-left: 8px;">Jugador</th>
                    <th style="text-align: right;">Pts</th>
                    <th style="text-align: center;">G</th>
                    <th style="text-align: center;">A</th>
                    <th style="text-align: center;">P</th>
                    <th style="text-align: center;">S</th>
                    <th style="text-align: center; width: 28px;">▼</th>
                  </tr>
                </thead>
                <tbody>
                  ${redRowsHtml}
                </tbody>
              </table>
            </div>
          </div>

          <!-- Tabla Equipo BLUE -->
          <div class="team-stats-column team-blue team-stats-box team-away">
            <div class="team-stats-header blue-header" id="team-away-header">
              <span>🔵 Equipo Azul</span>
              <span class="team-score-badge">${blueGoals} Goles</span>
            </div>
            <div class="team-stats-table-wrapper">
              <table class="stats-table" id="team-away-table">
                <thead>
                  <tr>
                    <th style="text-align: left; padding-left: 8px;">Jugador</th>
                    <th style="text-align: right;">Pts</th>
                    <th style="text-align: center;">G</th>
                    <th style="text-align: center;">A</th>
                    <th style="text-align: center;">P</th>
                    <th style="text-align: center;">S</th>
                    <th style="text-align: center; width: 28px;">▼</th>
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
      statsBtn.className = 'external-nav-tab right-tab';
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
