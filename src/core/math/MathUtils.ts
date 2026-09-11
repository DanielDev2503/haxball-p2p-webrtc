import { Vec2 } from './Vec2';

export const EPSILON = 1e-6;

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Projects a point (px, py) onto line segment AB and sets result into outVec.
 * Returns projection factor t clamped to [0, 1].
 */
export function closestPointOnSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  outVec: Vec2
): number {
  const abX = bx - ax;
  const abY = by - ay;
  const abLenSq = abX * abX + abY * abY;

  if (abLenSq < EPSILON) {
    outVec.set(ax, ay);
    return 0;
  }

  const apX = px - ax;
  const apY = py - ay;
  const t = clamp((apX * abX + apY * abY) / abLenSq, 0, 1);

  outVec.set(ax + abX * t, ay + abY * t);
  return t;
}
