export class ScoreboardHUD {
  private redScoreEl: HTMLElement;
  private blueScoreEl: HTMLElement;
  private timerEl: HTMLElement;
  private pingEl: HTMLElement;
  private fpsEl: HTMLElement;

  constructor() {
    this.redScoreEl = document.getElementById('redScore')!;
    this.blueScoreEl = document.getElementById('blueScore')!;
    this.timerEl = document.getElementById('matchTimer')!;
    this.pingEl = document.getElementById('pingValue')!;
    this.fpsEl = document.getElementById('fpsValue')!;
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
