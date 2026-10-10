import { Disc, COLLISION_GROUP_BALL } from '../entities/Disc';
import { Segment } from '../entities/Segment';
import { GoalNet } from '../entities/GoalNet';
import { Stadium } from '../entities/Stadium';
import {
  resolveDiscDiscCollision,
  resolveDiscSegmentCollision,
  CollisionEvent,
  KickoffPhysicsContext
} from './Collision';
import { clamp } from '../math/MathUtils';

export interface PhysicsWorldConfig {
  gravityX?: number;
  gravityY?: number;
  fixedDt?: number;
  maxSubsteps?: number;
}

export class PhysicsWorld {
  public discs: Disc[] = [];
  public segments: Segment[] = [];
  public goalNets: GoalNet[] = [];
  public fixedDt: number;
  public maxSubsteps: number;
  public onCollision?: (event: CollisionEvent) => void;
  public onSubstep?: (subDt: number) => void;
  public kickoffContext?: KickoffPhysicsContext | null = null;

  constructor(config: PhysicsWorldConfig = {}) {
    this.fixedDt = config.fixedDt ?? 1 / 60;
    this.maxSubsteps = config.maxSubsteps ?? 8;
  }

  public addDisc(disc: Disc): void {
    this.discs.push(disc);
  }

  public removeDisc(disc: Disc): void {
    const idx = this.discs.indexOf(disc);
    if (idx !== -1) {
      this.discs.splice(idx, 1);
    }
  }

  public addSegment(segment: Segment): void {
    this.segments.push(segment);
  }

  public removeSegment(segment: Segment): void {
    const idx = this.segments.indexOf(segment);
    if (idx !== -1) {
      this.segments.splice(idx, 1);
    }
  }

  public clearSegments(): void {
    this.segments = [];
  }

  /**
   * Carga un estadio en el mundo físico purgando muros rígidos de portería
   * e instanciando automáticamente la física de cuerda elástica holgada (GoalNet)
   * adaptada a las dimensiones de los postes activos en cualquier estadio.
   */
  public loadStadium(stadium: Stadium): void {
    // 1. Limpiar segmentos y postes antiguos
    this.clearSegments();
    if (this.discs.length > 0) {
      this.discs = this.discs.filter(d => !d.isPost);
    }

    // 2. Determinar posición de los postes activos
    let leftXPost = -stadium.halfWidth;
    let rightXPost = stadium.halfWidth;
    let leftYPost = stadium.goalHalfHeight;
    let rightYPost = stadium.goalHalfHeight;

    if (stadium.goals && stadium.goals.length >= 2) {
      const gRed = stadium.goals.find(g => g.team === 'red') || stadium.goals[0];
      const gBlue = stadium.goals.find(g => g.team === 'blue') || stadium.goals[1];
      leftXPost = Math.min(gRed.p0.x, gRed.p1.x);
      leftYPost = Math.max(Math.abs(gRed.p0.y), Math.abs(gRed.p1.y));
      rightXPost = Math.max(gBlue.p0.x, gBlue.p1.x);
      rightYPost = Math.max(Math.abs(gBlue.p0.y), Math.abs(gBlue.p1.y));
    }

    // 3. Purga estricta de segmentos rígidos detrás de los postes para el balón:
    // Portería izquierda: cualquier segmento con X < -x_post y |Y| <= y_post + 15
    // Portería derecha: cualquier segmento con X > x_post y |Y| <= y_post + 15
    for (const seg of stadium.segments) {
      const minX = Math.min(seg.p0.x, seg.p1.x);
      const maxX = Math.max(seg.p0.x, seg.p1.x);
      const maxY = Math.max(Math.abs(seg.p0.y), Math.abs(seg.p1.y));

      const isLeftGoalArea = maxX < (leftXPost + 1) && maxY <= (leftYPost + 15);
      const isRightGoalArea = minX > (rightXPost - 1) && maxY <= (rightYPost + 15);

      if (isLeftGoalArea || isRightGoalArea) {
        seg.cMask = seg.cMask & ~COLLISION_GROUP_BALL;
      }

      this.addSegment(seg);
    }

    // 4. Agregar postes físicos
    for (const post of stadium.posts) {
      post.isPost = true;
      this.addDisc(post);
    }

    // 5. Instanciar GoalNet de caja con red elástica subamortiguada (N = 15 partículas, profundidad ≈ 36 px)
    const depth = 36;
    const leftNet = new GoalNet({
      side: 'left',
      mouthX: leftXPost,
      backX: leftXPost - depth,
      depth,
      topY: -leftYPost,
      bottomY: leftYPost,
      nodeCount: 15
    });

    const rightNet = new GoalNet({
      side: 'right',
      mouthX: rightXPost,
      backX: rightXPost + depth,
      depth,
      topY: -rightYPost,
      bottomY: rightYPost,
      nodeCount: 15
    });

    this.goalNets = [leftNet, rightNet];
  }

  public get goalNetLeft(): GoalNet | undefined {
    return this.goalNets[0];
  }

  public get goalNetRight(): GoalNet | undefined {
    return this.goalNets[1];
  }

