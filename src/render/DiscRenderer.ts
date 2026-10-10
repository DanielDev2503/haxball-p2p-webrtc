import { DiscSnapshot } from '../core/game/GameState';
import { $theme } from '../ui/stores/gameStore';

const TURBO_TRAIL_CAPACITY = 16;

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
  size: number;
  color: string;
}

interface PlayerTurboBuffer {
  posX: Float32Array;
  posY: Float32Array;
  radius: number;
  team: number;
  head: number;
  count: number;
}

const PHI = (1 + Math.sqrt(5)) / 2;
const INV_NORM = 1 / Math.sqrt(1 + PHI * PHI);

export class DiscRenderer {
  public static readonly ICOSA_X = new Float32Array([
    -1 * INV_NORM,  1 * INV_NORM, -1 * INV_NORM,  1 * INV_NORM,
     0,             0,             0,             0,
    -PHI * INV_NORM, PHI * INV_NORM, -PHI * INV_NORM, PHI * INV_NORM
  ]);
  public static readonly ICOSA_Y = new Float32Array([
    -PHI * INV_NORM, -PHI * INV_NORM,  PHI * INV_NORM,  PHI * INV_NORM,
    -1 * INV_NORM,   1 * INV_NORM, -1 * INV_NORM,   1 * INV_NORM,
     0,              0,             0,              0
  ]);
  public static readonly ICOSA_Z = new Float32Array([
     0,              0,             0,              0,
    -PHI * INV_NORM, -PHI * INV_NORM,  PHI * INV_NORM,  PHI * INV_NORM,
    -1 * INV_NORM,  -1 * INV_NORM,  1 * INV_NORM,   1 * INV_NORM
  ]);

  // Skin y Cinemática 3D de Rodamiento del Balón
  public ballSkin: 'classic' | 'retro' | 'neon' = 'classic';
  private ballRollAngleX: number = 0;
  private ballRollAngleY: number = 0;

  // Buffers circulares prealocados para estela de Tiro con Potencia (Power Shot)
  private static readonly POWER_TRAIL_CAPACITY = 20;
  private powerTrailX: Float32Array = new Float32Array(20);
  private powerTrailY: Float32Array = new Float32Array(20);
  private powerTrailHead: number = 0;
  private powerTrailCount: number = 0;

  private ghostMap: Map<number, GhostSlot[]> = new Map();
  private turboParticles: TurboParticle[] = [];
  private nextParticleIdx: number = 0;
  private ribbonMap: Map<number, PlayerTurboBuffer> = new Map();

  // Buffers circulares prealocados para estela de balón con giro Magnus (Zero-GC)
  private static readonly BALL_TRAIL_CAPACITY = 16;
  private ballTrailX: Float32Array = new Float32Array(16);
  private ballTrailY: Float32Array = new Float32Array(16);
  private ballTrailSpin: Float32Array = new Float32Array(16);
  private ballTrailHead: number = 0;
  private ballTrailCount: number = 0;
  public ballTrailEnabled: boolean = true;
  public playerGlowEnabled: boolean = true;

  // Buffers prealocados de coordenadas de polígonos para CERO GC en hot loop
  private scratchLeftX: Float32Array = new Float32Array(TURBO_TRAIL_CAPACITY);
  private scratchLeftY: Float32Array = new Float32Array(TURBO_TRAIL_CAPACITY);
  private scratchRightX: Float32Array = new Float32Array(TURBO_TRAIL_CAPACITY);
  private scratchRightY: Float32Array = new Float32Array(TURBO_TRAIL_CAPACITY);
  private scratchCoreLeftX: Float32Array = new Float32Array(TURBO_TRAIL_CAPACITY);
  private scratchCoreLeftY: Float32Array = new Float32Array(TURBO_TRAIL_CAPACITY);
  private scratchCoreRightX: Float32Array = new Float32Array(TURBO_TRAIL_CAPACITY);
  private scratchCoreRightY: Float32Array = new Float32Array(TURBO_TRAIL_CAPACITY);

  public extrapolationMs: number = 0;
  public stadiumBounds: { halfWidth: number; halfHeight: number; goalDepth: number; goalHalfHeight: number } | null = null;
  public dampingBall: number = 0.99;
  public dampingPlayer: number = 0.96;

  private scratchDisc: DiscSnapshot = {
    id: 0,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    radius: 15,
    team: 0,
    avatar: '',
    kicking: false,
    stamina: 100,
    isDashing: false,
    isTurbo: false,
    isTyping: false
  };

  public setExtrapolation(ms: number): void {
    this.extrapolationMs = Math.max(0, Math.min(250, ms));
  }

  public setStadiumBounds(bounds: { halfWidth: number; halfHeight: number; goalDepth: number; goalHalfHeight: number } | null): void {
    this.stadiumBounds = bounds;
  }

