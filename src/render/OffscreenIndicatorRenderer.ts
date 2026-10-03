import { DiscSnapshot } from '../core/game/GameState';

export interface EdgeProjectionResult {
  ex: number;
  ey: number;
  theta: number;
}

export class OffscreenIndicatorRenderer {
  public static readonly MARGIN: number = 22;
  public static readonly HUD_TOP_MARGIN: number = 50;
  public static readonly BASE_WIDTH: number = 14;
  public static readonly HEIGHT: number = 16;

  /**
   * Calcula la proyección sobre el rectángulo seguro perimetral de la pantalla.
   * Utilizado para tests unitarios y cálculos geométricos puros.
   */
  public static projectToEdge(
    sx: number,
    sy: number,
    cx: number,
    cy: number,
    xmin: number,
    ymin: number,
    xmax: number,
    ymax: number
  ): EdgeProjectionResult {
    const dx = sx - cx;
    const dy = sy - cy;
    const theta = Math.atan2(dy, dx);

    let t = 1.0;

    if (dx > 1e-6) {
      const tx = (xmax - cx) / dx;
      if (tx < t) t = tx;
    } else if (dx < -1e-6) {
      const tx = (xmin - cx) / dx;
      if (tx < t) t = tx;
    }

    if (dy > 1e-6) {
      const ty = (ymax - cy) / dy;
      if (ty < t) t = ty;
    } else if (dy < -1e-6) {
      const ty = (ymin - cy) / dy;
      if (ty < t) t = ty;
    }

    const ex = Math.max(xmin, Math.min(xmax, cx + t * dx));
    const ey = Math.max(ymin, Math.min(ymax, cy + t * dy));

    return { ex, ey, theta };
  }

  /**
   * Renderiza los indicadores fuera de pantalla (Off-screen triangles) directamente en el Canvas 2D
   * con CERO alocaciones en tiempo de ejecución (Zero-GC a 60 Hz).
   */
  public draw(
    ctx: CanvasRenderingContext2D,
    discs: DiscSnapshot[],
    localDiscId: number | null | undefined,
    camX: number,
    camY: number,
    cx: number,
    cy: number,
    viewportWidth: number,
    viewportHeight: number,
    chatHeight: number
  ): void {
    const m = OffscreenIndicatorRenderer.MARGIN;
    const xmin = m;
    const xmax = viewportWidth - m;
    const ymin = m + OffscreenIndicatorRenderer.HUD_TOP_MARGIN;
    const ymax = viewportHeight - chatHeight - m;

    // Si el área de visualización es degenerada, omitir
    if (xmax <= xmin || ymax <= ymin) return;

    const count = discs.length;

    for (let i = 0; i < count; i++) {
      const disc = discs[i];

      // Omitir el jugador local (él mismo es el punto de referencia / anclaje de seguimiento)
      if (localDiscId !== null && localDiscId !== undefined && disc.id === localDiscId) {
        continue;
      }

      // Solo entidades de juego activas: 0 = Balón, 1 = Equipo Rojo, 2 = Equipo Azul
      let color = '';
      let isBall = false;
      if (disc.team === 0) {
        color = '#FFCC00';
        isBall = true;
      } else if (disc.team === 1) {
        color = '#FF0055';
      } else if (disc.team === 2) {
        color = '#00E5FF';
      } else {
        continue;
      }

      // Coordenada de pantalla absoluta de la entidad
      const sx = (disc.x - camX) + cx;
      const sy = (disc.y - camY) + cy;

      // Verificar si la entidad está fuera del rectángulo seguro
      if (sx >= xmin && sx <= xmax && sy >= ymin && sy <= ymax) {
        continue; // Está visible en pantalla, no requiere indicador
      }

      // Proyección escalar del rayo desde (cx, cy) hacia (sx, sy)
      const dx = sx - cx;
      const dy = sy - cy;
      const theta = Math.atan2(dy, dx);

      let t = 1.0;

      if (dx > 1e-6) {
        const tx = (xmax - cx) / dx;
        if (tx < t) t = tx;
      } else if (dx < -1e-6) {
        const tx = (xmin - cx) / dx;
        if (tx < t) t = tx;
      }

      if (dy > 1e-6) {
        const ty = (ymax - cy) / dy;
        if (ty < t) t = ty;
      } else if (dy < -1e-6) {
        const ty = (ymin - cy) / dy;
        if (ty < t) t = ty;
      }

      let ex = cx + t * dx;
      let ey = cy + t * dy;

      if (ex < xmin) ex = xmin;
      else if (ex > xmax) ex = xmax;
      if (ey < ymin) ey = ymin;
      else if (ey > ymax) ey = ymax;

      // Dibujo del triángulo isósceles orientado hacia afuera (theta + PI / 2)
      ctx.save();
      ctx.translate(ex, ey);
      ctx.rotate(theta + Math.PI / 2);

      ctx.beginPath();
      ctx.moveTo(0, -8);  // Vértice superior (apunta hacia afuera en dirección theta)
      ctx.lineTo(-7, 8);  // Esquina inferior izquierda
      ctx.lineTo(7, 8);   // Esquina inferior derecha
      ctx.closePath();

      ctx.fillStyle = color;
      ctx.fill();

      ctx.strokeStyle = '#000000';
      ctx.lineWidth = isBall ? 1.5 : 1.0;
      ctx.stroke();

      ctx.restore();
    }
  }
}
