export enum MatchPhase {
  STOPPED = 0,
  PLAYING = 1,
  PAUSED = 2,
  COUNTDOWN = 3,
  GOAL_CELEBRATION = 4,
  MATCH_ENDED = 5
}

export type MatchState = MatchPhase;
export const MatchState = MatchPhase;

export function toMatchPhase(val: MatchPhase | string | number): MatchPhase {
  if (typeof val === 'number') {
    return val in MatchPhase ? (val as MatchPhase) : MatchPhase.STOPPED;
  }
  switch (val) {
    case 'PLAYING': return MatchPhase.PLAYING;
    case 'PAUSED': return MatchPhase.PAUSED;
    case 'COUNTDOWN': return MatchPhase.COUNTDOWN;
    case 'GOAL_CELEBRATION': return MatchPhase.GOAL_CELEBRATION;
    case 'MATCH_ENDED': return MatchPhase.MATCH_ENDED;
    case 'STOPPED':
    default:
      return MatchPhase.STOPPED;
  }
}

export interface FSMConfig {
  countdownDurationTicks?: number; // default 180 (3s at 60Hz)
}

export class GameFSM {
  public currentState: MatchPhase = MatchPhase.STOPPED;
  public countdownSeconds: number = 3;
  public stateTicksRemaining: number = 0;
  public countdownDurationTicks: number;
  public winningTeam: 'red' | 'blue' | null = null;

  public onStateChange?: (newState: MatchPhase) => void;

  constructor(config: FSMConfig = {}) {
    this.countdownDurationTicks = config.countdownDurationTicks ?? 180;
  }

  public get state(): MatchPhase {
    return this.currentState;
  }

  public set state(val: MatchPhase) {
    this.currentState = val;
  }

  public startMatch(): void {
    this.startResumeCountdown();
    this.winningTeam = null;
  }

  public stopMatch(): void {
    this.currentState = MatchPhase.STOPPED;
    this.stateTicksRemaining = 0;
    this.countdownSeconds = 0;
    this.winningTeam = null;
    if (this.onStateChange) this.onStateChange(this.currentState);
  }

  public pauseMatch(): void {
    if (this.currentState === MatchPhase.PLAYING) {
      this.currentState = MatchPhase.PAUSED;
      this.stateTicksRemaining = 0;
      if (this.onStateChange) this.onStateChange(this.currentState);
    }
  }

  public resumeMatch(): void {
    if (this.currentState === MatchPhase.PAUSED || this.currentState === MatchPhase.STOPPED) {
      this.startResumeCountdown();
    }
  }

  public togglePause(): void {
    if (this.currentState === MatchPhase.PLAYING) {
      this.pauseMatch();
    } else if (this.currentState === MatchPhase.PAUSED) {
      this.resumeMatch();
    }
  }

  public startResumeCountdown(): void {
    this.currentState = MatchPhase.COUNTDOWN;
    this.stateTicksRemaining = this.countdownDurationTicks;
    this.countdownSeconds = Math.ceil(this.stateTicksRemaining / 60);
    if (this.onStateChange) this.onStateChange(this.currentState);
  }

  public startGoalCelebration(durationTicks: number = 180): void {
    this.currentState = MatchPhase.GOAL_CELEBRATION;
    this.stateTicksRemaining = durationTicks;
    if (this.onStateChange) this.onStateChange(this.currentState);
  }

  public startMatchEnded(winner: 'red' | 'blue' | null, durationTicks: number = 180): void {
    this.currentState = MatchPhase.MATCH_ENDED;
    this.winningTeam = winner;
    this.stateTicksRemaining = durationTicks;
    if (this.onStateChange) this.onStateChange(this.currentState);
  }

  public endMatch(winner: 'red' | 'blue' | null): void {
    this.currentState = MatchPhase.STOPPED;
    this.winningTeam = winner;
    this.stateTicksRemaining = 0;
    this.countdownSeconds = 0;
    if (this.onStateChange) this.onStateChange(this.currentState);
  }

  public resetToWaiting(): void {
    this.stopMatch();
  }

  /**
   * Advances the state machine timer by 1 tick (1/60s).
   * Returns true if a state transition occurred.
   */
  public tick(): boolean {
    if (this.currentState === MatchPhase.COUNTDOWN && this.stateTicksRemaining > 0) {
      this.stateTicksRemaining--;
      this.countdownSeconds = Math.max(1, Math.ceil(this.stateTicksRemaining / 60));

      if (this.stateTicksRemaining === 0) {
        this.currentState = MatchPhase.PLAYING;
        this.countdownSeconds = 0;
        if (this.onStateChange) this.onStateChange(this.currentState);
        return true;
      }
    } else if (this.currentState === MatchPhase.GOAL_CELEBRATION && this.stateTicksRemaining > 0) {
      this.stateTicksRemaining--;
      if (this.stateTicksRemaining === 0) {
        this.startResumeCountdown();
        return true;
      }
    } else if (this.currentState === MatchPhase.MATCH_ENDED && this.stateTicksRemaining > 0) {
      this.stateTicksRemaining--;
      if (this.stateTicksRemaining === 0) {
        this.endMatch(this.winningTeam);
        return true;
      }
    }
    return false;
  }
}

export const MatchManager = GameFSM;
export type MatchManager = GameFSM;

