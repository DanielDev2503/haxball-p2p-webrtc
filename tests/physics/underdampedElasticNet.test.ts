import { describe, it, expect } from 'vitest';
import { GoalNet, NetBall } from '../../src/core/entities/GoalNet';

const makeLeft = (): GoalNet => new GoalNet({
  side: 'left', mouthX: -600, backX: -636, depth: 36, topY: -85, bottomY: 85
});
const makeRight = (): GoalNet => new GoalNet({
  side: 'right', mouthX: 600, backX: 636, depth: 36, topY: -85, bottomY: 85
});

/** X of the curtain at a given Y (linear interpolation over the chain). */
const curtainXAt = (net: GoalNet, y: number): number => {
  for (let k = 0; k < net.nodeCount - 1; k++) {
    if (y >= net.posY[k] && y <= net.posY[k + 1]) {
      const t = (y - net.posY[k]) / (net.posY[k + 1] - net.posY[k]);
      return net.posX[k] + t * (net.posX[k + 1] - net.posX[k]);
    }
  }
  return net.posX[0];
};

const allFinite = (net: GoalNet): boolean => {
  for (let i = 0; i < net.nodeCount; i++) {
    if (!Number.isFinite(net.posX[i]) || !Number.isFinite(net.posY[i])) return false;
  }
  return true;
};

