export interface GoalNetOptions {
  side: 'left' | 'right' | 'red' | 'blue';
  mouthX: number; // Front line of the goal / posts (e.g. -600 or 600)
  backX?: number;  // Back corner line (e.g. -636 or 636)
  depth?: number;  // Depth of the box net (default ≈ 36 px)
  topY: number;   // Top post (e.g. -85)
  bottomY: number;// Bottom post (e.g. 85)
  topCornerY?: number; // Compatibility
  bottomCornerY?: number; // Compatibility
  rearLimitX?: number; // Hard stop back limit (e.g. -650 or 650)
  nodeCount?: number; // default 15 (particles in back drop net chain)
  damping?: number; // default 0.05 (underdamped, range [0.045, 0.055])
  kSpring?: number; // default 0.14 (restoring spring, range [0.12, 0.16])
  kShape?: number; // compatibility alias of kSpring
  nodeMass?: number; // default 0.40 (invMass = 2.5)
  color?: string; // default '#717F98'
  cols?: number;  // Compatibility
  rows?: number;  // Compatibility
}

/** Minimal kinematic view of the ball used by the net (structural typing, Zero-GC). */
export interface NetBall {
  pos: { x: number; y: number };
  vel: { x: number; y: number };
  radius?: number;
  isBall?: boolean;
}

/** Fixed simulation step (60 Hz). */
const FIXED_DT = 1 / 60;
/** Default physical parameters of the underdamped net. */
const DEFAULT_NODE_COUNT = 15;
const DEFAULT_NODE_MASS = 0.40;
const DEFAULT_K_SPRING = 0.14;
const DEFAULT_DAMPING = 0.05;
/**
 * Normalization of k_spring into the tick domain: (F/m)·Δt² is evaluated with Δt measured
 * in fixed ticks and this gain, giving ω = sqrt(k·w·gain) ≈ 0.17 rad/tick for k = 0.14, m = 0.40.
 * Period ≈ 37 ticks (~0.6 s) → 2–3 visible harmonic cycles in ~1.5 s, ζ ≈ 0.15 (< 1).
 */
const SPRING_TICK_GAIN = 1 / 12;
/** Gauss-Seidel iterations for distance / bending constraints. */
const CONSTRAINT_ITERATIONS = 2;
/** Max elastic elongation of each segment (25 %). */
const MAX_ELONGATION = 1.25;
/** Minimum second-neighbor distance ratio (anti-loop). */
const BEND_MIN_RATIO = 0.85;
/** Momentum transfer ratio |v_ball|·0.30 applied along impact normal. */
const PUSH_RATIO = 0.30;
/** Tension deceleration gain and clamp. */
const TENSION_GAIN = 0.75;
const TENSION_MAX = 0.90;
/** Ball inverse mass used to split contact penetration with the net nodes. */
const BALL_INV_MASS = 1.0;
/** Countdown smooth reset lerp factor. */
const RELAX_LERP = 0.06;

/**
 * GoalNet: Portería de Caja 2D (4 anclajes) con Red Elástica Subamortiguada.
 *
 * - 4 Anclajes Rígidos (invMass = 0): P_top, P_bottom (postes) y S_top, S_bottom (esquinas traseras).
 * - Laterales tensados semirrígidos (P_top→S_top, P_bottom→S_bottom) que deslizan el balón al fondo.
 * - Cortina de fondo: cadena Verlet de N = 15 partículas (m = 0.40, w = 2.5) entre S_top y S_bottom.
 *
 * Modelo físico (oscilador armónico subamortiguado, ζ < 1):
 *   F_spring,i = -k_spring · (p_i - restPos_i)                  (cero efecto plastilina)
 *   v_i        = (p_i,t - p_i,t-Δt) · (1 - damping)
 *   p_i,t+Δt   = p_i,t + v_i + (F_spring,i / m) · Δt²
 *   + 2 iteraciones Gauss-Seidel de distancia (elongación máx. 25 %), flexión anti-bucle (i, i+2)
 *     y orden monótono en Y.
 *
 * Interacción con el balón:
 *   - Transferencia progresiva de momento a_push = n̂ · |v_ball| · 0.30 (sin frenado en seco).
 *   - Desaceleración por tensión: F = clamp(|p_net - rest| / profMax · 0.75, 0, 0.90).
 *   - Contención unilateral infranqueable: el balón jamás cruza la cortina hacia afuera.
 *   - Permeabilidad absoluta para jugadores (sólo interactúa con el balón).
 *
 * Invariante Zero-GC: todo el estado vive en Float32Array prealocados en el constructor.
 */
