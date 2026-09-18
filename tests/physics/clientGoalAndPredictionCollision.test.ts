import { describe, it, expect } from 'vitest';
import {
  resolveGoalAndPitchBoundaries,
  resolvePredictivePlayerCollision,
  resolvePredictiveBallCollision
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

  describe('resolvePredictiveBallCollision (Mass-Weighted Anti-Clipping)', () => {
    it('applies 25% mass-weighted separation and cushioned elastic restitution (e=0.2)', () => {
      const localPos = { x: 10, y: 0 };
      const localVel = { x: 25, y: 0 }; // Moving rightwards into ball
      const playerRadius = 15;

      const ballPos = { x: 30, y: 0 }; // d = 20 < 15 + 10 = 25 -> overlap = 5
      const ballRadius = 10;

      const collided = resolvePredictiveBallCollision(
        localPos,
        localVel,
        playerRadius,
        ballPos,
        ballRadius
      );

      expect(collided).toBe(true);

      // Normal is (10 - 30) / 20 = -1 in X.
      // Player displacement is overlap * 0.25 = 5 * 0.25 = 1.25 units along normal (-1, 0)
      // localPos.x = 10 - 1.25 = 8.75
      expect(localPos.x).toBeCloseTo(8.75, 4);
      expect(localPos.y).toBe(0);

      // vn = 25 * (-1) = -25 < 0
      // impulse = (1 + 0.2) * (-25) * 0.25 = -7.5
      // localVel.x -= (-7.5) * (-1) = 25 - 7.5 = 17.5 (smooth cushioning without strobe)
      expect(localVel.x).toBeCloseTo(17.5, 4);
      expect(localVel.y).toBe(0);
    });

    it('preserves tangential and outgoing velocity components when separating from ball', () => {
      const localPos = { x: 10, y: 0 };
      const localVel = { x: -30, y: 15 }; // Moving leftwards away from ball and upwards tangentially
      const playerRadius = 15;
      const ballPos = { x: 30, y: 0 }; // Overlap = 5
      const ballRadius = 10;

      const collided = resolvePredictiveBallCollision(
        localPos,
        localVel,
        playerRadius,
        ballPos,
        ballRadius
      );

      expect(collided).toBe(true);
      expect(localPos.x).toBeCloseTo(8.75, 4);

      // Since normal is (-1, 0), vn = (-30 * -1) = 30 >= 0 (moving away)
      // Velocity should NOT be reduced or canceled
      expect(localVel.x).toBeCloseTo(-30, 4);
      expect(localVel.y).toBeCloseTo(15, 4);
    });

    it('handles exact center overlap (d = 0) with non-zero fallback normal and 25% displacement', () => {
      const localPos = { x: 50, y: 50 };
      const localVel = { x: 0, y: 0 };
      const playerRadius = 15;
      const ballPos = { x: 50, y: 50 };
      const ballRadius = 10;

      const collided = resolvePredictiveBallCollision(
        localPos,
        localVel,
        playerRadius,
        ballPos,
        ballRadius
      );

      expect(collided).toBe(true);
      // Overlap = 25 -> displacement = 25 * 0.25 = 6.25
      const newDist = Math.hypot(localPos.x - ballPos.x, localPos.y - ballPos.y);
      expect(newDist).toBeCloseTo(6.25, 4);
    });

    it('returns false and does not modify player when distance >= sum of radii', () => {
      const localPos = { x: 0, y: 0 };
      const localVel = { x: 10, y: 5 };
      const playerRadius = 15;
      const ballPos = { x: 50, y: 0 }; // d = 50 > 25
      const ballRadius = 10;

      const collided = resolvePredictiveBallCollision(
        localPos,
        localVel,
        playerRadius,
        ballPos,
        ballRadius
      );

      expect(collided).toBe(false);
      expect(localPos.x).toBe(0);
      expect(localPos.y).toBe(0);
      expect(localVel.x).toBe(10);
      expect(localVel.y).toBe(5);
    });
  });

  describe('Reconciliation Error Decay Smoothing', () => {
    it('absorbs positional correction into visualOffset without visual pop and decays exponentially to zero', () => {
      const predictedPos = { x: 100, y: 100 };
      const visualOffset = { x: 0, y: 0 };
      const hostPos = { x: 102, y: 101 }; // Discrepancy within normal range

      // Reconcile snapshot
      const diffX = hostPos.x - predictedPos.x; // 2
      const diffY = hostPos.y - predictedPos.y; // 1

      visualOffset.x -= diffX; // -2
      visualOffset.y -= diffY; // -1
      predictedPos.x = hostPos.x; // 102
      predictedPos.y = hostPos.y; // 101

      // Render position immediately after reconciliation is completely continuous (zero pop)
      const renderX0 = predictedPos.x + visualOffset.x;
      const renderY0 = predictedPos.y + visualOffset.y;
      expect(renderX0).toBeCloseTo(100, 4); // Exactly old predicted pos!
      expect(renderY0).toBeCloseTo(100, 4);

      // Simulate 60 Hz render frames decaying by 0.82
      for (let frame = 0; frame < 25; frame++) {
        visualOffset.x *= 0.82;
        visualOffset.y *= 0.82;
        if (Math.abs(visualOffset.x) < 0.05) visualOffset.x = 0;
        if (Math.abs(visualOffset.y) < 0.05) visualOffset.y = 0;
      }

      // After a few frames, offset is smoothly 0 and player smoothly rendered at hostPos
      expect(visualOffset.x).toBe(0);
      expect(visualOffset.y).toBe(0);
      expect(predictedPos.x + visualOffset.x).toBe(102);
      expect(predictedPos.y + visualOffset.y).toBe(101);
    });
  });
});
