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

  it('allows possessing team full access to center circle in rival half when dist <= R - r', () => {
    engine.startMatch();
    for (let i = 0; i < 180; i++) engine.tick(new Map());

    // Goal scored by Red -> Blue gets kickoff
    engine.ball.pos.set(engine.stadium.halfWidth + 20, 0);
    engine.tick(new Map());
    for (let i = 0; i < 180; i++) engine.tick(new Map()); // Celebration
    for (let i = 0; i < 180; i++) engine.tick(new Map()); // Countdown

    expect(engine.kickoffState.possessingTeam).toBe('blue');
    const blueDisc = engine.playerDiscs.get(pBlue.id)!;

    // 1. Blue can enter Red territory inside the central circle (x = -25, y = 35) away from ball (dist approx 43 <= 65)
    blueDisc.pos.set(-25, 35);
    blueDisc.vel.set(0, 0);
    engine.tick(new Map());

    expect(blueDisc.pos.x).toBeCloseTo(-25, 0);
    expect(blueDisc.pos.y).toBeCloseTo(35, 0);
    expect(engine.kickoffState.active).toBe(true);

    // Goal scored by Blue -> Red gets kickoff
    engine.ball.pos.set(-engine.stadium.halfWidth - 20, 0);
    engine.tick(new Map());
    for (let i = 0; i < 180; i++) engine.tick(new Map());
    for (let i = 0; i < 180; i++) engine.tick(new Map());

    expect(engine.kickoffState.possessingTeam).toBe('red');
    const redDisc = engine.playerDiscs.get(pRed.id)!;

    // 2. Red can enter Blue territory inside the central circle (x = 25, y = 35) away from ball
    redDisc.pos.set(25, 35);
    redDisc.vel.set(0, 0);
    engine.tick(new Map());

    expect(redDisc.pos.x).toBeCloseTo(25, 0);
    expect(redDisc.pos.y).toBeCloseTo(35, 0);
    expect(engine.kickoffState.active).toBe(true);
  });

  it('blocks possessing team from exiting center circle into rival territory (dist > R - r)', () => {
    engine.startMatch();
    for (let i = 0; i < 180; i++) engine.tick(new Map());

    // Goal scored by Red -> Blue gets kickoff
    engine.ball.pos.set(engine.stadium.halfWidth + 20, 0);
    engine.tick(new Map());
    for (let i = 0; i < 180; i++) engine.tick(new Map());
    for (let i = 0; i < 180; i++) engine.tick(new Map());

    expect(engine.kickoffState.possessingTeam).toBe('blue');
    const blueDisc = engine.playerDiscs.get(pBlue.id)!;

    // Blue attempts to go deep into Red territory beyond R_inner (65): x = -75, y = 30 (dist approx 80.7 > 65)
    blueDisc.pos.set(-75, 30);
    blueDisc.vel.set(-50, 0);
    engine.tick(new Map());

    const blueDist = Math.hypot(blueDisc.pos.x, blueDisc.pos.y);
    expect(blueDist).toBeLessThanOrEqual(65.01);
    expect(blueDisc.pos.x).toBeLessThan(0); // Still in rival territory but projected to arc
    expect(engine.kickoffState.active).toBe(true);

    // Goal scored by Blue -> Red gets kickoff
    engine.ball.pos.set(-engine.stadium.halfWidth - 20, 0);
    engine.tick(new Map());
    for (let i = 0; i < 180; i++) engine.tick(new Map());
    for (let i = 0; i < 180; i++) engine.tick(new Map());

    expect(engine.kickoffState.possessingTeam).toBe('red');
    const redDisc = engine.playerDiscs.get(pRed.id)!;

    // Red attempts to go deep into Blue territory: x = 75, y = 30
    redDisc.pos.set(75, 30);
    redDisc.vel.set(50, 0);
    engine.tick(new Map());

    const redDist = Math.hypot(redDisc.pos.x, redDisc.pos.y);
    expect(redDist).toBeLessThanOrEqual(65.01);
    expect(redDisc.pos.x).toBeGreaterThan(0);
    expect(engine.kickoffState.active).toBe(true);
  });

  it('blocks possessing team from crossing midfield line outside center circle (|y| >= Y_seam)', () => {
    engine.startMatch();
    for (let i = 0; i < 180; i++) engine.tick(new Map());

    // Goal scored by Red -> Blue gets kickoff
    engine.ball.pos.set(engine.stadium.halfWidth + 20, 0);
    engine.tick(new Map());
    for (let i = 0; i < 180; i++) engine.tick(new Map());
    for (let i = 0; i < 180; i++) engine.tick(new Map());

    expect(engine.kickoffState.possessingTeam).toBe('blue');
    const blueDisc = engine.playerDiscs.get(pBlue.id)!;

    // R = 80, r = 15 -> R_inner = 65, Y_seam = sqrt(65^2 - 15^2) = sqrt(4000) approx 63.25
    // Blue attempts to cross into Red territory (x < 0) at y = 70 (|y| = 70 >= Y_seam)
    blueDisc.pos.set(-10, 70);
    blueDisc.vel.set(-50, 0);
    engine.tick(new Map());

    // Must be clamped to pos.x = r (15) and negative vx nullified, preventing any midline body bleed
    expect(blueDisc.pos.x).toBeGreaterThanOrEqual(15);
    expect(blueDisc.vel.x).toBeGreaterThanOrEqual(0);

    // Goal scored by Blue -> Red gets kickoff
    engine.ball.pos.set(-engine.stadium.halfWidth - 20, 0);
    engine.tick(new Map());
    for (let i = 0; i < 180; i++) engine.tick(new Map());
    for (let i = 0; i < 180; i++) engine.tick(new Map());

    expect(engine.kickoffState.possessingTeam).toBe('red');
    const redDisc = engine.playerDiscs.get(pRed.id)!;

    // Red attempts to cross into Blue territory (x > 0) at y = 70 (|y| >= Y_seam)
    redDisc.pos.set(10, 70);
    redDisc.vel.set(50, 0);
    engine.tick(new Map());

    // Must be clamped to pos.x = -r (-15) and positive vx nullified, preventing midline body bleed
    expect(redDisc.pos.x).toBeLessThanOrEqual(-15);
    expect(redDisc.vel.x).toBeLessThanOrEqual(0);
  });

  it('verifies mathematical continuity at Y_seam between vertical line and circular arc', () => {
    engine.startMatch();
    for (let i = 0; i < 180; i++) engine.tick(new Map());

    // Blue scores -> Red gets kickoff
    engine.ball.pos.set(-engine.stadium.halfWidth - 20, 0);
    engine.tick(new Map());
    for (let i = 0; i < 180; i++) engine.tick(new Map());
    for (let i = 0; i < 180; i++) engine.tick(new Map());

    expect(engine.kickoffState.possessingTeam).toBe('red');
    const redDisc = engine.playerDiscs.get(pRed.id)!;

    // Y_seam = sqrt(65^2 - 15^2) approx 63.24555
    const ySeam = Math.sqrt(65 * 65 - 15 * 15);

    // 1. Exactly at y = ySeam, outside boundary clamps to x = -r (-15)
    redDisc.pos.set(0, ySeam);
    redDisc.vel.set(20, 0);
    engine.tick(new Map());
    expect(redDisc.pos.x).toBeCloseTo(-15, 0);
    expect(redDisc.vel.x).toBeLessThanOrEqual(0);

    // 2. Just inside y = ySeam - 0.5 (within circle), disc attempting to cross beyond circle is projected to arc
    redDisc.pos.set(50, ySeam - 0.5);
    redDisc.vel.set(50, 0);
    engine.tick(new Map());
    const dist = Math.hypot(redDisc.pos.x, redDisc.pos.y);
    expect(dist).toBeLessThanOrEqual(65.01);
  });

  it('allows possessing team completely free movement in own half without spurious projections or teleport', () => {
    engine.startMatch();
    for (let i = 0; i < 180; i++) engine.tick(new Map());

    // Goal scored by Red -> Blue gets kickoff
    engine.ball.pos.set(engine.stadium.halfWidth + 20, 0);
    engine.tick(new Map());
    for (let i = 0; i < 180; i++) engine.tick(new Map());
    for (let i = 0; i < 180; i++) engine.tick(new Map());

    expect(engine.kickoffState.possessingTeam).toBe('blue');
    const blueDisc = engine.playerDiscs.get(pBlue.id)!;

    // Blue (base half X >= 0) is in own territory at x = 30, y = 70 (where dist > 65 and |y| > 65)
    blueDisc.pos.set(30, 70);
    blueDisc.vel.set(10, 5);
    engine.tick(new Map());

    // In own half, NO restriction: pos.x >= 0, position advanced normally by vel
    expect(blueDisc.pos.x).toBeGreaterThan(30);
    expect(blueDisc.pos.y).toBeCloseTo(70.08, 1);

    // Goal scored by Blue -> Red gets kickoff
    engine.ball.pos.set(-engine.stadium.halfWidth - 20, 0);
    engine.tick(new Map());
    for (let i = 0; i < 180; i++) engine.tick(new Map());
    for (let i = 0; i < 180; i++) engine.tick(new Map());

    expect(engine.kickoffState.possessingTeam).toBe('red');
    const redDisc = engine.playerDiscs.get(pRed.id)!;

    // Red (base half X <= 0) is in own territory at x = -30, y = 70
    redDisc.pos.set(-30, 70);
    redDisc.vel.set(-10, 5);
    engine.tick(new Map());

    expect(redDisc.pos.x).toBeLessThan(-30);
    expect(redDisc.pos.y).toBeCloseTo(70.08, 1);
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

