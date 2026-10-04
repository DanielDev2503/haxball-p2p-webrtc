import { describe, it, expect, beforeEach } from 'vitest';
import { GameEngine } from '../../src/core/game/GameEngine';
import { Player, INPUT_KICK } from '../../src/core/game/Player';
import { MatchPhase } from '../../src/core/game/GameFSM';
import { Segment } from '../../src/core/entities/Segment';
import { resolveDiscDiscCollision, resolveDiscSegmentCollision } from '../../src/core/physics/Collision';
import { Disc, COLLISION_GROUP_BALL, COLLISION_GROUP_RED } from '../../src/core/entities/Disc';

describe('Directed 2D Magnus Effect', () => {
  let engine: GameEngine;
  let player: Player;

  beforeEach(() => {
    engine = new GameEngine();
    player = new Player({ id: 'p1', name: 'Tester', team: 'red', isHost: true });
    engine.addPlayer(player);
    engine.fsm.currentState = MatchPhase.PLAYING;
  });

  it('applies aggressive lateral curvature while curve key is actively held, and extinguishes immediately when released', () => {
    const disc = engine.playerDiscs.get('p1')!;
    // Place player right behind the ball at (-25, 0) kicking forward (+X)
    disc.pos.set(-25, 0);
    disc.prevPos.set(-25, 0);
    disc.vel.set(0, 0);

    engine.ball.pos.set(0, 0);
    engine.ball.prevPos.set(0, 0);
    engine.ball.vel.set(0, 0);

    // Initial kick
    const inputs = new Map<string, number>();
    inputs.set('p1', INPUT_KICK);
    engine.tick(inputs);

    expect(engine.ball.isCurvingAllowed).toBe(true);

    // Apply active left curve key (INPUT_MAGNUS_LEFT / curveInput = 1) for 10 ticks
    player.curveInput = 1;
    for (let i = 0; i < 10; i++) {
      engine.tick(inputs);
    }

    expect(engine.ball.isCurving).toBe(true);
    expect(engine.ball.curvePerp).toBe(-1);
    // Ball should have developed significant lateral velocity towards negative Y
    expect(engine.ball.vel.y).toBeLessThan(-5.0);

    // Release curve key: curveLeft = false, curveRight = false
    player.curveInput = 0;
    engine.tick(new Map());

    expect(engine.ball.isCurving).toBe(false);
    expect(engine.ball.curvePerp).toBe(0);

    // Record lateral velocity and verify zero centripetal acceleration in subsequent ticks
    // vel.y must only experience standard damping (0.99), with no lateral deviation or steering
    const vyAfterRelease = engine.ball.vel.y;
    engine.tick(new Map());

    // In Euler physics: vy_next = vy * damping (0.99)
    expect(engine.ball.vel.y).toBeCloseTo(vyAfterRelease * 0.99, 4);
    expect(engine.ball.isCurving).toBe(false);
    expect(engine.ball.curvePerp).toBe(0);
  });

  it('applies braking when curve input opposes velocity direction (c_parallel < 0)', () => {
    const disc = engine.playerDiscs.get('p1')!;
    disc.pos.set(-25, 0);
    disc.prevPos.set(-25, 0);

    engine.ball.pos.set(0, 0);
    engine.ball.vel.set(0, 0);

    // Player kicks forward (+X), but curve input is backwards (-X)
    player.curveX = -1;
    player.curveY = 0;

    const inputs = new Map<string, number>();
    inputs.set('p1', INPUT_KICK);
    engine.tick(inputs);

    expect(engine.ball.curveBrake).toBeGreaterThan(0);

    // Record speed after kick
    const speedAfterKick = engine.ball.vel.x;

    // Tick forward with kick released
    inputs.set('p1', 0);
    engine.tick(inputs);

    // Ball should have decelerated faster due to a_brake
    expect(engine.ball.vel.x).toBeLessThan(speedAfterKick * 0.99); // Greater than standard 0.99 damping alone
  });

  it('extinguishes Magnus curve immediately on collision with another disc or segment', () => {
    const ball = new Disc({
      id: 0,
      x: 100,
      y: 0,
      radius: 10,
      isBall: true,
      cGroup: COLLISION_GROUP_BALL
    });
    ball.vel.set(100, 0);
    ball.isCurving = true;
    ball.curvePerp = 1.0;
    ball.curveBrake = 0.5;

    const playerDisc = new Disc({
      id: 1001,
      x: 115, // overlapping (radius 10 + 15 = 25 > 15)
      y: 0,
      radius: 15,
      isBall: false,
      cGroup: COLLISION_GROUP_RED
    });

    resolveDiscDiscCollision(ball, playerDisc);

    expect(ball.isCurving).toBe(false);
    expect(ball.curvePerp).toBe(0);
    expect(ball.curveBrake).toBe(0);

    // Test segment collision extinction
    ball.pos.set(100, 0);
    ball.vel.set(50, 0);
    ball.isCurving = true;
    ball.curvePerp = -0.8;
    const seg = new Segment({
      id: 1,
      x0: 105,
      y0: -50,
      x1: 105,
      y1: 50
    });

    resolveDiscSegmentCollision(ball, seg);

    expect(ball.isCurving).toBe(false);
    expect(ball.curvePerp).toBe(0);
  });
});
