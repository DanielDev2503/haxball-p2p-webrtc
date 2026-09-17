import { Stadium } from '../core/entities/Stadium';
import { GameSnapshot } from '../core/game/GameState';
import { MatchPhase, toMatchPhase } from '../core/game/GameFSM';
import { PitchRenderer } from './PitchRenderer';
import { DiscRenderer } from './DiscRenderer';
import gsap from 'gsap';
import confetti from 'canvas-confetti';

export class CanvasRenderer {
  public canvas: HTMLCanvasElement;
  public ctx: CanvasRenderingContext2D;
  public stadium: Stadium;
  public pitchRenderer: PitchRenderer;
  public discRenderer: DiscRenderer;

  public scale: number = 1;
  public offsetX: number = 0;
  public offsetY: number = 0;

  // Transformación de cámara y sacudón elástico con GSAP
  public cameraOffset: { x: number; y: number } = { x: 0, y: 0 };
  private lastCelebrationPhase: MatchPhase | null = null;

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
    this.ctx.fillStyle = '#E0F2FE';
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

  /**
   * Micro-sacudón de cámara de 150ms con decaimiento elástico en impactos de postes o choques fuertes
   */
  public triggerPostHitShake(): void {
    try {
      gsap.fromTo(
        this.cameraOffset,
        { x: -3, y: 3 },
        { x: 0, y: 0, duration: 0.15, ease: 'power2.out' }
      );
    } catch {
      this.cameraOffset.x = 0;
      this.cameraOffset.y = 0;
    }
  }

  /**
   * Dispara una ráfaga cinética de confeti con los colores del equipo anotador y blanco glacial
   */
  public triggerCelebrationConfetti(targetTeam: number): void {
    if (typeof window === 'undefined') return;
    try {
      const scoringColor = targetTeam === 1 ? '#FF0055' : (targetTeam === 2 ? '#00E5FF' : '#00E599');
      confetti({
        particleCount: 75,
        spread: 75,
        origin: { y: 0.6 },
        colors: [scoringColor, '#FFFFFF', '#00C2FF']
      });
    } catch {
      // Ignorar en pruebas sin DOM completo
    }
  }

  public render(snapshot: GameSnapshot, localDiscId?: number | null): void {
    const dpr = typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1;
    const ctx = this.ctx;

    ctx.save();
    // Fondo perimetral técnico Futurism Aero (Cielo Luminoso #E0F2FE)
    ctx.fillStyle = '#E0F2FE';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // Transformaciones High-DPI, Centrado y Desplazamiento de Cámara GSAP
    ctx.scale(dpr, dpr);
    ctx.translate(this.offsetX + this.cameraOffset.x, this.offsetY + this.cameraOffset.y);
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
    const targetTeamColor = targetTeam === 1 ? '#FF0055' : (targetTeam === 2 ? '#00E5FF' : '#00E599');
    const winningTeam = targetTeam === 1 ? 'EQUIPO ROJO' : (targetTeam === 2 ? 'EQUIPO AZUL' : '');
    const winningTeamColor = targetTeam === 1 ? '#FF0055' : (targetTeam === 2 ? '#00E5FF' : '#00E599');

    // Detección de transición para disparo de confeti
    if (currentPhase === MatchPhase.GOAL_CELEBRATION || currentPhase === MatchPhase.MATCH_ENDED) {
      if (this.lastCelebrationPhase !== currentPhase) {
        this.lastCelebrationPhase = currentPhase;
        this.triggerCelebrationConfetti(targetTeam);
      }
    } else {
      this.lastCelebrationPhase = null;
    }

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
        this.drawPauseOverlay(ctx);
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
    let color: string = '#00E599';
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
    this.drawBigText(ctx, text, '#00E599');
  }

  private drawBigText(ctx: CanvasRenderingContext2D, text: string, color: string): void {
    ctx.save();
    ctx.font = '900 70px "Zen Dots", "Inter", "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Halo neón reactivo
    ctx.shadowColor = color;
    ctx.shadowBlur = 18;

    // Sombra de contraste
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillText(text, 0, -20 + 4);

    // Contorno oscuro
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 6;
    ctx.strokeText(text, 0, -20);

    // Relleno de texto neón
    ctx.fillStyle = color;
    ctx.fillText(text, 0, -20);
    ctx.restore();
  }

