export const INPUT_UP = 1 << 0;
export const INPUT_DOWN = 1 << 1;
export const INPUT_LEFT = 1 << 2;
export const INPUT_RIGHT = 1 << 3;
export const INPUT_KICK = 1 << 4;
export const INPUT_TURBO = 1 << 5;
export const INPUT_DASH = 1 << 6;

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
  private _isAdmin: boolean;
  public joinedAt: number;
  public inputMask: number = 0;
  public discId: number | null = null;
  public declare isAdmin: boolean;

  // Sistema de Estamina, Turbo, Dash y Comba (Ponytail: escalares puros)
  public stamina: number = 100;
  public isDashing: boolean = false;
  public dashTicksRemaining: number = 0;
  public dashDirX: number = 0;
  public dashDirY: number = 0;
  public isTurbo: boolean = false;
  public triggerDash: boolean = false;
  public curveX: number = 0; // -1, 0, 1
  public curveY: number = 0; // -1, 0, 1

  constructor(data: PlayerData) {
    this.id = data.id;
    this.name = data.name;
    this.team = data.team;
    this.avatar = data.avatar ?? data.name.substring(0, 2).toUpperCase();
    this.isHost = data.isHost ?? false;
    this._isAdmin = this.isHost ? true : Boolean(data.isAdmin);
    this.joinedAt = data.joinedAt ?? Date.now();

    // Host admin is perpetual and immutable — cannot be revoked
    Object.defineProperty(this, 'isAdmin', {
      enumerable: true,
      configurable: true,
      get: () => (this.isHost ? true : this._isAdmin),
      set: (val: boolean) => {
        if (this.isHost) {
          this._isAdmin = true;
          return;
        }
        this._isAdmin = Boolean(val);
      }
    });
  }

  public toJSON() {
    return {
      id: this.id,
      name: this.name,
      team: this.team,
      avatar: this.avatar,
      isHost: this.isHost,
      isAdmin: this.isAdmin,
      joinedAt: this.joinedAt
    };
  }
}

