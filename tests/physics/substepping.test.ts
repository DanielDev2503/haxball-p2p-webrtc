import { describe, it, expect } from 'vitest';
import { PhysicsWorld } from '../../src/core/physics/PhysicsWorld';
import { Disc } from '../../src/core/entities/Disc';
import { Segment } from '../../src/core/entities/Segment';

describe('Adaptive Substepping and Anti-Tunneling', () => {
  it('prevents high-speed projectile tunneling through a thin wall segment', () => {
    const world = new PhysicsWorld({ fixedDt: 1 / 60, maxSubsteps: 16 });

    // Wall at x = 100
    const wall = new Segment({
      id: 1,
      x0: 100,
      y0: -200,
      x1: 100,
      y1: 200,
      bounciness: 0.8
    });
    world.addSegment(wall);

    // Ball at x = 80 with radius 10. Distance to wall is 10 units.
    // Velocity vx = 3600 (moves 60 units in 1 frame of dt=1/60).
    // Without substepping, x would jump from 80 to 140, tunneling completely through the wall!
    const ball = new Disc({
      id: 0,
      x: 80,
      y: 0,
      radius: 10,
      mass: 1,
      damping: 1.0,
      bounciness: 0.8
    });
    ball.vel.set(3600, 0);
    world.addDisc(ball);

    // Step physics
    world.step();

    // The ball must have collided and rebounded:
    // Its center must remain on the left side of the wall (x <= 100 - radius = 90)
    // and its velocity must now be negative (rebounded to the left)
    expect(ball.pos.x).toBeLessThanOrEqual(90);
    expect(ball.vel.x).toBeLessThan(0);
  });
});
