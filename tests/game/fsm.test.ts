import { describe, it, expect } from 'vitest';
import { GameEngine } from '../../src/core/game/GameEngine';
import { Player } from '../../src/core/game/Player';
import { MatchState } from '../../src/core/game/GameFSM';

describe('Match Finite State Machine (GameFSM)', () => {
  it('manages match lifecycle, countdowns, goal scoring and conclusion', () => {
    const engine = new GameEngine({ scoreLimit: 1 });
    const p1 = new Player({ id: 'p1', name: 'Alice', team: 'red' });
    const p2 = new Player({ id: 'p2', name: 'Bob', team: 'blue' });
    engine.addPlayer(p1);
    engine.addPlayer(p2);

    expect(engine.fsm.currentState).toBe(MatchState.WAITING);

    // Start match
    engine.startMatch();
    expect(engine.fsm.currentState).toBe(MatchState.COUNTDOWN);

    // Advance countdown duration (180 ticks)
    const inputs = new Map<string, number>();
    for (let i = 0; i < 180; i++) {
      engine.tick(inputs);
    }
    expect(engine.fsm.currentState).toBe(MatchState.PLAYING);

    // Ball moves into blue goal (right goal at x > 370)
    engine.ball.pos.set(375, 0);
    engine.tick(inputs);

    // Red scored! With scoreLimit = 1, match should reach GAME_OVER
    expect(engine.redScore).toBe(1);
    expect(engine.fsm.currentState).toBe(MatchState.GAME_OVER);
    expect(engine.fsm.winningTeam).toBe('red');
  });
});
