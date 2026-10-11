import { PlayerMatchStats } from '../../core/game/GameState';

export interface MatchStatsPanelEvents {
  onClose?: () => void;
  onSlideToMenu?: () => void;
}

export class MatchStatsPanel {
  private overlayEl: HTMLElement | null = null;
  private containerEl: HTMLElement | null = null;
  private slideToMenuBtn: HTMLButtonElement | null = null;
  private events: MatchStatsPanelEvents;
  private _isOpen: boolean = false;
  private expandedPlayerIds: Set<string> = new Set();
  private currentStats: PlayerMatchStats[] = [];
  private currentMvpId: string | null = null;

  public onSlideToMenu?: () => void;

  constructor(events: MatchStatsPanelEvents = {}) {
    this.events = events;
    if (events.onSlideToMenu) {
      this.onSlideToMenu = events.onSlideToMenu;
    }
    this.buildDOM();
  }

  private buildDOM(): void {
    if (typeof document === 'undefined') return;

    let overlay = document.getElementById('matchStatsModal');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'matchStatsModal';
      overlay.className = 'sliding-panels-container';
      overlay.style.position = 'fixed';
      overlay.style.inset = '0';
      overlay.style.backgroundColor = 'transparent';
      overlay.style.backdropFilter = 'none';
      (overlay.style as any).webkitBackdropFilter = 'none';
      overlay.style.display = 'none';
      overlay.style.justifyContent = 'center';
      overlay.style.alignItems = 'center';
      overlay.style.zIndex = '10005';
      overlay.style.pointerEvents = 'none';
      overlay.style.overflow = 'visible';
      document.body.appendChild(overlay);
    } else {
      overlay.style.backgroundColor = 'transparent';
      overlay.style.backdropFilter = 'none';
      (overlay.style as any).webkitBackdropFilter = 'none';
      overlay.style.pointerEvents = 'none';
    }
    this.overlayEl = overlay;

    let content = overlay.querySelector('.match-stats-card') as HTMLElement | null;
    if (!content) {
      content = document.createElement('div');
      content.className = 'match-stats-card menu-modal-card sliding-panel panel-center modal-container';
      content.style.position = 'absolute';
      content.style.top = '60px';
      content.style.bottom = 'calc(var(--chat-height, 180px) + 16px)';
      content.style.maxHeight = 'calc(100vh - var(--chat-height, 180px) - 86px)';
      content.style.left = '50%';
      content.style.maxWidth = '860px';
      content.style.width = 'min(94vw, 860px)';
      content.style.backgroundColor = 'rgba(15, 23, 42, 0.95)';
      content.style.border = '1.5px solid rgba(14, 165, 233, 0.35)';
      content.style.boxShadow = '0 20px 50px rgba(0, 0, 0, 0.6), 0 0 30px rgba(14, 165, 233, 0.15)';
      content.style.borderRadius = '20px';
      content.style.padding = '20px';
      content.style.color = '#F8FAFC';
      content.style.fontFamily = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
      content.style.pointerEvents = 'auto';
      content.style.overflow = 'visible';
      content.style.display = 'flex';
      content.style.flexDirection = 'column';
      content.style.boxSizing = 'border-box';
      overlay.appendChild(content);
    }
    this.containerEl = content;

