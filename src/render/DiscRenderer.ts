import { DiscSnapshot } from '../core/game/GameState';

export class DiscRenderer {
  public render(
    ctx: CanvasRenderingContext2D,
    discs: DiscSnapshot[],
    localDiscId?: number | null
  ): void {
    ctx.save();

    for (const disc of discs) {
      if (disc.team === 0) {
        this.renderBall(ctx, disc);
      } else {
        this.renderPlayer(ctx, disc, disc.id === localDiscId);
      }
    }

    ctx.restore();
  }

  private renderBall(ctx: CanvasRenderingContext2D, disc: DiscSnapshot): void {
    const { x, y, radius } = disc;

    ctx.save();

    // 1. Sombra Elíptica Proyectada sobre el Suelo
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.beginPath();
    if (typeof (ctx as any).ellipse === 'function') {
      ctx.ellipse(x + 2, y + radius * 0.35, radius * 0.95, radius * 0.5, 0, 0, Math.PI * 2);
    } else {
      ctx.arc(x + 2, y + 3, radius, 0, Math.PI * 2);
    }
    ctx.fill();

    // 2. Esfera Perlada Blanca con Gradiente Radial Analítico
    const grad = ctx.createRadialGradient(
      x - radius * 0.35,
      y - radius * 0.35,
      radius * 0.08,
      x,
      y,
      radius
    );
    grad.addColorStop(0, '#ffffff'); // Brillo especular
    grad.addColorStop(0.35, '#f8fafc');
    grad.addColorStop(0.75, '#cbd5e1');
    grad.addColorStop(1, '#94a3b8');

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();

    // 3. Contorno Técnico Nítido
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 1.6;
    ctx.stroke();

    ctx.restore();
  }

  private renderPlayer(
    ctx: CanvasRenderingContext2D,
    disc: DiscSnapshot,
    isLocal: boolean
  ): void {
    const { x, y, radius, team, avatar, kicking } = disc;
    const isRed = team === 1;
    const neonColor = isRed ? '#FF0055' : '#00E5FF';
    const neonGlow = isRed ? 'rgba(255, 0, 85, 0.45)' : 'rgba(0, 229, 255, 0.45)';

    ctx.save();

    // 1. Anillo de Pulso Expansivo Blanco al Activar Patada (Kick)
    if (kicking) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
      ctx.lineWidth = 3.5;
      ctx.shadowColor = '#ffffff';
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(x, y, radius + 5.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // 2. Sombra Elíptica Proyectada
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.beginPath();
    ctx.arc(x + 2.5, y + 3.5, radius, 0, Math.PI * 2);
    ctx.fill();

    // 3. Gradiente Radial Analítico simulando Esfera Esmaltada en 3D con Reflejo Especular
    const grad = ctx.createRadialGradient(
      x - radius * 0.35,
      y - radius * 0.35,
      radius * 0.05,
      x,
      y,
      radius
    );

    if (isRed) {
      grad.addColorStop(0, '#ffffff'); // Brillo especular
      grad.addColorStop(0.2, '#ff3377');
      grad.addColorStop(0.65, '#ff0055');
      grad.addColorStop(1, '#990033');
    } else {
      grad.addColorStop(0, '#ffffff'); // Brillo especular
      grad.addColorStop(0.2, '#33ecff');
      grad.addColorStop(0.65, '#00e5ff');
      grad.addColorStop(1, '#007a99');
    }

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();

    // 4. Anillo Exterior Neón con Resplandor Perimetral
    ctx.save();
    ctx.strokeStyle = neonColor;
    ctx.lineWidth = 2.2;
    ctx.shadowColor = neonGlow;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(x, y, radius - 0.8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // 5. Borde Interior Blanco Fino para Definición Especular
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(x, y, radius - 2.8, 0, Math.PI * 2);
    ctx.stroke();

    // 6. Avatar / Dorsal con Tipografía Zen Dots / Inter
    if (avatar) {
      ctx.save();
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold ${Math.round(radius * 0.9)}px "Zen Dots", "Inter", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
      ctx.shadowBlur = 3;
      ctx.fillText(avatar, x, y + 1);
      ctx.restore();
    }

    // 7. Indicador del Jugador Local en Verde Neovital
    if (isLocal) {
      ctx.save();
      ctx.strokeStyle = '#00E599';
      ctx.lineWidth = 2;
      ctx.shadowColor = 'rgba(0, 229, 153, 0.6)';
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.arc(x, y, radius + 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    ctx.restore();
  }
}