export class GoalNet {
  public side: 'left' | 'right';
  public nodeCount: number;

  // 4 Anclajes rígidos
  public mouthX: number;
  public backX: number;
  public depth: number;
  public topY: number;
  public bottomY: number;
  public rearLimitX: number;

  public pTopX: number;
  public pTopY: number;
  public pBottomX: number;
  public pBottomY: number;
  public sTopX: number;
  public sTopY: number;
  public sBottomX: number;
  public sBottomY: number;

  // Buffers de partículas para la cortina de fondo (Zero-GC: Float32Array)
  public posX: Float32Array;
  public posY: Float32Array;
  public oldPosX: Float32Array;
  public oldPosY: Float32Array;
  public restPosX: Float32Array;
  public restPosY: Float32Array;
  public invMass: Float32Array;
  public restLen: Float32Array;
  public restLenBend: Float32Array;

  // Compatibility aliases
  public prevX: Float32Array;
  public prevY: Float32Array;
  public restX: Float32Array;
  public restY: Float32Array;
  public segRestLen: Float32Array;

  public damping: number;
  public kSpring: number;
  public kShape: number; // alias de kSpring (compatibilidad)
  public nodeMass: number;
  public relaxationIterations: number = CONSTRAINT_ITERATIONS;
  public color: string;
  public isRelaxing: boolean = false;

  constructor(options: GoalNetOptions) {
    this.side = (options.side === 'red' || options.side === 'left') ? 'left' : 'right';
    this.mouthX = options.mouthX;
    const signX = this.mouthX < 0 ? -1 : 1;

    this.depth = options.depth ?? (options.backX !== undefined ? Math.abs(options.backX - this.mouthX) : 36);
    this.backX = options.backX ?? (this.mouthX + signX * this.depth);
    this.topY = options.topY;
    this.bottomY = options.bottomY;

    this.pTopX = this.mouthX;
    this.pTopY = this.topY;
    this.pBottomX = this.mouthX;
    this.pBottomY = this.bottomY;
    this.sTopX = this.backX;
    this.sTopY = this.topY;
    this.sBottomX = this.backX;
    this.sBottomY = this.bottomY;

    this.rearLimitX = options.rearLimitX ?? (this.backX + signX * 14);

    this.damping = options.damping ?? DEFAULT_DAMPING;
    this.kSpring = options.kSpring ?? options.kShape ?? DEFAULT_K_SPRING;
    this.kShape = this.kSpring;
    this.nodeMass = options.nodeMass ?? DEFAULT_NODE_MASS;
    this.color = options.color ?? '#717F98';

    this.nodeCount = options.nodeCount ?? DEFAULT_NODE_COUNT;
    if (this.nodeCount < 4) this.nodeCount = DEFAULT_NODE_COUNT;

    const N = this.nodeCount;
    this.posX = new Float32Array(N);
    this.posY = new Float32Array(N);
    this.oldPosX = new Float32Array(N);
    this.oldPosY = new Float32Array(N);
    this.restPosX = new Float32Array(N);
    this.restPosY = new Float32Array(N);
    this.invMass = new Float32Array(N);
    this.restLen = new Float32Array(N - 1);
    this.restLenBend = new Float32Array(N - 2);

    this.prevX = this.oldPosX;
    this.prevY = this.oldPosY;
    this.restX = this.restPosX;
    this.restY = this.restPosY;
    this.segRestLen = this.restLen;

    this.initGeometry();
  }

