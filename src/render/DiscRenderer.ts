import { DiscSnapshot } from '../core/game/GameState';

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

export class DiscRenderer {
  private ghostMap: Map<number, GhostSlot[]> = new Map();
  private turboParticles: TurboParticle[] = [];
  private nextParticleIdx: number = 0;

  constructor() {
    // Pre-alocación fija del pool de partículas de turbo (Zero GC en bucle de render)
    for (let i = 0; i < 80; i++) {
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

    // 1. Renderizar partículas de turbo dinámicas
    this.renderTurboParticles(ctx);

    // 2. Renderizar siluetas fantasma de dash (ghosting / after-images)
    this.renderDashGhosts(ctx);

    // 3. Procesar y registrar ráfagas de dash y turbo en buffers de efectos
    for (const disc of discs) {
      if (disc.team !== 0) {
        if (disc.isDashing) {
          this.recordDashGhost(disc);
        }
        if (disc.isTurbo) {
          this.emitTurboParticle(disc);
        }
      }
    }

    // 4. Renderizar discos (balón y jugadores con barra de estamina dual)
    for (const disc of discs) {
      if (disc.team === 0) {
        this.renderBall(ctx, disc);
      } else {
        this.renderPlayer(ctx, disc, disc.id === localDiscId);
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

    // Buscar el slot con menor alpha o inactivo
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

        // Decaimiento rápido de opacidad (alpha *= 0.7) desvaneciéndose en < 200 ms
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

    // Dirección opuesta al desplazamiento (-u)
    const ux = -disc.vx / speed;
    const uy = -disc.vy / speed;

    const p = this.turboParticles[this.nextParticleIdx];
    this.nextParticleIdx = (this.nextParticleIdx + 1) % this.turboParticles.length;

    p.x = disc.x + ux * (disc.radius * 0.8) + (Math.random() - 0.5) * 6;
    p.y = disc.y + uy * (disc.radius * 0.8) + (Math.random() - 0.5) * 6;
    p.vx = ux * (speed * 0.25);
    p.vy = uy * (speed * 0.25);
    p.alpha = 0.7;
    p.active = true;
    p.color = disc.team === 1 ? 'rgba(255, 0, 85, ' : 'rgba(0, 229, 255, ';
  }

  private renderTurboParticles(ctx: CanvasRenderingContext2D): void {
    for (let i = 0; i < this.turboParticles.length; i++) {
      const p = this.turboParticles[i];
      if (!p.active) continue;

      p.x += p.vx * (1 / 60);
      p.y += p.vy * (1 / 60);
      p.alpha *= 0.84; // Disolución suave

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

    // 7. Barra Dual Perimétrica de Estamina (CADA jugador, Host y No-Host)
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
   * Dividida en 2 segmentos de 180°:
   * - Semicírculo inferior (0° a 180°): primer 50% (Dash 1).
   * - Semicírculo superior (180° a 360°): del 50% al 100% (Dash 2).
   */
  private renderStaminaBar(ctx: CanvasRenderingContext2D, disc: DiscSnapshot): void {
    const { x, y, radius, stamina } = disc;
    const E = stamina !== undefined ? Math.max(0, Math.min(100, stamina)) : 100;
    const ringRadius = radius + 6;
    const lineWidth = 3.5;
    const gap = 0.08; // Separación angular estética entre semicírculos

    ctx.save();
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';

    // Pistas de fondo translúcidas (gris tenue)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';

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

    // Segmento 1 Activo (0% - 50% de estamina)
    const ratio1 = Math.min(1, E / 50);
    if (ratio1 > 0) {
      ctx.save();
      const startAngle1 = gap;
      const endAngle1 = gap + ratio1 * (Math.PI - 2 * gap);

      if (E >= 50) {
        // Iluminado en blanco glacial brillante con halo en Azul Cielo (#00E5FF)
        ctx.strokeStyle = '#FFFFFF';
        ctx.shadowColor = '#00E5FF';
        ctx.shadowBlur = 9 * pulse;
      } else {
        // En recarga: gris translúcido tenue
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)';
        ctx.shadowColor = 'rgba(0, 229, 255, 0.3)';
        ctx.shadowBlur = 4;
      }

      ctx.beginPath();
      ctx.arc(x, y, ringRadius, startAngle1, endAngle1);
      ctx.stroke();
      ctx.restore();
    }

    // Segmento 2 Activo (50% - 100% de estamina)
    const ratio2 = Math.max(0, Math.min(1, (E - 50) / 50));
    if (ratio2 > 0) {
      ctx.save();
      const startAngle2 = Math.PI + gap;
      const endAngle2 = Math.PI + gap + ratio2 * (Math.PI - 2 * gap);

      if (isFull) {
        // Al 100%: ambos semicírculos se iluminan intensamente con pulso de luz neón
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
      ctx.restore();
    }

    ctx.restore();
  }
}

