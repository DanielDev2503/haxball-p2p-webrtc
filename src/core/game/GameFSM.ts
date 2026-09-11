export const MatchState = {
  STOPPED: 'STOPPED',
  PAUSED: 'PAUSED',
  COUNTDOWN: 'COUNTDOWN',
  PLAYING: 'PLAYING',
} as const;

export type MatchState = (typeof MatchState)[keyof typeof MatchState];

export interface FSMConfig {
  countdownDurationTicks?: number; // default 180 (3s at 60Hz)
}

export class GameFSM {
  public currentState: MatchState = 'STOPPED';
  public countdownSeconds: number = 3;
  public stateTicksRemaining: number = 0;
  public countdownDurationTicks: number;
  public winningTeam: 'red' | 'blue' | null = null;

  public onStateChange?: (newState: MatchState) => void;

  constructor(config: FSMConfig = {}) {
    this.countdownDurationTicks = config.countdownDurationTicks ?? 180;
  }

  public get state(): MatchState {
    return this.currentState;
  }

  public set state(val: MatchState) {
    this.currentState = val;
  }

  public startMatch(): void {
    this.startResumeCountdown();
    this.winningTeam = null;
  }

  public stopMatch(): void {
    this.currentState = 'STOPPED';
    this.stateTicksRemaining = 0;
    this.countdownSeconds = 0;
    this.winningTeam = null;
    if (this.onStateChange) this.onStateChange(this.currentState);
  }

  public pauseMatch(): void {
    if (this.currentState === 'PLAYING') {
      this.currentState = 'PAUSED';
      this.stateTicksRemaining = 0;
      if (this.onStateChange) this.onStateChange(this.currentState);
    }
  }

  public resumeMatch(): void {
    if (this.currentState === 'PAUSED' || this.currentState === 'STOPPED') {
      this.startResumeCountdown();
    }
  }

  public togglePause(): void {
    if (this.currentState === 'PLAYING') {
      this.pauseMatch();
    } else if (this.currentState === 'PAUSED') {
      this.resumeMatch();
    }
  }

  public startResumeCountdown(): void {
    this.currentState = 'COUNTDOWN';
    this.stateTicksRemaining = this.countdownDurationTicks;
    this.countdownSeconds = Math.ceil(this.stateTicksRemaining / 60);
    if (this.onStateChange) this.onStateChange(this.currentState);
  }

  public endMatch(winner: 'red' | 'blue' | null): void {
    this.currentState = 'STOPPED';
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
    if (this.currentState === 'COUNTDOWN' && this.stateTicksRemaining > 0) {
      this.stateTicksRemaining--;
      this.countdownSeconds = Math.max(1, Math.ceil(this.stateTicksRemaining / 60));

      if (this.stateTicksRemaining === 0) {
        this.currentState = 'PLAYING';
        this.countdownSeconds = 0;
        if (this.onStateChange) this.onStateChange(this.currentState);
        return true;
      }
    }
    return false;
  }
}

export const MatchManager = GameFSM;
export type MatchManager = GameFSM;

