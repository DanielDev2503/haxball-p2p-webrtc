import { describe, it, expect } from 'vitest';
import { canChangeTeam } from '../../src/client/GameApp';
import { JitterBuffer } from '../../src/net/transport/JitterBuffer';
import { GameEngine } from '../../src/core/game/GameEngine';
import { Player } from '../../src/core/game/Player';
import { GameSnapshot } from '../../src/core/game/GameState';
import { MatchPhase } from '../../src/core/game/GameFSM';

describe('canChangeTeam Authorization Logic', () => {
  it('allows admin to move anyone regardless of teamsLocked', () => {
    // canChangeTeam(senderPeerId, targetPlayerId, teamsLocked, isAdmin)
    expect(canChangeTeam('host_1', 'peer_2', false, true)).toBe(true);
    expect(canChangeTeam('host_1', 'peer_2', true, true)).toBe(true);
    expect(canChangeTeam('host_1', 'host_1', true, true)).toBe(true);
  });

  it('allows non-admin to move self when teams are unlocked', () => {
    expect(canChangeTeam('peer_2', 'peer_2', false, false)).toBe(true);
  });

  it('rejects non-admin moving self when teams are locked', () => {
    expect(canChangeTeam('peer_2', 'peer_2', true, false)).toBe(false);
  });

  it('rejects non-admin moving another player even when teams are unlocked', () => {
    expect(canChangeTeam('peer_2', 'peer_3', false, false)).toBe(false);
  });
});

describe('Match State Sync and Pause Freeze', () => {
  it('freezes velocities in GameEngine.getSnapshot during PAUSED', () => {
    const engine = new GameEngine();
    const p1 = new Player({ id: 'p1', name: 'Alice', team: 'red' });
    engine.addPlayer(p1);

    engine.startMatch();
    // Advance countdown (180 ticks = 3s)
    const inputs = new Map<string, number>();
    for (let i = 0; i < 180; i++) engine.tick(inputs);

    expect(engine.fsm.currentState).toBe(MatchPhase.PLAYING);

    // Give ball and player some velocity
    engine.ball.vel.set(25, -15);
    const disc = engine.playerDiscs.get('p1')!;
    disc.vel.set(-10, 30);

    // Active snapshot has velocities
    const activeSnap = engine.getSnapshot();
    expect(activeSnap.discs[0].vx).toBe(25);
    expect(activeSnap.discs[0].vy).toBe(-15);
    expect(activeSnap.discs[1].vx).toBe(-10);
    expect(activeSnap.discs[1].vy).toBe(30);

    // Now pause match
    engine.togglePause();
    expect(engine.fsm.currentState).toBe(MatchPhase.PAUSED);

    // Snapshot during pause must report vx: 0, vy: 0 to prevent client prediction drift
    const pausedSnap = engine.getSnapshot();
    expect(pausedSnap.discs[0].vx).toBe(0);
    expect(pausedSnap.discs[0].vy).toBe(0);
    expect(pausedSnap.discs[1].vx).toBe(0);
    expect(pausedSnap.discs[1].vy).toBe(0);

    // Internal velocities on the discs are preserved for when the match resumes
    expect(engine.ball.vel.x).toBe(25);
    expect(engine.ball.vel.y).toBe(-15);
    expect(disc.vel.x).toBe(-10);
    expect(disc.vel.y).toBe(30);
  });

  it('stops extrapolation and zeros velocities in JitterBuffer during PAUSED', () => {
    const buffer = new JitterBuffer(100);

    const snap1: GameSnapshot = {
      tick: 1,
      matchPhase: MatchPhase.PLAYING,
      timerSeconds: 180,
      subStateTimer: 0,
      targetTeam: 0,
      scoreRed: 0,
      scoreBlue: 0,
      matchState: MatchPhase.PLAYING,
      matchTimerSeconds: 180,
      redScore: 0,
      blueScore: 0,
      discs: [
        { id: 0, team: 0, x: 0, y: 0, vx: 100, vy: 50, radius: 10, kicking: false, avatar: '' }
      ]
    };

    const snap2: GameSnapshot = {
      tick: 2,
      matchPhase: MatchPhase.PLAYING,
      timerSeconds: 180,
      subStateTimer: 0,
      targetTeam: 0,
      scoreRed: 0,
      scoreBlue: 0,
      matchState: MatchPhase.PLAYING,
      matchTimerSeconds: 180,
      redScore: 0,
      blueScore: 0,
      discs: [
        { id: 0, team: 0, x: 10, y: 5, vx: 100, vy: 50, radius: 10, kicking: false, avatar: '' }
      ]
    };

    buffer.push(snap1);
    buffer.push(snap2);

    // In normal state, interpolation / extrapolation runs
    const interpNormal = buffer.getInterpolatedSnapshot(Date.now() + 500);
    expect(interpNormal).not.toBeNull();

    // Now set match state to PAUSED
    buffer.setMatchState('PAUSED');
    expect(buffer.currentMatchState).toBe('PAUSED');

    const interpPaused = buffer.getInterpolatedSnapshot(Date.now() + 500);
    expect(interpPaused).not.toBeNull();
    // Velocities must be forced to 0
    expect(interpPaused!.discs[0].vx).toBe(0);
    expect(interpPaused!.discs[0].vy).toBe(0);
    // Extrapolation must not shoot forward: x and y match the last known snapshot
    expect(interpPaused!.discs[0].x).toBe(10);
    expect(interpPaused!.discs[0].y).toBe(5);
  });
});