  /** Geometría de reposo: cortina con concavidad suave hacia atrás, anclada en S_top / S_bottom. */
  private initGeometry(): void {
    const N = this.nodeCount;
    const signX = this.mouthX < 0 ? -1 : 1;
    const w = 1 / this.nodeMass;

    for (let i = 0; i < N; i++) {
      const u = i / (N - 1);
      const y = this.topY + u * (this.bottomY - this.topY);
      const slack = 4 * u * (1 - u);
      const x = this.backX + signX * (3.5 * slack);

      this.restPosX[i] = x;
      this.restPosY[i] = y;
      this.invMass[i] = (i === 0 || i === N - 1) ? 0 : w;
    }

    this.restPosX[0] = this.sTopX;
    this.restPosY[0] = this.sTopY;
    this.restPosX[N - 1] = this.sBottomX;
    this.restPosY[N - 1] = this.sBottomY;

    for (let i = 0; i < N; i++) {
      this.posX[i] = this.restPosX[i];
      this.posY[i] = this.restPosY[i];
      this.oldPosX[i] = this.restPosX[i];
      this.oldPosY[i] = this.restPosY[i];
    }

    for (let i = 0; i < N - 1; i++) {
      this.restLen[i] = Math.hypot(this.restPosX[i + 1] - this.restPosX[i], this.restPosY[i + 1] - this.restPosY[i]);
    }
    for (let i = 0; i < N - 2; i++) {
      this.restLenBend[i] = Math.hypot(this.restPosX[i + 2] - this.restPosX[i], this.restPosY[i + 2] - this.restPosY[i]);
    }
  }

  /**
   * Paso determinista de simulación a 60 Hz (Zero-GC).
   * Acepta `step(dt)` o `step(ball, dt)` (en el segundo caso avanza el balón y resuelve la colisión).
   */
  public step(ballOrDt?: NetBall | number | null, maybeDt: number = FIXED_DT): void {
    let dt = FIXED_DT;
    let ball: NetBall | null = null;
    if (typeof ballOrDt === 'number') {
      dt = ballOrDt;
    } else if (ballOrDt && typeof ballOrDt === 'object') {
      ball = ballOrDt;
      dt = maybeDt;
    }

    const N = this.nodeCount;
    const keep = 1 - this.damping;
    const springK = this.kSpring * SPRING_TICK_GAIN;

    // 1. Integración Verlet subamortiguada con resorte de restitución
    for (let i = 1; i < N - 1; i++) {
      const w = this.invMass[i];
      const px = this.posX[i];
      const py = this.posY[i];
      const ox = px - this.restPosX[i];
      const oy = py - this.restPosY[i];

      // (F_spring / m) · Δt²  con F_spring = -k · (p - rest)
      let ax = -springK * w * ox;
      let ay = -springK * w * oy;

      if (this.isRelaxing) {
        ax -= ox * RELAX_LERP;
        ay -= oy * RELAX_LERP;
      }

      const vx = (px - this.oldPosX[i]) * keep;
      const vy = (py - this.oldPosY[i]) * keep;

      this.oldPosX[i] = px;
      this.oldPosY[i] = py;
      this.posX[i] = px + vx + ax;
      this.posY[i] = py + vy + ay;
    }

    // 2. Restricciones (Gauss-Seidel)
    this.solveConstraints();

    // 3. Tope posterior y saneamiento numérico (anti-NaN)
    this.clampRearAndSanitize();

    // 4. Convergencia del modo de relajación suave
    if (this.isRelaxing) {
      let maxDev = 0;
      for (let i = 1; i < N - 1; i++) {
        const dx = Math.abs(this.posX[i] - this.restPosX[i]);
        const dy = Math.abs(this.posY[i] - this.restPosY[i]);
        if (dx > maxDev) maxDev = dx;
        if (dy > maxDev) maxDev = dy;
      }
      if (maxDev < 0.05) this.resetShape(false);
    }

    // 5. Uso aislado (tests): avanzar el balón y resolver colisión
    if (ball && ball.isBall !== false) {
      ball.pos.x += ball.vel.x * dt;
      ball.pos.y += ball.vel.y * dt;
      this.checkBallCollision(ball);
    }
  }

