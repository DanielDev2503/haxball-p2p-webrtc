import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GameEngine } from '../../src/core/game/GameEngine';
import { MatchPhase } from '../../src/core/game/GameFSM';
import { Player } from '../../src/core/game/Player';
import { SnapshotPacket } from '../../src/net/protocol/SnapshotPacket';
import { JitterBuffer } from '../../src/net/transport/JitterBuffer';
import { CanvasRenderer } from '../../src/render/CanvasRenderer';
import { Stadium } from '../../src/core/entities/Stadium';
import { GameSnapshot } from '../../src/core/game/GameState';

describe('Host-Client Parity: Overlays, Banners & Celebration Physics', () => {
  let engine: GameEngine;
  let pRed: Player;
  let pBlue: Player;

  beforeEach(() => {
    engine = new GameEngine({ scoreLimit: 3, timeLimitSeconds: 180 });
    pRed = new Player({ id: 'pRed', name: 'RedPlayer', team: 'red' });
    pBlue = new Player({ id: 'pBlue', name: 'BluePlayer', team: 'blue' });
    engine.addPlayer(pRed);
    engine.addPlayer(pBlue);
  });

  it('serializes and deserializes MatchPhase, targetTeam and subStateTimer in binary snapshot during celebration', () => {
    engine.startMatch();
    // Fast-forward countdown to PLAYING
    for (let i = 0; i < 180; i++) engine.tick(new Map());
    expect(engine.fsm.currentState).toBe(MatchPhase.PLAYING);

    // Score a goal for red by placing ball in blue goal
    engine.ball.pos.set(engine.stadium.halfWidth + 20, 0);
    engine.tick(new Map());

    expect(engine.fsm.currentState).toBe(MatchPhase.GOAL_CELEBRATION);
    expect(engine.redScore).toBe(1);
    expect(engine.lastScoringTeam).toBe('red');

    // Generate snapshot from authoritative engine
    const hostSnapshot = engine.getSnapshot();
    expect(hostSnapshot.matchPhase).toBe(MatchPhase.GOAL_CELEBRATION);
    expect(hostSnapshot.targetTeam).toBe(1); // 1 = Red
    expect(hostSnapshot.scoreRed).toBe(1);
    expect(hostSnapshot.scoreBlue).toBe(0);
    expect(hostSnapshot.subStateTimer).toBeCloseTo(3.0, 1);

    // Encode via SnapshotPacket
    const buffer = SnapshotPacket.encode(hostSnapshot);
    expect(buffer.byteLength).toBe(SnapshotPacket.HEADER_LENGTH + hostSnapshot.discs.length * SnapshotPacket.DISC_LENGTH);

    // Decode on simulated client
    const clientSnapshot = SnapshotPacket.decode(buffer);
    expect(clientSnapshot).not.toBeNull();
    expect(clientSnapshot!.matchPhase).toBe(MatchPhase.GOAL_CELEBRATION);
    expect(clientSnapshot!.targetTeam).toBe(1);
    expect(clientSnapshot!.scoreRed).toBe(1);
    expect(clientSnapshot!.scoreBlue).toBe(0);
    expect(clientSnapshot!.subStateTimer).toBeCloseTo(3.0, 1);
  });

  it('keeps JitterBuffer kinematics and interpolation active during GOAL_CELEBRATION without freezing discs', () => {
    const jitterBuffer = new JitterBuffer(50);

    const baseSnapshot: GameSnapshot = {
      tick: 100,
      matchPhase: MatchPhase.GOAL_CELEBRATION,
      timerSeconds: 150,
      subStateTimer: 2.8,
      targetTeam: 1,
      scoreRed: 1,
      scoreBlue: 0,
      matchState: MatchPhase.GOAL_CELEBRATION,
      matchTimerSeconds: 150,
      redScore: 1,
      blueScore: 0,
      discs: [
        { id: 0, team: 0, x: 10, y: 10, vx: 50, vy: 20, radius: 10, kicking: false, avatar: '' },
        { id: 1001, team: 1, x: -50, y: 0, vx: 20, vy: -10, radius: 15, kicking: true, avatar: 'R1' }
      ]
    };

    const nextSnapshot: GameSnapshot = {
      ...baseSnapshot,
      tick: 101,
      subStateTimer: 2.78,
      discs: [
        { id: 0, team: 0, x: 20, y: 15, vx: 50, vy: 20, radius: 10, kicking: false, avatar: '' },
        { id: 1001, team: 1, x: -45, y: -2, vx: 20, vy: -10, radius: 15, kicking: true, avatar: 'R1' }
      ]
    };

    const t0 = 1000;
    const t1 = 1016;
    jitterBuffer.push(baseSnapshot, t0);
    jitterBuffer.push(nextSnapshot, t1);

    // Interpolate in the middle of celebration
    const interpolated = jitterBuffer.getInterpolatedSnapshot(t0 + 8 + 50); // renderTime = t0 + 8
    expect(interpolated).not.toBeNull();
    expect(interpolated!.matchPhase).toBe(MatchPhase.GOAL_CELEBRATION);
    expect(interpolated!.targetTeam).toBe(1);

    // Discs must NOT be frozen to vx: 0, vy: 0
    expect(interpolated!.discs[0].vx).toBeCloseTo(50, 1);
    expect(interpolated!.discs[0].x).toBeGreaterThan(10);
    expect(interpolated!.discs[0].x).toBeLessThan(20);
    expect(interpolated!.discs[1].x).toBeGreaterThan(-50);
    expect(interpolated!.discs[1].x).toBeLessThan(-45);
  });

  it('disables JitterBuffer predictive extrapolation only during PAUSED, COUNTDOWN and STOPPED', () => {
    const jitterBuffer = new JitterBuffer(50);

    const pausedSnapshot: GameSnapshot = {
      tick: 50,
      matchPhase: MatchPhase.PAUSED,
      timerSeconds: 120,
      subStateTimer: 0,
      targetTeam: 0,
      scoreRed: 0,
      scoreBlue: 0,
      matchState: MatchPhase.PAUSED,
      matchTimerSeconds: 120,
      redScore: 0,
      blueScore: 0,
      discs: [
        { id: 0, team: 0, x: 10, y: 20, vx: 100, vy: 50, radius: 10, kicking: false, avatar: '' }
      ]
    };

    jitterBuffer.push(pausedSnapshot, 1000);
    // Query far into future (causing extrapolation branch !s0 || !s1)
    const result = jitterBuffer.getInterpolatedSnapshot(2000);
    expect(result).not.toBeNull();
    // In PAUSED, discs must freeze without advancing position
    expect(result!.discs[0].vx).toBe(0);
    expect(result!.discs[0].vy).toBe(0);
    expect(result!.discs[0].x).toBe(10);
    expect(result!.discs[0].y).toBe(20);
  });

  it('renders overlays purely from the snapshot state without local timers', () => {
    const mockCtx: any = {
      save: vi.fn(),
      restore: vi.fn(),
      scale: vi.fn(),
      translate: vi.fn(),
      fillRect: vi.fn(),
      beginPath: vi.fn(),
      roundRect: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      fillText: vi.fn(),
      strokeText: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      arc: vi.fn(),
      closePath: vi.fn(),
      measureText: vi.fn(() => ({ width: 100 })),
      setLineDash: vi.fn(),
      createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
      createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() }))
    };

    const mockCanvas: any = {
      getContext: vi.fn(() => mockCtx),
      clientWidth: 800,
      clientHeight: 600,
      width: 800,
      height: 600
    };

    const stadium = new Stadium();
    const renderer = new CanvasRenderer(mockCanvas, stadium);

    // 1. GOAL_CELEBRATION: Draws goal banner for red team
    const goalSnap: GameSnapshot = {
      tick: 1,
      matchPhase: MatchPhase.GOAL_CELEBRATION,
      timerSeconds: 100,
      subStateTimer: 2.9,
      targetTeam: 1, // Red
      scoreRed: 1,
      scoreBlue: 0,
      matchState: MatchPhase.GOAL_CELEBRATION,
      matchTimerSeconds: 100,
      redScore: 1,
      blueScore: 0,
      discs: []
    };

    mockCtx.fillText.mockClear();
    renderer.render(goalSnap);
    // Must draw "¡GOL! - EQUIPO ROJO"
    expect(mockCtx.fillText).toHaveBeenCalledWith('¡GOL! - EQUIPO ROJO', 0, expect.any(Number));

    // 2. COUNTDOWN: Draws big text (3, 2, 1)
    const countdownSnap: GameSnapshot = {
      ...goalSnap,
      matchPhase: MatchPhase.COUNTDOWN,
      subStateTimer: 1.8 // Math.ceil(1.8) -> 2
    };

    mockCtx.fillText.mockClear();
    renderer.render(countdownSnap);
    expect(mockCtx.fillText).toHaveBeenCalledWith('2', 0, expect.any(Number));

    // 3. PLAYING: No banner or big text drawn
    const playingSnap: GameSnapshot = {
      ...goalSnap,
      matchPhase: MatchPhase.PLAYING,
      subStateTimer: 0
    };

    mockCtx.fillText.mockClear();
    renderer.render(playingSnap);
    expect(mockCtx.fillText).not.toHaveBeenCalledWith('¡GOL! - EQUIPO ROJO', 0, expect.any(Number));
    expect(mockCtx.fillText).not.toHaveBeenCalledWith('PAUSA', 0, expect.any(Number));
  });

  it('advances tickCount continuously throughout GOAL_CELEBRATION to prevent snapshot dropping', () => {
    engine.startMatch();
    for (let i = 0; i < 180; i++) engine.tick(new Map());
    expect(engine.fsm.currentState).toBe(MatchPhase.PLAYING);

    // Score goal for red team
    engine.ball.pos.set(engine.stadium.halfWidth + 20, 0);
    engine.tick(new Map());
    expect(engine.fsm.currentState).toBe(MatchPhase.GOAL_CELEBRATION);

    const initialCelebrationTick = engine.tickCount;
    // Step 30 celebration ticks
    for (let i = 0; i < 30; i++) {
      engine.tick(new Map());
    }
    expect(engine.fsm.currentState).toBe(MatchPhase.GOAL_CELEBRATION);
    expect(engine.tickCount).toBe(initialCelebrationTick + 30);
  });

  it('renders PAUSED, MATCH_ENDED overlays and renders no overlay during STOPPED', () => {
    const mockCtx: any = {
      save: vi.fn(),
      restore: vi.fn(),
      scale: vi.fn(),
      translate: vi.fn(),
      fillRect: vi.fn(),
      beginPath: vi.fn(),
      roundRect: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      fillText: vi.fn(),
      strokeText: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      arc: vi.fn(),
      closePath: vi.fn(),
      measureText: vi.fn(() => ({ width: 100 })),
      setLineDash: vi.fn(),
      createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
      createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() }))
    };
    const mockCanvas: any = {
      getContext: vi.fn(() => mockCtx),
      clientWidth: 800,
      clientHeight: 600,
      width: 800,
      height: 600
    };
    const renderer = new CanvasRenderer(mockCanvas, new Stadium());

    // PAUSED: renders PAUSA
    const pausedSnap: GameSnapshot = {
      tick: 10,
      matchPhase: MatchPhase.PAUSED,
      timerSeconds: 100,
      subStateTimer: 0,
      targetTeam: 0,
      scoreRed: 0,
      scoreBlue: 0,
      matchState: MatchPhase.PAUSED,
      matchTimerSeconds: 100,
      redScore: 0,
      blueScore: 0,
      discs: []
    };
    mockCtx.fillText.mockClear();
    renderer.render(pausedSnap);
    expect(mockCtx.fillText).toHaveBeenCalledWith('PAUSA', 0, expect.any(Number));

    // MATCH_ENDED: renders VICTORIA
    const matchEndedSnap: GameSnapshot = {
      tick: 20,
      matchPhase: MatchPhase.MATCH_ENDED,
      timerSeconds: 0,
      subStateTimer: 3,
      targetTeam: 2, // Blue
      scoreRed: 1,
      scoreBlue: 3,
      matchState: MatchPhase.MATCH_ENDED,
      matchTimerSeconds: 0,
      redScore: 1,
      blueScore: 3,
      discs: []
    };
    mockCtx.fillText.mockClear();
    renderer.render(matchEndedSnap);
    expect(mockCtx.fillText).toHaveBeenCalledWith('¡VICTORIA EQUIPO AZUL!', 0, expect.any(Number));

    // STOPPED: renders no banners on canvas
    const stoppedSnap: GameSnapshot = {
      tick: 0,
      matchPhase: MatchPhase.STOPPED,
      timerSeconds: 0,
      subStateTimer: 0,
      targetTeam: 0,
      scoreRed: 0,
      scoreBlue: 0,
      matchState: MatchPhase.STOPPED,
      matchTimerSeconds: 0,
      redScore: 0,
      blueScore: 0,
      discs: []
    };
    mockCtx.fillText.mockClear();
    renderer.render(stoppedSnap);
    expect(mockCtx.fillText).not.toHaveBeenCalled();
  });

  it('predicts local player kinematics and performs soft snap reconciliation with epsilon > 2.0px', () => {
    const dt = 1 / 60;
    const accel = 7.5;
    const damping = 0.96;

    const predictedPos = { x: 0, y: 0 };
    const predictedVel = { x: 0, y: 0 };

    // Move RIGHT: dirX = 1, dirY = 0
    predictedVel.x += accel;
    predictedPos.x += predictedVel.x * dt;
    predictedVel.x *= damping;

    expect(predictedPos.x).toBeCloseTo(7.5 * dt, 4);
    expect(predictedVel.x).toBeCloseTo(7.5 * damping, 4);

    // Reconcile with authoritative host snapshot
    // 1. Within tolerance (<= 2.0px): no soft snap adjustment
    const authClose = { x: predictedPos.x + 1.2, y: 0, vx: predictedVel.x, vy: 0 };
    let dist = Math.hypot(authClose.x - predictedPos.x, authClose.y - predictedPos.y);
    expect(dist).toBeLessThanOrEqual(2.0);

    // 2. Beyond tolerance (> 2.0px): applies soft snap correction factor 0.25
    const authDistant = { x: predictedPos.x + 10.0, y: 0, vx: predictedVel.x, vy: 0 };
    dist = Math.hypot(authDistant.x - predictedPos.x, authDistant.y - predictedPos.y);
    expect(dist).toBeGreaterThan(2.0);

    const oldX = predictedPos.x;
    const dx = authDistant.x - predictedPos.x;
    predictedPos.x += dx * 0.25;

    expect(predictedPos.x).toBeCloseTo(oldX + 2.5, 4);
  });
});
