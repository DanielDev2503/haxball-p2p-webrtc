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
  stamina?: number | undefined;
  isDashing?: boolean | undefined;
  isTurbo?: boolean | undefined;
  isTyping?: boolean | undefined;
  isSpinActive?: boolean | undefined;
  isCurvingAllowed?: boolean | undefined;
  lastKickerId?: string | number | null | undefined;
  curveFactor?: number | undefined;
  spin?: number | undefined;
  isPowerShot?: boolean | undefined;
}

export interface TouchHistoryEntry {
  playerId: string;
  team: 'red' | 'blue';
  timestamp: number;
  wasCurve: boolean;
  wasPower: boolean;
  tick: number;
}

export interface PlayerMatchStats {
  playerId: string;
  playerName: string;
  nickname?: string;
  team: 'red' | 'blue' | 'spec';
  points: number;
  totalPoints?: number;
  goals: number;
  assists: number;
  passes: number;
  saves: number;
  shots: number;
  touches: number;
  hasHattrickBonus: boolean;
}

export interface GoalInfo {
  scorerId: string;
  scorerName: string;
  assisterId: string | null;
  assisterName: string | null;
  team: 'red' | 'blue';
}

export interface KickoffState {
  active: boolean;
  mode: 'NEUTRAL' | 'TEAM_KICKOFF';
  possessingTeam: 'red' | 'blue' | null;
}

export interface GameSnapshot {
  tick: number;
  matchPhase: MatchPhase;
  timerSeconds: number;
  subStateTimer: number;
  targetTeam: number; // 0: none, 1: red, 2: blue
  scoreRed: number;
  scoreBlue: number;
  soundMask?: number;
  kickoffActive?: boolean;
  kickoffMode?: 'NEUTRAL' | 'TEAM_KICKOFF';
  possessingTeam?: 'red' | 'blue' | null;
  isGoldenGoal?: boolean;
  discs: DiscSnapshot[];
  lastGoal?: GoalInfo | null;
  matchStats?: PlayerMatchStats[];
  mvpPlayerId?: string | null;

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

