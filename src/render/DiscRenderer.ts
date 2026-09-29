import { DiscSnapshot } from '../core/game/GameState';
import { $theme } from '../ui/stores/gameStore';

interface GhostSlot {
  x: number;
  y: number;
  alpha: number;
  active: boolean;
  color: string;
  radius: number;
}

interface TurboParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  alpha: number;
  active: boolean;
  color: string;
}

interface RibbonNode {
  x: number;
  y: number;
  r: number;
  team: number;
}

export class DiscRenderer {
  private ghostMap: Map<number, GhostSlot[]> = new Map();
  private turboParticles: TurboParticle[] = [];
  private nextParticleIdx: number = 0;
  private ribbonMap: Map<number, RibbonNode[]> = new Map();

  constructor() {
    // Pre-alocación fija del pool de partículas de turbo (Zero GC en bucle de render)
    for (let i = 0; i < 120; i++) {
      this.turboParticles.push({
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        alpha: 0,
        active: false,
        color: 'rgba(0, 229, 255, '
      });
    }
  }

  public render(
    ctx: CanvasRenderingContext2D,
    discs: DiscSnapshot[],
    localDiscId?: number | null
  ): void {
    ctx.save();

    // 1. Procesar ráfagas de turbo para registrar o decaer ribbon trails
    const activeTurboIds = new Set<number>();
    for (const disc of discs) {
      if (disc.team !== 0) {
        if (disc.isDashing) {
          this.recordDashGhost(disc);
        }
        if (disc.isTurbo) {
          activeTurboIds.add(disc.id);
          this.recordRibbonPoint(disc);
          this.emitTurboParticle(disc);
        }
      }
    }

    // Decaimiento natural de estelas de jugadores que ya no usan turbo
    for (const [id, history] of this.ribbonMap.entries()) {
      if (!activeTurboIds.has(id) && history.length > 0) {
        history.pop();
      }
    }

    // 2. Renderizar Ribbon Trails poligonales translúcidos de Turbo
    this.renderRibbonTrails(ctx);

    // 3. Renderizar partículas de turbo dinámicas con dispersión de 35°
    this.renderTurboParticles(ctx);

    // 4. Renderizar siluetas fantasma de dash (ghosting / after-images)
    this.renderDashGhosts(ctx);

    // 5. Renderizar discos (balón y jugadores con barra de estamina dual)
    for (const disc of discs) {
      if (disc.team === 0) {
        this.renderBall(ctx, disc);
      } else {
        this.renderPlayer(ctx, disc, disc.id === localDiscId);
      }
    }

    ctx.restore();
  }

  private recordRibbonPoint(disc: DiscSnapshot): void {
    let history = this.ribbonMap.get(disc.id);
    if (!history) {
      history = [];
      this.ribbonMap.set(disc.id, history);
    }
    history.unshift({ x: disc.x, y: disc.y, r: disc.radius, team: disc.team });
    if (history.length > 8) {
      history.length = 8;
    }
  }

