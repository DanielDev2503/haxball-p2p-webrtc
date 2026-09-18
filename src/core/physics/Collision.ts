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

  // Mecánica de Tackle: si un jugador en Dash o Turbo impacta a otro, masa efectiva x1.8 (invMass / 1.8)
  let invMass1 = d1.invMass;
  let invMass2 = d2.invMass;

  if (!d1.isBall && !d2.isBall) {
    if (d1.isDashing || d1.isTurbo) {
      invMass1 /= 1.8;
    }
    if (d2.isDashing || d2.isTurbo) {
      invMass2 /= 1.8;
    }
  }

  const totalInvMass = invMass1 + invMass2;
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

  // Positional correction based on effective inverse mass
  const percent = 1.0; // Full separation
  const correctionMagnitude = (penetration / totalInvMass) * percent;

  d1.pos.addScaled(normal, correctionMagnitude * invMass1);
  d2.pos.addScaled(normal, -correctionMagnitude * invMass2);

  // Relative velocity along normal: (v1 - v2) . normal
  const relVel = Vec2.t2.copy(d1.vel).sub(d2.vel);
  const velAlongNormal = relVel.dot(normal);

  // Do not resolve if velocities are already separating
  if (velAlongNormal < 0) {
    // Extinción instantánea de la comba del balón al colisionar con cualquier disco (poste u otro jugador)
    if (d1.isBall && d1.isCurving && d2.id !== d1.lastKickerId) {
      d1.resetCurve();
    }
    if (d2.isBall && d2.isCurving && d1.id !== d2.lastKickerId) {
      d2.resetCurve();
    }

    const restitution = Math.min(d1.bounciness, d2.bounciness);
    const impulseMag = (-(1 + restitution) * velAlongNormal) / totalInvMass;

    d1.vel.addScaled(normal, impulseMag * invMass1);
    d2.vel.addScaled(normal, -impulseMag * invMass2);
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

  // Extinción instantánea de la comba al chocar contra segmentos o paredes
  if (disc.isBall && disc.isCurving) disc.resetCurve();

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

export interface StadiumBoundariesConfig {
  halfWidth?: number;       // default 600
  halfHeight?: number;      // default 270
  goalHalfHeight?: number;  // default 85
  goalDepth?: number;       // default 35 (fondo de red X = ±635)
}

/**
 * Resuelve la delimitación analítica completa del estadio para la predicción local del cliente,
 * permitiendo la libre circulación en el interior de la portería (X in [-635, 635]).
 */
export function resolveGoalAndPitchBoundaries(
  pos: { x: number; y: number },
  vel: { x: number; y: number },
  radius: number = 15,
  config: StadiumBoundariesConfig = {}
): void {
  const hw = config.halfWidth ?? 600;
  const hh = config.halfHeight ?? 270;
  const gh = config.goalHalfHeight ?? 85;
  const gd = config.goalDepth ?? 35;
  const netX = hw + gd; // 635

  // 1. Paredes perimetrales superior e inferior del campo (y = ±hh)
  if (pos.y < -hh + radius) {
    pos.y = -hh + radius;
    if (vel.y < 0) vel.y = 0;
  } else if (pos.y > hh - radius) {
    pos.y = hh - radius;
    if (vel.y > 0) vel.y = 0;
  }

  // 2. Paredes superior e inferior de la red de la portería (y = ±gh para |x| in [hw, netX])
  const absX = Math.abs(pos.x);
  if (absX >= hw) {
    if (pos.y < -gh + radius) {
      pos.y = -gh + radius;
      if (vel.y < 0) vel.y = 0;
    } else if (pos.y > gh - radius) {
      pos.y = gh - radius;
      if (vel.y > 0) vel.y = 0;
    }
  }

  // 3. Paredes verticales perimetrales (X = ±hw) y fondo de red (X = ±netX)
  if (Math.abs(pos.y) > gh) {
    // Fuera de la boca de la portería: límites en X = ±hw
    if (pos.x < -hw + radius) {
      pos.x = -hw + radius;
      if (vel.x < 0) vel.x = 0;
    } else if (pos.x > hw - radius) {
      pos.x = hw - radius;
      if (vel.x > 0) vel.x = 0;
    }
  } else {
    // Dentro de la boca de la portería (|y| <= gh): el límite se extiende hasta el fondo de la red X = ±netX
    if (pos.x < -netX + radius) {
      pos.x = -netX + radius;
      if (vel.x < 0) vel.x = 0;
    } else if (pos.x > netX - radius) {
      pos.x = netX - radius;
      if (vel.x > 0) vel.x = 0;
    }
  }

  // 4. Colisión analítica de los 4 postes en (±hw, ±gh) con radio = 8
  const postR = 8;
  const minPostDist = radius + postR;
  const minPostDistSq = minPostDist * minPostDist;

  const postsX = [-hw, -hw, hw, hw];
  const postsY = [-gh, gh, -gh, gh];

  for (let i = 0; i < 4; i++) {
    const postX = postsX[i];
    const postY = postsY[i];
    const dx = pos.x - postX;
    const dy = pos.y - postY;
    const dSq = dx * dx + dy * dy;

    if (dSq < minPostDistSq && dSq > 1e-6) {
      const dist = Math.sqrt(dSq);
      const nx = dx / dist;
      const ny = dy / dist;
      pos.x = postX + nx * minPostDist;
      pos.y = postY + ny * minPostDist;

      const vDotN = vel.x * nx + vel.y * ny;
      if (vDotN < 0) {
        vel.x -= vDotN * nx;
        vel.y -= vDotN * ny;
      }
    }
  }
}

/**
 * Resuelve la colisión predictiva círculo-círculo no-host en el cliente,
 * erradicando la superposición visual (clipping) antes de la llegada del snapshot.
 */
export function resolvePredictivePlayerCollision(
  localPos: { x: number; y: number },
  localVel: { x: number; y: number },
  localRadius: number,
  otherPos: { x: number; y: number },
  otherVel: { x: number; y: number },
  otherRadius: number,
  restitution: number = 0.5
): boolean {
  const dx = localPos.x - otherPos.x;
  const dy = localPos.y - otherPos.y;
  const distSq = dx * dx + dy * dy;
  const radiusSum = localRadius + otherRadius;

  if (distSq >= radiusSum * radiusSum) return false;

  const dist = Math.sqrt(distSq);
  let nx = 1;
  let ny = 0;
  if (dist > 1e-9) {
    nx = dx / dist;
    ny = dy / dist;
  }

  // Penetración posicional instantánea en el jugador local
  const overlap = radiusSum - dist;
  localPos.x += nx * overlap;
  localPos.y += ny * overlap;

  // Reflexión elástica de la velocidad
  const relVel = (localVel.x - otherVel.x) * nx + (localVel.y - otherVel.y) * ny;
  if (relVel < 0) {
    const impulse = -(1 + restitution) * relVel;
    localVel.x += nx * impulse * 0.5;
    localVel.y += ny * impulse * 0.5;
  }

  return true;
}

/**
 * Resuelve la colisión predictiva analítica entre el jugador local y el balón (No-Host anti-clipping).
 * Aplica ponderación estricta por masa inversa (ratio jugador = 0.25) y atenuación elástica del impulso (e = 0.2)
 * para erradicar el efecto flash/strobing y evitar discrepancias oscilatorias con el Host.
 * Zero GC: utiliza únicamente primitivas escalares.
 */
export function resolvePredictiveBallCollision(
  localPos: { x: number; y: number },
  localVel: { x: number; y: number },
  playerRadius: number,
  ballPos: { x: number; y: number },
  ballRadius: number = 10
): boolean {
  const dx = localPos.x - ballPos.x;
  const dy = localPos.y - ballPos.y;
  const distSq = dx * dx + dy * dy;
  const minDist = playerRadius + ballRadius;

  if (distSq >= minDist * minDist) return false;

  const dist = Math.sqrt(distSq);
  let nx = 1;
  let ny = 0;

  if (dist > 1e-9) {
    nx = dx / dist;
    ny = dy / dist;
  }

  // Ponderación estricta por masa relativa: ratio_player = 0.25 (el 75% restante lo absorbe la pelota en el Host)
  const overlap = minDist - dist;
  const playerDisplacement = overlap * 0.25;
  localPos.x += nx * playerDisplacement;
  localPos.y += ny * playerDisplacement;

  // Atenuación elástica amortiguada del impulso normal (e = 0.2, ratio = 0.25)
  const vn = localVel.x * nx + localVel.y * ny;
  if (vn < 0) {
    const impulse = (1 + 0.2) * vn * 0.25;
    localVel.x -= impulse * nx;
    localVel.y -= impulse * ny;
  }

  return true;
}