  private solveConstraints(): void {
    const N = this.nodeCount;
    for (let iter = 0; iter < this.relaxationIterations; iter++) {
      // A. Distancia entre vecinos (i, i+1): corrección suave hacia L0 + tope duro en 1.25·L0
      for (let i = 0; i < N - 1; i++) {
        const w1 = this.invMass[i];
        const w2 = this.invMass[i + 1];
        const wSum = w1 + w2;
        if (wSum <= 0) continue;

        let dx = this.posX[i + 1] - this.posX[i];
        let dy = this.posY[i + 1] - this.posY[i];
        let d = Math.hypot(dx, dy);
        if (d < 1e-6) continue;

        const l0 = this.restLen[i];
        if (Math.abs(d - l0) < 1e-4) continue; // dead-zone: evita micro-deriva por redondeo Float32
        const soft = ((d - l0) / d) * 0.5;
        const s1 = soft * (w1 / wSum);
        const s2 = soft * (w2 / wSum);
        this.posX[i] += dx * s1;
        this.posY[i] += dy * s1;
        this.posX[i + 1] -= dx * s2;
        this.posY[i + 1] -= dy * s2;

        const lMax = l0 * MAX_ELONGATION;
        dx = this.posX[i + 1] - this.posX[i];
        dy = this.posY[i + 1] - this.posY[i];
        d = Math.hypot(dx, dy);
        if (d > lMax) {
          const hard = (d - lMax) / d;
          const h1 = hard * (w1 / wSum);
          const h2 = hard * (w2 / wSum);
          this.posX[i] += dx * h1;
          this.posY[i] += dy * h1;
          this.posX[i + 1] -= dx * h2;
          this.posY[i + 1] -= dy * h2;
        }
      }

      // B. Flexión anti-bucle (i, i+2): d_b >= 0.85 · L_bend
      for (let i = 0; i < N - 2; i++) {
        const w1 = this.invMass[i];
        const w2 = this.invMass[i + 2];
        const wSum = w1 + w2;
        if (wSum <= 0) continue;

        const dbx = this.posX[i + 2] - this.posX[i];
        const dby = this.posY[i + 2] - this.posY[i];
        const db = Math.hypot(dbx, dby);
        const lMin = this.restLenBend[i] * BEND_MIN_RATIO;
        if (db >= lMin) continue;

        let cx: number;
        let cy: number;
        if (db > 1e-6) {
          const diff = (db - lMin) / db;
          cx = dbx * diff;
          cy = dby * diff;
        } else {
          cx = 0;
          cy = -lMin;
        }
        this.posX[i] += cx * (w1 / wSum);
        this.posY[i] += cy * (w1 / wSum);
        this.posX[i + 2] -= cx * (w2 / wSum);
        this.posY[i + 2] -= cy * (w2 / wSum);
      }

      // C. Orden monótono en Y
      for (let i = 0; i < N - 1; i++) {
        if (this.posY[i + 1] <= this.posY[i]) {
          this.posY[i + 1] = this.posY[i] + 1.0;
        }
      }

      // D. Re-anclaje inviolable
      this.posX[0] = this.sTopX;
      this.posY[0] = this.sTopY;
      this.posX[N - 1] = this.sBottomX;
      this.posY[N - 1] = this.sBottomY;
    }
  }

