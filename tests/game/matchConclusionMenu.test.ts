import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GameEngine } from '../../src/core/game/GameEngine';
import { MatchState, MatchPhase } from '../../src/core/game/GameFSM';
import { TeamSelectModal } from '../../src/ui/components/TeamSelectModal';
import { Player } from '../../src/core/game/Player';
import { JitterBuffer } from '../../src/net/transport/JitterBuffer';

describe('Match Conclusion Flow and Menu Synchronization', () => {
  describe('GameEngine state propagation on match end', () => {
    it('fires onStateChange with STOPPED when endMatch is called', () => {
      const engine = new GameEngine({ scoreLimit: 3, timeLimitSeconds: 60 });
      const stateChanges: MatchState[] = [];

      engine.onStateChange = (state) => {
        stateChanges.push(state);
      };

      engine.startMatch(); // Moves from STOPPED to COUNTDOWN
      expect(stateChanges).toContain(MatchState.COUNTDOWN);

      // Force game over via FSM endMatch
      engine.fsm.endMatch('red');

      expect(stateChanges).toContain(MatchState.STOPPED);
      expect(engine.fsm.currentState).toBe(MatchState.STOPPED);
    });

    it('triggers match conclusion when score limit is reached', () => {
      const engine = new GameEngine({ scoreLimit: 1, timeLimitSeconds: 60 });
      let winnerResult: 'red' | 'blue' | null = null;
      let finalState: MatchState | null = null;

      engine.onMatchEnd = (winner) => {
        winnerResult = winner;
      };
      engine.onStateChange = (state) => {
        finalState = state;
      };

      // Set score and start
      engine.startMatch();
      engine.fsm.currentState = MatchState.PLAYING;

      // Simulate a goal by red team
      (engine as any).redScore = 1;
      (engine as any).checkMatchConclusion();

      expect(engine.fsm.currentState).toBe(MatchState.MATCH_ENDED);
      expect(finalState).toBe(MatchState.MATCH_ENDED);
      expect(winnerResult).toBeNull();

      // Advance 180 ticks (3.0 seconds at 60 Hz)
      for (let i = 0; i < 180; i++) {
        engine.tick(new Map());
      }

      expect(winnerResult).toBe('red');
      expect(finalState).toBe(MatchState.STOPPED);
      expect(engine.fsm.currentState).toBe(MatchState.STOPPED);
    });
  });

  describe('TeamSelectModal outcome banner and mandatory display on match conclusion', () => {
    let ingameMenuEl: any;
    let outcomeBannerEl: any;
    let returnGameBtnEl: any;
    let classSet: Set<string>;

    beforeEach(() => {
      classSet = new Set<string>(['hidden']);
      ingameMenuEl = {
        classList: {
          add: vi.fn((...cls: string[]) => cls.forEach(c => classSet.add(c))),
          remove: vi.fn((...cls: string[]) => cls.forEach(c => classSet.delete(c))),
          contains: vi.fn((cls: string) => classSet.has(cls))
        },
        style: {
          display: 'none',
          pointerEvents: 'none'
        }
      };

      outcomeBannerEl = {
        style: { display: 'none' },
        textContent: ''
      };

      returnGameBtnEl = {
        style: { display: 'none' },
        addEventListener: vi.fn()
      };

      const closeBtnEl = {
        style: { display: '' },
        addEventListener: vi.fn()
      };

      (globalThis as any).document = {
        getElementById: (id: string) => {
          if (id === 'ingame-menu') return ingameMenuEl;
          if (id === 'match-outcome-banner') return outcomeBannerEl;
          if (id === 'btn-return-game') return returnGameBtnEl;
          if (id === 'menu-close-btn') return closeBtnEl;
          return null;
        },
        querySelectorAll: () => [],
        querySelector: () => null,
        createElement: () => ({ className: '', appendChild: vi.fn(), setAttribute: vi.fn(), addEventListener: vi.fn() })
      };
    });

    it('displays outcome banner and forces menu open on STOPPED state with winner', () => {
      const modal = new TeamSelectModal();

      modal.updateMatchState(MatchState.STOPPED, '¡Victoria del Equipo Rojo!');

      expect(ingameMenuEl.classList.remove).toHaveBeenCalledWith('hidden', 'u-hidden', 'ui-screen-hidden');
      expect(ingameMenuEl.classList.add).toHaveBeenCalledWith('is-forced-open');
      expect(ingameMenuEl.style.display).toBe('flex');
      expect(outcomeBannerEl.style.display).toBe('block');
      expect(outcomeBannerEl.textContent).toBe('¡Victoria del Equipo Rojo!');

      // Escape or regular close is blocked during STOPPED
      modal.close(false);
      expect(ingameMenuEl.style.display).toBe('flex');
    });

    it('hides outcome banner and auto-closes menu when transitioning to PLAYING or COUNTDOWN', () => {
      const modal = new TeamSelectModal();

      // First stop with outcome
      modal.updateMatchState(MatchState.STOPPED, '¡Empate!');
      expect(outcomeBannerEl.style.display).toBe('block');

      // Then transition to COUNTDOWN
      modal.updateMatchState(MatchState.COUNTDOWN);
      expect(outcomeBannerEl.style.display).toBe('none');
      expect(ingameMenuEl.style.display).toBe('none');
    });

    it('hides closeBtn and returnGameBtn when state is STOPPED', () => {
      const modal = new TeamSelectModal();
      const closeBtn = (globalThis as any).document.getElementById('menu-close-btn');
      const returnBtn = (globalThis as any).document.getElementById('btn-return-game');

      modal.updateMatchState(MatchPhase.STOPPED);
      expect(closeBtn.style.display).toBe('none');
      expect(returnBtn.style.display).toBe('none');

      modal.updateMatchState(MatchPhase.PLAYING);
      expect(closeBtn.style.display).toBe('');
      expect(returnBtn.style.display).toBe('inline-block');
    });
  });

  describe('Immediate Physical Hard-Reset on stopMatch', () => {
    it('resets ball to (0,0) with zero velocity, zeroes player velocities and kicking, and resets scores/timer', () => {
      const engine = new GameEngine({ scoreLimit: 3, timeLimitSeconds: 180 });
      const p1 = new Player({ id: 'p1', name: 'Player 1', team: 'red' });
      const p2 = new Player({ id: 'p2', name: 'Player 2', team: 'blue' });
      engine.addPlayer(p1);
      engine.addPlayer(p2);

      engine.startMatch();
      for (let i = 0; i < 180; i++) engine.tick(new Map());
      expect(engine.fsm.currentState).toBe(MatchPhase.PLAYING);

      // Mutate ball, players, scores and timer
      engine.ball.pos.set(250, -80);
      engine.ball.vel.set(12.5, -4.2);
      engine.ball.prevPos.set(237.5, -75.8);
      engine.redScore = 2;
      engine.blueScore = 1;
      engine.matchTimerSeconds = 120;

      const d1 = engine.playerDiscs.get('p1')!;
      d1.pos.set(100, 50);
      d1.vel.set(5, 3);
      d1.kicking = true;
      p1.inputMask = 15;

      const initialTick = engine.tickCount;

      // Call stopMatch
      engine.stopMatch();

      expect(engine.fsm.currentState).toBe(MatchPhase.STOPPED);
      expect(engine.redScore).toBe(0);
      expect(engine.blueScore).toBe(0);
      expect(engine.matchTimerSeconds).toBe(0);
      expect(engine.soundMask).toBe(0);
      expect(engine.tickCount).toBe(initialTick + 1);

      // Ball hard-reset
      expect(engine.ball.pos.x).toBe(0);
      expect(engine.ball.pos.y).toBe(0);
      expect(engine.ball.vel.x).toBe(0);
      expect(engine.ball.vel.y).toBe(0);
      expect(engine.ball.prevPos.x).toBe(0);
      expect(engine.ball.prevPos.y).toBe(0);

      // Player hard-reset
      expect(p1.inputMask).toBe(0);
      expect(d1.vel.x).toBe(0);
      expect(d1.vel.y).toBe(0);
      expect(d1.kicking).toBe(false);
      expect(d1.pos.x).toBe(-180); // Red kickoff spawn line
    });
  });

  describe('JitterBuffer immediate purge on STOPPED', () => {
    it('purges previous dynamic simulation snapshots when STOPPED snapshot arrives', () => {
      const buffer = new JitterBuffer(70, 30);

      // Push playing snapshots
      buffer.push({
        tick: 100,
        matchPhase: MatchPhase.PLAYING,
        matchState: MatchPhase.PLAYING,
        timerSeconds: 100,
        matchTimerSeconds: 100,
        subStateTimer: 0,
        targetTeam: 0,
        scoreRed: 1,
        redScore: 1,
        scoreBlue: 0,
        blueScore: 0,
        discs: [{ id: 0, team: 0, x: 200, y: 100, vx: 5, vy: 2, radius: 10, kicking: false, avatar: '' }]
      }, 1000);

      buffer.push({
        tick: 101,
        matchPhase: MatchPhase.PLAYING,
        matchState: MatchPhase.PLAYING,
        timerSeconds: 100,
        matchTimerSeconds: 100,
        subStateTimer: 0,
        targetTeam: 0,
        scoreRed: 1,
        redScore: 1,
        scoreBlue: 0,
        blueScore: 0,
        discs: [{ id: 0, team: 0, x: 205, y: 102, vx: 5, vy: 2, radius: 10, kicking: false, avatar: '' }]
      }, 1016);

      expect(buffer.buffer.length).toBe(2);

      // Push STOPPED snapshot
      buffer.push({
        tick: 102,
        matchPhase: MatchPhase.STOPPED,
        matchState: MatchPhase.STOPPED,
        timerSeconds: 0,
        matchTimerSeconds: 0,
        subStateTimer: 0,
        targetTeam: 0,
        scoreRed: 0,
        redScore: 0,
        scoreBlue: 0,
        blueScore: 0,
        discs: [{ id: 0, team: 0, x: 0, y: 0, vx: 0, vy: 0, radius: 10, kicking: false, avatar: '' }]
      }, 1032);

      // Previous snapshots must be purged! Only the clean STOPPED snapshot remains
      expect(buffer.buffer.length).toBe(1);
      const snap = buffer.getInterpolatedSnapshot(1032);
      expect(snap).not.toBeNull();
      expect(snap!.matchPhase).toBe(MatchPhase.STOPPED);
      expect(snap!.discs[0].x).toBe(0);
      expect(snap!.discs[0].y).toBe(0);
    });
  });
});
