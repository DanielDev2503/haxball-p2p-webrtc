export interface GoalNetOptions {
  side: 'left' | 'right' | 'red' | 'blue';
  mouthX: number; // Front line of the goal (e.g. -600 or 600)
  backX: number;  // Back of the net (e.g. -635 or 635)
  topY: number;   // Top post (e.g. -85)
  bottomY: number;// Bottom post (e.g. 85)
  topCornerY?: number; // default -65
  bottomCornerY?: number; // default 65
  rearLimitX?: number; // default -640 or 640
  nodeCount?: number; // default 11 (particles in rope)
  damping?: number; // default 0.20
  kShape?: number; // default 0
  kSpring?: number; // compatibility alias
  color?: string; // default '#717F98'
  cols?: number;  // Compatibility
  rows?: number;  // Compatibility
}

/**
 * GoalNet: Portería de Cuerda Viscoelástica Holgada con Memoria Plástica (Viscoelastic Plastic Retaining Rope).
 * 
 * - Anclaje Fijo 1 (Poste Superior): P_0 = (±600, -85) con invMass = 0.
 * - Anclaje Fijo 2 (Poste Inferior): P_{N-1} = (±600, 85) con invMass = 0.
 * - Geometría en Reposo: Trapecio holgado con esquinas redondeadas (N = 11 partículas).
 * - Integración Verlet a 60 Hz con masa m = 0.4 (w_i = 2.5) y damping viscoso ~ 0.20.
 * - Eliminación del resorte continuo de retorno (kShape = 0 en juego activo): la red absorbe el impacto y
 *   retiene su deformación plástica transitoria envolviendo el balón sin intentar regresar de forma autónoma.
 * - Absorción viscoelástica instantánea: v_ball <- v_ball * 0.35 y arrastre de deformación en los nodos.
 * - Restricciones de distancia: 3 iteraciones Gauss-Seidel entre nodos consecutivos.
 * - Ciclo de restauración: resetShape(smooth: boolean) (instantáneo o relajación suave a 0.08 por tick en COUNTDOWN).
 * - Permeabilidad absoluta para jugadores: cMask estricto a ['ball'], disc.isBall === false ignorado al 100%.
 * - Invariante Hard Rule: Cero alocaciones en bucles calientes (Zero-GC Float32Array).
 */
export class GoalNet {
  public side: 'left' | 'right';
  public nodeCount: number;

  // Particle buffers (Zero-GC: Float32Array)
  public posX: Float32Array;
  public posY: Float32Array;
  public oldPosX: Float32Array;
  public oldPosY: Float32Array;
  public restPosX: Float32Array;
  public restPosY: Float32Array;
  public invMass: Float32Array;
  public restLen: Float32Array;

  // Compatibility aliases
  public prevX: Float32Array;
  public prevY: Float32Array;
  public restX: Float32Array;
  public restY: Float32Array;
  public segRestLen: Float32Array;

  public damping: number;
  public kShape: number;
  public kSpring: number;
  public relaxationIterations: number = 3;
  public color: string;
  public isRelaxing: boolean = false;

  public mouthX: number;
  public backX: number;
  public topY: number;
  public bottomY: number;
  public topCornerY: number;
  public bottomCornerY: number;
  public rearLimitX: number;

  constructor(options: GoalNetOptions) {
    this.side = (options.side === 'red' || options.side === 'left') ? 'left' : 'right';
    this.mouthX = options.mouthX;
    const signX = this.mouthX < 0 ? -1 : 1;
    this.backX = options.backX ?? (this.mouthX + signX * 38);
    this.topY = options.topY;
    this.bottomY = options.bottomY;

    const yPost = Math.max(Math.abs(this.topY), Math.abs(this.bottomY));
    const yCorner = yPost * 0.75;
    this.topCornerY = options.topCornerY ?? -yCorner;
    this.bottomCornerY = options.bottomCornerY ?? yCorner;

    // Límite de elongación máxima en X = X_back ± 12 px
    if (options.rearLimitX !== undefined) {
      this.rearLimitX = options.rearLimitX;
    } else {
      this.rearLimitX = this.backX + signX * 12;
    }

    this.damping = options.damping ?? 0.20;
    this.kShape = options.kShape ?? options.kSpring ?? 0;
    this.kSpring = this.kShape;
    this.color = options.color ?? '#717F98';

    // Discretización en N = 11 partículas
    this.nodeCount = options.nodeCount ?? 11;
    if (this.nodeCount < 5) this.nodeCount = 11;

    // Prealocación Zero-GC en arreglos tipados
    this.posX = new Float32Array(this.nodeCount);
    this.posY = new Float32Array(this.nodeCount);
    this.oldPosX = new Float32Array(this.nodeCount);
    this.oldPosY = new Float32Array(this.nodeCount);
    this.restPosX = new Float32Array(this.nodeCount);
    this.restPosY = new Float32Array(this.nodeCount);
    this.invMass = new Float32Array(this.nodeCount);
    this.restLen = new Float32Array(this.nodeCount - 1);

    // Aliases para compatibilidad con código existente
    this.prevX = this.oldPosX;
    this.prevY = this.oldPosY;
    this.restX = this.restPosX;
    this.restY = this.restPosY;
    this.segRestLen = this.restLen;

    this.initGeometry();
  }

