import { describe, it, expect } from 'vitest';
import { GameEngine } from '../../src/core/game/GameEngine';
import { Player, INPUT_UP, INPUT_RIGHT, INPUT_KICK, INPUT_DOWN, INPUT_LEFT } from '../../src/core/game/Player';

describe('Deterministic Physics Engine', () => {
  it('produces identical state across two isolated instances after 1800 ticks', () => {
    const engine1 = new GameEngine();
    const engine2 = new GameEngine();

    const p1 = new Player({ id: 'p1', name: 'Alice', team: 'red' });
    const p2 = new Player({ id: 'p2', name: 'Bob', team: 'blue' });

    engine1.addPlayer(p1);
    engine1.addPlayer(p2);
    engine1.startMatch();

    const p1Copy = new Player({ id: 'p1', name: 'Alice', team: 'red' });
    const p2Copy = new Player({ id: 'p2', name: 'Bob', team: 'blue' });

    engine2.addPlayer(p1Copy);
    engine2.addPlayer(p2Copy);
    engine2.startMatch();

    // Mock input sequence over 1800 ticks (30s)
    for (let tick = 0; tick < 1800; tick++) {
      const inputs = new Map<string, number>();

      let p1Mask = 0;
      let p2Mask = 0;

      if (tick % 4 === 0) p1Mask |= INPUT_UP;
      if (tick % 6 === 0) p1Mask |= INPUT_RIGHT;
      if (tick % 10 === 0) p1Mask |= INPUT_KICK;

      if (tick % 3 === 0) p2Mask |= INPUT_DOWN;
      if (tick % 5 === 0) p2Mask |= INPUT_LEFT;
      if (tick % 8 === 0) p2Mask |= INPUT_KICK;

      inputs.set('p1', p1Mask);
      inputs.set('p2', p2Mask);

      engine1.tick(inputs);
      engine2.tick(inputs);
    }

    const snap1 = engine1.getSnapshot();
    const snap2 = engine2.getSnapshot();

    expect(snap1.tick).toBe(snap2.tick);
    expect(snap1.redScore).toBe(snap2.redScore);
    expect(snap1.blueScore).toBe(snap2.blueScore);
    expect(snap1.matchState).toBe(snap2.matchState);
    expect(snap1.discs.length).toBe(snap2.discs.length);

    for (let i = 0; i < snap1.discs.length; i++) {
      const d1 = snap1.discs[i];
      const d2 = snap2.discs[i];

      expect(d1.id).toBe(d2.id);
      expect(d1.x).toBeCloseTo(d2.x, 6);
      expect(d1.y).toBeCloseTo(d2.y, 6);
      expect(d1.vx).toBeCloseTo(d2.vx, 6);
      expect(d1.vy).toBeCloseTo(d2.vy, 6);
    }
  });
});