  private renderRibbonTrails(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    for (const history of this.ribbonMap.values()) {
      if (history.length < 2) continue;

      const team = history[0].team;
      const isRed = team === 1;
      const neonColor = isRed ? 'rgba(255, 0, 85, ' : 'rgba(0, 229, 255, ';

      const leftPts: Array<{ x: number; y: number }> = [];
      const rightPts: Array<{ x: number; y: number }> = [];
      const coreLeftPts: Array<{ x: number; y: number }> = [];
      const coreRightPts: Array<{ x: number; y: number }> = [];

      for (let i = 0; i < history.length; i++) {
        const pt = history[i];
        const next = i < history.length - 1 ? history[i + 1] : history[i];
        const prev = i > 0 ? history[i - 1] : history[i];

        let dx = next.x - prev.x;
        let dy = next.y - prev.y;
        let len = Math.hypot(dx, dy);
        if (len < 0.001) {
          dx = 1;
          dy = 0;
          len = 1;
        }

        const nx = -dy / len;
        const ny = dx / len;

        // Estrechamiento cónico hacia atrás: ancho inicial 2 * r_player hasta 0 en el frame 8
        const taper = Math.max(0, 1 - i / 8);
        const halfWidth = pt.r * taper;
        const coreHalfWidth = halfWidth * 0.38;

        leftPts.push({ x: pt.x + nx * halfWidth, y: pt.y + ny * halfWidth });
        rightPts.push({ x: pt.x - nx * halfWidth, y: pt.y - ny * halfWidth });

        coreLeftPts.push({ x: pt.x + nx * coreHalfWidth, y: pt.y + ny * coreHalfWidth });
        coreRightPts.push({ x: pt.x - nx * coreHalfWidth, y: pt.y - ny * coreHalfWidth });
      }

      for (let i = 0; i < history.length - 1; i++) {
        const alpha = Math.max(0, 0.55 * (1 - i / 8));
        const nextAlpha = Math.max(0, 0.55 * (1 - (i + 1) / 8));

        // 1. Estela poligonal con el neón del equipo
        ctx.beginPath();
        ctx.moveTo(leftPts[i].x, leftPts[i].y);
        ctx.lineTo(leftPts[i + 1].x, leftPts[i + 1].y);
        ctx.lineTo(rightPts[i + 1].x, rightPts[i + 1].y);
        ctx.lineTo(rightPts[i].x, rightPts[i].y);
        ctx.closePath();

        const grad = ctx.createLinearGradient(history[i].x, history[i].y, history[i + 1].x, history[i + 1].y);
        grad.addColorStop(0, `${neonColor}${alpha})`);
        grad.addColorStop(1, `${neonColor}${nextAlpha})`);
        ctx.fillStyle = grad;
        ctx.fill();

        // 2. Núcleo blanco brillante
        ctx.beginPath();
        ctx.moveTo(coreLeftPts[i].x, coreLeftPts[i].y);
        ctx.lineTo(coreLeftPts[i + 1].x, coreLeftPts[i + 1].y);
        ctx.lineTo(coreRightPts[i + 1].x, coreRightPts[i + 1].y);
        ctx.lineTo(coreRightPts[i].x, coreRightPts[i].y);
        ctx.closePath();

        const coreGrad = ctx.createLinearGradient(history[i].x, history[i].y, history[i + 1].x, history[i + 1].y);
        coreGrad.addColorStop(0, `rgba(255, 255, 255, ${alpha * 0.95})`);
        coreGrad.addColorStop(1, `rgba(255, 255, 255, ${nextAlpha * 0.95})`);
        ctx.fillStyle = coreGrad;
        ctx.fill();
      }
    }

    ctx.restore();
  }

  private recordDashGhost(disc: DiscSnapshot): void {
    let slots = this.ghostMap.get(disc.id);
    if (!slots) {
      slots = [
        { x: 0, y: 0, alpha: 0, active: false, color: '', radius: 15 },
        { x: 0, y: 0, alpha: 0, active: false, color: '', radius: 15 },
        { x: 0, y: 0, alpha: 0, active: false, color: '', radius: 15 },
        { x: 0, y: 0, alpha: 0, active: false, color: '', radius: 15 }
      ];
      this.ghostMap.set(disc.id, slots);
    }

    let targetSlot = slots[0];
    for (let i = 1; i < slots.length; i++) {
      if (!slots[i].active || slots[i].alpha < targetSlot.alpha) {
        targetSlot = slots[i];
      }
    }

    targetSlot.x = disc.x;
    targetSlot.y = disc.y;
    targetSlot.alpha = 0.65;
    targetSlot.active = true;
    targetSlot.color = disc.team === 1 ? '#FF0055' : '#00E5FF';
    targetSlot.radius = disc.radius;
  }

  private renderDashGhosts(ctx: CanvasRenderingContext2D): void {
    for (const slots of this.ghostMap.values()) {
      for (let i = 0; i < slots.length; i++) {
        const ghost = slots[i];
        if (!ghost.active) continue;

        ctx.save();
        ctx.globalAlpha = ghost.alpha;
        ctx.fillStyle = ghost.color;
        ctx.shadowColor = ghost.color;
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(ghost.x, ghost.y, ghost.radius * 0.96, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        ghost.alpha *= 0.7;
        if (ghost.alpha < 0.02) {
          ghost.active = false;
        }
      }
    }
  }

  private emitTurboParticle(disc: DiscSnapshot): void {
    const speed = Math.hypot(disc.vx, disc.vy);
    if (speed < 0.5) return;

    // Dirección opuesta al desplazamiento (-u) con dispersión angular de 35°
    const baseAngle = Math.atan2(-disc.vy, -disc.vx);
    const spreadRad = (35 * Math.PI) / 180;
    const angle = baseAngle + (Math.random() - 0.5) * spreadRad;
    const pSpeed = speed * (0.55 + Math.random() * 0.45) + 40;

    const p = this.turboParticles[this.nextParticleIdx];
    this.nextParticleIdx = (this.nextParticleIdx + 1) % this.turboParticles.length;

    p.x = disc.x - (disc.vx / speed) * (disc.radius * 0.8) + (Math.random() - 0.5) * 6;
    p.y = disc.y - (disc.vy / speed) * (disc.radius * 0.8) + (Math.random() - 0.5) * 6;
    p.vx = Math.cos(angle) * pSpeed;
    p.vy = Math.sin(angle) * pSpeed;
    p.alpha = 0.85;
    p.active = true;
    p.color = disc.team === 1 ? 'rgba(255, 0, 85, ' : 'rgba(0, 229, 255, ';
  }

  private renderTurboParticles(ctx: CanvasRenderingContext2D): void {
    for (let i = 0; i < this.turboParticles.length; i++) {
      const p = this.turboParticles[i];
      if (!p.active) continue;

      p.x += p.vx * (1 / 60);
      p.y += p.vy * (1 / 60);
      p.alpha *= 0.84;

      if (p.alpha < 0.02) {
        p.active = false;
        continue;
      }

      ctx.save();
      ctx.strokeStyle = `${p.color}${p.alpha})`;
      ctx.lineWidth = 2.0;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - p.vx * 0.06, p.y - p.vy * 0.06);
      ctx.stroke();
      ctx.restore();
    }
  }

