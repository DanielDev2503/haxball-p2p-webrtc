import { Stadium } from '../core/entities/Stadium';
import { GameSnapshot } from '../core/game/GameState';
import { MatchState } from '../core/game/GameFSM';
import { PitchRenderer } from './PitchRenderer';
import { DiscRenderer } from './DiscRenderer';

export interface CanvasBanner {
  text: string;
  subtext?: string;
  color: string;
  expiresAt: number;
}

export class CanvasRenderer {
  public canvas: HTMLCanvasElement;
  public ctx: CanvasRenderingContext2D;
  public stadium: Stadium;
  public pitchRenderer: PitchRenderer;
  public discRenderer: DiscRenderer;

  public scale: number = 1;
  public offsetX: number = 0;
  public offsetY: number = 0;

  // Visual effects & banners
  public bannerText: string = '';
  public bannerColor: string = '#ffffff';
  public activeBanner: CanvasBanner | null = null;

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

  public setBanner(text: string, subtext?: string, color: string = '#facc15', durationMs: number = 3000): void {
    const expiresAt = durationMs > 0 ? performance.now() + durationMs : Infinity;
    this.activeBanner = { text, subtext, color, expiresAt };
  }

  public clearBanner(): void {
    this.activeBanner = null;
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

    // 1. Banner activo sincronizado (¡GOL!, ¡VICTORIA!, aviso especial)
    if (this.activeBanner) {
      if (performance.now() > this.activeBanner.expiresAt) {
        this.activeBanner = null;
      } else {
        this.drawBannerBox(ctx, this.activeBanner.text, this.activeBanner.subtext, this.activeBanner.color);
        ctx.restore();
        return;
      }
    }

    // 2. Overlays según estado de partido
    if (snapshot.matchState === 'STOPPED') {
      this.drawPillBanner(ctx, 'PARTIDO DETENIDO', '#94a3b8');
    } else if (snapshot.matchState === 'PAUSED') {
      this.drawBannerBox(ctx, 'PAUSA', 'Partido pausado por el Administrador', '#f59e0b');
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

  private drawBannerBox(ctx: CanvasRenderingContext2D, text: string, subtext?: string, color: string = '#facc15'): void {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Medición de texto para dimensionar caja
    ctx.font = '900 44px "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    const textMetrics = ctx.measureText(text);
    let bannerWidth = Math.max(textMetrics.width + 60, 260);

    if (subtext) {
      ctx.font = '600 16px "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      const subMetrics = ctx.measureText(subtext);
      bannerWidth = Math.max(bannerWidth, subMetrics.width + 48);
    }

    const bannerHeight = subtext ? 92 : 68;
    const yOffset = -20;

    // Fondo oscuro con sombra
    ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
    ctx.shadowBlur = 16;
    ctx.shadowOffsetY = 4;

    ctx.beginPath();
    ctx.roundRect(-bannerWidth / 2, yOffset - bannerHeight / 2, bannerWidth, bannerHeight, 12);
    ctx.fill();

    // Borde de acento
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Texto de título principal
    ctx.font = '900 42px "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillStyle = color;
    const titleY = subtext ? yOffset - 14 : yOffset;
    ctx.fillText(text, 0, titleY);

    // Subtexto opcional
    if (subtext) {
      ctx.font = '600 15px "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.fillStyle = '#cbd5e1';
      ctx.fillText(subtext, 0, yOffset + 20);
    }

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
