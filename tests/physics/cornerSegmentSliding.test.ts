import { describe, it, expect } from 'vitest';
import { Disc } from '../../src/core/entities/Disc';
import { Segment } from '../../src/core/entities/Segment';
import { resolveDiscSegmentCollision } from '../../src/core/physics/Collision';

describe('Corner Segment Sliding and Endpoint Collision Resolution', () => {
  it('does not produce NaN or zero out tangential velocity when colliding with segment endpoint', () => {
    // Horizontal segment from (0, 0) to (100, 0)
    const seg = new Segment({
      id: 1,
      x0: 0,
      y0: 0,
      x1: 100,
      y1: 0,
      bounciness: 0.5,
      cGroup: 1,
      cMask: 1
    });

    // Disc moving diagonally into endpoint p0 (0, 0)
    const disc = new Disc({
      id: 1,
      x: -10,
      y: 10,
      radius: 15,
      bounciness: 0.5,
      cGroup: 1,
      cMask: 1,
      isBall: false
    });
    // Velocity pointing towards the corner with substantial tangential component
    disc.vel.set(30, -10);

    const collided = resolveDiscSegmentCollision(disc, seg);
    expect(collided).toBe(true);

    // No NaNs allowed
    expect(Number.isNaN(disc.pos.x)).toBe(false);
    expect(Number.isNaN(disc.pos.y)).toBe(false);
    expect(Number.isNaN(disc.vel.x)).toBe(false);
    expect(Number.isNaN(disc.vel.y)).toBe(false);

    // Position must be pushed out by radius (penetration resolved)
    const distToVertex = disc.pos.len();
    expect(distToVertex).toBeGreaterThanOrEqual(14.99);

    // Tangential velocity component must NOT be zeroed out
    const speed = disc.vel.len();
    expect(speed).toBeGreaterThan(5);
  });

  it('allows smooth sliding along shared corner of two perpendicular segments', () => {
    // Two segments meeting at corner (0, 0)
    const segBottom = new Segment({
      id: 1,
      x0: -100,
      y0: 0,
      x1: 0,
      y1: 0,
      bounciness: 0.5,
      cGroup: 1,
      cMask: 1
    });
    const segRight = new Segment({
      id: 2,
      x0: 0,
      y0: 0,
      x1: 0,
      y1: 100,
      bounciness: 0.5,
      cGroup: 1,
      cMask: 1
    });

    const disc = new Disc({
      id: 1,
      x: -8,
      y: 8,
      radius: 15,
      bounciness: 0.5,
      cGroup: 1,
      cMask: 1,
      isBall: false
    });
    disc.vel.set(15, -15);

    resolveDiscSegmentCollision(disc, segBottom);
    resolveDiscSegmentCollision(disc, segRight);

    // Disc should not be trapped at velocity (0, 0)
    expect(Number.isNaN(disc.vel.x)).toBe(false);
    expect(Number.isNaN(disc.vel.y)).toBe(false);
    expect(disc.vel.len()).toBeGreaterThan(0.1);
  });

  it('applies restitution impulse normally for ball discs or segment interiors', () => {
    const seg = new Segment({
      id: 1,
      x0: 0,
      y0: 0,
      x1: 100,
      y1: 0,
      bounciness: 0.5,
      cGroup: 1,
      cMask: 1
    });

    // Disc colliding at interior of segment (x = 50)
    const disc = new Disc({
      id: 1,
      x: 50,
      y: 10,
      radius: 15,
      bounciness: 0.5,
      cGroup: 1,
      cMask: 1,
      isBall: false
    });
    disc.vel.set(0, -30);

    const collided = resolveDiscSegmentCollision(disc, seg);
    expect(collided).toBe(true);

    // Normal bounce with restitution
    expect(disc.pos.y).toBeGreaterThanOrEqual(15);
    expect(disc.vel.y).toBeGreaterThan(0);
  });
});
