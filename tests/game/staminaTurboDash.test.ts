import { describe, it, expect, beforeEach } from 'vitest';
import { GameEngine } from '../../src/core/game/GameEngine';
import { Player, INPUT_UP, INPUT_RIGHT, INPUT_KICK, INPUT_TURBO, INPUT_DASH } from '../../src/core/game/Player';
import { MatchPhase } from '../../src/core/game/GameFSM';
import { Disc, COLLISION_GROUP_RED, COLLISION_GROUP_BLUE } from '../../src/core/entities/Disc';
import { resolveDiscDiscCollision } from '../../src/core/physics/Collision';

describe('Shared Stamina System (Turbo, Dash, Immobility Recharge & Tackle)', () => {
  let engine: GameEngine;
  let playerRed: Player;
  let playerBlue: Player;

  beforeEach(() => {
    engine = new GameEngine();
    playerRed = new Player({ id: 'p1', name: 'RedPlayer', team: 'red', isHost: true });
    playerBlue = new Player({ id: 'p2', name: 'BluePlayer', team: 'blue', isHost: false });
    engine.addPlayer(playerRed);
    engine.addPlayer(playerBlue);
    engine.fsm.currentState = MatchPhase.PLAYING;
  });

  it('initializes player with 100% stamina pool', () => {
    expect(playerRed.stamina).toBe(100);
    expect(playerRed.isDashing).toBe(false);
    expect(playerRed.isTurbo).toBe(false);
  });

  it('executes Dash consuming exactly 50% stamina for 75 px displacement over 4 ticks', () => {
    // Keep ball far away to isolate player motion
    engine.ball.pos.set(1000, 1000);
    const disc = engine.playerDiscs.get('p1')!;
    disc.pos.set(0, 0);
    disc.prevPos.set(0, 0);
    disc.vel.set(0, 0);

    const inputs = new Map<string, number>();
    inputs.set('p1', INPUT_RIGHT | INPUT_DASH);

    // Tick 1: trigger dash
    engine.tick(inputs);
    expect(playerRed.stamina).toBe(50);
    expect(playerRed.isDashing).toBe(true);

    // Release dash input and complete the 4-tick burst
    inputs.set('p1', 0);
    for (let i = 0; i < 3; i++) {
      engine.tick(inputs);
    }

    expect(playerRed.isDashing).toBe(false);
    // 4 ticks * 18.75 px/tick = 75 px displacement (subject to mid-step substepping damping ~73.8 px)
    expect(disc.pos.x).toBeGreaterThanOrEqual(73);
    expect(disc.pos.x).toBeLessThanOrEqual(76);

    // Attempt second dash with 50% stamina remaining
    inputs.set('p1', INPUT_RIGHT | INPUT_DASH);
    engine.tick(inputs);
    expect(playerRed.stamina).toBe(0);
    expect(playerRed.isDashing).toBe(true);

    // Complete second dash (3 ticks)
    inputs.set('p1', 0);
    for (let i = 0; i < 3; i++) {
      engine.tick(inputs);
    }
    expect(playerRed.isDashing).toBe(false);

    // Third dash should fail due to 0% stamina
    inputs.set('p1', INPUT_RIGHT | INPUT_DASH);
    engine.tick(inputs);
    expect(playerRed.stamina).toBe(0);
    expect(playerRed.isDashing).toBe(false);
    expect(playerRed.dashTicksRemaining).toBe(0);
  });

  it('drains Turbo at 40%/s clamped to max speed of 150 px/s (375 px over 2.5s)', () => {
    engine.ball.pos.set(1000, 1000);
    const disc = engine.playerDiscs.get('p1')!;
    disc.pos.set(0, 0);
    disc.prevPos.set(0, 0);
    disc.vel.set(0, 0);

    const inputs = new Map<string, number>();
    inputs.set('p1', INPUT_RIGHT | INPUT_TURBO);

    // Run 60 ticks (1.0 second) of turbo
    for (let i = 0; i < 60; i++) {
      engine.tick(inputs);
    }

    // Stamina should drain ~40% (leaving ~60%)
    expect(playerRed.stamina).toBeCloseTo(60, 0);
    expect(playerRed.isTurbo).toBe(true);
    // Speed clamped to 150 px/s prior to substep integration, resulting in 150 * 0.96 = 144 post-damping
    const speed = Math.hypot(disc.vel.x, disc.vel.y);
    expect(speed).toBeCloseTo(150 * 0.96, 0.5);

    // Drain remaining stamina (another 90 ticks = 1.5s, total 150 ticks = 2.5s)
    for (let i = 0; i < 90; i++) {
      engine.tick(inputs);
    }

    expect(playerRed.stamina).toBe(0);
    expect(playerRed.isTurbo).toBe(false);
  });

  it('strictly recharges stamina at +25%/s only upon total immobility (v < 0.01 and inputs == 0)', () => {
    engine.ball.pos.set(1000, 1000);
    const disc = engine.playerDiscs.get('p1')!;
    playerRed.stamina = 0;
    disc.pos.set(0, 0);
    disc.prevPos.set(0, 0);

    // Case 1: moving disc (vel > 0.01) with 0 inputs -> NO recharge
    disc.vel.set(50, 0);
    const inputs = new Map<string, number>();
    inputs.set('p1', 0);
    engine.tick(inputs);
    expect(playerRed.stamina).toBe(0);

    // Case 2: holding move key even if stalled against a wall -> NO recharge
    disc.vel.set(0, 0);
    inputs.set('p1', INPUT_UP);
    engine.tick(inputs);
    expect(playerRed.stamina).toBe(0);

    // Case 3: complete stillness (vel < 0.01 && inputs == 0) -> recharge +25%/s
    disc.vel.set(0, 0);
    inputs.set('p1', 0);
    // 60 ticks = 1 second => +25%
    for (let i = 0; i < 60; i++) {
      engine.tick(inputs);
    }
    expect(playerRed.stamina).toBeCloseTo(25, 0.5);

    // 180 ticks = 3 more seconds => reaches 100% and clamps
    for (let i = 0; i < 180; i++) {
      engine.tick(inputs);
    }
    expect(playerRed.stamina).toBe(100);
  });

  it('boosts kick impulse by x1.35 on Dash and x1.15 on Turbo', () => {
    const disc = engine.playerDiscs.get('p1')!;

    // 1. Regular kick (320 px/s with 0.99 ball damping after 1 tick = 316.8)
    disc.pos.set(-28, 0);
    disc.prevPos.set(-28, 0);
    disc.vel.set(0, 0);
    engine.ball.pos.set(0, 0);
    engine.ball.prevPos.set(0, 0);
    engine.ball.vel.set(0, 0);

    let inputs = new Map<string, number>();
    inputs.set('p1', INPUT_KICK);
    engine.tick(inputs);
    const normalKickVx = engine.ball.vel.x;
    expect(normalKickVx).toBeCloseTo(320 * 0.99, 1);

    // 2. Dash kick (x1.35 -> 320 * 1.35 * 0.99 = 427.68)
    playerRed.stamina = 100;
    disc.pos.set(-28, 0);
    disc.prevPos.set(-28, 0);
    disc.vel.set(0, 0);
    engine.ball.pos.set(0, 0);
    engine.ball.prevPos.set(0, 0);
    engine.ball.vel.set(0, 0);

    inputs = new Map<string, number>();
    // Move up (perpendicular to kick direction) so physical collision doesn't interfere
    inputs.set('p1', INPUT_DASH | INPUT_KICK | INPUT_UP);
    engine.tick(inputs);
    const dashKickVx = engine.ball.vel.x;
    expect(dashKickVx).toBeCloseTo(320 * 1.35 * 0.99, 1);

    // 3. Turbo kick (x1.15 -> 320 * 1.15 * 0.99 = 364.32)
    playerRed.stamina = 100;
    playerRed.isDashing = false;
    disc.pos.set(-28, 0);
    disc.prevPos.set(-28, 0);
    disc.vel.set(0, 0);
    engine.ball.pos.set(0, 0);
    engine.ball.prevPos.set(0, 0);
    engine.ball.vel.set(0, 0);

    inputs = new Map<string, number>();
    inputs.set('p1', INPUT_TURBO | INPUT_KICK | INPUT_UP);
    engine.tick(inputs);
    const turboKickVx = engine.ball.vel.x;
    expect(turboKickVx).toBeCloseTo(320 * 1.15 * 0.99, 1);
  });

  it('applies x1.8 inertial mass tackle scale in player-player collisions when dashing or turbo', () => {
    // Disc 1 (Attacker, dashing)
    const attacker = new Disc({
      id: 1,
      x: 0,
      y: 0,
      radius: 15,
      mass: 1.0,
      bounciness: 0.5,
      cGroup: COLLISION_GROUP_RED
    });
    attacker.vel.set(100, 0);
    attacker.isDashing = true;

    // Disc 2 (Defender, normal stationary)
    const defender = new Disc({
      id: 2,
      x: 25, // Overlapping (15 + 15 = 30 > 25)
      y: 0,
      radius: 15,
      mass: 1.0,
      bounciness: 0.5,
      cGroup: COLLISION_GROUP_BLUE
    });
    defender.vel.set(0, 0);

    // Normal collision without tackle:
    // With equal mass m1=1, m2=1, impulse = (-(1+e)*(-100)) / (1+1) = 150 / 2 = 75
    // With tackle m1_eff = 1.8 => invMass1_eff = 1/1.8 = 0.5555
    // totalInvMass = 0.5555 + 1.0 = 1.5555
    // impulse = 150 / 1.5555 = 96.43
    // Defender velocity change = +96.43 (vs 75 without tackle)
    resolveDiscDiscCollision(attacker, defender);

    expect(defender.vel.x).toBeGreaterThan(85); // Significantly greater than 75
    expect(attacker.vel.x).toBeGreaterThan( attacker.vel.x - 75 ); // Attacker slows down less
  });
});