  private clampRearAndSanitize(): void {
    const N = this.nodeCount;
    const left = this.side === 'left';
    for (let i = 1; i < N - 1; i++) {
      if (!Number.isFinite(this.posX[i]) || !Number.isFinite(this.posY[i]) ||
          !Number.isFinite(this.oldPosX[i]) || !Number.isFinite(this.oldPosY[i])) {
        this.posX[i] = this.restPosX[i];
        this.posY[i] = this.restPosY[i];
        this.oldPosX[i] = this.restPosX[i];
        this.oldPosY[i] = this.restPosY[i];
        continue;
      }
      if (left ? this.posX[i] < this.rearLimitX : this.posX[i] > this.rearLimitX) {
        this.posX[i] = this.rearLimitX;
      }
    }
  }

  /**
   * Colisión determinista Balón-Red:
   * - Deflexión en laterales tensados semirrígidos.
   * - Transferencia progresiva de momento y desaceleración por tensión en la cortina.
   * - Contención unilateral infranqueable (anti-tunneling).
   * - Permeabilidad absoluta para jugadores (ignora discos con isBall === false).
   */
  public checkBallCollision(ball?: NetBall | null): void {
    if (!ball || ball.isBall === false) return;

    const rBall = ball.radius ?? 5.8;
    const signX = this.mouthX < 0 ? -1 : 1;

    const minX = Math.min(this.mouthX, this.rearLimitX) - rBall - 15;
    const maxX = Math.max(this.mouthX, this.rearLimitX) + rBall + 15;
    const minY = Math.min(this.topY, this.bottomY) - rBall - 15;
    const maxY = Math.max(this.topY, this.bottomY) + rBall + 15;
    if (ball.pos.x < minX || ball.pos.x > maxX || ball.pos.y < minY || ball.pos.y > maxY) return;

    const N = this.nodeCount;

    // 1. LATERALES TENSADOS SEMIRRÍGIDOS
    const xMinSide = Math.min(this.mouthX, this.backX) - rBall;
    const xMaxSide = Math.max(this.mouthX, this.backX) + rBall;
    if (ball.pos.x >= xMinSide && ball.pos.x <= xMaxSide) {
      if (Math.abs(ball.pos.y - this.topY) < rBall) {
        ball.pos.y = this.topY + rBall;
        if (ball.vel.y < 0) ball.vel.y = -ball.vel.y * 0.35;
        ball.vel.x = signX * (Math.abs(ball.vel.x) * 0.7 + 2.5);
      }
      if (Math.abs(ball.pos.y - this.bottomY) < rBall) {
        ball.pos.y = this.bottomY - rBall;
        if (ball.vel.y > 0) ball.vel.y = -ball.vel.y * 0.35;
        ball.vel.x = signX * (Math.abs(ball.vel.x) * 0.7 + 2.5);
      }
    }

    // 2. CORTINA DE FONDO: contacto, cesión, transferencia de momento y tensión
    const speed = Math.hypot(ball.vel.x, ball.vel.y);
    const push = speed * PUSH_RATIO * FIXED_DT; // a_push · Δt
    const profMax = Math.max(1, Math.abs(this.rearLimitX - this.backX));
    let maxDeform = -1;

    for (let i = 0; i < N - 1; i++) {
      const x0 = this.posX[i];
      const y0 = this.posY[i];
      const sx = this.posX[i + 1] - x0;
      const sy = this.posY[i + 1] - y0;
      const sLenSq = sx * sx + sy * sy;
      if (sLenSq < 1e-6) continue;

      const t = ((ball.pos.x - x0) * sx + (ball.pos.y - y0) * sy) / sLenSq;
      if (t < 0 || t > 1) continue;

      // Normal del segmento orientada hacia el campo (-signX)
      const sLen = Math.sqrt(sLenSq);
      let nx = -sy / sLen;
      let ny = sx / sLen;
      if (nx * -signX < 0) {
        nx = -nx;
        ny = -ny;
      }

      const qx = x0 + t * sx;
      const qy = y0 + t * sy;
      const sDist = (ball.pos.x - qx) * nx + (ball.pos.y - qy) * ny; // distancia con signo (lado campo > 0)
      if (sDist >= rBall || sDist < -(rBall + 20)) continue;

      const pen = rBall - sDist;
      const w1 = this.invMass[i];
      const w2 = this.invMass[i + 1];
      const wNet = (1 - t) * w1 + t * w2;
      const wTotal = wNet + BALL_INV_MASS;
      const netShare = wNet > 0 ? pen * (wNet / wTotal) : 0;
      const ballShare = pen - netShare;

      // Cesión de la red (barycentric) + empuje progresivo a_push·Δt hacia el fondo (−n̂)
      const denom = (1 - t) * (1 - t) + t * t;
      const yieldScale = denom > 1e-6 ? netShare / denom : 0;
      if (w1 > 0) {
        const m1 = yieldScale * (1 - t) + push;
        this.posX[i] -= nx * m1;
        this.posY[i] -= ny * m1;
      }
      if (w2 > 0) {
        const m2 = yieldScale * t + push;
        this.posX[i + 1] -= nx * m2;
        this.posY[i + 1] -= ny * m2;
      }

      // El balón sólo se separa la parte de la penetración que no absorbe la red
      ball.pos.x += nx * ballShare;
      ball.pos.y += ny * ballShare;

      // Deformación local respecto a reposo en el punto de contacto
      const curQx = this.posX[i] + t * (this.posX[i + 1] - this.posX[i]);
      const curQy = this.posY[i] + t * (this.posY[i + 1] - this.posY[i]);
      const restQx = this.restPosX[i] + t * (this.restPosX[i + 1] - this.restPosX[i]);
      const restQy = this.restPosY[i] + t * (this.restPosY[i + 1] - this.restPosY[i]);
      const deform = Math.hypot(curQx - restQx, curQy - restQy);
      if (deform > maxDeform) maxDeform = deform;
    }

    if (maxDeform >= 0) {
      this.clampRearAndSanitize();
      // Desaceleración elástica progresiva (Δt normalizado al tick fijo)
      let fTension = (maxDeform / profMax) * TENSION_GAIN;
      if (fTension < 0) fTension = 0;
      if (fTension > TENSION_MAX) fTension = TENSION_MAX;
      ball.vel.x *= (1 - fTension);
      ball.vel.y *= (1 - fTension);
    }

    // 3. CONTENCIÓN UNILATERAL INFRANQUEABLE
    const by = ball.pos.y;
    for (let k = 0; k < N - 1; k++) {
      const ya = this.posY[k];
      const yb = this.posY[k + 1];
      if (by < ya || by > yb) continue;
      const segDy = yb - ya;
      const tSeg = segDy > 1e-4 ? (by - ya) / segDy : 0.5;
      const xSeg = this.posX[k] + tSeg * (this.posX[k + 1] - this.posX[k]);
      if (signX > 0) {
        if (ball.pos.x > xSeg - rBall) {
          ball.pos.x = xSeg - rBall;
          if (ball.vel.x > 0) ball.vel.x = 0;
        }
      } else if (ball.pos.x < xSeg + rBall) {
        ball.pos.x = xSeg + rBall;
        if (ball.vel.x < 0) ball.vel.x = 0;
      }
      break;
    }

    // 4. TOPE ABSOLUTO DE FONDO
    if (signX < 0) {
      if (ball.pos.x - rBall < this.rearLimitX) {
        ball.pos.x = this.rearLimitX + rBall;
        if (ball.vel.x < 0) ball.vel.x = 0;
      }
    } else if (ball.pos.x + rBall > this.rearLimitX) {
      ball.pos.x = this.rearLimitX - rBall;
      if (ball.vel.x > 0) ball.vel.x = 0;
    }
  }

