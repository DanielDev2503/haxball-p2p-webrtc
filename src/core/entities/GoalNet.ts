export interface GoalNetOptions {
  side: 'left' | 'right' | 'red' | 'blue';
  mouthX: number; // Front line of the goal (e.g. -600 or 600)
  backX: number;  // Back of the net (e.g. -635 or 635)
  topY: number;   // Top post (e.g. -85)
  bottomY: number;// Bottom post (e.g. 85)
  nodeCount?: number; // default 11 (between 9 and 13)
  cols?: number;  // Compatibility
  rows?: number;  // Compatibility
  damping?: number; // default 0.12
  kSpring?: number; // default 0.15
  color?: string; // default '#717F98'
}

/**
 * GoalNet: Modelo Físico de Cuerda Elástica 1D para Porterías (Haxball Rope Net).
 * 
 * Modela la red como una cuerda elástica continua suspendida entre los postes:
 * - Poste Superior: Anclaje fijo P_top = (mouthX, topY) con invMass = 0.
 * - Poste Inferior: Anclaje fijo P_bottom = (mouthX, bottomY) con invMass = 0.
 * - Fondo de la Red: Discretizada en N partículas intermedias dinámicas (m = 0.5, w = 2.0).
 * - Integración Verlet con damping (~0.12).
 * - Relajación de restricciones de distancia (tensión de cuerda).
 * - Fuerza de retorno hacia la curvatura de reposo (k_spring ~0.15).
 * - Colisión exclusiva con balón (cMask: ['ball']) con disipación cinética (v_ball * 0.75).
 * - Renderizado continuo suavizado con curvas cuadráticas en Canvas 2D (#717F98, 2px).
 * - Invariante Hard Rule: Cero alocaciones en bucle caliente (Zero-GC Float32Array).
 */
export class GoalNet {
  public side: 'left' | 'right';
  public nodeCount: number;

  // Particle buffers (Zero-GC: Float32Array)
  public posX: Float32Array;
  public posY: Float32Array;
  public prevX: Float32Array;
  public prevY: Float32Array;
  public restX: Float32Array;
  public restY: Float32Array;
  public invMass: Float32Array;

  // Segment rest length buffer
  public segRestLen: Float32Array;

  public damping: number = 0.12;
  public kSpring: number = 0.15;
  public relaxationIterations: number = 5;
  public color: string = '#717F98';

  public mouthX: number;
  public backX: number;
  public topY: number;
  public bottomY: number;

  constructor(options: GoalNetOptions) {
    this.side = (options.side === 'red' || options.side === 'left') ? 'left' : 'right';
    this.mouthX = options.mouthX;
    this.backX = options.backX;
    this.topY = options.topY;
    this.bottomY = options.bottomY;
    this.damping = options.damping ?? 0.12;
    this.kSpring = options.kSpring ?? 0.15;
    this.color = options.color ?? '#717F98';

    // Discretización en N partículas intermedias dinámicas (rango 9 - 13, default 11)
    this.nodeCount = options.nodeCount ?? 11;
    if (this.nodeCount < 5) this.nodeCount = 11;

    // Preallocate typed arrays
    this.posX = new Float32Array(this.nodeCount);
    this.posY = new Float32Array(this.nodeCount);
    this.prevX = new Float32Array(this.nodeCount);
    this.prevY = new Float32Array(this.nodeCount);
    this.restX = new Float32Array(this.nodeCount);
    this.restY = new Float32Array(this.nodeCount);
    this.invMass = new Float32Array(this.nodeCount);
    this.segRestLen = new Float32Array(this.nodeCount - 1);

    this.initGeometry();
  }

  private initGeometry(): void {
    const N = this.nodeCount;
    const depth = Math.abs(this.backX - this.mouthX);
    const height = Math.abs(this.bottomY - this.topY);
    const totalLen = depth + height + depth; // top side + back wall + bottom side

    // Construir contorno natural de reposo de la portería
    for (let i = 0; i < N; i++) {
      const dist = (i / (N - 1)) * totalLen;
      let x = this.mouthX;
      let y = this.topY;

      if (dist <= depth) {
        // Lado superior del arco
        const t = depth > 0 ? dist / depth : 0;
        x = this.mouthX + t * (this.backX - this.mouthX);
        y = this.topY;
      } else if (dist <= depth + height) {
        // Pared trasera de la red
        const t = height > 0 ? (dist - depth) / height : 0;
        x = this.backX;
        y = this.topY + t * (this.bottomY - this.topY);
      } else {
        // Lado inferior del arco
        const t = depth > 0 ? (dist - (depth + height)) / depth : 0;
        x = this.backX + t * (this.mouthX - this.backX);
        y = this.bottomY;
      }

      this.restX[i] = x;
      this.restY[i] = y;
      this.posX[i] = x;
      this.posY[i] = y;
      this.prevX[i] = x;
      this.prevY[i] = y;

      // Anclajes fijos en postes: invMass = 0
      // Nodos intermedios dinámicos: masa m = 0.5 => invMass = 2.0 (w_i = 2.0)
      if (i === 0 || i === N - 1) {
        this.invMass[i] = 0;
      } else {
        this.invMass[i] = 2.0;
      }
    }

    // Longitud de reposo de cada segmento
    for (let i = 0; i < N - 1; i++) {
      const dx = this.restX[i + 1] - this.restX[i];
      const dy = this.restY[i + 1] - this.restY[i];
      this.segRestLen[i] = Math.hypot(dx, dy);
    }
  }

