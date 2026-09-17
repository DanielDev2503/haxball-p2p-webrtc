import { atom } from 'nanostores';

export interface ScoreState {
  red: number;
  blue: number;
}

export interface RoomConfigState {
  timeLimit: number;
  goalLimit: number;
  teamsLocked: boolean;
}

export const $matchPhase = atom<number>(0);
export const $score = atom<ScoreState>({ red: 0, blue: 0 });
export const $timer = atom<string>('00:00');
export const $subStateTimer = atom<number>(0);
export const $ping = atom<number>(0);
export const $players = atom<Array<any>>([]);
export const $roomConfig = atom<RoomConfigState>({
  timeLimit: 3,
  goalLimit: 3,
  teamsLocked: false
});
