import { Vec2 } from '../math/Vec2';

export const COLLISION_GROUP_BALL = 1 << 0;
export const COLLISION_GROUP_RED = 1 << 1;
export const COLLISION_GROUP_BLUE = 1 << 2;
export const COLLISION_GROUP_WALL = 1 << 3;
export const COLLISION_GROUP_RED_GOAL = 1 << 4;
export const COLLISION_GROUP_BLUE_GOAL = 1 << 5;
export const COLLISION_GROUP_ALL = 0xFFFFFFFF;

export interface DiscOptions {
  id: number;
  x?: number;
  y?: number;
  radius?: number;
  mass?: number;
  damping?: number;
  bounciness?: number;
  cGroup?: number;
  cMask?: number;
  isBall?: boolean;
  color?: string;
}

export class Disc {
  public id: number;
  public pos: Vec2;
  public prevPos: Vec2;
  public vel: Vec2;
  public radius: number;
  public mass: number;
  public invMass: number;
  public damping: number;
  public bounciness: number;
  public cGroup: number;
  public cMask: number;
  public isBall: boolean;
  public color: string;
  public kicking: boolean = false;

  // Mecánicas de Efecto Magnus (solo balón, escalares puros, cero GC)
  public isCurving: boolean = false;
  public curvePerp: number = 0;   // c_perp
  public curveBrake: number = 0;  // k_brake * |c_parallel|
  public lastKickerId: number = -1;

  // Mecánicas de Jugador (escalares para colisiones y snapshots)
  public stamina: number = 100;
  public isDashing: boolean = false;
  public isTurbo: boolean = false;

  constructor(options: DiscOptions) {
    this.id = options.id;
    this.pos = new Vec2(options.x ?? 0, options.y ?? 0);
    this.prevPos = new Vec2(this.pos.x, this.pos.y);
    this.vel = new Vec2(0, 0);
    this.radius = options.radius ?? 15;
    this.mass = options.mass ?? 1;
    this.invMass = this.mass === 0 ? 0 : 1 / this.mass;
    this.damping = options.damping ?? 0.99;
    this.bounciness = options.bounciness ?? 0.5;
    this.cGroup = options.cGroup ?? COLLISION_GROUP_ALL;
    this.cMask = options.cMask ?? COLLISION_GROUP_ALL;
    this.isBall = options.isBall ?? false;
    this.color = options.color ?? (this.isBall ? '#ffffff' : '#e74c3c');
  }

  public setMass(mass: number): void {
    this.mass = mass;
    this.invMass = mass === 0 ? 0 : 1 / mass;
  }

  public applyImpulse(ix: number, iy: number): void {
    if (this.invMass === 0) return;
    this.vel.x += ix * this.invMass;
    this.vel.y += iy * this.invMass;
  }

  public canCollideWith(other: Disc): boolean {
    return (this.cGroup & other.cMask) !== 0 && (other.cGroup & this.cMask) !== 0;
  }

  public resetCurve(): void {
    this.isCurving = false;
    this.curvePerp = 0;
    this.curveBrake = 0;
    this.lastKickerId = -1;
  }
}
