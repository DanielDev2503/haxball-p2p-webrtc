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

  it('manages 300-tick victory celebration: active physics, movement and score lock before transitioning to STOPPED', () => {
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
    expect(engine.fsm.currentState).toBe(MatchState.VICTORY_CELEBRATION);
    expect(engine.fsm.isVictoryCelebration()).toBe(true);
    expect(matchEndedWinner).toBeUndefined(); // onMatchEnd is NOT called yet!

    // During 300 ticks of VICTORY_CELEBRATION:
    // 1. Players retain 100% motor control and movement
    const moveInputs = new Map<string, number>();
    moveInputs.set('p1', 1); // UP key mask
    const prevY = engine.playerDiscs.get('p1')!.pos.y;
    engine.tick(moveInputs);
    const newY = engine.playerDiscs.get('p1')!.pos.y;
    expect(newY).not.toBe(prevY); // Player moved during victory celebration!

    // 2. Score Lock: ball pushed into goal does NOT increase score or emit new goal events
    let extraGoalFired = false;
    engine.onGoal = () => { extraGoalFired = true; };
    engine.ball.pos.set(engine.stadium.halfWidth + 30, 0);
    engine.tick(emptyInputs);
    expect(engine.redScore).toBe(1); // Score locked!
    expect(extraGoalFired).toBe(false);

    // Advance 296 remaining ticks (we ticked 3 above [tick 1 on goal, tick 2 on move, tick 3 on score lock], so 296 + 3 = 299 ticks in victory celebration)
    for (let i = 0; i < 296; i++) {
      const kickInput = new Map<string, number>();
      kickInput.set('p1', 16); // Kick mask = 16
      engine.tick(kickInput);
      expect(engine.fsm.currentState).toBe(MatchState.VICTORY_CELEBRATION);
      expect(matchEndedWinner).toBeUndefined();
    }

    // 300th tick transitions cleanly to STOPPED and invokes onMatchEnd
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
