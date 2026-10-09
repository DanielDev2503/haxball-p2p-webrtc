import { describe, it, expect, beforeEach } from 'vitest';
import { GameEngine } from '../../src/core/game/GameEngine';
import { Player, INPUT_RIGHT, INPUT_LEFT, INPUT_KICK } from '../../src/core/game/Player';
import { MatchPhase } from '../../src/core/game/GameFSM';

describe('Regulatory Kickoff Barriers & Contact Deactivation', () => {
  let engine: GameEngine;
  let pRed: Player;
  let pBlue: Player;

  beforeEach(() => {
    engine = new GameEngine({ scoreLimit: 3, timeLimitSeconds: 180 });
    pRed = new Player({ id: 'red-1', name: 'RedStriker', team: 'red' });
    pBlue = new Player({ id: 'blue-1', name: 'BlueStriker', team: 'blue' });
    engine.addPlayer(pRed);
    engine.addPlayer(pBlue);
  });

  it('activates neutral kickoff on match start with halfway line barrier at X = 0', () => {
    engine.startMatch();
    expect(engine.kickoffState.active).toBe(true);
    expect(engine.kickoffState.mode).toBe('NEUTRAL');
    expect(engine.kickoffState.possessingTeam).toBeNull();

    // Fast-forward countdown into PLAYING
    for (let i = 0; i < 180; i++) {
      engine.tick(new Map());
    }
    expect(engine.fsm.currentState).toBe(MatchPhase.PLAYING);
    expect(engine.kickoffState.active).toBe(true);

    const redDisc = engine.playerDiscs.get(pRed.id)!;
    const blueDisc = engine.playerDiscs.get(pBlue.id)!;

    // Position Red close to X = 0 (away from ball at y=60) and attempt to cross into Blue territory (X > 0)
    redDisc.pos.set(-10, 60);
    redDisc.vel.set(100, 0);

    const inputs = new Map<string, number>();
    inputs.set(pRed.id, INPUT_RIGHT);
    engine.tick(inputs);

    // Red must be restricted to pos.x <= -15 and vx must not be positive towards rival side
    expect(redDisc.pos.x).toBeLessThanOrEqual(-15);
    expect(redDisc.vel.x).toBeLessThanOrEqual(0);

    // Position Blue close to X = 0 (away from ball at y=60) and attempt to cross into Red territory (X < 0)
    blueDisc.pos.set(10, 60);
    blueDisc.vel.set(-100, 0);
    inputs.clear();
    inputs.set(pBlue.id, INPUT_LEFT);
    engine.tick(inputs);

    // Blue must be restricted to pos.x >= 15 and vx must not be negative towards rival side
    expect(blueDisc.pos.x).toBeGreaterThanOrEqual(15);
    expect(blueDisc.vel.x).toBeGreaterThanOrEqual(0);
  });

  it('deactivates barriers immediately upon first ball touch in neutral kickoff', () => {
    engine.startMatch();
    for (let i = 0; i < 180; i++) engine.tick(new Map());

    const redDisc = engine.playerDiscs.get(pRed.id)!;
    // Position red right at ball touch threshold (ball is at 0, 0 with radius 10, player radius 15)
    redDisc.pos.set(-20, 0);
    redDisc.vel.set(10, 0);

    expect(engine.kickoffState.active).toBe(true);

    // Tick to allow collision/touch with ball
    engine.tick(new Map());

    // Once touched, kickoffState.active becomes false
    expect(engine.kickoffState.active).toBe(false);

    // Barriers are now dropped: Red can now freely cross X = 0
    redDisc.pos.set(-5, 0);
    redDisc.vel.set(50, 0);
    const inputs = new Map<string, number>();
    inputs.set(pRed.id, INPUT_RIGHT);
    engine.tick(inputs);

    expect(redDisc.pos.x).toBeGreaterThan(-15);
  });

  it('enforces TEAM_KICKOFF after goal: conceding team possesses ball, scoring team blocked from center circle (R=80)', () => {
    engine.startMatch();
    for (let i = 0; i < 180; i++) engine.tick(new Map());

    // Red scores a goal
    engine.ball.pos.set(engine.stadium.halfWidth + 20, 0);
    engine.tick(new Map());
    expect(engine.fsm.currentState).toBe(MatchPhase.GOAL_CELEBRATION);
    expect(engine.lastScoringTeam).toBe('red');

    // Fast-forward celebration (180 ticks)
    for (let i = 0; i < 180; i++) engine.tick(new Map());

    // Blue conceded, so Blue gets possession for kickoff
    expect(engine.kickoffState.active).toBe(true);
    expect(engine.kickoffState.mode).toBe('TEAM_KICKOFF');
    expect(engine.kickoffState.possessingTeam).toBe('blue');

    // Fast-forward countdown back to PLAYING
    for (let i = 0; i < 180; i++) engine.tick(new Map());
    expect(engine.fsm.currentState).toBe(MatchPhase.PLAYING);
    expect(engine.kickoffState.active).toBe(true);

    const redDisc = engine.playerDiscs.get(pRed.id)!;
    const blueDisc = engine.playerDiscs.get(pBlue.id)!;

    // 1. Red (non-possessing team) tries to enter central rotonda R = 80
    redDisc.pos.set(-60, 0); // Inside circle radius (< 80 + 15 = 95)
    redDisc.vel.set(50, 0);

    engine.tick(new Map());

    // Red must be repelled radially outwards to at least distance 95 from center
    const redDist = Math.hypot(redDisc.pos.x, redDisc.pos.y);
    expect(redDist).toBeGreaterThanOrEqual(95 - 0.01);
    expect(redDisc.pos.x).toBeLessThanOrEqual(-95 + 0.01);

    // 2. Blue (possessing team) CAN enter the central circle freely to take kickoff
    blueDisc.pos.set(50, 0); // inside R = 80
    blueDisc.vel.set(0, 0);
    engine.tick(new Map());
    expect(blueDisc.pos.x).toBeCloseTo(50, 0);

    // 3. Kickoff deactivation: Blue kicks/touches ball
    blueDisc.pos.set(20, 0);
    const kickInputs = new Map<string, number>();
    kickInputs.set(pBlue.id, INPUT_KICK);
    engine.tick(kickInputs);

    expect(engine.kickoffState.active).toBe(false);
  });

  it('keeps matchTimerSeconds and activePlayTicks frozen during kickoff and starts clock only after ball touch', () => {
    engine.startMatch();
    // Fast-forward countdown into PLAYING
    for (let i = 0; i < 180; i++) engine.tick(new Map());
    expect(engine.fsm.currentState).toBe(MatchPhase.PLAYING);
    expect(engine.kickoffState.active).toBe(true);

    // Initial matchTimerSeconds should be 180 and activePlayTicks 0
    expect(engine.matchTimerSeconds).toBe(180);
    expect(engine.activePlayTicks).toBe(0);

    // Simulate 120 ticks without any player touching the ball
    for (let i = 0; i < 120; i++) {
      engine.tick(new Map());
    }

    // Timer must remain strictly frozen
    expect(engine.matchTimerSeconds).toBe(180);
    expect(engine.activePlayTicks).toBe(0);
    expect(engine.kickoffState.active).toBe(true);

    // Now player touches the ball
    const redDisc = engine.playerDiscs.get(pRed.id)!;
    redDisc.pos.set(-15, 0); // Touching ball at (0, 0)
    engine.tick(new Map());

    // Kickoff becomes inactive
    expect(engine.kickoffState.active).toBe(false);

    // Next ticks must advance activePlayTicks and decrement matchTimerSeconds
    for (let i = 0; i < 60; i++) {
      engine.tick(new Map());
    }
    expect(engine.activePlayTicks).toBeGreaterThan(0);
    expect(engine.matchTimerSeconds).toBeLessThan(180);
  });

  it('confines possessing team to own half plus center circle (cannot exit circle into opponent half)', () => {
    engine.startMatch();
    for (let i = 0; i < 180; i++) engine.tick(new Map());

    // Goal scored by Red -> Blue gets kickoff
    engine.ball.pos.set(engine.stadium.halfWidth + 20, 0);
    engine.tick(new Map());
    for (let i = 0; i < 180; i++) engine.tick(new Map()); // Celebration
    for (let i = 0; i < 180; i++) engine.tick(new Map()); // Countdown

    expect(engine.kickoffState.possessingTeam).toBe('blue');
    const blueDisc = engine.playerDiscs.get(pBlue.id)!;

    // 1. Blue can be inside the circle in Red's half (x < 0, inside circle r=80, radius 15 -> r <= 65)
    blueDisc.pos.set(-30, 0);
    blueDisc.vel.set(0, 0);
    engine.tick(new Map());
    expect(blueDisc.pos.x).toBeCloseTo(-30, 0);

    // 2. Blue attempts to leave the circle deeper into Red territory (x = -80)
    blueDisc.pos.set(-75, 0);
    blueDisc.vel.set(-50, 0);
    engine.tick(new Map());

    // Blue should be restricted by the circle boundary in Red territory (distance <= 80 - 15 = 65)
    const dist = Math.hypot(blueDisc.pos.x, blueDisc.pos.y);
    expect(dist).toBeLessThanOrEqual(65.01);
  });

  it('allows possessing team free movement in own half without clamping or radial force', () => {
    engine.startMatch();
    for (let i = 0; i < 180; i++) engine.tick(new Map());

    // Goal scored by Red -> Blue gets kickoff
    engine.ball.pos.set(engine.stadium.halfWidth + 20, 0);
    engine.tick(new Map());
    for (let i = 0; i < 180; i++) engine.tick(new Map());
    for (let i = 0; i < 180; i++) engine.tick(new Map());

    expect(engine.kickoffState.possessingTeam).toBe('blue');
    const blueDisc = engine.playerDiscs.get(pBlue.id)!;

    // Blue (base half X >= 0) is at x = 5, y = 70 (where |y| = 70 > R - r = 65)
    blueDisc.pos.set(5, 70);
    blueDisc.vel.set(-10, 5);
    engine.tick(new Map());

    // Blue in own half (x >= 0) must NOT suffer any clamping, radial projection, or halfway barrier
    expect(blueDisc.pos.x).toBeGreaterThanOrEqual(0);
    expect(blueDisc.pos.y).toBeCloseTo(70.08, 1);
  });

  it('strictly blocks possessing team in rival half outside central circle (|y| >= R)', () => {
    engine.startMatch();
    for (let i = 0; i < 180; i++) engine.tick(new Map());

    // Goal scored by Red -> Blue gets kickoff
    engine.ball.pos.set(engine.stadium.halfWidth + 20, 0);
    engine.tick(new Map());
    for (let i = 0; i < 180; i++) engine.tick(new Map());
    for (let i = 0; i < 180; i++) engine.tick(new Map());

    expect(engine.kickoffState.possessingTeam).toBe('blue');
    const blueDisc = engine.playerDiscs.get(pBlue.id)!;

    // Blue attempts to cross into Red territory (X < 0) at y = 85 (|y| >= centerR = 80)
    blueDisc.pos.set(-10, 85);
    blueDisc.vel.set(-50, 0);
    engine.tick(new Map());

    // Must be clamped to x >= 0 with negative vx nullified
    expect(blueDisc.pos.x).toBeGreaterThanOrEqual(0);
    expect(blueDisc.vel.x).toBeGreaterThanOrEqual(0);
  });

  it('eliminates spurious vertex impulses at (0, ±R_circle) for possessing kickoff team', async () => {
    engine.startMatch();
    for (let i = 0; i < 180; i++) engine.tick(new Map());

    // Goal scored by Red -> Blue gets kickoff
    engine.ball.pos.set(engine.stadium.halfWidth + 20, 0);
    engine.tick(new Map());
    for (let i = 0; i < 180; i++) engine.tick(new Map());
    for (let i = 0; i < 180; i++) engine.tick(new Map());

    const { Segment } = await import('../../src/core/entities/Segment');
    const { resolveDiscSegmentCollision } = await import('../../src/core/physics/Collision');
    const { COLLISION_GROUP_WALL } = await import('../../src/core/entities/Disc');

    const halfSeg = new Segment({
      id: 999,
      x0: 0,
      y0: 80,
      x1: 0,
      y1: 270,
      cGroup: COLLISION_GROUP_WALL,
      cMask: 0xFFFFFFFF
    });

    const blueDisc = engine.playerDiscs.get(pBlue.id)!;
    // Position blue disc touching the vertex at (0, 80)
    blueDisc.pos.set(5, 80);
    blueDisc.vel.set(-10, 0);

    const collisionResolved = resolveDiscSegmentCollision(
      blueDisc,
      halfSeg,
      undefined,
      engine.physicsWorld.kickoffContext
    );

    // Collision with the seam vertex must be disabled for possessing team player
    expect(collisionResolved).toBe(false);

    // For rival team (Red), collision must NOT be disabled
    const redDisc = engine.playerDiscs.get(pRed.id)!;
    redDisc.pos.set(-5, 80);
    const redCollision = resolveDiscSegmentCollision(
      redDisc,
      halfSeg,
      undefined,
      engine.physicsWorld.kickoffContext
    );
    expect(redCollision).toBe(true);
  });

  it('serializes and deserializes kickoffState in GameSnapshot', () => {
    engine.startMatch();
    const snap = engine.getSnapshot();
    expect(snap.kickoffActive).toBe(true);
    expect(snap.kickoffMode).toBe('NEUTRAL');
    expect(snap.possessingTeam).toBeNull();
  });
});

