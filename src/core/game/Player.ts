export const INPUT_UP = 1 << 0;          // Bit 0: ArrowUp
export const INPUT_DOWN = 1 << 1;        // Bit 1: ArrowDown
export const INPUT_LEFT = 1 << 2;        // Bit 2: ArrowLeft
export const INPUT_RIGHT = 1 << 3;       // Bit 3: ArrowRight
export const INPUT_KICK = 1 << 4;        // Bit 4: Kick (X)
export const INPUT_TURBO = 1 << 5;       // Bit 5: Turbo (Shift)
export const INPUT_DASH = 1 << 6;        // Bit 6: DashTrigger (Space) — Flanco ascendente exclusivo
export const INPUT_MAGNUS_LEFT = 1 << 7; // Bit 7: MagnusLeft (Z)
export const INPUT_MAGNUS_RIGHT = 1 << 8;// Bit 8: MagnusRight (C)

// Parámetros Cinemáticos del Dash (Zero-GC)
export const DASH_STAMINA_COST = 50;
export const DASH_TICKS = 4;
export const DEFAULT_DASH_DISTANCE = 37.5; // Desplazamiento base calibrado (+100% de potencia)

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
  public curveX: number = 0; // -1, 0, 1 (compatibilidad)
  public curveY: number = 0; // -1, 0, 1 (compatibilidad)
  public curveInput: number = 0; // 00 (ninguno), 01 (A - Izquierda), 10 (D - Derecha)
  public triggerDash: boolean = false;
  public prevDashState: boolean = false;

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

