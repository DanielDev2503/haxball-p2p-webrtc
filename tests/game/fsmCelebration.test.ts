import { describe, it, expect } from 'vitest';
import { GameEngine } from '../../src/core/game/GameEngine';
import { MatchState } from '../../src/core/game/GameFSM';
import { Player } from '../../src/core/game/Player';
import { RoomSettingsRequestMessage, RoomSettingsSyncMessage } from '../../src/net/protocol/ControlMessages';

describe('Goal Celebration and Match Ended Lifecycle (FSM & Engine)', () => {
  it('manages 180-tick active goal celebration: physics steps, goals suppressed, resets to countdown', () => {
    const engine = new GameEngine({ scoreLimit: 3, timeLimitSeconds: 180 });
    const p1 = new Player({ id: 'p1', name: 'PlayerRed', team: 'red' });
    const p2 = new Player({ id: 'p2', name: 'PlayerBlue', team: 'blue' });
    engine.addPlayer(p1);
    engine.addPlayer(p2);

    engine.startMatch();
    // Advance countdown (180 ticks) to PLAYING
    const emptyInputs = new Map<string, number>();
    for (let i = 0; i < 180; i++) {
      engine.tick(emptyInputs);
    }
    expect(engine.fsm.currentState).toBe(MatchState.PLAYING);

    // Place ball inside blue goal to trigger red goal
    engine.ball.pos.set(engine.stadium.halfWidth + 20, 0);
    engine.ball.vel.set(50, 10);

    let goalEventFired = false;
    engine.onGoal = () => {
      goalEventFired = true;
    };

    // Next tick will trigger goal check
    engine.tick(emptyInputs);

    expect(goalEventFired).toBe(true);
    expect(engine.redScore).toBe(1);
    expect(engine.fsm.currentState).toBe(MatchState.GOAL_CELEBRATION);

    // During celebration, physics must remain active:
    // Apply input to p1 and verify disc updates position
    const moveInputs = new Map<string, number>();
    moveInputs.set('p1', 1); // UP key mask (UP = 1)
    const prevDiscY = engine.playerDiscs.get('p1')!.pos.y;

    engine.tick(moveInputs);
    const newDiscY = engine.playerDiscs.get('p1')!.pos.y;
    expect(newDiscY).not.toBe(prevDiscY); // Player moved during celebration!

    // Goal detection must be suppressed: score shouldn't increase even if ball is in goal
    engine.ball.pos.set(engine.stadium.halfWidth + 30, 0);
    engine.tick(emptyInputs);
    expect(engine.redScore).toBe(1); // Still 1!

    // Advance remainder of the 180 ticks (we already ticked 2 above, so 178 left)
    for (let i = 0; i < 178; i++) {
      engine.tick(emptyInputs);
    }

    // After 180 celebration ticks, positions reset and FSM transitions to COUNTDOWN
    expect(engine.fsm.currentState).toBe(MatchState.COUNTDOWN);
    expect(engine.ball.pos.x).toBe(0);
    expect(engine.ball.pos.y).toBe(0);
    expect(engine.ball.vel.x).toBe(0);
    expect(engine.ball.vel.y).toBe(0);

    // Countdown lasts 180 ticks -> back to PLAYING
    for (let i = 0; i < 180; i++) {
      engine.tick(emptyInputs);
    }
    expect(engine.fsm.currentState).toBe(MatchState.PLAYING);
  });

  it('manages 180-tick match ended victory phase before transitioning to STOPPED', () => {
    const engine = new GameEngine({ scoreLimit: 1, timeLimitSeconds: 180 });
    const p1 = new Player({ id: 'p1', name: 'PlayerRed', team: 'red' });
    engine.addPlayer(p1);

    let matchEndedWinner: 'red' | 'blue' | null | undefined = undefined;
    engine.onMatchEnd = (winner) => {
      matchEndedWinner = winner;
    };

    engine.startMatch();
    const emptyInputs = new Map<string, number>();
    for (let i = 0; i < 180; i++) {
      engine.tick(emptyInputs);
    }
    expect(engine.fsm.currentState).toBe(MatchState.PLAYING);

    // Red scores the game-winning goal (scoreLimit = 1)
    engine.ball.pos.set(engine.stadium.halfWidth + 20, 0);
    engine.tick(emptyInputs);

    expect(engine.redScore).toBe(1);
    expect(engine.fsm.currentState).toBe(MatchState.MATCH_ENDED);
    expect(matchEndedWinner).toBeUndefined(); // onMatchEnd is NOT called yet!

    // Advance 179 ticks of MATCH_ENDED
    for (let i = 0; i < 179; i++) {
      // During MATCH_ENDED, kick input must not apply impulse to the ball
      const kickInput = new Map<string, number>();
      kickInput.set('p1', 16); // Kick mask = 16
      engine.tick(kickInput);
      expect(engine.fsm.currentState).toBe(MatchState.MATCH_ENDED);
    }

    // 180th tick transitions to STOPPED and invokes onMatchEnd
    engine.tick(emptyInputs);
    expect(engine.fsm.currentState).toBe(MatchState.STOPPED);
    expect(matchEndedWinner).toBe('red');
  });

  it('validates protocol control messages for room settings', () => {
    const req: RoomSettingsRequestMessage = {
      type: 'ROOM_SETTINGS_REQUEST',
      timeLimit: 5,
      goalLimit: 3,
      teamsLocked: false,
    };
    expect(req.type).toBe('ROOM_SETTINGS_REQUEST');
    expect(req.timeLimit).toBe(5);
    expect(req.goalLimit).toBe(3);

    const sync: RoomSettingsSyncMessage = {
      type: 'ROOM_SETTINGS_SYNC',
      timeLimit: 5,
      goalLimit: 3,
      teamsLocked: false,
    };
    expect(sync.type).toBe('ROOM_SETTINGS_SYNC');
    expect(sync.teamsLocked).toBe(false);
  });
});