  public isBallControlledLocally(ball: DiscSnapshot, discs: DiscSnapshot[], localDiscId?: number | null): boolean {
    if (localDiscId === null || localDiscId === undefined) return false;
    for (let i = 0; i < discs.length; i++) {
      const d = discs[i];
      if (d.id === localDiscId && d.team !== 0) {
        const dx = ball.x - d.x;
        const dy = ball.y - d.y;
        const touchDist = (ball.radius || 5.8) + (d.radius || 15) + 4;
        if ((dx * dx + dy * dy) <= touchDist * touchDist && d.kicking) {
          return true;
        }
        break;
      }
    }
    return false;
  }

  public getRenderDisc(disc: DiscSnapshot, isRemote: boolean = true): DiscSnapshot {
    if (!isRemote || this.extrapolationMs <= 0) return disc;
    const dt = this.extrapolationMs / 1000;
    if (dt === 0) return disc;

    const damping = (disc as any).damping ?? (disc.team === 0 ? this.dampingBall : this.dampingPlayer);
    const s = this.scratchDisc;
    s.id = disc.id;
    let px = disc.x + (disc.vx || 0) * (dt * damping);
    let py = disc.y + (disc.vy || 0) * (dt * damping);

    if (this.stadiumBounds) {
      const hw = this.stadiumBounds.halfWidth;
      const hh = this.stadiumBounds.halfHeight;
      const gh = this.stadiumBounds.goalHalfHeight;
      const gd = this.stadiumBounds.goalDepth;
      const r = disc.radius || (disc.team === 0 ? 5.8 : 15);

      // Clamp vertical limits
      py = Math.max(-hh + r, Math.min(hh - r, py));

      // Clamp horizontal limits: if in goal mouth, can enter up to goalDepth
      if (Math.abs(py) <= gh - r) {
        px = Math.max(-(hw + gd - r), Math.min(hw + gd - r, px));
      } else {
        px = Math.max(-hw + r, Math.min(hw - r, px));
      }
    }

    s.x = px;
    s.y = py;
    s.vx = disc.vx;
    s.vy = disc.vy;
    s.radius = disc.radius;
    s.team = disc.team;
    s.avatar = disc.avatar;
    s.kicking = disc.kicking;
    s.stamina = disc.stamina;
    s.isDashing = disc.isDashing;
    s.isTurbo = disc.isTurbo;
    s.isTyping = disc.isTyping;
    s.spin = disc.spin;
    s.isSpinActive = disc.isSpinActive;
    s.curveFactor = disc.curveFactor;
    return s;
  }

  public draw(ctx: CanvasRenderingContext2D, discs: DiscSnapshot[], localDiscId?: number | null): void {
    this.render(ctx, discs, localDiscId);
  }