  /**
   * Inicializa la geometría en reposo del trapecio holgado con esquinas redondeadas.
   * Adaptable a cualquier tamaño de arco y coordenadas de postes.
   */
  private initGeometry(): void {
    const N = this.nodeCount;
    const xPost = this.mouthX;
    const yPost = Math.max(Math.abs(this.topY), Math.abs(this.bottomY));
    const xBack = this.backX;
    const yCorner = yPost * 0.75;

    for (let i = 0; i < N; i++) {
      let x = xPost;
      let y = -yPost;

      if (i === 0) {
        // Poste Superior (Anclaje fijo)
        x = xPost;
        y = -yPost;
      } else if (i >= 1 && i <= 3) {
        // Nodos 1 a 3: Esquina redondeada superior que curva suavemente desde P_top hacia (X_back, -y_post * 0.75)
        const t = i / 3.5;
        const oneMinusT = 1 - t;
        // Curva Bezier cuadrática con punto de control (xBack, -yPost)
        x = oneMinusT * oneMinusT * xPost + 2 * oneMinusT * t * xBack + t * t * xBack;
        y = oneMinusT * oneMinusT * (-yPost) + 2 * oneMinusT * t * (-yPost) + t * t * (-yCorner);
      } else if (i >= 4 && i <= 6) {
        // Nodos 4 a 6: Fondo holgado de la red en X = X_back entre -y_post * 0.75 y y_post * 0.75
        const t = (i - 3.5) / 3.0; // t varia simétricamente alrededor de 0.5 (nodo 5 en y = 0)
        x = xBack;
        y = -yCorner + t * (2 * yCorner);
      } else if (i >= 7 && i <= 9) {
        // Nodos 7 a 9: Esquina redondeada inferior que curva suavemente desde (X_back, y_post * 0.75) hacia P_bottom
        const k = i - 6; // 1, 2, 3
        const t = k / 3.5;
        const oneMinusT = 1 - t;
        // Curva Bezier cuadrática desde (xBack, yCorner) a (xPost, yPost) con control (xBack, yPost)
        x = oneMinusT * oneMinusT * xBack + 2 * oneMinusT * t * xBack + t * t * xPost;
        y = oneMinusT * oneMinusT * yCorner + 2 * oneMinusT * t * yPost + t * t * yPost;
      } else {
        // Nodo 10 (N - 1): Poste Inferior (Anclaje fijo)
        x = xPost;
        y = yPost;
      }

      this.restPosX[i] = x;
      this.restPosY[i] = y;
      this.posX[i] = x;
      this.posY[i] = y;
      this.oldPosX[i] = x;
      this.oldPosY[i] = y;

      // Anclajes fijos en postes: invMass = 0 (w = 0)
      // Nodos intermedios móviles: masa m = 0.4 => invMass = 1 / 0.4 = 2.5 (w_i = 2.5)
      if (i === 0 || i === N - 1) {
        this.invMass[i] = 0;
      } else {
        this.invMass[i] = 2.5;
      }
    }

    // Longitud de reposo de cada segmento
    for (let i = 0; i < N - 1; i++) {
      const dx = this.restPosX[i + 1] - this.restPosX[i];
      const dy = this.restPosY[i + 1] - this.restPosY[i];
      this.restLen[i] = Math.hypot(dx, dy);
    }
  }

