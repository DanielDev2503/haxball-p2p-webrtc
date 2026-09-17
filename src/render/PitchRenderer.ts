import { Stadium } from '../core/entities/Stadium';

export class PitchRenderer {
  public render(ctx: CanvasRenderingContext2D, stadium: Stadium): void {
    const hw = stadium.halfWidth;
    const hh = stadium.halfHeight;
    const gh = stadium.goalHalfHeight;
    const gd = stadium.goalDepth;
    const cr = stadium.centerRadius;

    ctx.save();

    // 1. Césped Glacial Blanco a Perlado (#FFFFFF a #F1F5F9)
    const pitchGrad = ctx.createLinearGradient(0, -hh, 0, hh);
    pitchGrad.addColorStop(0, '#FFFFFF');
    pitchGrad.addColorStop(0.5, '#F8FAFC');
    pitchGrad.addColorStop(1, '#F1F5F9');
    ctx.fillStyle = pitchGrad;
    ctx.fillRect(-hw, -hh, hw * 2, hh * 2);

    // 2. Rejilla Cyber-Aero Translúcida en Azul Cielo
    ctx.save();
    ctx.strokeStyle = 'rgba(14, 165, 233, 0.07)';
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

    // 3. Áreas de Penal y Redes de Portería con Identidad de Equipo Neón
    // Área y Red Izquierda (Rojo Neón #FF0055)
    ctx.save();
    ctx.fillStyle = 'rgba(255, 0, 85, 0.03)';
    ctx.fillRect(-hw, -gh * 1.5, 90, gh * 3);
    ctx.strokeStyle = 'rgba(255, 0, 85, 0.35)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-hw, -gh * 1.5);
    ctx.lineTo(-hw + 90, -gh * 1.5);
    ctx.lineTo(-hw + 90, gh * 1.5);
    ctx.lineTo(-hw, gh * 1.5);
    ctx.stroke();

    // Red Izquierda
    ctx.fillStyle = 'rgba(255, 0, 85, 0.08)';
    ctx.fillRect(-(hw + gd), -gh, gd, gh * 2);
    this.renderNetMesh(ctx, -(hw + gd), -gh, gd, gh * 2, 'rgba(255, 0, 85, 0.25)');
    ctx.restore();

    // Área y Red Derecha (Azul Neón #00E5FF)
    ctx.save();
    ctx.fillStyle = 'rgba(0, 229, 255, 0.03)';
    ctx.fillRect(hw - 90, -gh * 1.5, 90, gh * 3);
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.35)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(hw, -gh * 1.5);
    ctx.lineTo(hw - 90, -gh * 1.5);
    ctx.lineTo(hw - 90, gh * 1.5);
    ctx.lineTo(hw, gh * 1.5);
    ctx.stroke();

    // Red Derecha
    ctx.fillStyle = 'rgba(0, 229, 255, 0.08)';
    ctx.fillRect(hw, -gh, gd, gh * 2);
    this.renderNetMesh(ctx, hw, -gh, gd, gh * 2, 'rgba(0, 229, 255, 0.25)');
    ctx.restore();

    // 4. Líneas de Marcación Técnicas en Azul Cielo Brillante (#0EA5E9)
    ctx.save();
    ctx.strokeStyle = '#0EA5E9';
    ctx.lineWidth = 3.0;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = 'rgba(14, 165, 233, 0.25)';
    ctx.shadowBlur = 4;

    // Perímetro y cajetines de portería
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

    // Marcadores de cuadrante aero en el círculo central
    ctx.beginPath();
    const tick = 8;
    ctx.moveTo(-tick, 0);
    ctx.lineTo(tick, 0);
    ctx.moveTo(0, -tick);
    ctx.lineTo(0, tick);
    ctx.stroke();

    // Punto central
    ctx.fillStyle = '#0EA5E9';
    ctx.beginPath();
    ctx.arc(0, 0, 4.5, 0, Math.PI * 2);
    ctx.fill();

    // Líneas de gol discontinuas
    ctx.strokeStyle = 'rgba(14, 165, 233, 0.5)';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);

    ctx.beginPath();
    ctx.moveTo(-hw, -gh);
    ctx.lineTo(-hw, gh);
    ctx.moveTo(hw, -gh);
    ctx.lineTo(hw, gh);
    ctx.stroke();

    ctx.restore(); // Restaura sombras y dash

    // 5. Postes de Portería Metálicos con Halo Neón Reactivo
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
    h: number,
    color: string
  ): void {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2;
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
    const isLeft = x < 0;
    const haloColor = isLeft ? 'rgba(255, 0, 85, 0.5)' : 'rgba(0, 229, 255, 0.5)';

    // Sombra proyectada difusa sobre césped blanco
    ctx.fillStyle = 'rgba(15, 23, 42, 0.25)';
    ctx.beginPath();
    ctx.arc(x + 2, y + 2, r, 0, Math.PI * 2);
    ctx.fill();

    // Halo perimetral del poste con color de la portería
    ctx.shadowColor = haloColor;
    ctx.shadowBlur = 8;

    // Gradiente metálico esférico 3D con brillo especular nítido
    const grad = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, 1, x, y, r);
    grad.addColorStop(0, '#FFFFFF');
    grad.addColorStop(0.45, '#E2E8F0');
    grad.addColorStop(0.8, '#94A3B8');
    grad.addColorStop(1, '#475569');

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = isLeft ? '#FF0055' : '#0EA5E9';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }
}

