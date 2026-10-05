import {
  Disc,
  COLLISION_GROUP_BALL,
  COLLISION_GROUP_RED,
  COLLISION_GROUP_BLUE,
  COLLISION_GROUP_WALL,
  COLLISION_GROUP_ALL
} from './Disc';
import { Segment } from './Segment';

export interface GoalDefinition {
  team: 'red' | 'blue';
  p0: { x: number; y: number };
  p1: { x: number; y: number };
  size?: number;
}

export interface StadiumBallPhysics {
  radius: number;
  bCoef: number;
  invMass: number;
  color: string;
}

export interface StadiumPlayerPhysics {
  acceleration: number;
  kickingAcceleration: number;
  kickStrength: number;
  bCoef: number;
}

export interface StadiumOptions {
  id?: string | undefined;
  name?: string | undefined;
  width?: number | undefined;
  height?: number | undefined;
  goalSize?: number | undefined;
  goalDepth?: number | undefined;
  runOff?: number | undefined;
  spawnDistance?: number | undefined;
  kickOffRadius?: number | undefined;
  bgColor?: string | undefined;
  postRadius?: number | undefined;
  postColor?: string | undefined;
  ballPhysics?: StadiumBallPhysics | undefined;
  playerPhysics?: StadiumPlayerPhysics | undefined;
  leftGoalPos?: { p0: { x: number; y: number }; p1: { x: number; y: number } } | undefined;
  rightGoalPos?: { p0: { x: number; y: number }; p1: { x: number; y: number } } | undefined;
}

export class Stadium {
  public id: string = 'classic';
  public name: string = 'Classic Haxball';
  public width: number = 1200;
  public height: number = 540;
  public halfWidth: number = 600;
  public halfHeight: number = 270;
  public goalHalfHeight: number = 85;
  public goalDepth: number = 35;
  public centerRadius: number = 80;
  public runOff: number = 45; // delta = 45 px (1.5 player diameters)
  public spawnDistance: number = 180;
  public bgColor: string = '#1D2431';
  public postRadius: number = 8;
  public postColor: string = '#ffffff';
  public ballPhysics?: StadiumBallPhysics;
  public playerPhysics?: StadiumPlayerPhysics;
  public leftGoalPos?: { p0: { x: number; y: number }; p1: { x: number; y: number } };
  public rightGoalPos?: { p0: { x: number; y: number }; p1: { x: number; y: number } };

  public get goalSize(): number {
    return this.goalHalfHeight * 2;
  }

  public segments: Segment[] = [];
  public posts: Disc[] = [];
  public goals: GoalDefinition[] = [];

  constructor(options?: StadiumOptions) {
    if (options) {
      if (options.id) this.id = options.id;
      if (options.name) this.name = options.name;
      if (options.width) {
        this.width = options.width;
        this.halfWidth = options.width / 2;
      }
      if (options.height) {
        this.height = options.height;
        this.halfHeight = options.height / 2;
      }
      if (options.goalSize) {
        this.goalHalfHeight = options.goalSize / 2;
      }
      if (options.goalDepth) {
        this.goalDepth = options.goalDepth;
      }
      if (options.runOff !== undefined) {
        this.runOff = options.runOff;
      }
      if (options.spawnDistance !== undefined) {
        this.spawnDistance = options.spawnDistance;
      }
      if (options.kickOffRadius !== undefined) {
        this.centerRadius = options.kickOffRadius;
      }
      if (options.bgColor) {
        this.bgColor = options.bgColor;
      }
      if (options.postRadius !== undefined) {
        this.postRadius = options.postRadius;
      }
      if (options.postColor) {
        this.postColor = options.postColor;
      }
      if (options.ballPhysics) {
        this.ballPhysics = options.ballPhysics;
      }
      if (options.playerPhysics) {
        this.playerPhysics = options.playerPhysics;
      }
      if (options.leftGoalPos) {
        this.leftGoalPos = options.leftGoalPos;
      }
      if (options.rightGoalPos) {
        this.rightGoalPos = options.rightGoalPos;
      }
    }
    this.buildGeometry();
  }

