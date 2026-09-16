import { MatchPhase, MatchState } from './GameFSM';

export interface DiscSnapshot {
  id: number;
  team: 0 | 1 | 2; // 0: Ball, 1: Red, 2: Blue
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  kicking: boolean;
  avatar: string;
}

export interface GameSnapshot {
  tick: number;
  matchPhase: MatchPhase;
  timerSeconds: number;
  subStateTimer: number;
  targetTeam: number; // 0: none, 1: red, 2: blue
  scoreRed: number;
  scoreBlue: number;
  discs: DiscSnapshot[];

  // Compatibilidad hacia atrás
  matchState: MatchState;
  matchTimerSeconds: number;
  redScore: number;
  blueScore: number;
  countdownSeconds?: number;
}


export interface MatchConfig {
  scoreLimit: number;
  timeLimitSeconds: number;
}
