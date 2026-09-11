import { describe, it, expect } from 'vitest';
import { GameEngine } from '../../src/core/game/GameEngine';
import { Player } from '../../src/core/game/Player';

describe('Match Finite State Machine (GameFSM) - 3-Phase Model', () => {
  it('manages match lifecycle: STOPPED -> COUNTDOWN (3s) -> PLAYING, PAUSED and STOPPED reset', () => {
    const engine = new GameEngine({ scoreLimit: 1, timeLimitSeconds: 180 });
    const p1 = new Player({ id: 'p1', name: 'Alice', team: 'red' });
    const p2 = new Player({ id: 'p2', name: 'Bob', team: 'blue' });
    engine.addPlayer(p1);
    engine.addPlayer(p2);

    // Initial state: STOPPED
    expect(engine.fsm.currentState).toBe('STOPPED');

    // Start match: enters COUNTDOWN
    engine.startMatch();
    expect(engine.fsm.currentState).toBe('COUNTDOWN');
    expect(engine.fsm.countdownSeconds).toBe(3);

    // During countdown, physics does NOT step
    const inputs = new Map<string, number>();
    for (let i = 0; i < 60; i++) {
      engine.tick(inputs);
    }
    expect(engine.fsm.currentState).toBe('COUNTDOWN');
    expect(engine.fsm.countdownSeconds).toBe(2);

    // Advance remaining 120 ticks
    for (let i = 0; i < 120; i++) {
      engine.tick(inputs);
    }
    expect(engine.fsm.currentState).toBe('PLAYING');

    // Test PAUSE: physics freezes, positions and velocities preserved
    engine.ball.pos.set(50, 10);
    engine.ball.vel.set(100, -50);
    engine.togglePause();
    expect(engine.fsm.currentState).toBe('PAUSED');

    // Advance ticks while paused: nothing moves
    engine.tick(inputs);
    expect(engine.ball.pos.x).toBe(50);
    expect(engine.ball.pos.y).toBe(10);
    expect(engine.ball.vel.x).toBe(100);
    expect(engine.ball.vel.y).toBe(-50);

    // Resume from pause: enters COUNTDOWN (3s) before physics resumes
    engine.togglePause();
    expect(engine.fsm.currentState).toBe('COUNTDOWN');
    expect(engine.fsm.countdownSeconds).toBe(3);
    expect(engine.ball.vel.x).toBe(100); // Velocities still preserved!

    // Advance countdown to PLAYING
    for (let i = 0; i < 180; i++) {
      engine.tick(inputs);
    }
    expect(engine.fsm.currentState).toBe('PLAYING');

    // Test STOP: resets time to 0, score to 0 - 0, ball to center (0, 0)
    engine.redScore = 2;
    engine.blueScore = 1;
    engine.stopMatch();
    expect(engine.fsm.currentState).toBe('STOPPED');
    expect(engine.matchTimerSeconds).toBe(0);
    expect(engine.redScore).toBe(0);
    expect(engine.blueScore).toBe(0);
    expect(engine.ball.pos.x).toBe(0);
    expect(engine.ball.pos.y).toBe(0);
  });

  it('teleports players to their goal line with v = (0, 0) on team change', () => {
    const engine = new GameEngine();
    const p1 = new Player({ id: 'p1', name: 'Alice', team: 'spec' });
    engine.addPlayer(p1);

    // Move to red team: should spawn at red goal line (-stadium.halfWidth, 0) with v = (0, 0)
    engine.setPlayerTeam('p1', 'red');
    const redDisc = engine.playerDiscs.get('p1');
    expect(redDisc).toBeDefined();
    expect(redDisc!.pos.x).toBe(-engine.stadium.halfWidth);
    expect(redDisc!.pos.y).toBe(0);
    expect(redDisc!.vel.x).toBe(0);
    expect(redDisc!.vel.y).toBe(0);

    // Move to blue team: should teleport to blue goal line (stadium.halfWidth, 0) with v = (0, 0)
    engine.setPlayerTeam('p1', 'blue');
    const blueDisc = engine.playerDiscs.get('p1');
    expect(blueDisc).toBeDefined();
    expect(blueDisc!.pos.x).toBe(engine.stadium.halfWidth);
    expect(blueDisc!.pos.y).toBe(0);
    expect(blueDisc!.vel.x).toBe(0);
    expect(blueDisc!.vel.y).toBe(0);
  });
});

