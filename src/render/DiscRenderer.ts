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

    // 1. Sombra Difusa Proyectada sobre el Césped Blanco
    ctx.fillStyle = 'rgba(15, 23, 42, 0.22)';
    ctx.beginPath();
    if (typeof (ctx as any).ellipse === 'function') {
      ctx.ellipse(x + 1.5, y + radius * 0.45, radius * 0.95, radius * 0.55, 0, 0, Math.PI * 2);
    } else {
      ctx.arc(x + 1.5, y + 3, radius, 0, Math.PI * 2);
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
    grad.addColorStop(0, '#FFFFFF'); // Reflejo especular brillante
    grad.addColorStop(0.35, '#F8FAFC');
    grad.addColorStop(0.7, '#CBD5E1');
    grad.addColorStop(1, '#94A3B8');

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();

    // 3. Contorno Técnico Aero Nítido
    ctx.strokeStyle = '#0284C7';
    ctx.lineWidth = 1.4;
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
    const neonGlow = isRed ? 'rgba(255, 0, 85, 0.5)' : 'rgba(0, 229, 255, 0.5)';

    ctx.save();

    // 1. Anillo de Pulso Expansivo Blanco al Activar Patada (Kick)
    if (kicking) {
      ctx.save();
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 3.5;
      ctx.shadowColor = '#FFFFFF';
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(x, y, radius + 5.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // 2. Sombra Elíptica Proyectada sobre el Césped Glacial
    ctx.fillStyle = 'rgba(15, 23, 42, 0.2)';
    ctx.beginPath();
    ctx.arc(x + 2, y + 3, radius, 0, Math.PI * 2);
    ctx.fill();

    // 3. Gradiente Radial Analítico simulando Esfera Esmaltada con Núcleo Neón
    const grad = ctx.createRadialGradient(
      x - radius * 0.35,
      y - radius * 0.35,
      radius * 0.05,
      x,
      y,
      radius
    );

    if (isRed) {
      grad.addColorStop(0, '#FFFFFF'); // Brillo especular
      grad.addColorStop(0.2, '#FF4D88');
      grad.addColorStop(0.65, '#FF0055');
      grad.addColorStop(1, '#990033');
    } else {
      grad.addColorStop(0, '#FFFFFF'); // Brillo especular
      grad.addColorStop(0.2, '#4DEFFF');
      grad.addColorStop(0.65, '#00E5FF');
      grad.addColorStop(1, '#007A99');
    }

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();

    // 4. Anillo Exterior Neón con Resplandor Perimetral para Alto Contraste
    ctx.save();
    ctx.strokeStyle = neonColor;
    ctx.lineWidth = 2.4;
    ctx.shadowColor = neonGlow;
    ctx.shadowBlur = 9;
    ctx.beginPath();
    ctx.arc(x, y, radius - 0.6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // 5. Borde Interior Blanco Fino para Definición Especular
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(x, y, radius - 2.8, 0, Math.PI * 2);
    ctx.stroke();

    // 6. Avatar / Dorsal con Tipografía Zen Dots / Inter y Contorno Nítido
    if (avatar) {
      ctx.save();
      ctx.font = `bold ${Math.round(radius * 0.88)}px "Zen Dots", "Inter", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // Contorno oscuro para legibilidad absoluta
      ctx.strokeStyle = 'rgba(15, 23, 42, 0.7)';
      ctx.lineWidth = 2.5;
      ctx.strokeText(avatar, x, y + 1);

      // Texto blanco nítido
      ctx.fillStyle = '#FFFFFF';
      ctx.fillText(avatar, x, y + 1);
      ctx.restore();
    }

    // 7. Indicador del Jugador Local en Verde Neovital
    if (isLocal) {
      ctx.save();
      ctx.strokeStyle = '#00E599';
      ctx.lineWidth = 2.2;
      ctx.shadowColor = 'rgba(0, 229, 153, 0.7)';
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(x, y, radius + 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    ctx.restore();
  }
}