  /** Colisión explícita: filtra estrictamente discos que no sean el balón. */
  public resolveDiscCollision(disc: NetBall | null | undefined): void {
    if (!disc || !disc.isBall) return;
    this.step(disc, FIXED_DT);
  }

  /** Render Canvas 2D Zero-GC: laterales, cortina con curvas cuadráticas y costillas de profundidad. */
  public render(ctx: CanvasRenderingContext2D): void {
    const N = this.nodeCount;
    if (N < 2) return;

    ctx.save();
    ctx.strokeStyle = this.color;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // 1. Laterales tensados
    ctx.beginPath();
    ctx.moveTo(this.pTopX, this.pTopY);
    ctx.lineTo(this.posX[0], this.posY[0]);
    ctx.moveTo(this.pBottomX, this.pBottomY);
    ctx.lineTo(this.posX[N - 1], this.posY[N - 1]);
    ctx.stroke();

    // 2. Cortina de fondo (curva continua cuadrática por puntos medios)
    ctx.beginPath();
    ctx.moveTo(this.posX[0], this.posY[0]);
    if (typeof ctx.quadraticCurveTo === 'function') {
      for (let i = 1; i < N - 1; i++) {
        const xc = (this.posX[i] + this.posX[i + 1]) * 0.5;
        const yc = (this.posY[i] + this.posY[i + 1]) * 0.5;
        ctx.quadraticCurveTo(this.posX[i], this.posY[i], xc, yc);
      }
      ctx.lineTo(this.posX[N - 1], this.posY[N - 1]);
    } else {
      for (let i = 1; i < N; i++) ctx.lineTo(this.posX[i], this.posY[i]);
    }
    ctx.stroke();

    // 3. Costillas de profundidad
    ctx.globalAlpha = 0.28;
    ctx.lineWidth = 1;
    const ribCount = 4;
    for (let k = 1; k < ribCount; k++) {
      const u = k / ribCount;
      const frontY = this.pTopY + u * (this.pBottomY - this.pTopY);
      const nodeIdx = Math.min(N - 2, Math.floor(u * (N - 1)));
      const tSub = (u * (N - 1)) - nodeIdx;
      const bx = this.posX[nodeIdx] + tSub * (this.posX[nodeIdx + 1] - this.posX[nodeIdx]);
      const byy = this.posY[nodeIdx] + tSub * (this.posY[nodeIdx + 1] - this.posY[nodeIdx]);
      ctx.beginPath();
      ctx.moveTo(this.mouthX, frontY);
      ctx.lineTo(bx, byy);
      ctx.stroke();
    }

    ctx.restore();
  }

  /**
   * Restauración de la red:
   * - smooth === false: p_i = restPos_i y velocidades a cero.
   * - smooth === true: relajación adicional (lerp 0.06 por tick) durante COUNTDOWN.
   */
  public resetShape(smooth: boolean = false): void {
    if (!smooth) {
      this.isRelaxing = false;
      for (let i = 0; i < this.nodeCount; i++) {
        this.posX[i] = this.restPosX[i];
        this.posY[i] = this.restPosY[i];
        this.oldPosX[i] = this.restPosX[i];
        this.oldPosY[i] = this.restPosY[i];
      }
    } else {
      this.isRelaxing = true;
    }
  }

  /** Alias de resetShape(false). */
  public reset(): void {
    this.resetShape(false);
  }

  /** Energía/desviación máxima respecto al reposo (útil para tests y telemetría). */
  public maxDeviation(): number {
    let maxDev = 0;
    for (let i = 1; i < this.nodeCount - 1; i++) {
      const d = Math.hypot(this.posX[i] - this.restPosX[i], this.posY[i] - this.restPosY[i]);
      if (d > maxDev) maxDev = d;
    }
    return maxDev;
  }
}