  /**
   * Paso determinista de simulación de cuerda elástica holgada a 60 Hz (Zero-GC).
   * Soporta tanto llamada unificada step(ball, dt) como paso desacoplado step(dt).
   */
  public step(
    ballOrDt?: { pos: { x: number; y: number }; vel: { x: number; y: number }; radius?: number; isBall?: boolean } | number | null,
    maybeDt: number = 1 / 60
  ): void {
    let _dt = 1 / 60;
    let ball: { pos: { x: number; y: number }; vel: { x: number; y: number }; radius?: number; isBall?: boolean } | null = null;

    if (typeof ballOrDt === 'number') {
      _dt = ballOrDt;
    } else if (ballOrDt && typeof ballOrDt === 'object') {
      ball = ballOrDt;
      if (typeof maybeDt === 'number') _dt = maybeDt;
    }
    void _dt;

    const N = this.nodeCount;
    const damping = this.damping;
    const kShape = this.kShape;

    // 1. Integración Temporal Verlet con Damping y Modo de Relajación Suave (Kickoff)
    // Durante juego activo: kShape = 0 (memoria plástica transitoria, sin resorte continuo).
    // Si isRelaxing es true (COUNTDOWN): aplica interpolación suave p_i <- p_i + (restPos_i - p_i) * 0.08
    for (let i = 1; i < N - 1; i++) {
      let restoreX = 0;
      let restoreY = 0;

      if (this.isRelaxing) {
        restoreX = (this.restPosX[i] - this.posX[i]) * 0.08;
        restoreY = (this.restPosY[i] - this.posY[i]) * 0.08;
      } else if (kShape > 0) {
        restoreX = -kShape * (this.posX[i] - this.restPosX[i]);
        restoreY = -kShape * (this.posY[i] - this.restPosY[i]);
      }

      const vx = (this.posX[i] - this.oldPosX[i]) * (1 - damping);
      const vy = (this.posY[i] - this.oldPosY[i]) * (1 - damping);

      const nextX = this.posX[i] + vx + restoreX;
      const nextY = this.posY[i] + vy + restoreY;

      this.oldPosX[i] = this.posX[i];
      this.oldPosY[i] = this.posY[i];
      this.posX[i] = nextX;
      this.posY[i] = nextY;
    }

    // Comprobación de convergencia para el modo de relajación suave
    if (this.isRelaxing) {
      let maxDev = 0;
      for (let i = 1; i < N - 1; i++) {
        const dx = Math.abs(this.posX[i] - this.restPosX[i]);
        const dy = Math.abs(this.posY[i] - this.restPosY[i]);
        if (dx > maxDev) maxDev = dx;
        if (dy > maxDev) maxDev = dy;
      }
      if (maxDev < 0.05) {
        this.resetShape(false);
      }
    }

    // 2. Relajación de Restricciones de Distancia (3 iteraciones Gauss-Seidel)
    for (let iter = 0; iter < this.relaxationIterations; iter++) {
      for (let i = 0; i < N - 1; i++) {
        const dx = this.posX[i + 1] - this.posX[i];
        const dy = this.posY[i + 1] - this.posY[i];
        const d = Math.hypot(dx, dy);

        if (d > 1e-6) {
          const diff = (d - this.restLen[i]) / d;
          const w1 = this.invMass[i];
          const w2 = this.invMass[i + 1];
          const wSum = w1 + w2;

          if (wSum > 0) {
            const corrX = dx * diff;
            const corrY = dy * diff;
            this.posX[i] += corrX * (w1 / wSum);
            this.posY[i] += corrY * (w1 / wSum);
            this.posX[i + 1] -= corrX * (w2 / wSum);
            this.posY[i + 1] -= corrY * (w2 / wSum);
          }
        }
      }

      // Re-anclaje inviolable de los postes superior e inferior
      this.posX[0] = this.restPosX[0];
      this.posY[0] = this.restPosY[0];
      this.posX[N - 1] = this.restPosX[N - 1];
      this.posY[N - 1] = this.restPosY[N - 1];
    }

    // 3. Tope posterior de tensión máxima (X = X_back ± 12 px)
    if (this.side === 'left') {
      for (let i = 1; i < N - 1; i++) {
        if (this.posX[i] < this.rearLimitX) {
          this.posX[i] = this.rearLimitX;
        }
      }
    } else {
      for (let i = 1; i < N - 1; i++) {
        if (this.posX[i] > this.rearLimitX) {
          this.posX[i] = this.rearLimitX;
        }
      }
    }

    // 4. Si se proveyó el balón directamente a step, verificar colisión
    if (ball) {
      this.checkBallCollision(ball);
    }
  }

