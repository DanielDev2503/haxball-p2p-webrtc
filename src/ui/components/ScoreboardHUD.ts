import { $score, $timer, $ping, $theme, toggleTheme } from '../stores/gameStore';
import { renderIconHTML, renderIcon, Timer, Wifi, Sun, Moon } from '../utils/icons';

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

  constructor() {
    this.capsuleEl = (document.querySelector('.scoreboard-capsule') || document.querySelector('.scoreboard')) as HTMLElement | null;
    this.hudContainerEl = document.querySelector('.hud-container') as HTMLElement | null;
    this.matchClockContainerEl = document.querySelector('.match-clock-container') as HTMLElement | null;
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

    this.pingDotEl = document.getElementById('pingDot') || document.querySelector('.stat-dot') as HTMLElement | null;

    this.fpsEl = document.getElementById('fpsValue');
    if (!this.fpsEl) {
      console.warn('[ScoreboardHUD] Element "#fpsValue" was not found in DOM.');
    }

    // Inicializar tokens y estilos base de ScoreboardHUD
    this.applyTheme($theme.get());

    // Botón Switch de Modo Oscuro / Claro en el HUD superior
    const themeBtn = document.getElementById('theme-toggle-btn');
    if (themeBtn) {
      themeBtn.addEventListener('click', () => {
        toggleTheme();
      });

      this.unsubs.push(
        $theme.subscribe((theme) => {
          const isDark = theme === 'dark';
          themeBtn.innerHTML = '';
          renderIcon(themeBtn, isDark ? Sun : Moon, { width: 16, height: 16, stroke: isDark ? '#F59E0B' : '#0284C7' });
          themeBtn.title = isDark ? 'Cambiar a Modo Claro' : 'Cambiar a Modo Oscuro';
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

      // Variantes reactivas de Tailwind v4 y tokens solicitados:
      // Modo Claro: bg-slate-900/10 border-slate-900/15 text-slate-800 backdrop-blur-md
      // Modo Oscuro: dark:bg-slate-950/70 dark:border-cyan-500/20 dark:text-slate-100 backdrop-blur-md dark:shadow-[0_4px_20px_rgba(0,229,255,0.08)]
      const lightTokens = ['bg-slate-900/10', 'border-slate-900/15', 'text-slate-800', 'backdrop-blur-md'];
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

  public update(redScore: number, blueScore: number, timerSeconds: number, isGoldenGoal?: boolean): void {
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
      if (isGoldenGoal) {
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