describe('Underdamped Elastic Goal Net (harmonic vibration, zero plasticine, unilateral containment)', () => {
  it('builds N = 15 nodes with m = 0.40 (w = 2.5), anchored ends and underdamped parameters', () => {
    const net = makeLeft();
    expect(net.nodeCount).toBe(15);
    expect(net.invMass[0]).toBe(0);
    expect(net.invMass[14]).toBe(0);
    for (let i = 1; i < 14; i++) expect(net.invMass[i]).toBeCloseTo(2.5, 5);
    expect(net.kSpring).toBeGreaterThanOrEqual(0.12);
    expect(net.kSpring).toBeLessThanOrEqual(0.16);
    expect(net.damping).toBeGreaterThanOrEqual(0.045);
    expect(net.damping).toBeLessThanOrEqual(0.055);
    expect(net.posX).toBeInstanceOf(Float32Array);
  });

  it('vibrates with 2–3 damped harmonic cycles in ~1.5 s and settles at rest (no plastic deformation)', () => {
    const net = makeLeft();
    const mid = 7;
    net.posX[mid] = net.restPosX[mid] - 10; // pulled towards the back
    net.oldPosX[mid] = net.posX[mid];

    let crossings = 0;
    let prevSign = Math.sign(net.posX[mid] - net.restPosX[mid]);
    for (let tick = 0; tick < 90; tick++) {
      net.step(1 / 60);
      const s = Math.sign(net.posX[mid] - net.restPosX[mid]);
      if (s !== 0 && s !== prevSign) {
        crossings++;
        prevSign = s;
      }
    }
    // 2–3 full cycles ⇒ 4–6 zero crossings (allow a small margin)
    expect(crossings).toBeGreaterThanOrEqual(3);
    expect(crossings).toBeLessThanOrEqual(7);

    for (let tick = 0; tick < 30; tick++) net.step(1 / 60);
    expect(net.maxDeviation()).toBeLessThan(1.0); // ~2.0 s total

    for (let tick = 0; tick < 120; tick++) net.step(1 / 60);
    expect(net.maxDeviation()).toBeLessThan(0.1);
    expect(allFinite(net)).toBe(true);
  });

  it('stays perfectly still at rest (no drift)', () => {
    const net = makeRight();
    for (let tick = 0; tick < 600; tick++) net.step(1 / 60);
    expect(net.maxDeviation()).toBeLessThan(1e-4);
  });

  it('decelerates the ball progressively, bulges, keeps it inside and then vibrates back to rest', () => {
    const net = makeLeft();
    const ball: NetBall = { pos: { x: -615, y: 0 }, vel: { x: -400, y: 0 }, radius: 5.8, isBall: true };

    const speeds: number[] = [];
    let maxBulge = 0;
    for (let tick = 0; tick < 40; tick++) {
      net.step(ball, 1 / 60);
      speeds.push(Math.abs(ball.vel.x));
      maxBulge = Math.max(maxBulge, net.maxDeviation());
      // Never beyond the curtain nor the rear limit
      expect(ball.pos.x).toBeGreaterThanOrEqual(curtainXAt(net, ball.pos.y) + 5.8 - 1e-3);
      expect(ball.pos.x).toBeGreaterThanOrEqual(net.rearLimitX + 5.8 - 1e-3);
    }

    // Progressive: the first contact tick does not wipe out the velocity
    const firstContact = speeds.findIndex(v => v < 400);
    expect(firstContact).toBeGreaterThanOrEqual(0);
    expect(speeds[firstContact]).toBeGreaterThan(40);
    // Velocity decreases monotonically over several frames
    expect(speeds[firstContact + 1]).toBeLessThan(speeds[firstContact]);
    expect(maxBulge).toBeGreaterThan(3);

    // Remove the ball: the net must vibrate back (no plasticine)
    for (let tick = 0; tick < 180; tick++) net.step(1 / 60);
    expect(net.maxDeviation()).toBeLessThan(0.5);
    expect(allFinite(net)).toBe(true);
  });

  it('never lets a very fast ball tunnel through the right net', () => {
    const net = makeRight();
    const ball: NetBall = { pos: { x: 625, y: 20 }, vel: { x: 1500, y: -60 }, radius: 5.8, isBall: true };
    for (let tick = 0; tick < 60; tick++) {
      net.step(ball, 1 / 60);
      expect(ball.pos.x).toBeLessThanOrEqual(curtainXAt(net, ball.pos.y) - 5.8 + 1e-3);
      expect(ball.pos.x).toBeLessThanOrEqual(net.rearLimitX - 5.8 + 1e-3);
    }
    expect(allFinite(net)).toBe(true);
  });

  it('keeps anti-loop bending and monotonic Y under repeated impacts', () => {
    const net = makeLeft();
    for (let shot = 0; shot < 6; shot++) {
      const ball: NetBall = { pos: { x: -612, y: -60 + shot * 24 }, vel: { x: -900, y: (shot % 2 ? 1 : -1) * 200 }, radius: 5.8, isBall: true };
      for (let tick = 0; tick < 25; tick++) {
        net.step(ball, 1 / 60);
        for (let i = 0; i < net.nodeCount - 1; i++) {
          expect(net.posY[i + 1]).toBeGreaterThan(net.posY[i]);
        }
        for (let i = 0; i < net.nodeCount - 2; i++) {
          const db = Math.hypot(net.posX[i + 2] - net.posX[i], net.posY[i + 2] - net.posY[i]);
          expect(db).toBeGreaterThanOrEqual(net.restLenBend[i] * 0.85 * 0.9);
        }
      }
    }
    expect(allFinite(net)).toBe(true);
  });

  it('is fully deterministic for identical input sequences', () => {
    const a = makeLeft();
    const b = makeLeft();
    const ba: NetBall = { pos: { x: -610, y: 12 }, vel: { x: -520, y: 35 }, radius: 5.8, isBall: true };
    const bb: NetBall = { pos: { x: -610, y: 12 }, vel: { x: -520, y: 35 }, radius: 5.8, isBall: true };
    for (let tick = 0; tick < 200; tick++) {
      a.step(ba, 1 / 60);
      b.step(bb, 1 / 60);
    }
    for (let i = 0; i < a.nodeCount; i++) {
      expect(a.posX[i]).toBe(b.posX[i]);
      expect(a.posY[i]).toBe(b.posY[i]);
    }
    expect(ba.pos.x).toBe(bb.pos.x);
  });

  it('is fully permeable for player discs', () => {
    const net = makeLeft();
    const player: NetBall = { pos: { x: -640, y: 0 }, vel: { x: -100, y: 0 }, radius: 15, isBall: false };
    net.checkBallCollision(player);
    expect(player.pos.x).toBe(-640);
    expect(net.maxDeviation()).toBe(0);
  });
});
