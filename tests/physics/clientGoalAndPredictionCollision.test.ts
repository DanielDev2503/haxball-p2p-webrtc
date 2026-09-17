import { describe, it, expect } from 'vitest';
import {
  resolveGoalAndPitchBoundaries,
  resolvePredictivePlayerCollision
} from '../../src/core/physics/Collision';

describe('Goal Net Depth & Client Predictive Anti-Clipping', () => {
  const stadiumConfig = {
    halfWidth: 600,
    halfHeight: 270,
    goalHalfHeight: 85,
    goalDepth: 35 // fondo de red en 635
  };

  describe('resolveGoalAndPitchBoundaries', () => {
    it('restricts player to X in [-600, 600] in general perimeter (|y| > 85)', () => {
      const pos = { x: 595, y: 150 }; // y > 85, moving right
      const vel = { x: 50, y: 0 };
      const radius = 15;

      resolveGoalAndPitchBoundaries(pos, vel, radius, stadiumConfig);

      // pos.x must be clamped to 600 - radius = 585
      expect(pos.x).toBe(585);
      expect(vel.x).toBe(0);

      // Same for left side
      const leftPos = { x: -595, y: -120 };
      const leftVel = { x: -40, y: 0 };
      resolveGoalAndPitchBoundaries(leftPos, leftVel, radius, stadiumConfig);
      expect(leftPos.x).toBe(-585);
      expect(leftVel.x).toBe(0);
    });

    it('allows player to enter goal mouth (|y| <= 85) freely and extends boundaries to net depth X = ±635', () => {
      const radius = 15;
      // Moving into right goal net at y = 0
      const pos = { x: 610, y: 0 }; // Inside goal depth [600, 635]
      const vel = { x: 30, y: 0 };

      resolveGoalAndPitchBoundaries(pos, vel, radius, stadiumConfig);

      // Not clamped at 600: free to move inside
      expect(pos.x).toBe(610);
      expect(vel.x).toBe(30);

      // Moving past the back of the net (x = 640 > 635)
      pos.x = 640;
      resolveGoalAndPitchBoundaries(pos, vel, radius, stadiumConfig);

      // Clamped to net depth: 635 - 15 = 620
      expect(pos.x).toBe(620);
      expect(vel.x).toBe(0);

      // Moving past the back of the left net (x = -640 < -635)
      const leftPos = { x: -640, y: 10 };
      const leftVel = { x: -50, y: 0 };
      resolveGoalAndPitchBoundaries(leftPos, leftVel, radius, stadiumConfig);
      expect(leftPos.x).toBe(-620);
      expect(leftVel.x).toBe(0);
    });

    it('collides analytically with top and bottom net walls (y = ±85) inside the goal (|x| in [600, 635])', () => {
      const radius = 15;
      // Player inside right goal trying to cross top net wall (y = -85)
      const pos = { x: 625, y: -80 }; // penetrating y = -85 (since pos.y < -85 + 15 = -70)
      const vel = { x: 0, y: -40 };

      resolveGoalAndPitchBoundaries(pos, vel, radius, stadiumConfig);

      // Clamped to -85 + radius = -70
      expect(pos.y).toBe(-70);
      expect(vel.y).toBe(0);

      // Player inside right goal trying to cross bottom net wall (y = 85)
      pos.y = 80; // penetrating y = 85 (since pos.y > 85 - 15 = 70)
      vel.y = 40;
      resolveGoalAndPitchBoundaries(pos, vel, radius, stadiumConfig);

      // Clamped to 85 - radius = 70
      expect(pos.y).toBe(70);
      expect(vel.y).toBe(0);
    });
  });

  describe('resolvePredictivePlayerCollision (Circle-Circle Anti-Clipping)', () => {
    it('resolves instant positional separation and elastic velocity on overlapping players', () => {
      const localPos = { x: 50, y: 0 };
      const localVel = { x: 20, y: 0 };
      const localRadius = 15;

      const otherPos = { x: 70, y: 0 }; // distance = 20 < 15 + 15 = 30 -> overlap = 10
      const otherVel = { x: -10, y: 0 };
      const otherRadius = 15;

      const collided = resolvePredictivePlayerCollision(
        localPos,
        localVel,
        localRadius,
        otherPos,
        otherVel,
        otherRadius
      );

      expect(collided).toBe(true);

      // Local player pushed back along normal by overlap (10 units leftwards: from 50 to 40)
      expect(localPos.x).toBeCloseTo(40, 4);
      expect(localPos.y).toBe(0);

      // New distance is now exactly radiusSum (70 - 40 = 30) -> zero clipping
      const newDist = Math.hypot(localPos.x - otherPos.x, localPos.y - otherPos.y);
      expect(newDist).toBeCloseTo(30, 4);

      // Velocities reflect elastically (localVel.x had positive velocity moving towards other, now reflected)
      expect(localVel.x).toBeLessThan(0);
    });

    it('returns false and does not alter positions if players are not overlapping', () => {
      const localPos = { x: 0, y: 0 };
      const localVel = { x: 5, y: 5 };
      const otherPos = { x: 100, y: 0 };
      const otherVel = { x: 0, y: 0 };

      const collided = resolvePredictivePlayerCollision(
        localPos,
        localVel,
        15,
        otherPos,
        otherVel,
        15
      );

      expect(collided).toBe(false);
      expect(localPos.x).toBe(0);
      expect(localPos.y).toBe(0);
      expect(localVel.x).toBe(5);
      expect(localVel.y).toBe(5);
    });
  });
});
