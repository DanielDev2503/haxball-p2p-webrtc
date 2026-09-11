export const INPUT_UP = 1 << 0;
export const INPUT_DOWN = 1 << 1;
export const INPUT_LEFT = 1 << 2;
export const INPUT_RIGHT = 1 << 3;
export const INPUT_KICK = 1 << 4;

export type TeamType = 'red' | 'blue' | 'spec';

export interface PlayerData {
  id: string;
  name: string;
  team: TeamType;
  avatar?: string;
  isHost?: boolean;
  isAdmin?: boolean;
  joinedAt?: number;
}

export class Player {
  public id: string;
  public name: string;
  public team: TeamType;
  public avatar: string;
  public isHost: boolean;
  public isAdmin: boolean;
  public joinedAt: number;
  public inputMask: number = 0;
  public discId: number | null = null;

  constructor(data: PlayerData) {
    this.id = data.id;
    this.name = data.name;
    this.team = data.team;
    this.avatar = data.avatar ?? data.name.substring(0, 2).toUpperCase();
    this.isHost = data.isHost ?? false;
    this.isAdmin = data.isAdmin ?? (data.isHost ?? false);
    this.joinedAt = data.joinedAt ?? Date.now();
  }
}