  /**
   * Advances the simulation by fixedDt using adaptive substepping.
   * Calculates maximum displacement to guarantee no fast-moving disc
   * tunnels through another disc or segment in a single sub-step.
   * Enforces N >= 4 kinematic substeps whenever Dash is active.
   *
   * @param dt Integration step time in seconds (defaults to this.fixedDt)
   * @param isReplay When true, bypasses expensive cloth mass-spring GoalNet simulation during prediction replay
   */
  public step(dt: number = this.fixedDt, isReplay: boolean = false): void {
    const actualDt = typeof dt === 'number' && dt > 0 ? dt : this.fixedDt;
    const discCount = this.discs.length;
    const segCount = this.segments.length;

    // 1. Calculate maximum velocity among dynamic discs to determine substepping
    let maxSpeedSq = 0;
    let minRadius = 10;
    let hasDashingDisc = false;

    for (let i = 0; i < discCount; i++) {
      const d = this.discs[i];
      if (d.invMass > 0) {
        if (d.isDashing) {
          hasDashingDisc = true;
        }
        const speedSq = d.vel.lenSq();
        if (speedSq > maxSpeedSq) {
          maxSpeedSq = speedSq;
        }
        if (d.radius < minRadius) {
          minRadius = d.radius;
        }
      }
    }

    const maxSpeed = Math.sqrt(maxSpeedSq);
    const maxDisplacement = maxSpeed * actualDt;

    // Critical step threshold: no movement larger than half the smallest radius
    const criticalThreshold = minRadius * 0.45;
    const neededSubsteps = Math.ceil(maxDisplacement / criticalThreshold);
    // Garantizar al menos N >= 4 subiteraciones en ticks con Dash activo para prevenir tunelización
    const minSubsteps = hasDashingDisc ? 4 : 1;
    const substeps = clamp(neededSubsteps, minSubsteps, Math.max(this.maxSubsteps, minSubsteps));
    const subDt = actualDt / substeps;

    // 2. Perform substepping simulation
    for (let s = 0; s < substeps; s++) {
      // Store previous positions and integrate positions
      for (let i = 0; i < discCount; i++) {
        const d = this.discs[i];
        if (d.invMass > 0) {
          d.prevPos.copy(d.pos);
          d.pos.x += d.vel.x * subDt;
          d.pos.y += d.vel.y * subDt;
        }
      }

      this.onSubstep?.(subDt);

      // Solve disc-disc collisions (O(N^2), where N is small, e.g. 1 ball + up to 6 players + 4 posts)
      for (let i = 0; i < discCount; i++) {
        const d1 = this.discs[i];
        for (let j = i + 1; j < discCount; j++) {
          const d2 = this.discs[j];
          resolveDiscDiscCollision(d1, d2, this.onCollision);
        }
      }

      // Solve disc-segment collisions
      for (let i = 0; i < discCount; i++) {
        const d = this.discs[i];
        if (d.invMass > 0) {
          for (let k = 0; k < segCount; k++) {
            resolveDiscSegmentCollision(d, this.segments[k], this.onCollision, this.kickoffContext);
          }
        }
      }

      // Apply damping proportionally per substep
      for (let i = 0; i < discCount; i++) {
        const d = this.discs[i];
        if (d.invMass > 0) {
          const subDamping = Math.pow(d.damping, 1 / substeps);
          d.vel.x *= subDamping;
          d.vel.y *= subDamping;
        }
      }
    }

    // Step cloth mass-spring simulation on goal nets
    // Bypassed completely if isReplay === true to prevent CPU bottlenecks during reconciliation
    if (!isReplay) {
      let ball: Disc | undefined;
      for (let i = 0; i < discCount; i++) {
        if (this.discs[i].isBall) {
          ball = this.discs[i];
          break;
        }
      }
      if (this.goalNetLeft) {
        this.goalNetLeft.step(actualDt);
        if (ball) this.goalNetLeft.checkBallCollision(ball);
      }
      if (this.goalNetRight) {
        this.goalNetRight.step(actualDt);
        if (ball) this.goalNetRight.checkBallCollision(ball);
      }
    }
  }

  /**
   * Resetea la forma de todas las redes de portería activas.
   * smooth === false: restauración instantánea.
   * smooth === true: relajación suave a 0.08 por tick durante COUNTDOWN.
   */
  public resetNets(smooth: boolean = false): void {
    for (let i = 0; i < this.goalNets.length; i++) {
      this.goalNets[i].resetShape(smooth);
    }
  }

  /**
   * Avanza la integración de las redes de forma aislada (p. ej. relajación durante COUNTDOWN).
   */
  public stepNets(dt: number = 1 / 60): void {
    for (let i = 0; i < this.goalNets.length; i++) {
      this.goalNets[i].step(dt);
    }
  }

  /**
   * Restricción estricta de línea media en el saque (plano vertical X = 0).
   * - Si saca el equipo Rojo (campo izquierdo, x <= 0): su posición se acota a x <= -r.
   *   Si x + r > 0, corrige su posición a x = -r y anula la velocidad horizontal positiva (vx = min(vx, 0)).
   * - Si saca el equipo Azul (campo derecho, x >= 0): su posición se acota a x >= r.
   *   Si x - r < 0, corrige su posición a x = r y anula la velocidad horizontal negativa (vx = max(vx, 0)).
   */
  public enforceMidfieldBarrier(disc: Disc, team: 'red' | 'blue'): void {
    const r = disc.radius;
    if (team === 'red') {
      if (disc.pos.x + r > 0) {
        disc.pos.x = -r;
        if (disc.vel.x > 0) disc.vel.x = 0;
      }
    } else if (team === 'blue') {
      if (disc.pos.x - r < 0) {
        disc.pos.x = r;
        if (disc.vel.x < 0) disc.vel.x = 0;
      }
    }
  }
}
