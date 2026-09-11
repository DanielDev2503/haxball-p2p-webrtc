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
    // Drop shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.beginPath();
    ctx.arc(x + 2, y + 3, radius, 0, Math.PI * 2);
    ctx.fill();

    // 3D Sphere gradient
    const grad = ctx.createRadialGradient(
      x - radius * 0.3,
      y - radius * 0.3,
      1,
      x,
      y,
      radius
    );
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.7, '#e2e8f0');
    grad.addColorStop(1, '#94a3b8');

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();

    // Outline
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1.8;
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

    ctx.save();

    // 1. Kicking shockwave / halo ring
    if (kicking) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.lineWidth = 3.5;
      ctx.shadowColor = '#ffffff';
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(x, y, radius + 4.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.shadowBlur = 0; // reset
    }

    // 2. Drop shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.beginPath();
    ctx.arc(x + 3, y + 4, radius, 0, Math.PI * 2);
    ctx.fill();

    // 3. Disc body gradient
    const grad = ctx.createRadialGradient(
      x - radius * 0.3,
      y - radius * 0.3,
      2,
      x,
      y,
      radius
    );

    if (isRed) {
      grad.addColorStop(0, '#ff6b6b');
      grad.addColorStop(0.6, '#e74c3c');
      grad.addColorStop(1, '#c0392b');
    } else {
      grad.addColorStop(0, '#5dade2');
      grad.addColorStop(0.6, '#3498db');
      grad.addColorStop(1, '#2980b9');
    }

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();

    // 4. White inner border for classic Haxball look
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.2;
    ctx.stroke();

    // Outer dark rim
    ctx.strokeStyle = isRed ? '#962d22' : '#1b4f72';
    ctx.lineWidth = 1.0;
    ctx.stroke();

    // 5. Avatar / Player number text
    if (avatar) {
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold ${Math.round(radius * 0.95)}px "Inter", "Segoe UI", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(avatar, x, y + 1);
    }

    // 6. Local player indicator ring (subtle indicator)
    if (isLocal) {
      ctx.strokeStyle = 'rgba(255, 255, 0, 0.7)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, radius + 7, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.restore();
  }
}
