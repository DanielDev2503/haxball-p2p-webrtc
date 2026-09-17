import { Stadium } from '../core/entities/Stadium';

export class PitchRenderer {
  public render(ctx: CanvasRenderingContext2D, stadium: Stadium): void {
    const hw = stadium.halfWidth;
    const hh = stadium.halfHeight;
    const gh = stadium.goalHalfHeight;
    const gd = stadium.goalDepth;
    const cr = stadium.centerRadius;

    ctx.save();

    // 1. Fondo Azul Técnico Oscuro con Gradiente de Profundidad (#060E18 a #0A1626)
    const pitchGrad = ctx.createLinearGradient(0, -hh, 0, hh);
    pitchGrad.addColorStop(0, '#060e18');
    pitchGrad.addColorStop(0.5, '#081220');
    pitchGrad.addColorStop(1, '#0a1626');
    ctx.fillStyle = pitchGrad;
    ctx.fillRect(-hw, -hh, hw * 2, hh * 2);

    // 2. Rejilla Bio-Digital Translúcida en Verde Neovital Suave
    ctx.save();
    ctx.strokeStyle = 'rgba(0, 229, 153, 0.06)';
    ctx.lineWidth = 1;
    const gridSize = 28;

    ctx.beginPath();
    for (let x = -hw; x <= hw; x += gridSize) {
      ctx.moveTo(x, -hh);
      ctx.lineTo(x, hh);
    }
    for (let y = -hh; y <= hh; y += gridSize) {
      ctx.moveTo(-hw, y);
      ctx.lineTo(hw, y);
    }
    ctx.stroke();
    ctx.restore();

    // 3. Redes de Portería (Izquierda y Derecha) con Acento Aero
    // Red Izquierda
    ctx.fillStyle = 'rgba(0, 229, 255, 0.04)';
    ctx.fillRect(-(hw + gd), -gh, gd, gh * 2);
    this.renderNetMesh(ctx, -(hw + gd), -gh, gd, gh * 2);

    // Red Derecha
    ctx.fillStyle = 'rgba(0, 229, 255, 0.04)';
    ctx.fillRect(hw, -gh, gd, gh * 2);
    this.renderNetMesh(ctx, hw, -gh, gd, gh * 2);

    // 4. Líneas de Marcación Blancas Nítidas con Resplandor Sutil
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.lineWidth = 3.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = 'rgba(0, 194, 255, 0.35)';
    ctx.shadowBlur = 4;

    // Perímetro y cajas de portería
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

    // Línea de medio campo
    ctx.beginPath();
    ctx.moveTo(0, -hh);
    ctx.lineTo(0, hh);
    ctx.stroke();

    // Círculo central
    ctx.beginPath();
    ctx.arc(0, 0, cr, 0, Math.PI * 2);
    ctx.stroke();

    // Punto central
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(0, 0, 4.5, 0, Math.PI * 2);
    ctx.fill();

    // Líneas de gol discontinuas
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);

    ctx.beginPath();
    ctx.moveTo(-hw, -gh);
    ctx.lineTo(-hw, gh);
    ctx.moveTo(hw, -gh);
    ctx.lineTo(hw, gh);
    ctx.stroke();

    ctx.restore(); // Restaura sombras y dash

    // 5. Postes de Portería con Acabado Metálico Cromado
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
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.18)';
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
    // Sombra proyectada del poste
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.beginPath();
    ctx.arc(x + 2, y + 2, r, 0, Math.PI * 2);
    ctx.fill();

    // Gradiente metálico esférico 3D con reflejo especular
    const grad = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, 1, x, y, r);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.5, '#cbd5e1');
    grad.addColorStop(0.85, '#64748b');
    grad.addColorStop(1, '#334155');

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.restore();
  }
}
