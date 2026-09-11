export enum MatchState {
  WAITING = 0,
  COUNTDOWN = 1,
  PLAYING = 2,
  GOAL_SCORED = 3,
  GAME_OVER = 4
}

export interface FSMConfig {
  countdownDurationTicks?: number; // default 180 (3s at 60Hz)
  goalCelebrationTicks?: number;   // default 120 (2s at 60Hz)
}

export class GameFSM {
  public currentState: MatchState = MatchState.WAITING;
  public stateTicksRemaining: number = 0;
  public countdownDurationTicks: number;
  public goalCelebrationTicks: number;
  public winningTeam: 'red' | 'blue' | null = null;

  constructor(config: FSMConfig = {}) {
    this.countdownDurationTicks = config.countdownDurationTicks ?? 180;
    this.goalCelebrationTicks = config.goalCelebrationTicks ?? 120;
  }

  public startMatch(): void {
    this.currentState = MatchState.COUNTDOWN;
    this.stateTicksRemaining = this.countdownDurationTicks;
    this.winningTeam = null;
  }

  public scoreGoal(_scoringTeam: 'red' | 'blue'): void {
    this.currentState = MatchState.GOAL_SCORED;
    this.stateTicksRemaining = this.goalCelebrationTicks;
  }

  public endMatch(winner: 'red' | 'blue' | null): void {
    this.currentState = MatchState.GAME_OVER;
    this.winningTeam = winner;
    this.stateTicksRemaining = 0;
  }

  public resetToWaiting(): void {
    this.currentState = MatchState.WAITING;
    this.stateTicksRemaining = 0;
    this.winningTeam = null;
  }

  /**
   * Advances the state machine timer by 1 tick (1/60s).
   * Returns true if a state transition occurred.
   */
  public tick(): boolean {
    if (this.stateTicksRemaining > 0) {
      this.stateTicksRemaining--;
      if (this.stateTicksRemaining === 0) {
        if (this.currentState === MatchState.COUNTDOWN) {
          this.currentState = MatchState.PLAYING;
          return true;
        } else if (this.currentState === MatchState.GOAL_SCORED) {
          this.currentState = MatchState.COUNTDOWN;
          this.stateTicksRemaining = this.countdownDurationTicks;
          return true;
        }
      }
    }
    return false;
  }
}