  constructor() {
    if (typeof localStorage !== 'undefined') {
      const savedSkin = localStorage.getItem('haxball_ball_skin');
      if (savedSkin === 'classic' || savedSkin === 'retro' || savedSkin === 'neon') {
        this.ballSkin = savedSkin;
      }
    }

    // Pre-alocación fija del pool de partículas de turbo (Zero GC en bucle de render)
    for (let i = 0; i < 120; i++) {
      this.turboParticles.push({
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        alpha: 0,
        active: false,
        size: 3.0,
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

    // 1. Procesar ráfagas de turbo para registrar o decaer ribbon trails circulares
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

    // Decaimiento natural de estelas de jugadores que ya no usan turbo (Zero GC)
    for (const [id, buf] of this.ribbonMap.entries()) {
      if (!activeTurboIds.has(id) && buf.count > 0) {
        buf.count--;
      }
    }

    // 2. Procesar y registrar posiciones para la estela Magnus y Power Shot del balón
    const ballDisc = discs.find(d => d.team === 0);
    if (ballDisc) {
      const spinVal = ballDisc.spin ?? (ballDisc.curveFactor ? ballDisc.curveFactor / 10 : 0);
      const isSpinning = Boolean(ballDisc.isSpinActive || spinVal !== 0);
      if (isSpinning) {
        this.recordBallTrailPoint(ballDisc.x, ballDisc.y, spinVal !== 0 ? spinVal : (ballDisc.isSpinActive ? 1.0 : 0));
      } else if (this.ballTrailCount > 0) {
        this.ballTrailCount--;
      }

      if (ballDisc.isPowerShot) {
        this.recordPowerTrailPoint(ballDisc.x, ballDisc.y);
      } else if (this.powerTrailCount > 0) {
        this.powerTrailCount--;
      }
    }

    // 3. Renderizar estelas de movimiento (Ribbon trails, partículas y siluetas fantasma)
    this.renderRibbonTrails(ctx);
    this.renderTurboParticles(ctx);
    this.renderDashGhosts(ctx);
    if (ballDisc) {
      this.renderBallMagnusTrail(ctx, ballDisc.radius || 5.8);
      this.renderBallPowerTrail(ctx, ballDisc.radius || 5.8);
    }

    // 4. Aros de estamina de los jugadores (capa inferior a los discos de jugadores)
    for (const disc of discs) {
      if (disc.team !== 0) {
        const renderD = this.getRenderDisc(disc, true);
        this.renderStaminaBar(ctx, renderD);
      }
    }

    // 5. Discos de los jugadores y sus dorsales/avatares
    for (const disc of discs) {
      if (disc.team !== 0) {
        const renderD = this.getRenderDisc(disc, true);
        this.renderPlayer(ctx, renderD, disc.id === localDiscId, false);
      }
    }

    // 6. Balón físico, textura y su resplandor/sombra (RENDERIZADO POR ENCIMA DE LOS DISCOS Y AROS)
    for (const disc of discs) {
      if (disc.team === 0) {
        const renderD = this.getRenderDisc(disc, true);
        this.renderBall(ctx, renderD);
      }
    }

    ctx.restore();
  }

  private recordRibbonPoint(disc: DiscSnapshot): void {
    let buf = this.ribbonMap.get(disc.id);
    if (!buf) {
      buf = {
        posX: new Float32Array(TURBO_TRAIL_CAPACITY),
        posY: new Float32Array(TURBO_TRAIL_CAPACITY),
        radius: disc.radius,
        team: disc.team,
        head: 0,
        count: 0
      };
      this.ribbonMap.set(disc.id, buf);
    }

    buf.head = (buf.head + 1) & (TURBO_TRAIL_CAPACITY - 1);
    buf.posX[buf.head] = disc.x;
    buf.posY[buf.head] = disc.y;
    if (buf.count < TURBO_TRAIL_CAPACITY) {
      buf.count++;
    }
    buf.radius = disc.radius;
    buf.team = disc.team;
  }

  private renderRibbonTrails(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    for (const buf of this.ribbonMap.values()) {
      const count = buf.count;
      if (count < 2) continue;

      const isRed = buf.team === 1;
      const neonPrefix = isRed ? 'rgba(255, 0, 85, ' : 'rgba(0, 229, 255, ';

      // Calcular vértices del ribbon usando buffers prealocados (Zero GC)
      for (let i = 0; i < count; i++) {
        const curIdx = (buf.head - i + TURBO_TRAIL_CAPACITY) & (TURBO_TRAIL_CAPACITY - 1);
        const px = buf.posX[curIdx];
        const py = buf.posY[curIdx];

        const prevIdx = i > 0
          ? ((buf.head - (i - 1) + TURBO_TRAIL_CAPACITY) & (TURBO_TRAIL_CAPACITY - 1))
          : curIdx;
        const nextIdx = i < count - 1
          ? ((buf.head - (i + 1) + TURBO_TRAIL_CAPACITY) & (TURBO_TRAIL_CAPACITY - 1))
          : curIdx;

        let dx = buf.posX[prevIdx] - buf.posX[nextIdx];
        let dy = buf.posY[prevIdx] - buf.posY[nextIdx];
        let len = Math.hypot(dx, dy);
        if (len < 0.001) {
          dx = 1;
          dy = 0;
          len = 1;
        }

        const nx = -dy / len;
        const ny = dx / len;

        // Estrechamiento suave desde el radio completo del jugador (r ≈ 15px) hasta 0 en la cola
        const taper = Math.max(0, 1 - i / count);
        const halfWidth = buf.radius * taper;
        const coreHalfWidth = halfWidth * 0.42;

        this.scratchLeftX[i] = px + nx * halfWidth;
        this.scratchLeftY[i] = py + ny * halfWidth;
        this.scratchRightX[i] = px - nx * halfWidth;
        this.scratchRightY[i] = py - ny * halfWidth;

        this.scratchCoreLeftX[i] = px + nx * coreHalfWidth;
        this.scratchCoreLeftY[i] = py + ny * coreHalfWidth;
        this.scratchCoreRightX[i] = px - nx * coreHalfWidth;
        this.scratchCoreRightY[i] = py - ny * coreHalfWidth;
      }

      const headIdx = buf.head;
      const tailIdx = (buf.head - (count - 1) + TURBO_TRAIL_CAPACITY) & (TURBO_TRAIL_CAPACITY - 1);
      const headX = buf.posX[headIdx];
      const headY = buf.posY[headIdx];
      const tailX = buf.posX[tailIdx];
      const tailY = buf.posY[tailIdx];

      // 1. Estela poligonal exterior continua con resplandor neón perimetral
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(this.scratchLeftX[0], this.scratchLeftY[0]);
      for (let i = 1; i < count; i++) {
        ctx.lineTo(this.scratchLeftX[i], this.scratchLeftY[i]);
      }
      for (let i = count - 1; i >= 0; i--) {
        ctx.lineTo(this.scratchRightX[i], this.scratchRightY[i]);
      }
      ctx.closePath();

      const grad = ctx.createLinearGradient(headX, headY, tailX, tailY);
      grad.addColorStop(0, `${neonPrefix}0.65)`);
      grad.addColorStop(0.6, `${neonPrefix}0.25)`);
      grad.addColorStop(1, `${neonPrefix}0)`);

      ctx.fillStyle = grad;
      ctx.fill();
      ctx.restore();

      // 2. Núcleo central blanco brillante para aspecto aero-cinético de alta energía
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(this.scratchCoreLeftX[0], this.scratchCoreLeftY[0]);
      for (let i = 1; i < count; i++) {
        ctx.lineTo(this.scratchCoreLeftX[i], this.scratchCoreLeftY[i]);
      }
      for (let i = count - 1; i >= 0; i--) {
        ctx.lineTo(this.scratchCoreRightX[i], this.scratchCoreRightY[i]);
      }
      ctx.closePath();

      const coreGrad = ctx.createLinearGradient(headX, headY, tailX, tailY);
      coreGrad.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
      coreGrad.addColorStop(0.5, 'rgba(255, 255, 255, 0.4)');
      coreGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');

      ctx.fillStyle = coreGrad;
      ctx.fill();
      ctx.restore();
    }

    ctx.restore();
  }

  private recordDashGhost(disc: DiscSnapshot): void {
    let slots = this.ghostMap.get(disc.id);
    if (!slots) {
      slots = [
        { x: 0, y: 0, alpha: 0, active: false, color: '', radius: disc.radius },
        { x: 0, y: 0, alpha: 0, active: false, color: '', radius: disc.radius },
        { x: 0, y: 0, alpha: 0, active: false, color: '', radius: disc.radius },
        { x: 0, y: 0, alpha: 0, active: false, color: '', radius: disc.radius }
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

    // Dirección opuesta al desplazamiento (-v) con dispersión angular controlada de ±25°
    const baseAngle = Math.atan2(-disc.vy, -disc.vx);
    const spreadRad = (25 * Math.PI) / 180;
    const angle = baseAngle + (Math.random() - 0.5) * (2 * spreadRad);
    const pSpeed = speed * (0.65 + Math.random() * 0.45) + 60;

    const p = this.turboParticles[this.nextParticleIdx];
    this.nextParticleIdx = (this.nextParticleIdx + 1) % this.turboParticles.length;

    p.x = disc.x - (disc.vx / speed) * (disc.radius * 0.85) + (Math.random() - 0.5) * 8;
    p.y = disc.y - (disc.vy / speed) * (disc.radius * 0.85) + (Math.random() - 0.5) * 8;
    p.vx = Math.cos(angle) * pSpeed;
    p.vy = Math.sin(angle) * pSpeed;
    p.size = 2.5 + Math.random() * 2.0;
    p.alpha = 0.95;
    p.active = true;
    p.color = disc.team === 1 ? 'rgba(255, 0, 85, ' : 'rgba(0, 229, 255, ';
  }

  private renderTurboParticles(ctx: CanvasRenderingContext2D): void {
    for (let i = 0; i < this.turboParticles.length; i++) {
      const p = this.turboParticles[i];
      if (!p.active) continue;

      p.x += p.vx * (1 / 60);
      p.y += p.vy * (1 / 60);
      p.alpha *= 0.82; // Desvanecimiento alfa rápido

      if (p.alpha < 0.02) {
        p.active = false;
        continue;
      }

      ctx.save();
      ctx.strokeStyle = `${p.color}${p.alpha})`;
      ctx.fillStyle = `${p.color}${p.alpha})`;
      ctx.lineWidth = p.size;
      ctx.lineCap = 'round';

      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - p.vx * 0.06, p.y - p.vy * 0.06);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * 0.6, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    }
  }

  private renderBall(ctx: CanvasRenderingContext2D, disc: DiscSnapshot): void {
    const radius = disc.radius;
    const { x, y } = disc;
    const vx = disc.vx || 0;
    const vy = disc.vy || 0;
    const dt = 1 / 60;
    const r = Math.max(1, radius);

    // Integración angular en ejes X e Y para rodamiento 3D procedural en tiempo real:
    // Δθx = (vx · dt) / r, Δθy = (vy · dt) / r
    this.ballRollAngleX += (vx * dt) / r;
    this.ballRollAngleY += (vy * dt) / r;

    ctx.save();

    // 1. Sombra Difusa Proyectada en el suelo
    ctx.fillStyle = 'rgba(15, 23, 42, 0.28)';
    ctx.beginPath();
    if (typeof (ctx as any).ellipse === 'function') {
      ctx.ellipse(x + 1.5, y + radius * 0.45, radius * 0.95, radius * 0.55, 0, 0, Math.PI * 2);
    } else {
      ctx.arc(x + 1.5, y + 3, radius, 0, Math.PI * 2);
    }
    ctx.fill();

    // 2. Base esférica recortada (Clip perimétrico del disco)
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    if (typeof ctx.clip === 'function') {
      ctx.clip();
    }

    const skin = this.ballSkin || 'classic';
    const rotX = this.ballRollAngleX;
    const rotY = this.ballRollAngleY;
    const cosX = Math.cos(rotX);
    const sinX = Math.sin(rotX);
    const cosY = Math.cos(rotY);
    const sinY = Math.sin(rotY);

    if (skin === 'retro') {
      // Skin Retro: Cuero marrón clásico cosido
      const baseGrad = ctx.createRadialGradient(
        x - radius * 0.35, y - radius * 0.35, radius * 0.05,
        x, y, radius
      );
      baseGrad.addColorStop(0, '#D97706'); // Highlight ámbar cuero
      baseGrad.addColorStop(0.3, '#B45309');
      baseGrad.addColorStop(0.7, '#78350F');
      baseGrad.addColorStop(1, '#451A03'); // Borde cuero oscuro
      ctx.fillStyle = baseGrad;
      ctx.fill();

      // Costuras longitudinales clásicas en 3D (3 meridianos esféricos rotados)
      ctx.strokeStyle = '#291507';
      ctx.lineWidth = Math.max(1.1, radius * 0.09);
      ctx.lineCap = 'round';

      for (let m = 0; m < 3; m++) {
        const phi = (m * Math.PI) / 3;
        ctx.beginPath();
        let started = false;
        for (let s = -Math.PI; s <= Math.PI; s += 0.2) {
          const pX0 = Math.sin(s) * Math.cos(phi);
          const pY0 = Math.cos(s);
          const pZ0 = Math.sin(s) * Math.sin(phi);

          const pX1 = pX0 * cosX + pZ0 * sinX;
          const pY1 = pY0;
          const pZ1 = -pX0 * sinX + pZ0 * cosX;

          const pX2 = pX1;
          const pY2 = pY1 * cosY - pZ1 * sinY;
          const pZ2 = pY1 * sinY + pZ1 * cosY;

          if (pZ2 >= -0.15) {
            const sx = x + pX2 * radius;
            const sy = y + pY2 * radius;
            if (!started) {
              ctx.moveTo(sx, sy);
              started = true;
            } else {
              ctx.lineTo(sx, sy);
            }
          } else {
            started = false;
          }
        }
        ctx.stroke();
      }
    } else if (skin === 'neon') {
      // Skin Neón: Amarillo/naranja fluorescente de alta visibilidad
      const baseGrad = ctx.createRadialGradient(
        x - radius * 0.35, y - radius * 0.35, radius * 0.05,
        x, y, radius
      );
      baseGrad.addColorStop(0, '#FEF08A'); // Amarillo fluo
      baseGrad.addColorStop(0.35, '#FACC15');
      baseGrad.addColorStop(0.7, '#FB923C'); // Naranja transición
      baseGrad.addColorStop(1, '#EA580C'); // Naranja intenso
      ctx.fillStyle = baseGrad;
      ctx.fill();

      // Paneles y ranuras aerodinámicas neón rotando en 3D
      ctx.strokeStyle = '#C2410C';
      ctx.lineWidth = Math.max(1.2, radius * 0.1);
      for (let m = 0; m < 4; m++) {
        const phi = (m * Math.PI) / 4;
        ctx.beginPath();
        let started = false;
        for (let s = -Math.PI; s <= Math.PI; s += 0.25) {
          const pX0 = Math.sin(s) * Math.cos(phi);
          const pY0 = Math.cos(s);
          const pZ0 = Math.sin(s) * Math.sin(phi);

          const pX1 = pX0 * cosX + pZ0 * sinX;
          const pZ1 = -pX0 * sinX + pZ0 * cosX;
          const pX2 = pX1;
          const pY2 = pY0 * cosY - pZ1 * sinY;
          const pZ2 = pY0 * sinY + pZ1 * cosY;

          if (pZ2 >= -0.1) {
            const sx = x + pX2 * radius;
            const sy = y + pY2 * radius;
            if (!started) {
              ctx.moveTo(sx, sy);
              started = true;
            } else {
              ctx.lineTo(sx, sy);
            }
          } else {
            started = false;
          }
        }
        ctx.stroke();
      }
    } else {
      // Skin Classic: Balón de gajos blancos y negros clásico
      const baseGrad = ctx.createRadialGradient(
        x - radius * 0.35, y - radius * 0.35, radius * 0.05,
        x, y, radius
      );
      baseGrad.addColorStop(0, '#FFFFFF');
      baseGrad.addColorStop(0.35, '#F8FAFC');
      baseGrad.addColorStop(0.7, '#CBD5E1');
      baseGrad.addColorStop(1, '#94A3B8');
      ctx.fillStyle = baseGrad;
      ctx.fill();

      // Proyección 3D de costuras y parches pentagonales negros
      ctx.fillStyle = '#0F172A';
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = Math.max(1.0, radius * 0.08);

      for (let k = 0; k < 12; k++) {
        const vX0 = DiscRenderer.ICOSA_X[k];
        const vY0 = DiscRenderer.ICOSA_Y[k];
        const vZ0 = DiscRenderer.ICOSA_Z[k];

        // Rotación 3D
        const vX1 = vX0 * cosX + vZ0 * sinX;
        const vY1 = vY0;
        const vZ1 = -vX0 * sinX + vZ0 * cosX;

        const vX2 = vX1;
        const vY2 = vY1 * cosY - vZ1 * sinY;
        const vZ2 = vY1 * sinY + vZ1 * cosY;

        if (vZ2 > 0.05) {
          const px = x + vX2 * radius;
          const py = y + vY2 * radius;
          const patchR = radius * 0.28 * Math.sqrt(vZ2);

          ctx.beginPath();
          ctx.arc(px, py, patchR, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Costuras conectando vértices visibles
      for (let a = 0; a < 12; a++) {
        for (let b = a + 1; b < 12; b++) {
          const dx = DiscRenderer.ICOSA_X[a] - DiscRenderer.ICOSA_X[b];
          const dy = DiscRenderer.ICOSA_Y[a] - DiscRenderer.ICOSA_Y[b];
          const dz = DiscRenderer.ICOSA_Z[a] - DiscRenderer.ICOSA_Z[b];
          if (dx * dx + dy * dy + dz * dz < 1.15) {
            const vX1a = DiscRenderer.ICOSA_X[a] * cosX + DiscRenderer.ICOSA_Z[a] * sinX;
            const vZ1a = -DiscRenderer.ICOSA_X[a] * sinX + DiscRenderer.ICOSA_Z[a] * cosX;
            const vY2a = DiscRenderer.ICOSA_Y[a] * cosY - vZ1a * sinY;
            const vZ2a = DiscRenderer.ICOSA_Y[a] * sinY + vZ1a * cosY;

            const vX1b = DiscRenderer.ICOSA_X[b] * cosX + DiscRenderer.ICOSA_Z[b] * sinX;
            const vZ1b = -DiscRenderer.ICOSA_X[b] * sinX + DiscRenderer.ICOSA_Z[b] * cosX;
            const vY2b = DiscRenderer.ICOSA_Y[b] * cosY - vZ1b * sinY;
            const vZ2b = DiscRenderer.ICOSA_Y[b] * sinY + vZ1b * cosY;

            if (vZ2a > -0.1 && vZ2b > -0.1) {
              ctx.beginPath();
              ctx.moveTo(x + vX1a * radius, y + vY2a * radius);
              ctx.lineTo(x + vX1b * radius, y + vY2b * radius);
              ctx.stroke();
            }
          }
        }
      }
    }

    // 3. Brillo y sombreado esférico 3D superior (iluminación cenital)
    const highlightGrad = ctx.createRadialGradient(
      x - radius * 0.35, y - radius * 0.35, 0,
      x, y, radius
    );
    highlightGrad.addColorStop(0, 'rgba(255, 255, 255, 0.45)');
    highlightGrad.addColorStop(0.5, 'rgba(255, 255, 255, 0)');
    highlightGrad.addColorStop(1, 'rgba(0, 0, 0, 0.35)');
    ctx.fillStyle = highlightGrad;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);

    ctx.restore(); // Termina clip esférico

    // 4. Contorno perimetral aero
    ctx.strokeStyle = skin === 'neon' ? '#EA580C' : (skin === 'retro' ? '#451A03' : '#0284C7');
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();
  }

  private renderPlayer(
    ctx: CanvasRenderingContext2D,
    disc: DiscSnapshot,
    isLocal: boolean,
    renderStamina: boolean = true
  ): void {
    // Jugador:
    const radius = disc.radius; // Dinámico según snapshot o config
    const { x, y, team, avatar, kicking } = disc;
    const isRed = team === 1;
    const neonColor = isRed ? '#FF0055' : '#00E5FF';
    const neonGlow = isRed ? 'rgba(255, 0, 85, 0.5)' : 'rgba(0, 229, 255, 0.5)';

    ctx.save();

    // 1. Anillo de Pulso Expansivo Blanco al Activar Patada (Kick)
    if (kicking) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.lineWidth = 6.0;
      ctx.beginPath();
      ctx.arc(x, y, radius + 5.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 3.5;
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
    if (this.playerGlowEnabled) {
      ctx.strokeStyle = neonGlow;
      ctx.lineWidth = 4.8;
      ctx.beginPath();
      ctx.arc(x, y, radius - 0.6, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.strokeStyle = neonColor;
    ctx.lineWidth = 2.4;
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

    // 7. Barra Dual Perimétrica de Estamina (si no se dibujó en la pasada previa de aros)
    if (renderStamina) {
      this.renderStaminaBar(ctx, disc);
    }

    // 8. Indicador del Jugador Local en Verde Neovital
    if (isLocal) {
      ctx.save();
      ctx.strokeStyle = 'rgba(0, 229, 153, 0.35)';
      ctx.lineWidth = 4.5;
      ctx.beginPath();
      ctx.arc(x, y, radius + 11, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = '#00E599';
      ctx.lineWidth = 2.0;
      ctx.beginPath();
      ctx.arc(x, y, radius + 11, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // 9. Indicador Visual de Chat sobre el Avatar (Bocadillo / Globo de Diálogo)
    if (disc.isTyping) {
      this.renderTypingBubble(ctx, disc);
    }

    ctx.restore();
  }

  /**
   * Barra dual perimétrica de estamina concéntrica (R = r + 6px, lineWidth = 2.0px).
   * Tono satinado atenuado (rgba(0, 229, 255, 0.45) en azul y rgba(255, 0, 85, 0.45) en rojo)
   * con resplandor difuso atenuado (shadowBlur <= 3px) para máxima nitidez visual.
   */
  private renderStaminaBar(ctx: CanvasRenderingContext2D, disc: DiscSnapshot): void {
    const isDark = $theme.get() === 'dark';
    const { x, y, radius, stamina, team } = disc;
    const E = stamina !== undefined ? Math.max(0, Math.min(100, stamina)) : 100;
    const ringRadius = radius + 6;
    const lineWidth = 2.0;
    const gap = 0.08;

    const isRed = team === 1;
    const satinColor = isRed ? 'rgba(255, 0, 85, 0.45)' : 'rgba(0, 229, 255, 0.45)';

    ctx.save();
    ctx.lineCap = 'round';

    // 1. Anillo base oscuro discreto (lineWidth = 3.0) debajo de los arcos
    ctx.lineWidth = 3.0;
    ctx.strokeStyle = isDark ? 'rgba(0, 0, 0, 0.45)' : 'rgba(15, 23, 42, 0.35)';

    ctx.beginPath();
    ctx.arc(x, y, ringRadius, gap, Math.PI - gap);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(x, y, ringRadius, Math.PI + gap, Math.PI * 2 - gap);
    ctx.stroke();

    // 2. Pistas de fondo para segmentos no cargados
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(30, 41, 59, 0.18)';

    // Semicírculo 1 Fondo (inferior: 0° a 180°)
    ctx.beginPath();
    ctx.arc(x, y, ringRadius, gap, Math.PI - gap);
    ctx.stroke();

    // Semicírculo 2 Fondo (superior: 180° a 360°)
    ctx.beginPath();
    ctx.arc(x, y, ringRadius, Math.PI + gap, Math.PI * 2 - gap);
    ctx.stroke();



    // 3. Segmento 1 Activo (0% - 50% de estamina)
    const ratio1 = Math.min(1, E / 50);
    if (ratio1 > 0) {
      ctx.save();
      const startAngle1 = gap;
      const endAngle1 = gap + ratio1 * (Math.PI - 2 * gap);

      ctx.lineWidth = lineWidth;
      ctx.strokeStyle = satinColor;

      ctx.beginPath();
      ctx.arc(x, y, ringRadius, startAngle1, endAngle1);
      ctx.stroke();
      ctx.restore();
    }

    // 4. Segmento 2 Activo (50% - 100% de estamina)
    const ratio2 = Math.max(0, Math.min(1, (E - 50) / 50));
    if (ratio2 > 0) {
      ctx.save();
      const startAngle2 = Math.PI + gap;
      const endAngle2 = Math.PI + gap + ratio2 * (Math.PI - 2 * gap);

      ctx.lineWidth = lineWidth;
      ctx.strokeStyle = satinColor;

      ctx.beginPath();
      ctx.arc(x, y, ringRadius, startAngle2, endAngle2);
      ctx.stroke();
      ctx.restore();
    }

    ctx.restore();
  }

  private recordBallTrailPoint(x: number, y: number, spinIntensity: number): void {
    this.ballTrailHead = (this.ballTrailHead + 1) & (DiscRenderer.BALL_TRAIL_CAPACITY - 1);
    this.ballTrailX[this.ballTrailHead] = x;
    this.ballTrailY[this.ballTrailHead] = y;
    this.ballTrailSpin[this.ballTrailHead] = spinIntensity;
    if (this.ballTrailCount < DiscRenderer.BALL_TRAIL_CAPACITY) {
      this.ballTrailCount++;
    }
  }

  private renderBallMagnusTrail(ctx: CanvasRenderingContext2D, ballRadius: number): void {
    if (!this.ballTrailEnabled || this.ballTrailCount < 2) return;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    for (let i = 0; i < this.ballTrailCount; i++) {
      const idx = (this.ballTrailHead - i + DiscRenderer.BALL_TRAIL_CAPACITY) & (DiscRenderer.BALL_TRAIL_CAPACITY - 1);
      const px = this.ballTrailX[idx];
      const py = this.ballTrailY[idx];
      const spin = this.ballTrailSpin[idx];
      const spinMag = Math.min(1.5, Math.abs(spin));

      const taper = Math.max(0, 1 - i / this.ballTrailCount);
      const alpha = taper * Math.min(0.65, 0.15 + spinMag * 0.35);
      const r = ballRadius * (0.35 + 0.65 * taper);

      if (alpha <= 0.01) continue;

      ctx.save();
      // Color de estela según sentido de giro (Z izquierda = cian neón, C derecha = magenta/neón)
      const color = spin < 0 ? `rgba(0, 229, 255, ${alpha})` : `rgba(255, 0, 85, ${alpha})`;
      ctx.fillStyle = color;
      ctx.shadowColor = spin < 0 ? '#00E5FF' : '#FF0055';
      ctx.shadowBlur = 8 * taper;

      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    ctx.restore();
  }

  private recordPowerTrailPoint(x: number, y: number): void {
    this.powerTrailHead = (this.powerTrailHead + 1) & (DiscRenderer.POWER_TRAIL_CAPACITY - 1);
    this.powerTrailX[this.powerTrailHead] = x;
    this.powerTrailY[this.powerTrailHead] = y;
    if (this.powerTrailCount < DiscRenderer.POWER_TRAIL_CAPACITY) {
      this.powerTrailCount++;
    }
  }

  private renderBallPowerTrail(ctx: CanvasRenderingContext2D, ballRadius: number): void {
    if (this.powerTrailCount < 2) return;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    for (let i = 0; i < this.powerTrailCount; i++) {
      const idx = (this.powerTrailHead - i + DiscRenderer.POWER_TRAIL_CAPACITY) & (DiscRenderer.POWER_TRAIL_CAPACITY - 1);
      const px = this.powerTrailX[idx];
      const py = this.powerTrailY[idx];

      const taper = Math.max(0, 1 - i / this.powerTrailCount);
      const alpha = taper * 0.85;
      const r = ballRadius * (0.35 + 0.75 * taper);

      if (alpha <= 0.01) continue;

      ctx.save();
      // Estela fuego / resplandor naranja cinético con desvanecimiento alfa
      ctx.fillStyle = `rgba(255, ${Math.round(80 + 120 * taper)}, 0, ${alpha})`;
      ctx.shadowColor = '#FF4500';
      ctx.shadowBlur = 14 * taper;

      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();

      // Núcleo brillante incandescente
      if (taper > 0.4) {
        ctx.fillStyle = `rgba(255, 255, 220, ${alpha * 0.9})`;
        ctx.beginPath();
        ctx.arc(px, py, r * 0.45, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    ctx.restore();
  }

  private renderTypingBubble(ctx: CanvasRenderingContext2D, disc: DiscSnapshot): void {
    const { x, y, radius } = disc;
    const bx = x;
    const by = y - radius - 15;

    ctx.save();
    const left = bx - 11;
    const top = by - 8;
    const right = bx + 11;
    const bottom = by + 6;
    const r = 5;

    ctx.beginPath();
    ctx.moveTo(left + r, top);
    ctx.lineTo(right - r, top);
    ctx.arcTo(right, top, right, top + r, r);
    ctx.lineTo(right, bottom - r);
    ctx.arcTo(right, bottom, right - r, bottom, r);
    ctx.lineTo(bx + 3, bottom);
    ctx.lineTo(bx, bottom + 4); // Pico apuntando hacia el avatar
    ctx.lineTo(bx - 3, bottom);
    ctx.lineTo(left + r, bottom);
    ctx.arcTo(left, bottom, left, bottom - r, r);
    ctx.lineTo(left, top + r);
    ctx.arcTo(left, top, left + r, top, r);
    ctx.closePath();

    // Relleno sólido blanco aero con sombra difusa
    ctx.fillStyle = '#FFFFFF';
    ctx.shadowColor = 'rgba(0, 229, 255, 0.45)';
    ctx.shadowBlur = 6;
    ctx.fill();

    // Borde técnico
    ctx.strokeStyle = '#0284C7';
    ctx.lineWidth = 1.3;
    ctx.stroke();

    // 3 Puntos animados de escritura
    ctx.fillStyle = '#0F172A';
    const dotR = 1.25;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const t = now / 220;
    for (let d = -1; d <= 1; d++) {
      const bounce = Math.sin(t + d * 1.3) * 1.3;
      ctx.beginPath();
      ctx.arc(bx + d * 4.8, by - 0.5 + bounce, dotR, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }
}
