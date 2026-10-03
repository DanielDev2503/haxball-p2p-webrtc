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

export interface ThemeTokens {
  bgPrimary: string;
  bgSurface: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  borderGlow: string;
  accentCyan: string;
}

export const DARK_THEME_TOKENS: ThemeTokens = {
  bgPrimary: '#0B111E',
  bgSurface: '#070F1E',
  textPrimary: '#FFFFFF',
  textSecondary: '#E0F2FE',
  textMuted: '#67E8F9',
  borderGlow: 'rgba(0, 229, 255, 0.35)',
  accentCyan: '#00E5FF'
};

export const LIGHT_THEME_TOKENS: ThemeTokens = {
  bgPrimary: '#FFFFFF',
  bgSurface: '#F0F9FF',
  textPrimary: '#0F172A',
  textSecondary: '#0284C7',
  textMuted: '#0EA5E9',
  borderGlow: 'rgba(14, 165, 233, 0.3)',
  accentCyan: '#0EA5E9'
};

const getSavedTheme = (): 'light' | 'dark' => {
  if (typeof localStorage !== 'undefined') {
    const saved = localStorage.getItem('haxball_theme');
    if (saved === 'dark' || saved === 'light') return saved;
  }
  return 'dark';
};

const initialTheme = getSavedTheme();

export const $theme = atom<'light' | 'dark'>(initialTheme);
export const $themeTokens = atom<ThemeTokens>(initialTheme === 'dark' ? DARK_THEME_TOKENS : LIGHT_THEME_TOKENS);

export function applyThemeToDOM(mode: 'light' | 'dark'): void {
  if (typeof document === 'undefined' || !document.documentElement) return;
  
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
  $themeTokens.set(mode === 'dark' ? DARK_THEME_TOKENS : LIGHT_THEME_TOKENS);
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

