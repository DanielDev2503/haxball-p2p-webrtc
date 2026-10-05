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
  nodeCount?: number; // default 13 (particles in back drop net chain)
  damping?: number; // default 0.20
  kShape?: number; // default 0
  kSpring?: number; // compatibility alias
  color?: string; // default '#717F98'
  cols?: number;  // Compatibility
  rows?: number;  // Compatibility
}

/**
 * GoalNet: Portería de Caja 2D con 4 Anclajes (Stadium Box Net Model)
 * con Cortina de Fondo Viscoelástica, Restricción de Flexión Anti-Bucle y Contención Unilateral.
 * 
 * Topología de la Portería de Caja:
 * - 4 Anclajes Rígidos (invMass = 0):
 *     Poste Superior: P_top = (mouthX, topY)
 *     Poste Inferior: P_bottom = (mouthX, bottomY)
 *     Esquina Trasera Sup: S_top = (backX, topY)
 *     Esquina Trasera Inf: S_bottom = (backX, bottomY)
 *   donde backX = mouthX + (signoX * depth) (con depth ≈ 36 px).
 * 
 * - Laterales Tensados Semirrígidos (Side Nets):
 *     Lateral Superior: Segmento restrictivo entre P_top y S_top.
 *     Lateral Inferior: Segmento restrictivo entre P_bottom y S_bottom.
 *     Comportamiento: Actúan como deflectores elásticos que deslizan la pelota hacia el fondo,
 *     impidiendo físicamente que la red se pliegue hacia adentro o forme lazos.
 * 
 * - Cortina de Fondo Viscoelástica (Back Drop Net Chain):
 *     Cadena de N = 13 partículas suspendidas verticalmente entre S_top y S_bottom.
 *     Nodo 0: anclado en S_top (invMass = 0).
 *     Nodo N-1: anclado en S_bottom (invMass = 0).
 *     Nodos 1 ... N-2: masa m = 0.35 (w_i ≈ 2.857). Concavidad suave hacia atrás en reposo.
 * 
 * - Algoritmos Físicos Deterministas:
 *     1. Restricción de flexión anti-bucle (Second-Neighbor Bending Constraints):
 *        Si dist(p_i, p_{i+2}) < L_bend * 0.85 => corrige separación angular.
 *     2. Ordenamiento monótono en Y:
 *        Garantiza y_0 < y_1 < ... < y_{N-1} (si y_{i+1} <= y_i => y_{i+1} = y_i + 1.0 px).
 *     3. Transferencia progresiva de momento:
 *        v_node <- v_node + v_ball * 0.35. Desaceleración proporcional a tensión.
 *     4. Contención unilateral infranqueable (Anti-Tunneling Projection):
 *        Proyección estricta sobre la cortina de fondo. Cero tunelización.
 *     5. Memoria plástica transitoria y relajación suave (lerp 0.06) en countdown.
 *     6. Permeabilidad absoluta para jugadores (cero colisión con discos no-balón).
 *     7. Invariante Zero-GC en 60 Hz con Float32Array.
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
  public kShape: number;
  public kSpring: number;
  public relaxationIterations: number = 4;
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

    // 4 Anclajes Rígidos
    this.pTopX = this.mouthX;
    this.pTopY = this.topY;
    this.pBottomX = this.mouthX;
    this.pBottomY = this.bottomY;
    this.sTopX = this.backX;
    this.sTopY = this.topY;
    this.sBottomX = this.backX;
    this.sBottomY = this.bottomY;

    // Límite de elongación máxima en el fondo (tope infranqueable)
    if (options.rearLimitX !== undefined) {
      this.rearLimitX = options.rearLimitX;
    } else {
      this.rearLimitX = this.backX + signX * 14;
    }

    this.damping = options.damping ?? 0.20;
    this.kShape = options.kShape ?? options.kSpring ?? 0;
    this.kSpring = this.kShape;
    this.color = options.color ?? '#717F98';

    // Discretización de la cortina de fondo en N partículas (por defecto N = 13)
    this.nodeCount = options.nodeCount ?? 13;
    if (this.nodeCount < 4) this.nodeCount = 13;

    // Prealocación Zero-GC en arreglos tipados
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

    // Aliases para compatibilidad
    this.prevX = this.oldPosX;
    this.prevY = this.oldPosY;
    this.restX = this.restPosX;
    this.restY = this.restPosY;
    this.segRestLen = this.restLen;

    this.initGeometry();
  }

  /**
   * Inicializa la geometría en reposo de la cortina de fondo viscoelástica (Back Drop Net Chain).
   * Nodo 0 anclado en S_top = (backX, topY) con invMass = 0.
   * Nodo N-1 anclado en S_bottom = (backX, bottomY) con invMass = 0.
   * Nodos intermedios i in [1, N-2] con masa m = 0.35 (invMass ≈ 2.857)
   * colgando holgados hacia atrás formando una suave concavidad.
   */
  private initGeometry(): void {
    const N = this.nodeCount;
    const signX = this.mouthX < 0 ? -1 : 1;
    const yTop = this.topY;
    const yBottom = this.bottomY;

    for (let i = 0; i < N; i++) {
      const u = i / (N - 1);
      const y = yTop + u * (yBottom - yTop);
      // Concavidad suave hacia atrás (máximo en el centro de la red)
      const slack = 4 * u * (1 - u);
      const x = this.backX + signX * (3.5 * slack);

      this.restPosX[i] = x;
      this.restPosY[i] = y;
      this.posX[i] = x;
      this.posY[i] = y;
      this.oldPosX[i] = x;
      this.oldPosY[i] = y;

      if (i === 0 || i === N - 1) {
        // Anclajes fijos en esquinas traseras S_top y S_bottom
        this.invMass[i] = 0;
      } else {
        // Partículas dinámicas móviles: masa m = 0.35 => invMass ≈ 2.857
        this.invMass[i] = 1 / 0.35;
      }
    }

    // Asegurar anclaje exacto en esquinas traseras
    this.restPosX[0] = this.sTopX;
    this.restPosY[0] = this.sTopY;
    this.posX[0] = this.sTopX;
    this.posY[0] = this.sTopY;
    this.oldPosX[0] = this.sTopX;
    this.oldPosY[0] = this.sTopY;

    this.restPosX[N - 1] = this.sBottomX;
    this.restPosY[N - 1] = this.sBottomY;
    this.posX[N - 1] = this.sBottomX;
    this.posY[N - 1] = this.sBottomY;
    this.oldPosX[N - 1] = this.sBottomX;
    this.oldPosY[N - 1] = this.sBottomY;

    // Longitudes de reposo para segmentos adyacentes (i e i+1)
    for (let i = 0; i < N - 1; i++) {
      const dx = this.restPosX[i + 1] - this.restPosX[i];
      const dy = this.restPosY[i + 1] - this.restPosY[i];
      this.restLen[i] = Math.hypot(dx, dy);
    }

    // Longitudes de reposo para restricción de flexión anti-bucle (segundo vecino: i e i+2)
    for (let i = 0; i < N - 2; i++) {
      const bx = this.restPosX[i + 2] - this.restPosX[i];
      const by = this.restPosY[i + 2] - this.restPosY[i];
      this.restLenBend[i] = Math.hypot(bx, by);
    }
  }

  /**
   * Paso determinista de simulación física a 60 Hz (Zero-GC).
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

    // 1. Integración Temporal Verlet con Damping y Modo de Relajación Suave
    // En juego activo y celebración: kShape = 0 (memoria plástica transitoria).
    // Si isRelaxing es true (COUNTDOWN): flotación suave hacia reposo con factor 0.06 por tick.
    for (let i = 1; i < N - 1; i++) {
      let restoreX = 0;
      let restoreY = 0;

      if (this.isRelaxing) {
        restoreX = (this.restPosX[i] - this.posX[i]) * 0.06;
        restoreY = (this.restPosY[i] - this.posY[i]) * 0.06;
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

    // 2. Relajación de Restricciones PBD (Distancia + Flexión Anti-Bucle + Orden Monótono en Y)
    for (let iter = 0; iter < this.relaxationIterations; iter++) {
      // A. Restricción de Distancia entre Vecinos Contiguos (i e i+1) con tolerancia de elongación del 30%
      for (let i = 0; i < N - 1; i++) {
        const dx = this.posX[i + 1] - this.posX[i];
        const dy = this.posY[i + 1] - this.posY[i];
        const d = Math.hypot(dx, dy);

        if (d > 1e-6) {
          const lMax = this.restLen[i] * 1.30;
          if (d > lMax) {
            const diff = (d - lMax) / d;
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
      }

      // B. Restricción de Flexión Anti-Bucle (Second-Neighbor Bending Constraints: i e i+2)
      // Garantiza un radio de curvatura mínimo que erradica la formación de lazos o nudos invertidos
      for (let i = 0; i < N - 2; i++) {
        const dbx = this.posX[i + 2] - this.posX[i];
        const dby = this.posY[i + 2] - this.posY[i];
        const db = Math.hypot(dbx, dby);
        const lMinBend = this.restLenBend[i] * 0.85;

        if (db < lMinBend) {
          const diff = db > 1e-6 ? (db - lMinBend) / db : -1.0;
          const w1 = this.invMass[i];
          const w2 = this.invMass[i + 2];
          const wSum = w1 + w2;

          if (wSum > 0) {
            const corrX = (db > 1e-6 ? dbx : 0) * diff;
            const corrY = (db > 1e-6 ? dby : 1.0) * diff;
            this.posX[i] += corrX * (w1 / wSum);
            this.posY[i] += corrY * (w1 / wSum);
            this.posX[i + 2] -= corrX * (w2 / wSum);
            this.posY[i + 2] -= corrY * (w2 / wSum);
          }
        }
      }

      // C. Ordenamiento Monótono Estricto en Y: y_0 < y_1 < ... < y_{N-1}
      for (let i = 0; i < N - 1; i++) {
        if (this.posY[i + 1] <= this.posY[i]) {
          this.posY[i + 1] = this.posY[i] + 1.0;
        }
      }

      // D. Re-anclaje inviolable de esquinas traseras S_top y S_bottom
      this.posX[0] = this.sTopX;
      this.posY[0] = this.sTopY;
      this.posX[N - 1] = this.sBottomX;
      this.posY[N - 1] = this.sBottomY;
    }

    // 3. Tope posterior de contención máxima en X
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

    // 4. Si se proveyó el balón directamente a step (p. ej. en tests aislados), avanzar su posición y resolver colisión
    if (ball && ball.isBall !== false) {
      ball.pos.x += ball.vel.x * _dt;
      ball.pos.y += ball.vel.y * _dt;
      this.checkBallCollision(ball);
    }
  }

  /**
   * Cálculo determinista de Colisión Balón-Red con:
   * - Deflexión Elástica en Laterales Tensados Semirrígidos (Side Nets).
   * - Transferencia Progresiva de Momento y Tensión en Cortina de Fondo.
   * - Contención Unilateral Infranqueable (Anti-Tunneling Projection).
   * - Permeabilidad absoluta para jugadores (ignora disc si !isBall).
   */
  public checkBallCollision(
    ball?: { pos: { x: number; y: number }; vel: { x: number; y: number }; radius?: number; isBall?: boolean } | null
  ): void {
    if (!ball || ball.isBall === false) return;

    const bx = ball.pos.x;
    const by = ball.pos.y;
    const rBall = ball.radius ?? 5.8;
    const signX = this.mouthX < 0 ? -1 : 1;

    const minX = Math.min(this.mouthX, this.rearLimitX) - rBall - 15;
    const maxX = Math.max(this.mouthX, this.rearLimitX) + rBall + 15;
    const minY = Math.min(this.topY, this.bottomY) - rBall - 15;
    const maxY = Math.max(this.topY, this.bottomY) + rBall + 15;

    // Guarda AABB rápida para descartar cálculos fuera del perímetro del arco
    if (bx < minX || bx > maxX || by < minY || by > maxY) {
      return;
    }

    const N = this.nodeCount;
    const xMinSide = Math.min(this.mouthX, this.backX) - rBall;
    const xMaxSide = Math.max(this.mouthX, this.backX) + rBall;

    // -------------------------------------------------------------
    // 1. LATERALES TENSADOS SEMIRRÍGIDOS (SIDE NETS)
    // Lateral Superior (P_top -> S_top) y Lateral Inferior (P_bottom -> S_bottom)
    // Deflectores elásticos que deslizan la pelota hacia el fondo del arco
    // -------------------------------------------------------------
    if (bx >= xMinSide && bx <= xMaxSide) {
      // Lateral Superior: Y = topY (e.g. -85)
      const distTop = Math.abs(by - this.topY);
      if (distTop < rBall) {
        ball.pos.y = this.topY + rBall;
        if (ball.vel.y < 0) {
          ball.vel.y = -ball.vel.y * 0.35;
        }
        // Deslizamiento tangencial guiado hacia el fondo (signX)
        ball.vel.x = signX * (Math.abs(ball.vel.x) * 0.7 + 2.5);
      }

      // Lateral Inferior: Y = bottomY (e.g. 85)
      const distBottom = Math.abs(by - this.bottomY);
      if (distBottom < rBall) {
        ball.pos.y = this.bottomY - rBall;
        if (ball.vel.y > 0) {
          ball.vel.y = -ball.vel.y * 0.35;
        }
        // Deslizamiento tangencial guiado hacia el fondo (signX)
        ball.vel.x = signX * (Math.abs(ball.vel.x) * 0.7 + 2.5);
      }
    }

    // -------------------------------------------------------------
    // 2. CORTINA DE FONDO VISCOELÁSTICA (BACK DROP NET CHAIN)
    // Contacto con segmentos (i, i+1), transferencia de momento y frenado progresivo
    // -------------------------------------------------------------
    for (let i = 0; i < N - 1; i++) {
      const x0 = this.posX[i];
      const y0 = this.posY[i];
      const sx = this.posX[i + 1] - x0;
      const sy = this.posY[i + 1] - y0;
      const sLenSq = sx * sx + sy * sy;

      if (sLenSq < 1e-6) continue;

      const t = Math.max(0, Math.min(1, ((bx - x0) * sx + (by - y0) * sy) / sLenSq));
      const qx = x0 + t * sx;
      const qy = y0 + t * sy;
      const dx = bx - qx;
      const dy = by - qy;
      const d = Math.hypot(dx, dy);

      if (d < rBall) {
        const pen = rBall - d;
        const nx = d > 1e-4 ? dx / d : (signX < 0 ? 1 : -1);
        const ny = d > 1e-4 ? dy / d : 0;

        // A. Transferencia de Momento Progresiva (0.35 * v_ball):
        const dt = 1 / 60;
        const momX = ball.vel.x * 0.35 * dt;
        const momY = ball.vel.y * 0.35 * dt;
        const dragX = ball.vel.x * 0.05 * dt - nx * (pen * 0.3);
        const dragY = ball.vel.y * 0.05 * dt - ny * (pen * 0.3);

        if (this.invMass[i] > 0) {
          this.oldPosX[i] -= momX * (1 - t);
          this.oldPosY[i] -= momY * (1 - t);
          this.posX[i] += dragX * (1 - t);
          this.posY[i] += dragY * (1 - t);
          if (signX < 0 && this.posX[i] < this.rearLimitX) this.posX[i] = this.rearLimitX;
          if (signX > 0 && this.posX[i] > this.rearLimitX) this.posX[i] = this.rearLimitX;
        }

        if (this.invMass[i + 1] > 0) {
          this.oldPosX[i + 1] -= momX * t;
          this.oldPosY[i + 1] -= momY * t;
          this.posX[i + 1] += dragX * t;
          this.posY[i + 1] += dragY * t;
          if (signX < 0 && this.posX[i + 1] < this.rearLimitX) this.posX[i + 1] = this.rearLimitX;
          if (signX > 0 && this.posX[i + 1] > this.rearLimitX) this.posX[i + 1] = this.rearLimitX;
        }

        // B. Desaceleración Proporcional a la Tensión Acumulada:
        // F_tension = clamp(((Delta_L) / L_0) * 0.80, 0.0, 0.95)
        // v_ball <- v_ball * (1 - F_tension)
        const l0 = this.restLen[i];
        const updatedSx = this.posX[i + 1] - this.posX[i];
        const updatedSy = this.posY[i + 1] - this.posY[i];
        const updatedSLen = Math.hypot(updatedSx, updatedSy);
        const updatedQx = this.posX[i] + t * updatedSx;
        const qxRest = this.restPosX[i] + t * (this.restPosX[i + 1] - this.restPosX[i]);
        const defX = Math.abs(updatedQx - qxRest);
        const deltaL = Math.max(updatedSLen - l0, defX, pen);

        if (l0 > 1e-4) {
          const fTension = Math.min(0.95, Math.max(0.0, (deltaL / l0) * 0.80));
          const decel = Math.max(0.08, fTension);
          ball.vel.x *= (1 - decel);
          ball.vel.y *= (1 - decel);
        }
      }
    }

    // -------------------------------------------------------------
    // 3. CONTENCIÓN UNILATERAL INFRANQUEABLE (ANTI-TUNNELING PROJECTION)
    // Garantiza que el balón no pueda cruzar al otro lado de la cortina de fondo
    // -------------------------------------------------------------
    for (let k = 0; k < N - 1; k++) {
      const yMinSeg = Math.min(this.posY[k], this.posY[k + 1]);
      const yMaxSeg = Math.max(this.posY[k], this.posY[k + 1]);

      if (by >= yMinSeg - rBall && by <= yMaxSeg + rBall) {
        const segDy = this.posY[k + 1] - this.posY[k];
        const tSeg = Math.abs(segDy) > 1e-4 ? Math.max(0, Math.min(1, (by - this.posY[k]) / segDy)) : 0.5;
        const xSeg = this.posX[k] + tSeg * (this.posX[k + 1] - this.posX[k]);

        if (signX > 0) {
          // Portería derecha (X > 0): si el balón intenta rebasar la cortina hacia afuera
          if (ball.pos.x > xSeg) {
            ball.pos.x = xSeg - rBall;
            if (ball.vel.x > 0) ball.vel.x = 0;
          }
        } else {
          // Portería izquierda (X < 0): si el balón intenta rebasar la cortina hacia afuera
          if (ball.pos.x < xSeg) {
            ball.pos.x = xSeg + rBall;
            if (ball.vel.x < 0) ball.vel.x = 0;
          }
        }
      }
    }

    // -------------------------------------------------------------
    // 4. TOPE ABSOLUTO DE FONDO (REAR LIMIT X)
    // -------------------------------------------------------------
    if (signX < 0) {
      if (ball.pos.x - rBall < this.rearLimitX) {
        ball.pos.x = this.rearLimitX + rBall;
        if (ball.vel.x < 0) ball.vel.x = 0;
        ball.vel.y *= 0.7;
      }
    } else {
      if (ball.pos.x + rBall > this.rearLimitX) {
        ball.pos.x = this.rearLimitX - rBall;
        if (ball.vel.x > 0) ball.vel.x = 0;
        ball.vel.y *= 0.7;
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
   * Renderiza la portería de caja (4 anclajes, laterales tensados y cortina de fondo viscoelástica)
   * en Canvas 2D sin alocaciones de memoria (Zero-GC).
   */
  public render(ctx: CanvasRenderingContext2D): void {
    const N = this.nodeCount;
    if (N < 2) return;

    ctx.save();
    ctx.strokeStyle = this.color;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // 1. Laterales Tensados Semirrígidos (P_top -> S_top y P_bottom -> S_bottom)
    ctx.beginPath();
    ctx.moveTo(this.pTopX, this.pTopY);
    ctx.lineTo(this.posX[0], this.posY[0]);

    ctx.moveTo(this.pBottomX, this.pBottomY);
    ctx.lineTo(this.posX[N - 1], this.posY[N - 1]);
    ctx.stroke();

    // 2. Cortina de Fondo Viscoelástica (Back Drop Net Chain)
    ctx.beginPath();
    ctx.moveTo(this.posX[0], this.posY[0]);

    if (typeof ctx.quadraticCurveTo === 'function') {
      for (let i = 0; i < N - 1; i++) {
        const xc = (this.posX[i] + this.posX[i + 1]) * 0.5;
        const yc = (this.posY[i] + this.posY[i + 1]) * 0.5;
        ctx.quadraticCurveTo(this.posX[i], this.posY[i], xc, yc);
      }
      ctx.lineTo(this.posX[N - 1], this.posY[N - 1]);
    } else {
      for (let i = 1; i < N; i++) {
        ctx.lineTo(this.posX[i], this.posY[i]);
      }
    }
    ctx.stroke();

    // 3. Malla interior / Costillas de profundidad estilo Box Net (Zero-GC)
    ctx.save();
    ctx.strokeStyle = this.color;
    ctx.globalAlpha = 0.28;
    ctx.lineWidth = 1;

    const ribCount = 4;
    for (let k = 1; k < ribCount; k++) {
      const u = k / ribCount;
      const frontY = this.pTopY + u * (this.pBottomY - this.pTopY);
      const nodeIdx = Math.min(N - 2, Math.floor(u * (N - 1)));
      const tSub = (u * (N - 1)) - nodeIdx;
      const backX = this.posX[nodeIdx] + tSub * (this.posX[nodeIdx + 1] - this.posX[nodeIdx]);
      const backY = this.posY[nodeIdx] + tSub * (this.posY[nodeIdx + 1] - this.posY[nodeIdx]);

      ctx.beginPath();
      ctx.moveTo(this.mouthX, frontY);
      ctx.lineTo(backX, backY);
      ctx.stroke();
    }
    ctx.restore();

    ctx.restore();
  }

  /**
   * Ciclo de Restauración de la Red (Kickoff Reset):
   * - smooth === false: Reasigna instantáneamente p_i = restPos_i y resetea velocidades a cero.
   * - smooth === true: Activa modo de relajación durante COUNTDOWN (lerp 0.06 por tick).
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
