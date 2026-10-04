export interface GoalNetOptions {
  side: 'left' | 'right' | 'red' | 'blue';
  mouthX: number; // Front line of the goal (e.g. -600 or 600)
  backX: number;  // Back of the net (e.g. -635 or 635)
  topY: number;   // Top post (e.g. -85)
  bottomY: number;// Bottom post (e.g. 85)
  cols?: number;  // default 6
  rows?: number;  // default 5
}

/**
 * GoalNet: Simulación física 2D de malla/cuerda deformable para porterías.
 * Utiliza integración Verlet determinista y relajación de restricciones elásticas (Mass-Spring).
 * Invariante Hard Rule: Cero alocaciones en el bucle caliente (Zero-GC) utilizando Float32Array e Int32Array.
 */
export class GoalNet {
  public side: 'left' | 'right';
  public cols: number;
  public rows: number;
  public nodeCount: number;
  public edgeCount: number = 0;

  // Particle buffers (Zero-GC: Float32Array)
  public posX: Float32Array;
  public posY: Float32Array;
  public prevX: Float32Array;
  public prevY: Float32Array;
  public restX: Float32Array;
  public restY: Float32Array;
  public invMass: Float32Array;

  // Spring edge buffers (Int32Array & Float32Array)
  public edgeA: Int32Array;
  public edgeB: Int32Array;
  public restLen: Float32Array;

  public damping: number = 0.08;
  public relaxationIterations: number = 3;

  public mouthX: number;
  public backX: number;
  public topY: number;
  public bottomY: number;

