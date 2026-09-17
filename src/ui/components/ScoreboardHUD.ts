import { $score, $timer, $ping } from '../stores/gameStore';
import { renderIconHTML, Timer, Wifi } from '../utils/icons';

export class ScoreboardHUD {
  private redScoreEl: HTMLElement | null = null;
  private blueScoreEl: HTMLElement | null = null;
  private timerEl: HTMLElement | null = null;
  private pingEl: HTMLElement | null = null;
  private pingDotEl: HTMLElement | null = null;
  private fpsEl: HTMLElement | null = null;
  private unsubs: Array<() => void> = [];

  constructor() {
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

    this.pingEl = document.getElementById('pingValue');
    if (!this.pingEl) {
      console.warn('[ScoreboardHUD] Element "#pingValue" was not found in DOM.');
    }

    this.pingDotEl = document.getElementById('pingDot') || document.querySelector('.stat-dot') as HTMLElement | null;

    this.fpsEl = document.getElementById('fpsValue');
    if (!this.fpsEl) {
      console.warn('[ScoreboardHUD] Element "#fpsValue" was not found in DOM.');
    }

    // Inyectar iconos Lucide en ranuras reservadas del DOM si existen
    const clockSlot = document.getElementById('clockIconSlot');
    if (clockSlot && !clockSlot.innerHTML) {
      clockSlot.innerHTML = renderIconHTML(Timer, { width: 14, height: 14, stroke: '#00C2FF' });
    }

    const wifiSlot = document.getElementById('wifiIconSlot');
    if (wifiSlot && !wifiSlot.innerHTML) {
      wifiSlot.innerHTML = renderIconHTML(Wifi, { width: 14, height: 14, stroke: '#00C2FF' });
    }

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

  private updatePingDot(pingMs: number): void {
    if (!this.pingDotEl) return;
    this.pingDotEl.classList.remove('stat-dot--warning', 'stat-dot--danger');
    if (pingMs >= 120) {
      this.pingDotEl.classList.add('stat-dot--danger');
    } else if (pingMs >= 50) {
      this.pingDotEl.classList.add('stat-dot--warning');
    }
  }

  public update(redScore: number, blueScore: number, timerSeconds: number): void {
    const mins = Math.floor(timerSeconds / 60);
    const secs = timerSeconds % 60;
    const timeStr = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;

    // Sincronizar átomos en el almacén reactivo
    $score.set({ red: redScore, blue: blueScore });
    $timer.set(timeStr);

    // Actualización de nodo DOM directa para consistencia determinista y tests síncronos
    if (this.redScoreEl) this.redScoreEl.textContent = redScore.toString();
    if (this.blueScoreEl) this.blueScoreEl.textContent = blueScore.toString();
    if (this.timerEl) this.timerEl.textContent = timeStr;
  }

  public updateStats(pingMs: number, fps: number): void {
    $ping.set(pingMs);

    if (this.pingEl) this.pingEl.textContent = `${Math.round(pingMs)}ms`;
    if (this.fpsEl) this.fpsEl.textContent = `${Math.round(fps)} FPS`;
    this.updatePingDot(pingMs);
  }

  public destroy(): void {
    for (const unsub of this.unsubs) {
      unsub();
    }
    this.unsubs = [];
  }
}