    if (typeof window !== 'undefined') {
      window.addEventListener('chat:resize', (e: Event) => {
        const customEvent = e as CustomEvent<{ height: number }>;
        const h = customEvent?.detail?.height ?? 180;
        if (this.containerEl) {
          this.containerEl.style.bottom = `calc(${h}px + 16px)`;
          this.containerEl.style.maxHeight = `calc(100vh - ${h}px - 86px)`;
        }
      });
    }
  }

  public isOpen(): boolean {
    return this._isOpen;
  }

  public slideToLeft(): void {
    if (this.overlayEl) {
      this.overlayEl.style.pointerEvents = 'none';
    }
    if (this.containerEl) {
      this.containerEl.classList?.remove?.('panel-center', 'panel-right');
      this.containerEl.classList?.add?.('panel-left');
    }
    this._isOpen = false;
  }

  public slideToCenter(): void {
    if (!this.overlayEl || !this.containerEl) {
      this.buildDOM();
    }
    if (this.overlayEl) {
      this.overlayEl.style.display = 'flex';
      this.overlayEl.style.pointerEvents = 'none';
    }
    if (this.containerEl) {
      this.containerEl.classList?.remove?.('panel-left', 'panel-right');
      this.containerEl.classList?.add?.('panel-center');
      this.containerEl.style.pointerEvents = 'auto';
    }
    this._isOpen = true;
  }

  public slideToRight(): void {
    if (this.overlayEl) {
      this.overlayEl.style.pointerEvents = 'none';
    }
    if (this.containerEl) {
      this.containerEl.classList?.remove?.('panel-center', 'panel-left');
      this.containerEl.classList?.add?.('panel-right');
    }
    this._isOpen = false;
  }

  public show(stats: PlayerMatchStats[], mvpId?: string | null): void {
    this._isOpen = true;
    this.currentStats = stats;
    this.currentMvpId = mvpId ?? null;

    if (!this.overlayEl || !this.containerEl) {
      this.buildDOM();
    }
    if (!this.overlayEl || !this.containerEl) return;

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
            <button class="accordion-toggle-btn" data-player-id="${p.playerId}" title="Desglose detallado">
              ${isExpanded ? '▲' : '▼'}
            </button>
          </td>
        </tr>
        <tr id="breakdown-row-${p.playerId}" style="display: ${isExpanded ? 'table-row' : 'none'}; background: rgba(15, 23, 42, 0.85);">
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
      <!-- Botón Externo a la derecha -->
      <button id="stats-to-menu-btn" class="external-nav-tab right-tab" title="Ir al Menú de Sala">
        Menú &gt;
      </button>

      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 1.4rem;">📊</span>
          <h2 style="margin: 0; font-size: 1.25rem; font-weight: 800; letter-spacing: -0.01em; color: #F8FAFC;">
            Estadísticas del Partido
          </h2>
        </div>
      </div>

      <div class="stats-scroll-container">
        ${mvpBannerHtml}
        <div class="stats-teams-grid">
          <div class="team-stats-box red-team-box">
            <div class="team-stats-header red-header">
              <span>🔴 Equipo Rojo</span>
              <span class="team-score-badge">${redGoals} Goles</span>
            </div>
            <table class="stats-table">
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

          <div class="team-stats-box blue-team-box">
            <div class="team-stats-header blue-header">
              <span>🔵 Equipo Azul</span>
              <span class="team-score-badge">${blueGoals} Goles</span>
            </div>
            <table class="stats-table">
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
    `;

    let statsBtn = typeof this.containerEl.querySelector === 'function'
      ? this.containerEl.querySelector('#stats-to-menu-btn') as HTMLButtonElement | null
      : null;
    if (!statsBtn && typeof document !== 'undefined') {
      statsBtn = document.createElement('button') as HTMLButtonElement;
      statsBtn.id = 'stats-to-menu-btn';
      statsBtn.className = 'external-nav-tab right-tab';
      statsBtn.innerHTML = 'Menú &gt;';
      statsBtn.title = 'Ir al Menú de Sala';
      this.containerEl.appendChild(statsBtn);
    }
    this.slideToMenuBtn = statsBtn;

    this.slideToMenuBtn?.addEventListener('click', () => {
      this.slideToLeft();
      if (this.onSlideToMenu) {
        this.onSlideToMenu();
      } else {
        this.events.onSlideToMenu?.();
      }
    });

    const accordionBtns = typeof this.containerEl.querySelectorAll === 'function'
      ? this.containerEl.querySelectorAll<HTMLButtonElement>('.accordion-toggle-btn')
      : [];
    accordionBtns.forEach?.((btn) => {
      btn.addEventListener?.('click', (e) => {
        e.stopPropagation();
        const pId = btn.getAttribute?.('data-player-id');
        if (!pId) return;

        if (this.expandedPlayerIds.has(pId)) {
          this.expandedPlayerIds.delete(pId);
          btn.textContent = '▼';
          const subRow = typeof this.containerEl?.querySelector === 'function'
            ? this.containerEl.querySelector(`#breakdown-row-${pId}`) as HTMLElement | null
            : null;
          if (subRow) subRow.style.display = 'none';
        } else {
          this.expandedPlayerIds.add(pId);
          btn.textContent = '▲';
          const subRow = typeof this.containerEl?.querySelector === 'function'
            ? this.containerEl.querySelector(`#breakdown-row-${pId}`) as HTMLElement | null
            : null;
          if (subRow) subRow.style.display = 'table-row';
        }
      });
    });
  }

  public close(): void {
    if (this.overlayEl) {
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
  }
}