  /**
   * Cálculo determinista de Colisión Balón-Segmento (Cuerda Elástica Viscoelástica).
   * Permeabilidad absoluta para jugadores (ignora disc si !isBall).
   */
  public checkBallCollision(
    ball?: { pos: { x: number; y: number }; vel: { x: number; y: number }; radius?: number; isBall?: boolean } | null
  ): void {
    if (!ball || ball.isBall === false) return;

    const bx = ball.pos.x;
    const by = ball.pos.y;
    const rBall = ball.radius ?? 5.8;

    const minX = Math.min(this.mouthX, this.rearLimitX) - rBall - 10;
    const maxX = Math.max(this.mouthX, this.rearLimitX) + rBall + 10;
    const minY = Math.min(this.topY, this.bottomY) - rBall - 10;
    const maxY = Math.max(this.topY, this.bottomY) + rBall + 10;

    // Guarda AABB rápida para evitar cálculos innecesarios fuera del arco
    if (bx < minX || bx > maxX || by < minY || by > maxY) {
      return;
    }

    let ballDamped = false;
    const N = this.nodeCount;

    for (let i = 0; i < N - 1; i++) {
      const x0 = this.posX[i];
      const y0 = this.posY[i];
      const sx = this.posX[i + 1] - x0;
      const sy = this.posY[i + 1] - y0;
      const sLenSq = sx * sx + sy * sy;

      if (sLenSq < 1e-6) continue;

      // Proyección del centro del balón sobre el segmento de cuerda
      const t = Math.max(0, Math.min(1, ((bx - x0) * sx + (by - y0) * sy) / sLenSq));
      const qx = x0 + t * sx;
      const qy = y0 + t * sy;
      const dx = bx - qx;
      const dy = by - qy;
      const d = Math.hypot(dx, dy);

      if (d < rBall) {
        const pen = rBall - d;
        let nx = d > 1e-4 ? dx / d : (this.side === 'left' ? 1 : -1);
        let ny = d > 1e-4 ? dy / d : 0;

        // Arrastre de deformación: desplaza los nodos i e i+1 en dirección del vector de velocidad del balón v_ball
        // y la penetración normal estirando la cuerda hacia la profundidad del arco
        const dragX = ball.vel.x * 0.06 - nx * pen;
        const dragY = ball.vel.y * 0.06 - ny * pen;

        if (this.invMass[i] > 0) {
          this.posX[i] += dragX * (1 - t);
          this.posY[i] += dragY * (1 - t);
          if (this.side === 'left' && this.posX[i] < this.rearLimitX) this.posX[i] = this.rearLimitX;
          if (this.side === 'right' && this.posX[i] > this.rearLimitX) this.posX[i] = this.rearLimitX;
        }
        if (this.invMass[i + 1] > 0) {
          this.posX[i + 1] += dragX * t;
          this.posY[i + 1] += dragY * t;
          if (this.side === 'left' && this.posX[i + 1] < this.rearLimitX) this.posX[i + 1] = this.rearLimitX;
          if (this.side === 'right' && this.posX[i + 1] > this.rearLimitX) this.posX[i + 1] = this.rearLimitX;
        }

        // Disipación viscosa instantánea: el balón pierde casi toda su energía cinética en el contacto:
        // v_ball <- v_ball * 0.35
        if (!ballDamped) {
          ball.vel.x *= 0.35;
          ball.vel.y *= 0.35;
          ballDamped = true;
        }

        // Retención elástica suave dentro de la portería
        ball.pos.x += nx * (pen * 0.4);
        ball.pos.y += ny * (pen * 0.4);
      }
    }

    // Límite de contención: Si la cuerda alcanza su elongación máxima (X = X_back ± 12 px),
    // aplica una fuerza de restitución normal que retiene firmemente el balón dentro de la portería
    if (this.side === 'left') {
      if (ball.pos.x - rBall < this.rearLimitX) {
        ball.pos.x = this.rearLimitX + rBall;
        ball.vel.x = 0;
        ball.vel.y *= 0.5;
      }
    } else {
      if (ball.pos.x + rBall > this.rearLimitX) {
        ball.pos.x = this.rearLimitX - rBall;
        ball.vel.x = 0;
        ball.vel.y *= 0.5;
      }
    }
  }

  /**
   * Método de colisión explícito para validación arquitectónica.
   * Filtra estrictamente discos que no sean el balón.
   */
  public resolveDiscCollision(disc: any): void {
    if (!disc || !disc.isBall) return;
    this.step(disc, 1 / 60);
  }

  /**
   * Dibuja la cuerda elástica continua suavizada en Canvas 2D usando curvas cuadráticas.
   */
  public render(ctx: CanvasRenderingContext2D): void {
    const N = this.nodeCount;
    if (N < 2) return;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(this.posX[0], this.posY[0]);

    if (typeof ctx.quadraticCurveTo === 'function') {
      for (let i = 0; i < N - 1; i++) {
        const xc = (this.posX[i] + this.posX[i + 1]) * 0.5;
        const yc = (this.posY[i] + this.posY[i + 1]) * 0.5;
        ctx.quadraticCurveTo(this.posX[i], this.posY[i], xc, yc);
      }
    } else {
      for (let i = 1; i < N; i++) {
        ctx.lineTo(this.posX[i], this.posY[i]);
      }
    }
    ctx.lineTo(this.posX[N - 1], this.posY[N - 1]);

    ctx.strokeStyle = this.color;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Ciclo de Restauración de la Red (Kickoff Reset):
   * - smooth === false: Reasigna instantáneamente p_i = restPos_i y resetea velocidades a cero.
   * - smooth === true: Activa modo de relajación durante COUNTDOWN (p_i <- p_i + (restPos_i - p_i) * 0.08 por tick).
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

  /**
   * Restablece todos los nodos a su geometría de reposo (alias de resetShape(false)).
   */
  public reset(): void {
    this.resetShape(false);
  }
}
