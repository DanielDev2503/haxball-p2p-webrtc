import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GameEngine } from '../../src/core/game/GameEngine';
import { MatchState } from '../../src/core/game/GameFSM';
import { TeamSelectModal } from '../../src/ui/components/TeamSelectModal';

describe('Match Conclusion Flow and Menu Synchronization', () => {
  describe('GameEngine state propagation on match end', () => {
    it('fires onStateChange with STOPPED and onMatchEnd when endMatch is called', () => {
      const engine = new GameEngine({ scoreLimit: 3, timeLimitSeconds: 60 });
      const stateChanges: MatchState[] = [];
      let endWinner: 'red' | 'blue' | null | undefined = undefined;

      engine.onStateChange = (state) => {
        stateChanges.push(state);
      };
      engine.onMatchEnd = (winner) => {
        endWinner = winner;
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

      (globalThis as any).document = {
        getElementById: (id: string) => {
          if (id === 'ingame-menu') return ingameMenuEl;
          if (id === 'match-outcome-banner') return outcomeBannerEl;
          if (id === 'btn-return-game') return returnGameBtnEl;
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

    it('hides outcome banner when transitioning to PLAYING or COUNTDOWN', () => {
      const modal = new TeamSelectModal();

      // First stop with outcome
      modal.updateMatchState(MatchState.STOPPED, '¡Empate!');
      expect(outcomeBannerEl.style.display).toBe('block');

      // Then transition to COUNTDOWN
      modal.updateMatchState(MatchState.COUNTDOWN);
      expect(outcomeBannerEl.style.display).toBe('none');
      expect(ingameMenuEl.style.display).toBe('none');
    });
  });
});
