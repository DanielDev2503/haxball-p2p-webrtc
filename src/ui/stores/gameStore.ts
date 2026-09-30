import { atom } from 'nanostores';
import { GameplayConfig, DEFAULT_GAMEPLAY_CONFIG } from '../../core/game/GameConfig';

export interface ScoreState {
  red: number;
  blue: number;
}

export interface RoomConfigState {
  timeLimit: number;
  goalLimit: number;
  teamsLocked: boolean;
  stadiumId?: string;
}

export const $matchPhase = atom<number>(0);
export const $score = atom<ScoreState>({ red: 0, blue: 0 });
export const $timer = atom<string>('00:00');
export const $subStateTimer = atom<number>(0);
export const $ping = atom<number>(0);
export const $players = atom<Array<any>>([]);
export const $gameConfig = atom<GameplayConfig>(DEFAULT_GAMEPLAY_CONFIG);
export const $roomConfig = atom<RoomConfigState>({
  timeLimit: 3,
  goalLimit: 3,
  teamsLocked: false,
  stadiumId: 'classic'
});

const getSavedTheme = (): 'light' | 'dark' => {
  if (typeof localStorage !== 'undefined') {
    const saved = localStorage.getItem('haxball_theme');
    if (saved === 'dark' || saved === 'light') return saved;
  }
  return 'light';
};

const initialTheme = getSavedTheme();

export const $theme = atom<'light' | 'dark'>(initialTheme);

export function setTheme(mode: 'light' | 'dark'): void {
  $theme.set(mode);
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('haxball_theme', mode);
  }
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', mode);
    if (document.body) {
      document.body.setAttribute('data-theme', mode);
    }
  }
}

export function toggleTheme(): 'light' | 'dark' {
  const next = $theme.get() === 'dark' ? 'light' : 'dark';
  setTheme(next);
  return next;
}

if (typeof document !== 'undefined') {
  document.documentElement.setAttribute('data-theme', initialTheme);
  if (document.body) {
    document.body.setAttribute('data-theme', initialTheme);
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      document.body.setAttribute('data-theme', $theme.get());
    });
  }
}

