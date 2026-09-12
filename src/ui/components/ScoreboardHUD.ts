export class ScoreboardHUD {
  private redScoreEl: HTMLElement | null = null;
  private blueScoreEl: HTMLElement | null = null;
  private timerEl: HTMLElement | null = null;
  private pingEl: HTMLElement | null = null;
  private fpsEl: HTMLElement | null = null;

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

    this.fpsEl = document.getElementById('fpsValue');
    if (!this.fpsEl) {
      console.warn('[ScoreboardHUD] Element "#fpsValue" was not found in DOM.');
    }
  }

  public update(redScore: number, blueScore: number, timerSeconds: number): void {
    if (this.redScoreEl) this.redScoreEl.textContent = redScore.toString();
    if (this.blueScoreEl) this.blueScoreEl.textContent = blueScore.toString();

    if (this.timerEl) {
      const mins = Math.floor(timerSeconds / 60);
      const secs = timerSeconds % 60;
      this.timerEl.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
  }

  public updateStats(pingMs: number, fps: number): void {
    if (this.pingEl) this.pingEl.textContent = `${Math.round(pingMs)}ms`;
    if (this.fpsEl) this.fpsEl.textContent = `${Math.round(fps)} FPS`;
  }
}