  constructor(options: GoalNetOptions) {
    this.side = (options.side === 'red' || options.side === 'left') ? 'left' : 'right';
    this.cols = options.cols ?? 6;
    this.rows = options.rows ?? 5;
    this.mouthX = options.mouthX;
    this.backX = options.backX;
    this.topY = options.topY;
    this.bottomY = options.bottomY;

    this.nodeCount = this.cols * this.rows;

    // Preallocate node arrays
    this.posX = new Float32Array(this.nodeCount);
    this.posY = new Float32Array(this.nodeCount);
    this.prevX = new Float32Array(this.nodeCount);
    this.prevY = new Float32Array(this.nodeCount);
    this.restX = new Float32Array(this.nodeCount);
    this.restY = new Float32Array(this.nodeCount);
    this.invMass = new Float32Array(this.nodeCount);

    // Build rest node positions
    for (let r = 0; r < this.rows; r++) {
      const vRatio = this.rows > 1 ? r / (this.rows - 1) : 0;
      const y = this.topY + vRatio * (this.bottomY - this.topY);

      for (let c = 0; c < this.cols; c++) {
        const uRatio = this.cols > 1 ? c / (this.cols - 1) : 0;
        const x = this.mouthX + uRatio * (this.backX - this.mouthX);

        const idx = r * this.cols + c;
        this.restX[idx] = x;
        this.restY[idx] = y;
        this.posX[idx] = x;
        this.posY[idx] = y;
        this.prevX[idx] = x;
        this.prevY[idx] = y;

        // Nodos anclados (fijos, invMass = 0):
        // 1. Postes superior e inferior en la boca (c = 0, r = 0) y (c = 0, r = rows - 1)
        // 2. Esquinas exteriores del marco de la portería (c = cols - 1, r = 0) y (c = cols - 1, r = rows - 1)
        const isPostTop = (c === 0 && r === 0);
        const isPostBottom = (c === 0 && r === this.rows - 1);
        const isCornerTop = (c === this.cols - 1 && r === 0);
        const isCornerBottom = (c === this.cols - 1 && r === this.rows - 1);

        if (isPostTop || isPostBottom || isCornerTop || isCornerBottom) {
          this.invMass[idx] = 0; // Anclado fijo
        } else {
          this.invMass[idx] = 1.0; // Nodo dinámico
        }
      }
    }

    // Temporary list for building edges without GC in tick
    const edgesList: Array<{ a: number; b: number; len: number }> = [];

    // Horizontal edges between (c, r) and (c+1, r)
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols - 1; c++) {
        const a = r * this.cols + c;
        const b = r * this.cols + (c + 1);
        const dx = this.restX[a] - this.restX[b];
        const dy = this.restY[a] - this.restY[b];
        edgesList.push({ a, b, len: Math.hypot(dx, dy) });
      }
    }

    // Vertical edges between (c, r) and (c, r+1)
    // Note: Do NOT add vertical edges across the open mouth (c = 0, 0 < r < rows - 1) to allow entry
    for (let c = 1; c < this.cols; c++) {
      for (let r = 0; r < this.rows - 1; r++) {
        const a = r * this.cols + c;
        const b = (r + 1) * this.cols + c;
        const dx = this.restX[a] - this.restX[b];
        const dy = this.restY[a] - this.restY[b];
        edgesList.push({ a, b, len: Math.hypot(dx, dy) });
      }
    }

    // Diagonal shear springs for structural cloth stability (excluding mouth c=0)
    for (let c = 1; c < this.cols - 1; c++) {
      for (let r = 0; r < this.rows - 1; r++) {
        const a = r * this.cols + c;
        const b = (r + 1) * this.cols + (c + 1);
        const dx = this.restX[a] - this.restX[b];
        const dy = this.restY[a] - this.restY[b];
        edgesList.push({ a, b, len: Math.hypot(dx, dy) });

        const a2 = (r + 1) * this.cols + c;
        const b2 = r * this.cols + (c + 1);
        const dx2 = this.restX[a2] - this.restX[b2];
        const dy2 = this.restY[a2] - this.restY[b2];
        edgesList.push({ a: a2, b: b2, len: Math.hypot(dx2, dy2) });
      }
    }

    this.edgeCount = edgesList.length;
    this.edgeA = new Int32Array(this.edgeCount);
    this.edgeB = new Int32Array(this.edgeCount);
    this.restLen = new Float32Array(this.edgeCount);

    for (let i = 0; i < this.edgeCount; i++) {
      this.edgeA[i] = edgesList[i].a;
      this.edgeB[i] = edgesList[i].b;
      this.restLen[i] = edgesList[i].len;
    }
  }

  /**
   * Resets all particle positions to their original rest geometry.
   */
  public reset(): void {
    for (let i = 0; i < this.nodeCount; i++) {
      this.posX[i] = this.restX[i];
      this.posY[i] = this.restY[i];
      this.prevX[i] = this.restX[i];
      this.prevY[i] = this.restY[i];
    }
  }

  /**
   * Tick simulation: Verlet integration + Spring relaxation + Ball interaction.
   * Zero GC allocations.
   */
  public step(
    ball?: { pos: { x: number; y: number }; vel: { x: number; y: number }; radius: number } | null,
    _dt: number = 1 / 60
  ): void {
    const damping = this.damping;

    // 1. Verlet Integration for each dynamic node
    for (let i = 0; i < this.nodeCount; i++) {
      if (this.invMass[i] <= 0) continue;

      const tempX = this.posX[i];
      const tempY = this.posY[i];

      const vx = (tempX - this.prevX[i]) * (1 - damping);
      const vy = (tempY - this.prevY[i]) * (1 - damping);

      // Light restoring spring force towards rest position to prevent perpetual sagging
      const springBackX = (this.restX[i] - tempX) * 0.15;
      const springBackY = (this.restY[i] - tempY) * 0.15;

      this.posX[i] += vx + springBackX;
      this.posY[i] += vy + springBackY;

      this.prevX[i] = tempX;
      this.prevY[i] = tempY;
    }

    // 2. Ball-Net Interaction (Push & Elastic deceleration)
    if (ball) {
      const bx = ball.pos.x;
      const by = ball.pos.y;
      const br = ball.radius || 5.8;
      const interactionRadius = br + 4.0;
      const interactionRadiusSq = interactionRadius * interactionRadius;

      // Check if ball is in the vicinity of this goal
      const inX = this.side === 'left'
        ? (bx <= this.mouthX + br && bx >= this.backX - br * 2)
        : (bx >= this.mouthX - br && bx <= this.backX + br * 2);
      const inY = by >= this.topY - br * 2 && by <= this.bottomY + br * 2;

      if (inX && inY) {
        for (let i = 0; i < this.nodeCount; i++) {
          if (this.invMass[i] <= 0) continue;

          const dx = this.posX[i] - bx;
          const dy = this.posY[i] - by;
          const distSq = dx * dx + dy * dy;

          if (distSq < interactionRadiusSq && distSq > 1e-6) {
            const dist = Math.sqrt(distSq);
            const overlap = interactionRadius - dist;
            const nx = dx / dist;
            const ny = dy / dist;

            // Push node away from the ball center
            this.posX[i] += nx * overlap * 0.75;
            this.posY[i] += ny * overlap * 0.75;

            // Transmit elastic friction damping to the ball entering the net
            ball.vel.x *= 0.88;
            ball.vel.y *= 0.88;
          }
        }
      }
    }

    // 3. Spring Constraints Relaxation (Gauss-Seidel iterations)
    for (let iter = 0; iter < this.relaxationIterations; iter++) {
      for (let k = 0; k < this.edgeCount; k++) {
        const a = this.edgeA[k];
        const b = this.edgeB[k];

        const wA = this.invMass[a];
        const wB = this.invMass[b];
        const wSum = wA + wB;
        if (wSum <= 0) continue;

        const dx = this.posX[a] - this.posX[b];
        const dy = this.posY[a] - this.posY[b];
        const dist = Math.hypot(dx, dy);

        if (dist > 1e-6) {
          const diff = (dist - this.restLen[k]) / dist;
          const factorA = (wA / wSum) * diff;
          const factorB = (wB / wSum) * diff;

          this.posX[a] -= dx * factorA;
          this.posY[a] -= dy * factorA;

          this.posX[b] += dx * factorB;
          this.posY[b] += dy * factorB;
        }
      }
    }

    // 4. Boundary clamping (nodes should not penetrate forward beyond the goal line)
    for (let i = 0; i < this.nodeCount; i++) {
      if (this.invMass[i] <= 0) continue;
      if (this.side === 'left') {
        if (this.posX[i] > this.mouthX) {
          this.posX[i] = this.mouthX;
        }
      } else {
        if (this.posX[i] < this.mouthX) {
          this.posX[i] = this.mouthX;
        }
      }
    }
  }

  /**
   * Renderiza la malla deformada en Canvas 2D con un trazo fino y translúcido.
   * Zero-GC: Dibuja directamente de los buffers prealocados.
   */
  public render(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.strokeStyle = 'rgba(113, 127, 152, 0.65)';
    ctx.lineWidth = 1.0;
    ctx.beginPath();

    // Líneas horizontales
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols - 1; c++) {
        const i1 = r * this.cols + c;
        const i2 = r * this.cols + (c + 1);
        ctx.moveTo(this.posX[i1], this.posY[i1]);
        ctx.lineTo(this.posX[i2], this.posY[i2]);
      }
    }

    // Líneas verticales (excluyendo apertura frontal c=0)
    for (let c = 1; c < this.cols; c++) {
      for (let r = 0; r < this.rows - 1; r++) {
        const i1 = r * this.cols + c;
        const i2 = (r + 1) * this.cols + c;
        ctx.moveTo(this.posX[i1], this.posY[i1]);
        ctx.lineTo(this.posX[i2], this.posY[i2]);
      }
    }

    ctx.stroke();
    ctx.restore();
  }
}
