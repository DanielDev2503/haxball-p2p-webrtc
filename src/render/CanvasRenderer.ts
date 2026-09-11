import { Stadium } from '../core/entities/Stadium';
import { GameSnapshot } from '../core/game/GameState';
import { MatchState } from '../core/game/GameFSM';
import { PitchRenderer } from './PitchRenderer';
import { DiscRenderer } from './DiscRenderer';

export class CanvasRenderer {
  public canvas: HTMLCanvasElement;
  public ctx: CanvasRenderingContext2D;
  public stadium: Stadium;
  public pitchRenderer: PitchRenderer;
  public discRenderer: DiscRenderer;

  public scale: number = 1;
  public offsetX: number = 0;
  public offsetY: number = 0;

  // Visual effects
  public bannerText: string = '';
  public bannerColor: string = '#ffffff';

  constructor(canvas: HTMLCanvasElement, stadium: Stadium) {
    this.canvas = canvas;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) {
      throw new Error('Failed to get 2D context from canvas');
    }
    this.ctx = context;
    this.stadium = stadium;
    this.pitchRenderer = new PitchRenderer();
    this.discRenderer = new DiscRenderer();

    this.handleResize();
    window.addEventListener('resize', () => this.handleResize());
  }

  public handleResize(): void {
    const dpr = window.devicePixelRatio || 1;
    const displayWidth = this.canvas.clientWidth || window.innerWidth;
    const displayHeight = this.canvas.clientHeight || window.innerHeight;

    this.canvas.width = Math.round(displayWidth * dpr);
    this.canvas.height = Math.round(displayHeight * dpr);

    // Compute scale to fit stadium + margin
    const totalStadiumWidth = (this.stadium.halfWidth + this.stadium.goalDepth + 30) * 2;
    const totalStadiumHeight = (this.stadium.halfHeight + 30) * 2;

    const scaleX = (this.canvas.width / dpr) / totalStadiumWidth;
    const scaleY = (this.canvas.height / dpr) / totalStadiumHeight;
    this.scale = Math.min(scaleX, scaleY);

    this.offsetX = (this.canvas.width / dpr) / 2;
    this.offsetY = (this.canvas.height / dpr) / 2;
  }

  public render(snapshot: GameSnapshot, localDiscId?: number | null): void {
    const dpr = window.devicePixelRatio || 1;
    const ctx = this.ctx;

    ctx.save();
    // Clear whole screen with dark stadium boundary background
    ctx.fillStyle = '#1a2332';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // Apply High-DPI and Center-Zoom transformations
    ctx.scale(dpr, dpr);
    ctx.translate(this.offsetX, this.offsetY);
    ctx.scale(this.scale, this.scale);

    // 1. Render Pitch geometry & posts
    this.pitchRenderer.render(ctx, this.stadium);

    // 2. Render Discs (ball & players)
    this.discRenderer.render(ctx, snapshot.discs, localDiscId);

    // 3. Render Match Status Banners
    this.renderOverlayState(ctx, snapshot);

    ctx.restore();
  }

  private renderOverlayState(ctx: CanvasRenderingContext2D, snapshot: GameSnapshot): void {
    ctx.save();

    if (snapshot.matchState === 'STOPPED') {
      this.drawPillBanner(ctx, 'PARTIDO DETENIDO', '#94a3b8');
    } else if (snapshot.matchState === 'PAUSED') {
      this.drawBigText(ctx, 'PAUSA', '#f59e0b');
    } else if (snapshot.matchState === 'COUNTDOWN') {
      const count = snapshot.countdownSeconds ?? 3;
      const text = count > 0 ? count.toString() : '¡PLAY!';
      this.drawBigText(ctx, text, '#facc15');
    }

    ctx.restore();
  }

  private drawBigText(ctx: CanvasRenderingContext2D, text: string, color: string): void {
    ctx.save();
    ctx.font = '900 72px "Inter", "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillText(text, 0, -20 + 4);

    // Black stroke outline for high contrast
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 6;
    ctx.strokeText(text, 0, -20);

    // Text fill
    ctx.fillStyle = color;
    ctx.fillText(text, 0, -20);
    ctx.restore();
  }


  private drawPillBanner(ctx: CanvasRenderingContext2D, text: string, color: string): void {
    ctx.save();
    ctx.font = 'bold 20px "Inter", "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const metrics = ctx.measureText(text);
    const paddingX = 24;
    const w = metrics.width + paddingX * 2;
    const h = 40;

    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.beginPath();
    ctx.roundRect(-w / 2, -h / 2, w, h, 20);
    ctx.fill();

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = color;
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }
}
