import { Stadium } from '../core/entities/Stadium';

export class PitchRenderer {
  public render(ctx: CanvasRenderingContext2D, stadium: Stadium): void {
    const hw = stadium.halfWidth;
    const hh = stadium.halfHeight;
    const gh = stadium.goalHalfHeight;
    const gd = stadium.goalDepth;
    const cr = stadium.centerRadius;

    ctx.save();

    // 1. Stadium Pitch Background (Rich grass turf with stripes)
    const stripeCount = 14;
    const stripeWidth = (hw * 2) / stripeCount;
    for (let i = 0; i < stripeCount; i++) {
      ctx.fillStyle = i % 2 === 0 ? '#488a38' : '#427e33';
      ctx.fillRect(-hw + i * stripeWidth, -hh, stripeWidth, hh * 2);
    }

    // 2. Goal Nets (Left & Right)
    // Left net
    ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.fillRect(-(hw + gd), -gh, gd, gh * 2);
    this.renderNetMesh(ctx, -(hw + gd), -gh, gd, gh * 2);

    // Right net
    ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.fillRect(hw, -gh, gd, gh * 2);
    this.renderNetMesh(ctx, hw, -gh, gd, gh * 2);

    // 3. Pitch Lines (White crisp markings)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.lineWidth = 3.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Outer boundary
    ctx.beginPath();
    ctx.moveTo(-hw, -hh);
    ctx.lineTo(hw, -hh);
    ctx.lineTo(hw, -gh);
    ctx.lineTo(hw + gd, -gh);
    ctx.lineTo(hw + gd, gh);
    ctx.lineTo(hw, gh);
    ctx.lineTo(hw, hh);
    ctx.lineTo(-hw, hh);
    ctx.lineTo(-hw, gh);
    ctx.lineTo(-(hw + gd), gh);
    ctx.lineTo(-(hw + gd), -gh);
    ctx.lineTo(-hw, -gh);
    ctx.closePath();
    ctx.stroke();

    // Midfield Line
    ctx.beginPath();
    ctx.moveTo(0, -hh);
    ctx.lineTo(0, hh);
    ctx.stroke();

    // Center Circle
    ctx.beginPath();
    ctx.arc(0, 0, cr, 0, Math.PI * 2);
    ctx.stroke();

    // Center Spot
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.beginPath();
    ctx.arc(0, 0, 4, 0, Math.PI * 2);
    ctx.fill();

    // Goal Lines (Faint dotted or dashed goal entrance)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);

    ctx.beginPath();
    ctx.moveTo(-hw, -gh);
    ctx.lineTo(-hw, gh);
    ctx.moveTo(hw, -gh);
    ctx.lineTo(hw, gh);
    ctx.stroke();

    ctx.setLineDash([]); // Reset dash

    // 4. Goal Posts
    for (const post of stadium.posts) {
      this.renderPost(ctx, post.pos.x, post.pos.y, post.radius);
    }

    ctx.restore();
  }

  private renderNetMesh(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number
  ): void {
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.lineWidth = 1;
    const spacing = 12;

    ctx.beginPath();
    for (let lx = x; lx <= x + w; lx += spacing) {
      ctx.moveTo(lx, y);
      ctx.lineTo(lx, y + h);
    }
    for (let ly = y; ly <= y + h; ly += spacing) {
      ctx.moveTo(x, ly);
      ctx.lineTo(x + w, ly);
    }
    ctx.stroke();
    ctx.restore();
  }

  private renderPost(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
    ctx.save();
    // Drop shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.beginPath();
    ctx.arc(x + 2, y + 2, r, 0, Math.PI * 2);
    ctx.fill();

    // Post body with 3D metallic gradient
    const grad = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, 1, x, y, r);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.6, '#cbd5e1');
    grad.addColorStop(1, '#64748b');

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }
}
