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
  damping?: number; // default 0.10
  kShape?: number; // default 0.18
  kSpring?: number; // compatibility alias
  color?: string; // default '#717F98'
  cols?: number;  // Compatibility
  rows?: number;  // Compatibility
}

/**
 * GoalNet: Portería de Cuerda Elástica Holgada (Haxball Slack Trapezoid Rope).
 * 
 * Modela la red como una cuerda elástica 1D continua suspendida exclusivamente entre los dos postes:
 * - Anclaje Fijo 1 (Poste Superior): P_0 = (±600, -85) con invMass = 0.
 * - Anclaje Fijo 2 (Poste Inferior): P_{N-1} = (±600, 85) con invMass = 0.
 * - Frente de Portería: Abierto entre P_0 y P_{N-1}.
 * - Geometría en Reposo: Trapecio holgado con esquinas redondeadas (N = 11 partículas):
 *     * Esquina superior redondeada: curva suave desde (±600, -85) hasta (±635, -65).
 *     * Fondo de la red: segmento vertical en X = ±635 entre Y = -65 e Y = 65.
 *     * Esquina inferior redondeada: curva suave desde (±635, 65) hasta (±600, 85).
 * - Integración Verlet a 60 Hz con masa m = 0.4 (w_i = 2.5) y damping ~ 0.10.
 * - Fuerza de memoria de forma: F_restore = -k_shape * (p_i - restPos_i) con k_shape ~ 0.18.
 * - Restricciones de distancia: 3 iteraciones Gauss-Seidel entre nodos consecutivos.
 * - Interacción Balón vs Cuerda: Disipación cinética (v_ball <- v_ball * 0.65) y deformación elástica.
 * - Tope elástico posterior en X = ±640 para retener el balón dentro sin rebotes violentos.
 * - Permeabilidad absoluta para jugadores: cMask estricto a ['ball'], disc.isBall === false ignorado al 100%.
 * - Invariante Hard Rule: Cero alocaciones en bucle caliente (Zero-GC Float32Array).
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
    this.backX = options.backX;
    this.topY = options.topY;
    this.bottomY = options.bottomY;
    this.topCornerY = options.topCornerY ?? (this.topY < 0 ? -65 : 65);
    this.bottomCornerY = options.bottomCornerY ?? (this.bottomY > 0 ? 65 : -65);

    // Límite posterior de tensión máxima en X = ±640
    if (options.rearLimitX !== undefined) {
      this.rearLimitX = options.rearLimitX;
    } else {
      this.rearLimitX = this.side === 'left' ? -640 : 640;
    }

    this.damping = options.damping ?? 0.10;
    this.kShape = options.kShape ?? options.kSpring ?? 0.18;
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
   */
  private initGeometry(): void {
    const N = this.nodeCount;

    for (let i = 0; i < N; i++) {
      const u = i / (N - 1); // Rango 0.0 a 1.0
      let x = this.mouthX;
      let y = this.topY;

      if (u <= 0.25) {
        // Esquina superior redondeada: Curva cuadrática suave de (mouthX, topY) a (backX, topCornerY)
        const t = u / 0.25;
        const oneMinusT = 1 - t;
        // P0=(mouthX, topY), C=(backX, topY), P1=(backX, topCornerY)
        x = oneMinusT * oneMinusT * this.mouthX + 2 * oneMinusT * t * this.backX + t * t * this.backX;
        y = oneMinusT * oneMinusT * this.topY + 2 * oneMinusT * t * this.topY + t * t * this.topCornerY;
      } else if (u <= 0.75) {
        // Fondo de la red: Segmento vertical holgado en X = backX entre topCornerY y bottomCornerY
        const t = (u - 0.25) / 0.5;
        x = this.backX;
        y = this.topCornerY + t * (this.bottomCornerY - this.topCornerY);
      } else {
        // Esquina inferior redondeada: Curva cuadrática suave de (backX, bottomCornerY) a (mouthX, bottomY)
        const t = (u - 0.75) / 0.25;
        const oneMinusT = 1 - t;
        // P0=(backX, bottomCornerY), C=(backX, bottomY), P1=(mouthX, bottomY)
        x = oneMinusT * oneMinusT * this.backX + 2 * oneMinusT * t * this.backX + t * t * this.mouthX;
        y = oneMinusT * oneMinusT * this.bottomCornerY + 2 * oneMinusT * t * this.bottomY + t * t * this.bottomY;
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
   * 
   * Filtro estricto: Si disc no es balón (!disc.isBall), se ignora completamente.
   * Los jugadores atraviesan la red con permeabilidad 100% libre de colisiones.
   */
  public step(
    ball?: { pos: { x: number; y: number }; vel: { x: number; y: number }; radius?: number; isBall?: boolean } | null,
    _dt: number = 1 / 60
  ): void {
    const N = this.nodeCount;
    const damping = this.damping;
    const kShape = this.kShape;

    // 1. Integración Temporal Verlet con Damping y Fuerza de Memoria de Forma
    // v_i = (p_t - p_{t-dt}) * (1 - damping)
    // p_{t+dt} = p_t + v_i - k_shape * (p_t - restPos)
    for (let i = 1; i < N - 1; i++) {
      const vx = (this.posX[i] - this.oldPosX[i]) * (1 - damping);
      const vy = (this.posY[i] - this.oldPosY[i]) * (1 - damping);

      const restoreX = -kShape * (this.posX[i] - this.restPosX[i]);
      const restoreY = -kShape * (this.posY[i] - this.restPosY[i]);

      const nextX = this.posX[i] + vx + restoreX;
      const nextY = this.posY[i] + vy + restoreY;

      this.oldPosX[i] = this.posX[i];
      this.oldPosY[i] = this.posY[i];
      this.posX[i] = nextX;
      this.posY[i] = nextY;
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

    // 3. Tope posterior de tensión máxima en X = ±640
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

    // 4. Interacción Balón vs. Cuerda (Permeabilidad absoluta para jugadores)
    // PROHIBIDO colisionar o modificar velocidad/posición si no es el balón
    if (ball && (ball.isBall === undefined || ball.isBall === true)) {
      const bx = ball.pos.x;
      const by = ball.pos.y;
      const rBall = ball.radius ?? 5.8;

      const minX = Math.min(this.mouthX, this.rearLimitX) - rBall - 10;
      const maxX = Math.max(this.mouthX, this.rearLimitX) + rBall + 10;
      const minY = Math.min(this.topY, this.bottomY) - rBall - 10;
      const maxY = Math.max(this.topY, this.bottomY) + rBall + 10;

      // Guarda AABB rápida para evitar cálculos innecesarios fuera del arco
      if (bx >= minX && bx <= maxX && by >= minY && by <= maxY) {
        let ballDamped = false;

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

            // Deformación de la cuerda: desplazar nodos i e i+1 en dirección del movimiento hacia el fondo
            const pushX = -nx * pen;
            const pushY = -ny * pen;

            if (this.invMass[i] > 0) {
              this.posX[i] += pushX * (1 - t);
              this.posY[i] += pushY * (1 - t);
              if (this.side === 'left' && this.posX[i] < this.rearLimitX) this.posX[i] = this.rearLimitX;
              if (this.side === 'right' && this.posX[i] > this.rearLimitX) this.posX[i] = this.rearLimitX;
            }
            if (this.invMass[i + 1] > 0) {
              this.posX[i + 1] += pushX * t;
              this.posY[i + 1] += pushY * t;
              if (this.side === 'left' && this.posX[i + 1] < this.rearLimitX) this.posX[i + 1] = this.rearLimitX;
              if (this.side === 'right' && this.posX[i + 1] > this.rearLimitX) this.posX[i + 1] = this.rearLimitX;
            }

            // Freno y Retención del Balón: absorbe energía cinética y disipa la velocidad
            // v_ball <- v_ball * 0.65
            if (!ballDamped) {
              ball.vel.x *= 0.65;
              ball.vel.y *= 0.65;
              ballDamped = true;
            }

            // Retención elástica suave dentro de la portería
            ball.pos.x += nx * (pen * 0.4);
            ball.pos.y += ny * (pen * 0.4);
          }
        }

        // Si la cuerda alcanza su tensión máxima (X = ±640), actúa como tope elástico suave
        if (this.side === 'left') {
          if (ball.pos.x - rBall < this.rearLimitX) {
            ball.pos.x = this.rearLimitX + rBall;
            if (ball.vel.x < 0) ball.vel.x *= -0.2;
          }
        } else {
          if (ball.pos.x + rBall > this.rearLimitX) {
            ball.pos.x = this.rearLimitX - rBall;
            if (ball.vel.x > 0) ball.vel.x *= -0.2;
          }
        }
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
   * Restablece todos los nodos a su geometría de reposo.
   */
  public reset(): void {
    for (let i = 0; i < this.nodeCount; i++) {
      this.posX[i] = this.restPosX[i];
      this.posY[i] = this.restPosY[i];
      this.oldPosX[i] = this.restPosX[i];
      this.oldPosY[i] = this.restPosY[i];
    }
  }
}
