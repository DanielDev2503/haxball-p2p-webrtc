import { Disc } from '../entities/Disc';
import { Segment } from '../entities/Segment';
import { resolveDiscDiscCollision, resolveDiscSegmentCollision, CollisionEvent } from './Collision';
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
  public fixedDt: number;
  public maxSubsteps: number;
  public onCollision?: (event: CollisionEvent) => void;
  public onSubstep?: (subDt: number) => void;

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

  /**
   * Advances the simulation by fixedDt using adaptive substepping.
   * Calculates maximum displacement to guarantee no fast-moving disc
   * tunnels through another disc or segment in a single sub-step.
   */
  public step(): void {
    const dt = this.fixedDt;
    const discCount = this.discs.length;
    const segCount = this.segments.length;

    // 1. Calculate maximum velocity among dynamic discs to determine substepping
    let maxSpeedSq = 0;
    let minRadius = 10;

    for (let i = 0; i < discCount; i++) {
      const d = this.discs[i];
      if (d.invMass > 0) {
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
    const maxDisplacement = maxSpeed * dt;

    // Critical step threshold: no movement larger than half the smallest radius
    const criticalThreshold = minRadius * 0.45;
    const neededSubsteps = Math.ceil(maxDisplacement / criticalThreshold);
    const substeps = clamp(neededSubsteps, 1, this.maxSubsteps);
    const subDt = dt / substeps;

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
            resolveDiscSegmentCollision(d, this.segments[k], this.onCollision);
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
  }
}
