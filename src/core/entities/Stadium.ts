import { Disc } from './Disc';
import { Segment } from './Segment';

export interface GoalDefinition {
  team: 'red' | 'blue';
  p0: { x: number; y: number };
  p1: { x: number; y: number };
}

export class Stadium {
  public name: string = 'Classic Haxball';
  public width: number = 740;
  public height: number = 400;
  public halfWidth: number = 370;
  public halfHeight: number = 200;
  public goalHalfHeight: number = 70;
  public goalDepth: number = 60;
  public centerRadius: number = 75;

  public segments: Segment[] = [];
  public posts: Disc[] = [];
  public goals: GoalDefinition[] = [];

  constructor() {
    this.buildGeometry();
  }

  private buildGeometry(): void {
    const hw = this.halfWidth;
    const hh = this.halfHeight;
    const gh = this.goalHalfHeight;
    const gd = this.goalDepth;

    let segId = 1;

    // Pitch perimeter walls
    // Top
    this.segments.push(new Segment({ id: segId++, x0: -hw, y0: -hh, x1: hw, y1: -hh, bounciness: 0.5 }));
    // Bottom
    this.segments.push(new Segment({ id: segId++, x0: -hw, y0: hh, x1: hw, y1: hh, bounciness: 0.5 }));
    // Left top & bottom
    this.segments.push(new Segment({ id: segId++, x0: -hw, y0: -hh, x1: -hw, y1: -gh, bounciness: 0.5 }));
    this.segments.push(new Segment({ id: segId++, x0: -hw, y0: gh, x1: -hw, y1: hh, bounciness: 0.5 }));
    // Right top & bottom
    this.segments.push(new Segment({ id: segId++, x0: hw, y0: -hh, x1: hw, y1: -gh, bounciness: 0.5 }));
    this.segments.push(new Segment({ id: segId++, x0: hw, y0: gh, x1: hw, y1: hh, bounciness: 0.5 }));

    // Left Goal Nets
    this.segments.push(new Segment({ id: segId++, x0: -hw, y0: -gh, x1: -(hw + gd), y1: -gh, bounciness: 0.2, color: '#94a3b8' }));
    this.segments.push(new Segment({ id: segId++, x0: -(hw + gd), y0: -gh, x1: -(hw + gd), y1: gh, bounciness: 0.2, color: '#94a3b8' }));
    this.segments.push(new Segment({ id: segId++, x0: -(hw + gd), y0: gh, x1: -hw, y1: gh, bounciness: 0.2, color: '#94a3b8' }));

    // Right Goal Nets
    this.segments.push(new Segment({ id: segId++, x0: hw, y0: -gh, x1: hw + gd, y1: -gh, bounciness: 0.2, color: '#94a3b8' }));
    this.segments.push(new Segment({ id: segId++, x0: hw + gd, y0: -gh, x1: hw + gd, y1: gh, bounciness: 0.2, color: '#94a3b8' }));
    this.segments.push(new Segment({ id: segId++, x0: hw + gd, y0: gh, x1: hw, y1: gh, bounciness: 0.2, color: '#94a3b8' }));

    // Goal Posts (Discs with mass = 0, invMass = 0)
    let postId = 100;
    const postRadius = 8;
    const postColor = '#ffffff';

    // Left posts (Red goal)
    this.posts.push(new Disc({ id: postId++, x: -hw, y: -gh, radius: postRadius, mass: 0, bounciness: 0.5, color: postColor }));
    this.posts.push(new Disc({ id: postId++, x: -hw, y: gh, radius: postRadius, mass: 0, bounciness: 0.5, color: postColor }));

    // Right posts (Blue goal)
    this.posts.push(new Disc({ id: postId++, x: hw, y: -gh, radius: postRadius, mass: 0, bounciness: 0.5, color: postColor }));
    this.posts.push(new Disc({ id: postId++, x: hw, y: gh, radius: postRadius, mass: 0, bounciness: 0.5, color: postColor }));

    // Goal definitions
    this.goals.push({
      team: 'red',
      p0: { x: -hw, y: -gh },
      p1: { x: -hw, y: gh }
    });
    this.goals.push({
      team: 'blue',
      p0: { x: hw, y: -gh },
      p1: { x: hw, y: gh }
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