  private buildGeometry(): void {
    const hw = this.halfWidth;
    const hh = this.halfHeight;
    const gh = this.goalHalfHeight;
    const delta = this.runOff;

    let segId = 1;

    // 1. Límite Interior (Líneas de la Cancha): cMask: ['ball'], cGroup: ['pitchLine']
    // El balón rebota estrictamente en las líneas reglamentarias (X = ±W/2, Y = ±H/2, salvo apertura de arcos)
    // Top
    this.segments.push(new Segment({
      id: segId++,
      x0: -hw, y0: -hh, x1: hw, y1: -hh,
      bounciness: 0.5,
      cGroup: COLLISION_GROUP_WALL,
      cMask: COLLISION_GROUP_BALL,
      color: '#64748b'
    }));
    // Bottom
    this.segments.push(new Segment({
      id: segId++,
      x0: -hw, y0: hh, x1: hw, y1: hh,
      bounciness: 0.5,
      cGroup: COLLISION_GROUP_WALL,
      cMask: COLLISION_GROUP_BALL,
      color: '#64748b'
    }));
    // Left top & bottom (fuera de la boca del arco)
    this.segments.push(new Segment({
      id: segId++,
      x0: -hw, y0: -hh, x1: -hw, y1: -gh,
      bounciness: 0.5,
      cGroup: COLLISION_GROUP_WALL,
      cMask: COLLISION_GROUP_BALL,
      color: '#64748b'
    }));
    this.segments.push(new Segment({
      id: segId++,
      x0: -hw, y0: gh, x1: -hw, y1: hh,
      bounciness: 0.5,
      cGroup: COLLISION_GROUP_WALL,
      cMask: COLLISION_GROUP_BALL,
      color: '#64748b'
    }));
    // Right top & bottom (fuera de la boca del arco)
    this.segments.push(new Segment({
      id: segId++,
      x0: hw, y0: -hh, x1: hw, y1: -gh,
      bounciness: 0.5,
      cGroup: COLLISION_GROUP_WALL,
      cMask: COLLISION_GROUP_BALL,
      color: '#64748b'
    }));
    this.segments.push(new Segment({
      id: segId++,
      x0: hw, y0: gh, x1: hw, y1: hh,
      bounciness: 0.5,
      cGroup: COLLISION_GROUP_WALL,
      cMask: COLLISION_GROUP_BALL,
      color: '#64748b'
    }));

    // 2. Límite Exterior Invisible (Zona de Escape del Jugador):
    // Distancia delta = 45 px. Segmentos colocados a (X = ±(W/2 + delta), Y = ±(H/2 + delta))
    // cMask: ['red', 'blue'] y visible: false
    const extHw = hw + delta;
    const extHh = hh + delta;

    // Top exterior
    this.segments.push(new Segment({
      id: segId++,
      x0: -extHw, y0: -extHh, x1: extHw, y1: -extHh,
      bounciness: 0.2,
      cGroup: COLLISION_GROUP_WALL,
      cMask: COLLISION_GROUP_RED | COLLISION_GROUP_BLUE,
      visible: false
    }));
    // Bottom exterior
    this.segments.push(new Segment({
      id: segId++,
      x0: -extHw, y0: extHh, x1: extHw, y1: extHh,
      bounciness: 0.2,
      cGroup: COLLISION_GROUP_WALL,
      cMask: COLLISION_GROUP_RED | COLLISION_GROUP_BLUE,
      visible: false
    }));
    // Left exterior
    this.segments.push(new Segment({
      id: segId++,
      x0: -extHw, y0: -extHh, x1: -extHw, y1: extHh,
      bounciness: 0.2,
      cGroup: COLLISION_GROUP_WALL,
      cMask: COLLISION_GROUP_RED | COLLISION_GROUP_BLUE,
      visible: false
    }));
    // Right exterior
    this.segments.push(new Segment({
      id: segId++,
      x0: extHw, y0: -extHh, x1: extHw, y1: extHh,
      bounciness: 0.2,
      cGroup: COLLISION_GROUP_WALL,
      cMask: COLLISION_GROUP_RED | COLLISION_GROUP_BLUE,
      visible: false
    }));

    // 3. Postes de Portería (Goal Posts)
    let postId = 100;
    const postRadius = this.postRadius;
    const postColor = this.postColor;

    // Left posts (Red goal)
    this.posts.push(new Disc({ id: postId++, x: -hw, y: -gh, radius: postRadius, mass: 0, bounciness: 0.5, color: postColor, cGroup: COLLISION_GROUP_WALL, cMask: COLLISION_GROUP_ALL, isPost: true }));
    this.posts.push(new Disc({ id: postId++, x: -hw, y: gh, radius: postRadius, mass: 0, bounciness: 0.5, color: postColor, cGroup: COLLISION_GROUP_WALL, cMask: COLLISION_GROUP_ALL, isPost: true }));

    // Right posts (Blue goal)
    this.posts.push(new Disc({ id: postId++, x: hw, y: -gh, radius: postRadius, mass: 0, bounciness: 0.5, color: postColor, cGroup: COLLISION_GROUP_WALL, cMask: COLLISION_GROUP_ALL, isPost: true }));
    this.posts.push(new Disc({ id: postId++, x: hw, y: gh, radius: postRadius, mass: 0, bounciness: 0.5, color: postColor, cGroup: COLLISION_GROUP_WALL, cMask: COLLISION_GROUP_ALL, isPost: true }));

    // 5. Goal definitions
    if (this.leftGoalPos) {
      this.goals.push({
        team: 'red',
        p0: { ...this.leftGoalPos.p0 },
        p1: { ...this.leftGoalPos.p1 },
        size: Math.abs(this.leftGoalPos.p1.y - this.leftGoalPos.p0.y)
      });
    } else {
      this.goals.push({
        team: 'red',
        p0: { x: -hw, y: -gh },
        p1: { x: -hw, y: gh },
        size: gh * 2
      });
    }

    if (this.rightGoalPos) {
      this.goals.push({
        team: 'blue',
        p0: { ...this.rightGoalPos.p0 },
        p1: { ...this.rightGoalPos.p1 },
        size: Math.abs(this.rightGoalPos.p1.y - this.rightGoalPos.p0.y)
      });
    } else {
      this.goals.push({
        team: 'blue',
        p0: { x: hw, y: -gh },
        p1: { x: hw, y: gh },
        size: gh * 2
      });
    }
  }

  /**
   * Checks if a point (ball position) crossed a goal line.
   * Returns 'red' if Red scored (ball crossed blue goal on the right),
   * 'blue' if Blue scored (ball crossed red goal on the left),
   * or null if no goal.
   */
  public checkGoal(ballX: number, ballY: number): 'red' | 'blue' | null {
    const hw = this.halfWidth;
    const gh = this.goalHalfHeight;

    if (ballY > -gh && ballY < gh) {
      if (ballX < -hw) {
        return 'blue'; // Left goal conceded by red, point for blue
      }
      if (ballX > hw) {
        return 'red'; // Right goal conceded by blue, point for red
      }
    }
    return null;
  }
}