  /**
   * Paso determinista de simulación de cuerda elástica a 60 Hz (Zero-GC).
   */
  public step(
    ball?: { pos: { x: number; y: number }; vel: { x: number; y: number }; radius?: number } | null,
    dt: number = 1 / 60
  ): void {
    const N = this.nodeCount;

    // 1. Integración Temporal Verlet con Damping y Restauración Elástica
    for (let i = 1; i < N - 1; i++) {
      const vx = (this.posX[i] - this.prevX[i]) * (1 - this.damping);
      const vy = (this.posY[i] - this.prevY[i]) * (1 - this.damping);

      // Fuerza de retorno a la posición de reposo: F = -k * (p - p_reposo)
      const restFx = -this.kSpring * (this.posX[i] - this.restX[i]);
      const restFy = -this.kSpring * (this.posY[i] - this.restY[i]);

      // Aceleración: a = F * invMass
      const ax = restFx * this.invMass[i];
      const ay = restFy * this.invMass[i];

      const nextX = this.posX[i] + vx + ax * dt;
      const nextY = this.posY[i] + vy + ay * dt;

      this.prevX[i] = this.posX[i];
      this.prevY[i] = this.posY[i];
      this.posX[i] = nextX;
      this.posY[i] = nextY;
    }

    // 2. Relajación de Restricciones de Distancia (Tensión de la Cuerda)
    for (let iter = 0; iter < this.relaxationIterations; iter++) {
      for (let i = 0; i < N - 1; i++) {
        const dx = this.posX[i + 1] - this.posX[i];
        const dy = this.posY[i + 1] - this.posY[i];
        const dist = Math.hypot(dx, dy);

        if (dist > 1e-6) {
          const ratio = (dist - this.segRestLen[i]) / dist;
          const w1 = this.invMass[i];
          const w2 = this.invMass[i + 1];
          const totalW = w1 + w2;

          if (totalW > 0) {
            const corrX = dx * ratio;
            const corrY = dy * ratio;
            this.posX[i] += corrX * (w1 / totalW);
            this.posY[i] += corrY * (w1 / totalW);
            this.posX[i + 1] -= corrX * (w2 / totalW);
            this.posY[i + 1] -= corrY * (w2 / totalW);
          }
        }
      }
    }

    // 3. Colisión Balón vs. Cuerda Elástica (cMask: ['ball'])
    if (ball) {
      const bx = ball.pos.x;
      const by = ball.pos.y;
      const rBall = ball.radius ?? 5.8;

      const minX = Math.min(this.mouthX, this.backX) - rBall - 15;
      const maxX = Math.max(this.mouthX, this.backX) + rBall + 15;
      const minY = this.topY - rBall - 15;
      const maxY = this.bottomY + rBall + 15;

      // Guarda AABB rápida para evitar cálculos cuando el balón está lejos del arco
      if (bx >= minX && bx <= maxX && by >= minY && by <= maxY) {
        let ballDamped = false;
        for (let i = 0; i < N - 1; i++) {
          const x0 = this.posX[i];
          const y0 = this.posY[i];
          const sx = this.posX[i + 1] - x0;
          const sy = this.posY[i + 1] - y0;
          const slen2 = sx * sx + sy * sy;

          if (slen2 < 1e-6) continue;

          // Proyección ortogonal del centro del balón sobre el segmento
          const t = Math.max(0, Math.min(1, ((bx - x0) * sx + (by - y0) * sy) / slen2));
          const cx = x0 + t * sx;
          const cy = y0 + t * sy;
          const dx = bx - cx;
          const dy = by - cy;
          const dist = Math.hypot(dx, dy);

          if (dist < rBall) {
            const penetration = rBall - dist;
            let nx = dist > 1e-4 ? dx / dist : (this.side === 'left' ? 1 : -1);
            let ny = dist > 1e-4 ? dy / dist : 0;

            // Desplazar los nodos de la cuerda hacia el fondo del arco
            const pushX = -nx * penetration;
            const pushY = -ny * penetration;

            if (this.invMass[i] > 0) {
              this.posX[i] += pushX * (1 - t) * 0.9;
              this.posY[i] += pushY * (1 - t) * 0.9;
            }
            if (this.invMass[i + 1] > 0) {
              this.posX[i + 1] += pushX * t * 0.9;
              this.posY[i + 1] += pushY * t * 0.9;
            }

            // La cuerda disipa la energía cinética del balón (v_ball <- v_ball * 0.75)
            if (!ballDamped) {
              ball.vel.x *= 0.75;
              ball.vel.y *= 0.75;
              ballDamped = true;
            }

            // Reacción elástica de amortiguación para retener el balón dentro de la red
            ball.pos.x += nx * (penetration * 0.35);
            ball.pos.y += ny * (penetration * 0.35);
          }
        }
      }
    }
  }

  /**
   * Dibuja la cuerda elástica continua suavizada en Canvas 2D (curvas cuadráticas).
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
      this.posX[i] = this.restX[i];
      this.posY[i] = this.restY[i];
      this.prevX[i] = this.restX[i];
      this.prevY[i] = this.restY[i];
    }
  }
}