  private drawBannerBox(ctx: CanvasRenderingContext2D, text: string, subtext?: string, color: string = '#00E599'): void {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Medición de texto con Zen Dots para dimensionar caja aero
    ctx.font = '900 38px "Zen Dots", "Inter", sans-serif';
    const textMetrics = ctx.measureText(text);
    let bannerWidth = Math.max(textMetrics.width + 64, 280);

    if (subtext) {
      ctx.font = '600 16px "Inter", sans-serif';
      const subMetrics = ctx.measureText(subtext);
      bannerWidth = Math.max(bannerWidth, subMetrics.width + 48);
    }

    const bannerHeight = subtext ? 96 : 72;
    const yOffset = -20;

    // Fondo de cristal blanco aero con resplandor neón reactivo
    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.shadowColor = color;
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 2;

    ctx.beginPath();
    ctx.roundRect(-bannerWidth / 2, yOffset - bannerHeight / 2, bannerWidth, bannerHeight, 16);
    ctx.fill();

    // Borde de cristal reactivo
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Texto de título principal
    ctx.font = '900 38px "Zen Dots", "Inter", sans-serif';
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
    const titleY = subtext ? yOffset - 14 : yOffset;
    ctx.fillText(text, 0, titleY);

    // Subtexto opcional
    if (subtext) {
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.font = '600 15px "Inter", sans-serif';
      ctx.fillStyle = '#475569';
      ctx.fillText(subtext, 0, yOffset + 22);
    }

    ctx.restore();
  }

  /**
   * Renderiza el banner de pausa Aero de alto contraste sobre el campo blanco glacial.
   */
  private drawPauseOverlay(ctx: CanvasRenderingContext2D): void {
    ctx.save();

    // 1. Fondo de cristal oscuro translúcido que cubre todo el campo
    const width = (this.stadium.halfWidth + this.stadium.goalDepth + 30) * 2;
    const height = (this.stadium.halfHeight + 30) * 2;
    ctx.fillStyle = 'rgba(15, 23, 42, 0.65)';
    ctx.fillRect(-width / 2, -height / 2, width, height);

    // 2. Medición de texto y dimensionamiento de la tarjeta
    const title = 'PARTIDO PAUSADO';
    const subtitle = 'Presiona P o usa el menú de administrador para reanudar';

    ctx.font = '900 36px "Zen Dots", "Inter", sans-serif';
    const titleMetrics = ctx.measureText(title);

    ctx.font = '600 15px "Zen Dots", "Inter", sans-serif';
    const subMetrics = ctx.measureText(subtitle);

    const cardWidth = Math.max(titleMetrics.width, subMetrics.width) + 64;
    const cardHeight = 112;
    const yOffset = -15;

    // 3. Tarjeta central redondeada con borde blanco neón (#FFFFFF) y sombra azul cielo
    ctx.save();
    ctx.shadowColor = 'rgba(0, 229, 255, 0.6)';
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 2;

    ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
    ctx.beginPath();
    ctx.roundRect(-cardWidth / 2, yOffset - cardHeight / 2, cardWidth, cardHeight, 18);
    ctx.fill();

    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.restore();

    // 4. Texto en Zen Dots:
    // Título: "PARTIDO PAUSADO" en blanco puro (#FFFFFF) con brillo exterior en Azul Neón (#00E5FF)
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '900 36px "Zen Dots", "Inter", sans-serif';
    ctx.shadowColor = '#00E5FF';
    ctx.shadowBlur = 16;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(title, 0, yOffset - 18);

    // Subtítulo: "Presiona P o usa el menú de administrador para reanudar" en gris perla (#E2E8F0)
    ctx.font = '600 15px "Zen Dots", "Inter", sans-serif';
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#E2E8F0';
    ctx.fillText(subtitle, 0, yOffset + 24);

    ctx.restore();
  }
}

