import { Stadium } from '../core/entities/Stadium';
import { GameSnapshot } from '../core/game/GameState';
import { MatchPhase, toMatchPhase } from '../core/game/GameFSM';
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
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', () => this.handleResize());
    }
  }

  public clear(): void {
    this.ctx.fillStyle = '#1a2332';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  public resize(): void {
    this.handleResize();
  }

  public handleResize(): void {
    const dpr = typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1;
    const displayWidth = this.canvas.clientWidth || (typeof window !== 'undefined' ? window.innerWidth : 800);
    const displayHeight = this.canvas.clientHeight || (typeof window !== 'undefined' ? window.innerHeight : 600);

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
    const dpr = typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1;
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

    // 3. Render Match Status Banners (función pura del snapshot)
    this.drawOverlays(ctx, snapshot);

    ctx.restore();
  }

  public drawOverlays(ctx: CanvasRenderingContext2D, snapshot: GameSnapshot): void {
    const currentPhase: MatchPhase = snapshot.matchPhase !== undefined
      ? snapshot.matchPhase
      : toMatchPhase(snapshot.matchState);

    const subStateTimer = snapshot.subStateTimer ?? snapshot.countdownSeconds ?? 0;
    const targetTeam = snapshot.targetTeam ?? 0;
    const targetTeamColor = targetTeam === 1 ? '#ef4444' : (targetTeam === 2 ? '#38bdf8' : '#facc15');
    const winningTeam = targetTeam === 1 ? 'EQUIPO ROJO' : (targetTeam === 2 ? 'EQUIPO AZUL' : '');
    const winningTeamColor = targetTeam === 1 ? '#ef4444' : (targetTeam === 2 ? '#38bdf8' : '#f59e0b');

    ctx.save();

    // Renderizado gobernado estrictamente por el estado del snapshot
    switch (currentPhase) {
      case MatchPhase.GOAL_CELEBRATION: {
        const teamSuffix = targetTeam === 1 ? ' - EQUIPO ROJO' : (targetTeam === 2 ? ' - EQUIPO AZUL' : '');
        this.drawCenterBanner(ctx, `¡GOL!${teamSuffix}`, targetTeamColor);
        break;
      }
      case MatchPhase.COUNTDOWN:
        this.drawCountdownNumber(ctx, Math.ceil(subStateTimer)); // 3, 2, 1
        break;
      case MatchPhase.PAUSED:
        this.drawCenterBanner(ctx, 'PAUSA', '#ffffff');
        break;
      case MatchPhase.MATCH_ENDED: {
        const title = winningTeam ? `¡VICTORIA ${winningTeam}!` : '¡EMPATE!';
        this.drawCenterBanner(ctx, title, winningTeamColor);
        break;
      }
      case MatchPhase.PLAYING:
      case MatchPhase.STOPPED:
      default:
        // No renderizar banners superpuestos
        break;
    }

    ctx.restore();
  }

  public renderOverlayState(ctx: CanvasRenderingContext2D, snapshot: GameSnapshot): void {
    this.drawOverlays(ctx, snapshot);
  }

  public drawCenterBanner(ctxOrText: CanvasRenderingContext2D | string, textOrColor?: string, colorOrSubtext?: string, subtext?: string): void {
    let ctx: CanvasRenderingContext2D;
    let text: string;
    let color: string = '#facc15';
    let sub: string | undefined;

    if (typeof ctxOrText === 'string') {
      ctx = this.ctx;
      text = ctxOrText;
      if (textOrColor) color = textOrColor;
      if (colorOrSubtext) sub = colorOrSubtext;
    } else {
      ctx = ctxOrText;
      text = textOrColor || '';
      if (colorOrSubtext) color = colorOrSubtext;
      sub = subtext;
    }

    this.drawBannerBox(ctx, text, sub, color);
  }

  public drawCountdownNumber(ctxOrCount: CanvasRenderingContext2D | number, countNum?: number): void {
    const ctx = typeof ctxOrCount === 'number' ? this.ctx : ctxOrCount;
    const count = typeof ctxOrCount === 'number' ? ctxOrCount : (countNum ?? 0);
    const text = count > 0 ? count.toString() : '¡PLAY!';
    this.drawBigText(ctx, text, '#facc15');
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
}
