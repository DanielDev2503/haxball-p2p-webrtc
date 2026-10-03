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
  return 'dark';
};

const initialTheme = getSavedTheme();

export const $theme = atom<'light' | 'dark'>(initialTheme);

export function applyThemeToDOM(mode: 'light' | 'dark'): void {
  if (typeof document === 'undefined') return;
  
  const isDark = mode === 'dark';
  document.documentElement.setAttribute('data-theme', mode);
  document.documentElement.classList.toggle('dark', isDark);

  if (document.body) {
    document.body.setAttribute('data-theme', mode);
    document.body.classList.toggle('dark', isDark);
  }

  const appEl = document.getElementById('app') || document.getElementById('app-root');
  if (appEl) {
    appEl.setAttribute('data-theme', mode);
    appEl.classList.toggle('dark', isDark);
  }
}

export function setTheme(mode: 'light' | 'dark'): void {
  $theme.set(mode);
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('haxball_theme', mode);
  }
  applyThemeToDOM(mode);
}

export function toggleTheme(): 'light' | 'dark' {
  const next = $theme.get() === 'dark' ? 'light' : 'dark';
  setTheme(next);
  return next;
}

// Reactive subscription: any $theme.set() immediately updates DOM tokens
if (typeof document !== 'undefined') {
  applyThemeToDOM(initialTheme);
  $theme.subscribe((mode) => {
    applyThemeToDOM(mode);
  });

  if (!document.body) {
    document.addEventListener('DOMContentLoaded', () => {
      applyThemeToDOM($theme.get());
    });
  }
}

