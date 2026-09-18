import { describe, it, expect } from 'vitest';
import { GameEngine } from '../../src/core/game/GameEngine';
import { MatchState, MatchPhase } from '../../src/core/game/GameFSM';
import { Player } from '../../src/core/game/Player';

describe('Golden Goal (Sudden Death) Overtime Mechanics', () => {
  it('activates Golden Goal on time expiration when scores are tied', () => {
    // 1-minute match (60s)
    const engine = new GameEngine({ scoreLimit: 5, timeLimitSeconds: 60 });
    const p1 = new Player({ id: 'p1', name: 'Red1', team: 'red' });
    const p2 = new Player({ id: 'p2', name: 'Blue1', team: 'blue' });
    engine.addPlayer(p1);
    engine.addPlayer(p2);

    engine.startMatch();
    // Advance countdown to PLAYING
    for (let i = 0; i < 180; i++) {
      engine.tick(new Map());
    }
    expect(engine.fsm.currentState).toBe(MatchPhase.PLAYING);
    expect(engine.isGoldenGoal).toBe(false);

    // Fast-forward match timer to 1 second remaining
    engine.matchTimerSeconds = 1;
    expect(engine.redScore).toBe(0);
    expect(engine.blueScore).toBe(0);

    // Advance 60 ticks to tick down from 1 to 0
    for (let i = 0; i < 60; i++) {
      engine.tick(new Map());
    }

    // Since score is 0-0 (tied), Golden Goal must be activated!
    expect(engine.isGoldenGoal).toBe(true);
    // Simulation must continue in PLAYING, NOT MATCH_ENDED
    expect(engine.fsm.currentState).toBe(MatchPhase.PLAYING);
    // Overtime timer reset to 0 to track extra time
    expect(engine.matchTimerSeconds).toBe(0);

    // Verify snapshot reflects golden goal
    const snap = engine.getSnapshot();
    expect(snap.isGoldenGoal).toBe(true);
  });

  it('increments overtime timer continuously during Golden Goal', () => {
    const engine = new GameEngine({ scoreLimit: 5, timeLimitSeconds: 60 });
    engine.startMatch();
    for (let i = 0; i < 180; i++) engine.tick(new Map());

    engine.matchTimerSeconds = 1;
    for (let i = 0; i < 60; i++) engine.tick(new Map());

    expect(engine.isGoldenGoal).toBe(true);
    expect(engine.matchTimerSeconds).toBe(0);

    // Run for 3 simulated seconds in overtime (180 ticks)
    for (let i = 0; i < 180; i++) {
      engine.tick(new Map());
    }

    expect(engine.matchTimerSeconds).toBe(3);
    expect(engine.isGoldenGoal).toBe(true);
    expect(engine.fsm.currentState).toBe(MatchPhase.PLAYING);
  });

  it('ends match immediately upon first goal scored during Golden Goal (Sudden Death)', () => {
    const engine = new GameEngine({ scoreLimit: 5, timeLimitSeconds: 60 });
    const p1 = new Player({ id: 'p1', name: 'Red1', team: 'red' });
    const p2 = new Player({ id: 'p2', name: 'Blue1', team: 'blue' });
    engine.addPlayer(p1);
    engine.addPlayer(p2);

    let matchEndWinner: 'red' | 'blue' | null | undefined = undefined;
    engine.onMatchEnd = (winner) => {
      matchEndWinner = winner;
    };

    engine.startMatch();
    for (let i = 0; i < 180; i++) engine.tick(new Map());

    // Trigger Golden Goal
    engine.matchTimerSeconds = 1;
    for (let i = 0; i < 60; i++) engine.tick(new Map());
    expect(engine.isGoldenGoal).toBe(true);

    // Blue scores into red goal (x < -halfWidth)
    engine.ball.pos.set(-engine.stadium.halfWidth - 20, 0);
    engine.tick(new Map());

    expect(engine.blueScore).toBe(1);
    // Instant conclusion: directly to MATCH_ENDED, skipping regular celebration reset
    expect(engine.fsm.currentState).toBe(MatchPhase.MATCH_ENDED);
    expect(engine.fsm.winningTeam).toBe('blue');

    // Advance 180 ticks of MATCH_ENDED victory banner
    for (let i = 0; i < 180; i++) {
      engine.tick(new Map());
    }

    expect(engine.fsm.currentState).toBe(MatchPhase.STOPPED);
    expect(matchEndWinner).toBe('blue');
  });

  it('declares winner normally at time expiration if scores are not tied (no Golden Goal)', () => {
    const engine = new GameEngine({ scoreLimit: 5, timeLimitSeconds: 60 });
    engine.startMatch();
    for (let i = 0; i < 180; i++) engine.tick(new Map());

    // Red leads 1 - 0
    engine.redScore = 1;
    engine.blueScore = 0;
    engine.matchTimerSeconds = 1;

    for (let i = 0; i < 60; i++) engine.tick(new Map());

    // Match ended with Red winner
    expect(engine.isGoldenGoal).toBe(false);
    expect(engine.fsm.currentState).toBe(MatchPhase.MATCH_ENDED);
    expect(engine.fsm.winningTeam).toBe('red');
  });

  it('resets isGoldenGoal to false when startMatch() or stopMatch() is called', () => {
    const engine = new GameEngine({ scoreLimit: 3, timeLimitSeconds: 60 });
    engine.isGoldenGoal = true;

    engine.stopMatch();
    expect(engine.isGoldenGoal).toBe(false);

    engine.isGoldenGoal = true;
    engine.startMatch();
    expect(engine.isGoldenGoal).toBe(false);
  });
});