  private renderBall(ctx: CanvasRenderingContext2D, disc: DiscSnapshot): void {
    const { x, y, radius } = disc;

    ctx.save();

    // 1. Sombra Difusa Proyectada
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
    grad.addColorStop(0, '#FFFFFF');
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

    // 2. Sombra Elíptica Proyectada
    ctx.fillStyle = 'rgba(15, 23, 42, 0.2)';
    ctx.beginPath();
    ctx.arc(x + 2, y + 3, radius, 0, Math.PI * 2);
    ctx.fill();

    // 3. Gradiente Radial simulando Esfera Esmaltada con Núcleo Neón
    const grad = ctx.createRadialGradient(
      x - radius * 0.35,
      y - radius * 0.35,
      radius * 0.05,
      x,
      y,
      radius
    );

    if (isRed) {
      grad.addColorStop(0, '#FFFFFF');
      grad.addColorStop(0.2, '#FF4D88');
      grad.addColorStop(0.65, '#FF0055');
      grad.addColorStop(1, '#990033');
    } else {
      grad.addColorStop(0, '#FFFFFF');
      grad.addColorStop(0.2, '#4DEFFF');
      grad.addColorStop(0.65, '#00E5FF');
      grad.addColorStop(1, '#007A99');
    }

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();

    // 4. Anillo Exterior Neón con Resplandor Perimetral
    ctx.save();
    ctx.strokeStyle = neonColor;
    ctx.lineWidth = 2.4;
    ctx.shadowColor = neonGlow;
    ctx.shadowBlur = 9;
    ctx.beginPath();
    ctx.arc(x, y, radius - 0.6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // 5. Borde Interior Blanco Fino
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(x, y, radius - 2.8, 0, Math.PI * 2);
    ctx.stroke();

    // 6. Avatar / Dorsal
    if (avatar) {
      ctx.save();
      ctx.font = `bold ${Math.round(radius * 0.88)}px "Zen Dots", "Inter", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      ctx.strokeStyle = 'rgba(15, 23, 42, 0.7)';
      ctx.lineWidth = 2.5;
      ctx.strokeText(avatar, x, y + 1);

      ctx.fillStyle = '#FFFFFF';
      ctx.fillText(avatar, x, y + 1);
      ctx.restore();
    }

    // 7. Barra Dual Perimétrica de Estamina (con alto contraste dinámico)
    this.renderStaminaBar(ctx, disc);

    // 8. Indicador del Jugador Local en Verde Neovital
    if (isLocal) {
      ctx.save();
      ctx.strokeStyle = '#00E599';
      ctx.lineWidth = 2.0;
      ctx.shadowColor = 'rgba(0, 229, 153, 0.7)';
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(x, y, radius + 11, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    ctx.restore();
  }

  /**
   * Barra dual perimétrica de estamina concéntrica (R = r + 6px, lineWidth = 3.5).
   * Alto contraste: anillo base oscuro (rgba(15, 23, 42, 0.75)) lineWidth 5.0 debajo de los arcos.
   * Modo Claro:
   *  - Segmento no cargado: rgba(30, 41, 59, 0.4)
   *  - Segmento cargado (>= 50%): Azul Eléctrico #0284C7 con borde exterior blanco puro.
   *  - Barra al 100%: Glow dinámico cian oscuro y blanco contrastado.
   * Modo Oscuro:
   *  - Brillo blanco glacial y Azul Neón #00E5FF.
   */
  private renderStaminaBar(ctx: CanvasRenderingContext2D, disc: DiscSnapshot): void {
    const isDark = $theme.get() === 'dark';
    const { x, y, radius, stamina } = disc;
    const E = stamina !== undefined ? Math.max(0, Math.min(100, stamina)) : 100;
    const ringRadius = radius + 6;
    const lineWidth = 3.5;
    const gap = 0.08;

    ctx.save();
    ctx.lineCap = 'round';

    // 1. Anillo base de contraste oscuro (rgba(15, 23, 42, 0.75)) lineWidth: 5 justo debajo de los arcos
    ctx.lineWidth = 5.0;
    ctx.strokeStyle = isDark ? 'rgba(0, 0, 0, 0.7)' : 'rgba(15, 23, 42, 0.75)';

    ctx.beginPath();
    ctx.arc(x, y, ringRadius, gap, Math.PI - gap);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(x, y, ringRadius, Math.PI + gap, Math.PI * 2 - gap);
    ctx.stroke();

    // 2. Pistas de fondo para segmentos no cargados
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.22)' : 'rgba(30, 41, 59, 0.4)';

    // Semicírculo 1 Fondo (inferior: 0° a 180°)
    ctx.beginPath();
    ctx.arc(x, y, ringRadius, gap, Math.PI - gap);
    ctx.stroke();

    // Semicírculo 2 Fondo (superior: 180° a 360°)
    ctx.beginPath();
    ctx.arc(x, y, ringRadius, Math.PI + gap, Math.PI * 2 - gap);
    ctx.stroke();

    const isFull = E >= 99.5;
    const now = typeof performance !== 'undefined' ? performance.now() : 0;
    const pulse = isFull ? (0.7 + 0.3 * Math.sin(now * 0.008)) : 1.0;

    // 3. Segmento 1 Activo (0% - 50% de estamina)
    const ratio1 = Math.min(1, E / 50);
    if (ratio1 > 0) {
      ctx.save();
      const startAngle1 = gap;
      const endAngle1 = gap + ratio1 * (Math.PI - 2 * gap);

      if (isDark) {
        if (E >= 50) {
          ctx.strokeStyle = '#FFFFFF';
          ctx.shadowColor = '#00E5FF';
          ctx.shadowBlur = 9 * pulse;
        } else {
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)';
          ctx.shadowColor = 'rgba(0, 229, 255, 0.3)';
          ctx.shadowBlur = 4;
        }
        ctx.beginPath();
        ctx.arc(x, y, ringRadius, startAngle1, endAngle1);
        ctx.stroke();
      } else {
        // Modo Claro
        if (E >= 50) {
          // Borde exterior blanco puro bajo el arco para contraste máximo
          ctx.save();
          ctx.lineWidth = lineWidth + 1.6;
          ctx.strokeStyle = '#FFFFFF';
          ctx.beginPath();
          ctx.arc(x, y, ringRadius, startAngle1, endAngle1);
          ctx.stroke();
          ctx.restore();

          // Azul Eléctrico profundo #0284C7
          ctx.strokeStyle = '#0284C7';
          ctx.shadowColor = 'rgba(2, 132, 199, 0.5)';
          ctx.shadowBlur = 4;
        } else {
          ctx.strokeStyle = 'rgba(2, 132, 199, 0.7)';
        }
        ctx.beginPath();
        ctx.arc(x, y, ringRadius, startAngle1, endAngle1);
        ctx.stroke();
      }
      ctx.restore();
    }

    // 4. Segmento 2 Activo (50% - 100% de estamina)
    const ratio2 = Math.max(0, Math.min(1, (E - 50) / 50));
    if (ratio2 > 0) {
      ctx.save();
      const startAngle2 = Math.PI + gap;
      const endAngle2 = Math.PI + gap + ratio2 * (Math.PI - 2 * gap);

      if (isDark) {
        if (isFull) {
          ctx.strokeStyle = '#FFFFFF';
          ctx.shadowColor = '#00E5FF';
          ctx.shadowBlur = 12 * pulse;
        } else {
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
          ctx.shadowColor = 'rgba(0, 229, 255, 0.4)';
          ctx.shadowBlur = 5;
        }
        ctx.beginPath();
        ctx.arc(x, y, ringRadius, startAngle2, endAngle2);
        ctx.stroke();
      } else {
        // Modo Claro
        if (isFull) {
          ctx.save();
          ctx.lineWidth = lineWidth + 1.6;
          ctx.strokeStyle = '#FFFFFF';
          ctx.beginPath();
          ctx.arc(x, y, ringRadius, startAngle2, endAngle2);
          ctx.stroke();
          ctx.restore();

          // Barra al 100%: Glow dinámico cian oscuro y blanco contrastado
          ctx.strokeStyle = '#0284C7';
          ctx.shadowColor = '#00E5FF';
          ctx.shadowBlur = 11 * pulse;
        } else {
          ctx.strokeStyle = 'rgba(2, 132, 199, 0.85)';
          ctx.shadowColor = 'rgba(2, 132, 199, 0.35)';
          ctx.shadowBlur = 4;
        }
        ctx.beginPath();
        ctx.arc(x, y, ringRadius, startAngle2, endAngle2);
        ctx.stroke();
      }
      ctx.restore();
    }

    ctx.restore();
  }
}
