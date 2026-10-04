import { describe, it, expect } from 'vitest';

describe('Client Input Buffer & Prediction Replay Reconciliation', () => {
  it('correctly discards obsolete inputs with tick <= snap.tick and retains pending inputs', () => {
    const inputBuffer: Array<{
      tick: number;
      mask: number;
      curve: { x: number; y: number };
      isTurbo: boolean;
      triggerDash: boolean;
    }> = [];

    // Client has sent inputs from tick 100 to 110
    for (let t = 100; t <= 110; t++) {
      inputBuffer.push({
        tick: t,
        mask: 1,
        curve: { x: 0, y: 0 },
        isTurbo: false,
        triggerDash: false
      });
    }

    expect(inputBuffer.length).toBe(11);

    // Host snapshot arrives with tick 104
    const snapTick = 104;
    while (inputBuffer.length > 0 && inputBuffer[0].tick <= snapTick) {
      inputBuffer.shift();
    }

    // Obsolete inputs 100, 101, 102, 103, 104 discarded (5 inputs)
    expect(inputBuffer.length).toBe(6);
    expect(inputBuffer[0].tick).toBe(105);
    expect(inputBuffer[inputBuffer.length - 1].tick).toBe(110);
  });

  it('absorbs residual error in visualOffset when discrepancy <= 50 px', () => {
    let visualOffset = { x: 0, y: 0 };
    const prevPredicted = { x: 102, y: 50 };
    const resimulated = { x: 100, y: 50 };

    const errX = prevPredicted.x - resimulated.x; // 2 px
    const errY = prevPredicted.y - resimulated.y; // 0 px
    const distSq = errX * errX + errY * errY;

    if (distSq > 50 * 50) {
      visualOffset.x = 0;
      visualOffset.y = 0;
    } else {
      visualOffset.x += errX;
      visualOffset.y += errY;
    }

    expect(visualOffset.x).toBe(2);
    expect(visualOffset.y).toBe(0);

    // Exponential decay (0.82) over simulated frames
    visualOffset.x *= 0.82;
    expect(visualOffset.x).toBeCloseTo(1.64, 2);

    for (let i = 0; i < 20; i++) {
      visualOffset.x *= 0.82;
    }
    expect(visualOffset.x).toBeLessThan(0.05);
  });

  it('triggers hard snap and resets visualOffset when post-replay discrepancy exceeds 50 px', () => {
    let visualOffset = { x: 5, y: 5 };
    const prevPredicted = { x: 200, y: 150 };
    const resimulated = { x: 100, y: 50 }; // Teleport or goal respawn: 100px discrepancy

    const errX = prevPredicted.x - resimulated.x;
    const errY = prevPredicted.y - resimulated.y;
    const distSq = errX * errX + errY * errY;

    expect(distSq).toBeGreaterThan(50 * 50);

    if (distSq > 50 * 50) {
      visualOffset.x = 0;
      visualOffset.y = 0;
    }

    expect(visualOffset.x).toBe(0);
    expect(visualOffset.y).toBe(0);
  });
});
