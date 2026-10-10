import { PlayerMatchStats } from '../../core/game/GameState';

export interface MatchStatsPanelEvents {
  onClose?: () => void;
  onSlideToMenu?: () => void;
}

export class MatchStatsPanel {
  private overlayEl: HTMLElement | null = null;
  private containerEl: HTMLElement | null = null;
  private closeBtn: HTMLButtonElement | null = null;
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
      overlay.className = 'sliding-panels-container modal-backdrop modal-overlay';
      overlay.style.position = 'fixed';
      overlay.style.inset = '0';
      overlay.style.backgroundColor = 'rgba(15, 23, 42, 0.75)';
      overlay.style.backdropFilter = 'blur(8px)';
      overlay.style.display = 'none';
      overlay.style.justifyContent = 'center';
      overlay.style.alignItems = 'center';
      overlay.style.zIndex = '10005';
      overlay.style.padding = '16px';
      overlay.style.boxSizing = 'border-box';
      overlay.style.overflow = 'hidden';
      document.body.appendChild(overlay);
    }
    this.overlayEl = overlay;

    let content = overlay.querySelector('.match-stats-card') as HTMLElement | null;
    if (!content) {
      content = document.createElement('div');
      content.className = 'match-stats-card sliding-panel panel-center modal-container custom-scrollbar';
      content.style.maxWidth = '680px';
      content.style.width = '100%';
      content.style.backgroundColor = 'rgba(15, 23, 42, 0.95)';
      content.style.border = '1.5px solid rgba(14, 165, 233, 0.35)';
      content.style.boxShadow = '0 20px 50px rgba(0, 0, 0, 0.6), 0 0 30px rgba(14, 165, 233, 0.15)';
      content.style.borderRadius = '16px';
      content.style.padding = '24px';
      content.style.color = '#F8FAFC';
      content.style.fontFamily = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
      content.style.maxHeight = '90vh';
      content.style.overflowY = 'auto';
      overlay.appendChild(content);
    }
    this.containerEl = content;

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        this.close();
      }
    });
  }

  public isOpen(): boolean {
    return this._isOpen;
  }

  public slideToLeft(): void {
    if (this.containerEl) {
      this.containerEl.classList?.remove?.('panel-center', 'panel-right');
      this.containerEl.classList?.add?.('panel-left');
    }
  }

  public slideToCenter(): void {
    if (!this.overlayEl || !this.containerEl) {
      this.buildDOM();
    }
    if (this.overlayEl) {
      this.overlayEl.style.display = 'flex';
      this.overlayEl.style.pointerEvents = 'auto';
    }
    if (this.containerEl) {
      this.containerEl.classList?.remove?.('panel-left', 'panel-right');
      this.containerEl.classList?.add?.('panel-center');
    }
    this._isOpen = true;
  }

  public slideToRight(): void {
    if (this.containerEl) {
      this.containerEl.classList?.remove?.('panel-center', 'panel-left');
      this.containerEl.classList?.add?.('panel-right');
    }
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

    let rowsHtml = '';
    if (sortedStats.length === 0) {
      rowsHtml = `
        <tr>
          <td colspan="8" style="text-align: center; padding: 24px; color: #94A3B8; font-size: 0.9rem;">
            No se registraron estadísticas de juego en este partido.
          </td>
        </tr>
      `;
    } else {
      sortedStats.forEach((p, index) => {
        const isMvp = p.playerId === calculatedMvpId;
        const rank = index + 1;
        const isRed = p.team === 'red' || (p.team as any) === 1;
        const isBlue = p.team === 'blue' || (p.team as any) === 2;
        const teamColor = isRed ? '#EF4444' : isBlue ? '#3B82F6' : '#94A3B8';
        const teamBadge = isRed ? 'RED' : isBlue ? 'BLUE' : 'SPEC';
        const playerDisplayName = p.playerName || p.nickname || 'Jugador';
        const totalPointsVal = p.totalPoints ?? p.points;
        const isExpanded = this.expandedPlayerIds.has(p.playerId);

        const rowBg = isMvp
          ? 'linear-gradient(90deg, rgba(234, 179, 8, 0.18) 0%, rgba(234, 179, 8, 0.05) 100%)'
          : index % 2 === 0
            ? 'rgba(30, 41, 59, 0.4)'
            : 'rgba(15, 23, 42, 0.2)';

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

        rowsHtml += `
          <tr style="background: ${rowBg}; ${borderStyle} transition: background 0.15s ease;">
            <td style="padding: 10px 10px; font-weight: 700; color: ${isMvp ? '#FDE047' : '#94A3B8'}; width: 36px; text-align: center;">
              ${isMvp ? '👑' : `#${rank}`}
            </td>
            <td style="padding: 10px 10px; font-weight: 600; display: flex; align-items: center; gap: 8px;">
              <span style="font-size: 0.68rem; font-weight: 800; padding: 2px 6px; border-radius: 4px; background: ${teamColor}22; color: ${teamColor}; border: 1px solid ${teamColor}55;">
                ${teamBadge}
              </span>
              <span style="color: ${isMvp ? '#FEF08A' : '#F1F5F9'}; font-weight: ${isMvp ? '700' : '500'};">
                ${playerDisplayName}
              </span>
              ${isMvp ? '<span style="font-size: 0.72rem; font-weight: 800; background: #EAB308; color: #78350F; padding: 1px 6px; border-radius: 9999px;">MVP</span>' : ''}
            </td>
            <td style="padding: 10px 10px; text-align: right; font-weight: 800; color: #38BDF8; font-size: 0.95rem;">
              ${totalPointsVal}
            </td>
            <td style="padding: 10px 8px; text-align: center; color: #F8FAFC;">
              ${p.goals}
            </td>
            <td style="padding: 10px 8px; text-align: center; color: #F8FAFC;">
              ${p.assists}
            </td>
            <td style="padding: 10px 8px; text-align: center; color: #F8FAFC;">
              ${p.passes}
            </td>
            <td style="padding: 10px 8px; text-align: center; color: #F8FAFC;">
              ${p.saves}
            </td>
            <td style="padding: 10px 8px; text-align: center; width: 36px;">
              <button class="accordion-toggle-btn" data-player-id="${p.playerId}" title="Desglose detallado">
                ${isExpanded ? '▲' : '▼'}
              </button>
            </td>
          </tr>
          <tr id="breakdown-row-${p.playerId}" style="display: ${isExpanded ? 'table-row' : 'none'}; background: rgba(15, 23, 42, 0.75);">
            <td colspan="8" style="padding: 0;">
              <div class="player-breakdown-panel">
                <div class="breakdown-item">
                  <span class="breakdown-label">Toques:</span>
                  <span class="breakdown-val">${p.touches}</span>
                  <span class="breakdown-pts">+${touchesPts}</span>
                </div>
                <div class="breakdown-item">
                  <span class="breakdown-label">Pases:</span>
                  <span class="breakdown-val">${p.passes}</span>
                  <span class="breakdown-pts">+${passesPts}</span>
                </div>
                <div class="breakdown-item">
                  <span class="breakdown-label">Tiros normal:</span>
                  <span class="breakdown-val">${shotsNorm}</span>
                  <span class="breakdown-pts">+${shotsNormPts}</span>
                </div>
                <div class="breakdown-item">
                  <span class="breakdown-label">Tiros curva/pot.:</span>
                  <span class="breakdown-val">${shotsCurve}</span>
                  <span class="breakdown-pts">+${shotsCurvePts}</span>
                </div>
                <div class="breakdown-item">
                  <span class="breakdown-label">Asist. normal:</span>
                  <span class="breakdown-val">${assistsNorm}</span>
                  <span class="breakdown-pts">+${assistsNormPts}</span>
                </div>
                <div class="breakdown-item">
                  <span class="breakdown-label">Asist. curva:</span>
                  <span class="breakdown-val">${assistsCurve}</span>
                  <span class="breakdown-pts">+${assistsCurvePts}</span>
                </div>
                <div class="breakdown-item">
                  <span class="breakdown-label">Atajadas:</span>
                  <span class="breakdown-val">${p.saves}</span>
                  <span class="breakdown-pts">+${savesPts}</span>
                </div>
                <div class="breakdown-item">
                  <span class="breakdown-label">Goles:</span>
                  <span class="breakdown-val">${p.goals}</span>
                  <span class="breakdown-pts">+${goalsPts}</span>
                </div>
                <div class="breakdown-item">
                  <span class="breakdown-label">Hattrick bonus:</span>
                  <span class="breakdown-val">${p.hasHattrickBonus ? 'Sí' : 'No'}</span>
                  <span class="breakdown-pts">+${hattrickPts}</span>
                </div>
                <div class="breakdown-item" style="border-left: 1px solid rgba(56, 189, 248, 0.4); padding-left: 8px;">
                  <span class="breakdown-label" style="font-weight: 700; color: #38BDF8;">Total:</span>
                  <span class="breakdown-pts" style="font-size: 0.9rem;">${exactCalcTotal} pts</span>
                </div>
              </div>
            </td>
          </tr>
        `;
      });
    }

    const mvpBannerHtml = mvpPlayer
      ? `
      <div style="background: linear-gradient(135deg, rgba(234, 179, 8, 0.2) 0%, rgba(202, 138, 4, 0.08) 100%); border: 1.5px solid rgba(234, 179, 8, 0.4); border-radius: 12px; padding: 14px 18px; margin-bottom: 20px; display: flex; align-items: center; justify-content: space-between; box-shadow: 0 4px 20px rgba(234, 179, 8, 0.1);">
        <div style="display: flex; align-items: center; gap: 14px;">
          <div style="font-size: 2.2rem; filter: drop-shadow(0 0 10px rgba(234, 179, 8, 0.6));">👑</div>
          <div>
            <div style="font-size: 0.72rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; color: #FDE047;">Jugador Más Valioso (MVP)</div>
            <div style="font-size: 1.25rem; font-weight: 800; color: #FFFFFF;">${mvpPlayer.playerName || mvpPlayer.nickname || 'Jugador'}</div>
          </div>
        </div>
        <div style="text-align: right;">
          <div style="font-size: 1.4rem; font-weight: 900; color: #FDE047; font-family: 'Zen Dots', 'Inter', monospace;">${mvpPlayer.totalPoints ?? mvpPlayer.points} <span style="font-size: 0.8rem; font-weight: 600;">pts</span></div>
          <div style="font-size: 0.75rem; color: #CBD5E1;">${mvpPlayer.goals} goles • ${mvpPlayer.assists} asistencias • ${mvpPlayer.saves} atajadas</div>
        </div>
      </div>
    `
      : '';

    this.containerEl.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
        <div style="display: flex; align-items: center; gap: 10px;">
          <span style="font-size: 1.5rem;">📊</span>
          <h2 style="margin: 0; font-size: 1.3rem; font-weight: 800; letter-spacing: -0.01em; color: #F8FAFC;">
            Estadísticas del Partido
          </h2>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <button id="btnSlideToMenu" class="sliding-tab-btn" title="Ir al Menú / Lobby de la sala">Menú →</button>
          <button id="btnCloseMatchStats" class="icon-btn-close" style="background: none; border: none; font-size: 1.2rem; color: #94A3B8; cursor: pointer; padding: 4px 8px; border-radius: 6px;">✕</button>
        </div>
      </div>

      ${mvpBannerHtml}

      <div style="border: 1px solid rgba(14, 165, 233, 0.2); border-radius: 10px; overflow: hidden; margin-bottom: 20px;">
        <table style="width: 100%; border-collapse: collapse; font-size: 0.84rem;">
          <thead>
            <tr style="background: rgba(15, 23, 42, 0.85); border-bottom: 1.5px solid rgba(14, 165, 233, 0.25); color: #94A3B8; text-transform: uppercase; font-size: 0.72rem; letter-spacing: 0.05em;">
              <th style="padding: 10px 10px; text-align: center; width: 36px;">#</th>
              <th style="padding: 10px 10px; text-align: left;">Jugador</th>
              <th style="padding: 10px 10px; text-align: right; color: #38BDF8;">Puntos</th>
              <th style="padding: 10px 8px; text-align: center;">Goles</th>
              <th style="padding: 10px 8px; text-align: center;">Asist.</th>
              <th style="padding: 10px 8px; text-align: center;">Pases</th>
              <th style="padding: 10px 8px; text-align: center;">Atajadas</th>
              <th style="padding: 10px 8px; text-align: center; width: 36px;">▼</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </div>

      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span style="font-size: 0.78rem; color: #94A3B8;">Haz clic en ▼ para ver el desglose matemático de puntos.</span>
        <div style="display: flex; gap: 10px;">
          <button id="btnDismissMatchStats" class="btn btn-primary" style="padding: 8px 24px; font-weight: 700; border-radius: 8px; cursor: pointer;">
            Continuar
          </button>
        </div>
      </div>
    `;

    this.closeBtn = typeof this.containerEl.querySelector === 'function'
      ? this.containerEl.querySelector('#btnCloseMatchStats')
      : null;
    this.slideToMenuBtn = typeof this.containerEl.querySelector === 'function'
      ? this.containerEl.querySelector('#btnSlideToMenu')
      : null;
    const dismissBtn = typeof this.containerEl.querySelector === 'function'
      ? this.containerEl.querySelector('#btnDismissMatchStats')
      : null;

    this.closeBtn?.addEventListener?.('click', () => this.close());
    dismissBtn?.addEventListener?.('click', () => this.close());

    this.slideToMenuBtn?.addEventListener?.('click', () => {
      this.slideToLeft();
      if (this.onSlideToMenu) {
        this.onSlideToMenu();
      } else {
        this.events.onSlideToMenu?.();
      }
    });

    // Delegación o listeners para acordeones desplegables
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
