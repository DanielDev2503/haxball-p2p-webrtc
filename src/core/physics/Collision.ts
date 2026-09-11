import { Vec2 } from '../math/Vec2';
import { closestPointOnSegment } from '../math/MathUtils';
import { Disc } from '../entities/Disc';
import { Segment } from '../entities/Segment';

export interface CollisionEvent {
  type: 'disc-disc' | 'disc-segment';
  discA: Disc;
  discB?: Disc;
  segment?: Segment;
}

/**
 * Resolves collision between two circular discs using analytical impulse resolution
 * and inverse mass positional correction to prevent overlap and tunneling.
 */
export function resolveDiscDiscCollision(
  d1: Disc,
  d2: Disc,
  onCollision?: (e: CollisionEvent) => void
): boolean {
  if (!d1.canCollideWith(d2)) return false;

  const totalInvMass = d1.invMass + d2.invMass;
  if (totalInvMass <= 0) return false; // Both are static

  // Distance vector from d2 to d1
  const diff = Vec2.t0.copy(d1.pos).sub(d2.pos);
  const distSq = diff.lenSq();
  const radiusSum = d1.radius + d2.radius;

  if (distSq >= radiusSum * radiusSum) return false;

  const dist = Math.sqrt(distSq);
  const normal = Vec2.t1;

  if (dist > 1e-9) {
    normal.copy(diff).scale(1 / dist);
  } else {
    // Exact center overlap fallback
    normal.set(1, 0);
  }

  // Penetration depth
  const penetration = radiusSum - dist;

  // Positional correction based on inverse mass
  const percent = 1.0; // Full separation
  const correctionMagnitude = (penetration / totalInvMass) * percent;

  d1.pos.addScaled(normal, correctionMagnitude * d1.invMass);
  d2.pos.addScaled(normal, -correctionMagnitude * d2.invMass);

  // Relative velocity along normal: (v1 - v2) . normal
  const relVel = Vec2.t2.copy(d1.vel).sub(d2.vel);
  const velAlongNormal = relVel.dot(normal);

  // Do not resolve if velocities are already separating
  if (velAlongNormal < 0) {
    const restitution = Math.min(d1.bounciness, d2.bounciness);
    const impulseMag = (-(1 + restitution) * velAlongNormal) / totalInvMass;

    d1.vel.addScaled(normal, impulseMag * d1.invMass);
    d2.vel.addScaled(normal, -impulseMag * d2.invMass);
  }

  if (onCollision) {
    onCollision({ type: 'disc-disc', discA: d1, discB: d2 });
  }

  return true;
}

/**
 * Resolves collision between a circular disc and a static line segment
 * using closest-point projection and inverse mass impulse reflection.
 */
export function resolveDiscSegmentCollision(
  disc: Disc,
  seg: Segment,
  onCollision?: (e: CollisionEvent) => void
): boolean {
  if (disc.invMass === 0) return false;

  const closest = Vec2.t0;
  closestPointOnSegment(disc.pos.x, disc.pos.y, seg.p0.x, seg.p0.y, seg.p1.x, seg.p1.y, closest);

  const diff = Vec2.t1.copy(disc.pos).sub(closest);
  const distSq = diff.lenSq();

  if (distSq >= disc.radius * disc.radius) return false;

  const dist = Math.sqrt(distSq);
  const normal = Vec2.t2;

  if (dist > 1e-9) {
    normal.copy(diff).scale(1 / dist);
  } else {
    // Normal perpendicular to segment
    const segDir = Vec2.t3.copy(seg.p1).sub(seg.p0).normalize();
    normal.set(-segDir.y, segDir.x);
  }

  const penetration = disc.radius - dist;

  // Positional separation (segment has infinite mass)
  disc.pos.addScaled(normal, penetration);

  // Impulse reflection along normal
  const velAlongNormal = disc.vel.dot(normal);
  if (velAlongNormal < 0) {
    const restitution = Math.min(disc.bounciness, seg.bounciness);
    const impulseMag = -(1 + restitution) * velAlongNormal;
    disc.vel.addScaled(normal, impulseMag);
  }

  if (onCollision) {
    onCollision({ type: 'disc-segment', discA: disc, segment: seg });
  }

  return true;
}
