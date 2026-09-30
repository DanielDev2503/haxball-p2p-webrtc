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

export interface StadiumOptions {
  id?: string;
  name?: string;
  width?: number;
  height?: number;
  goalSize?: number;
  goalDepth?: number;
  runOff?: number;
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
    }
    this.buildGeometry();
  }

  private buildGeometry(): void {
    const hw = this.halfWidth;
    const hh = this.halfHeight;
    const gh = this.goalHalfHeight;
    const gd = this.goalDepth;
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

    // 3. Redes de Portería (Goal Nets)
    // Left Goal Nets (Red Goal)
    this.segments.push(new Segment({
      id: segId++,
      x0: -hw, y0: -gh, x1: -(hw + gd), y1: -gh,
      bounciness: 0.2,
      cGroup: COLLISION_GROUP_WALL,
      cMask: COLLISION_GROUP_ALL,
      color: '#94a3b8'
    }));
    this.segments.push(new Segment({
      id: segId++,
      x0: -(hw + gd), y0: -gh, x1: -(hw + gd), y1: gh,
      bounciness: 0.2,
      cGroup: COLLISION_GROUP_WALL,
      cMask: COLLISION_GROUP_ALL,
      color: '#94a3b8'
    }));
    this.segments.push(new Segment({
      id: segId++,
      x0: -(hw + gd), y0: gh, x1: -hw, y1: gh,
      bounciness: 0.2,
      cGroup: COLLISION_GROUP_WALL,
      cMask: COLLISION_GROUP_ALL,
      color: '#94a3b8'
    }));

    // Right Goal Nets (Blue Goal)
    this.segments.push(new Segment({
      id: segId++,
      x0: hw, y0: -gh, x1: hw + gd, y1: -gh,
      bounciness: 0.2,
      cGroup: COLLISION_GROUP_WALL,
      cMask: COLLISION_GROUP_ALL,
      color: '#94a3b8'
    }));
    this.segments.push(new Segment({
      id: segId++,
      x0: hw + gd, y0: -gh, x1: hw + gd, y1: gh,
      bounciness: 0.2,
      cGroup: COLLISION_GROUP_WALL,
      cMask: COLLISION_GROUP_ALL,
      color: '#94a3b8'
    }));
    this.segments.push(new Segment({
      id: segId++,
      x0: hw + gd, y0: gh, x1: hw, y1: gh,
      bounciness: 0.2,
      cGroup: COLLISION_GROUP_WALL,
      cMask: COLLISION_GROUP_ALL,
      color: '#94a3b8'
    }));

    // 4. Postes de Portería (Goal Posts)
    let postId = 100;
    const postRadius = 8;
    const postColor = '#ffffff';

    // Left posts (Red goal)
    this.posts.push(new Disc({ id: postId++, x: -hw, y: -gh, radius: postRadius, mass: 0, bounciness: 0.5, color: postColor, cGroup: COLLISION_GROUP_WALL, cMask: COLLISION_GROUP_ALL }));
    this.posts.push(new Disc({ id: postId++, x: -hw, y: gh, radius: postRadius, mass: 0, bounciness: 0.5, color: postColor, cGroup: COLLISION_GROUP_WALL, cMask: COLLISION_GROUP_ALL }));

    // Right posts (Blue goal)
    this.posts.push(new Disc({ id: postId++, x: hw, y: -gh, radius: postRadius, mass: 0, bounciness: 0.5, color: postColor, cGroup: COLLISION_GROUP_WALL, cMask: COLLISION_GROUP_ALL }));
    this.posts.push(new Disc({ id: postId++, x: hw, y: gh, radius: postRadius, mass: 0, bounciness: 0.5, color: postColor, cGroup: COLLISION_GROUP_WALL, cMask: COLLISION_GROUP_ALL }));

    // 5. Goal definitions
    this.goals.push({
      team: 'red',
      p0: { x: -hw, y: -gh },
      p1: { x: -hw, y: gh },
      size: gh * 2
    });
    this.goals.push({
      team: 'blue',
      p0: { x: hw, y: -gh },
      p1: { x: hw, y: gh },
      size: gh * 2
    });
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
