/**
 * In-place 2D Vector implementation designed for zero memory allocations
 * in hot physics loops. Includes static scratchpads and memory pooling.
 */
export class Vec2 {
  public x: number;
  public y: number;

  constructor(x: number = 0, y: number = 0) {
    this.x = x;
    this.y = y;
  }

  public set(x: number, y: number): this {
    this.x = x;
    this.y = y;
    return this;
  }

  public copy(other: Readonly<Vec2>): this {
    this.x = other.x;
    this.y = other.y;
    return this;
  }

  public clone(): Vec2 {
    return new Vec2(this.x, this.y);
  }

  public zero(): this {
    this.x = 0;
    this.y = 0;
    return this;
  }

  public add(other: Readonly<Vec2>): this {
    this.x += other.x;
    this.y += other.y;
    return this;
  }

  public addScaled(other: Readonly<Vec2>, scale: number): this {
    this.x += other.x * scale;
    this.y += other.y * scale;
    return this;
  }

  public sub(other: Readonly<Vec2>): this {
    this.x -= other.x;
    this.y -= other.y;
    return this;
  }

  public scale(scalar: number): this {
    this.x *= scalar;
    this.y *= scalar;
    return this;
  }

  public dot(other: Readonly<Vec2>): number {
    return this.x * other.x + this.y * other.y;
  }

  public cross(other: Readonly<Vec2>): number {
    return this.x * other.y - this.y * other.x;
  }

  public lenSq(): number {
    return this.x * this.x + this.y * this.y;
  }

  public len(): number {
    return Math.sqrt(this.x * this.x + this.y * this.y);
  }

  public normalize(): this {
    const length = this.len();
    if (length > 1e-9) {
      this.x /= length;
      this.y /= length;
    } else {
      this.x = 0;
      this.y = 0;
    }
    return this;
  }

  public distSq(other: Readonly<Vec2>): number {
    const dx = this.x - other.x;
    const dy = this.y - other.y;
    return dx * dx + dy * dy;
  }

  public dist(other: Readonly<Vec2>): number {
    return Math.sqrt(this.distSq(other));
  }

  public perp(): this {
    const tempX = this.x;
    this.x = -this.y;
    this.y = tempX;
    return this;
  }

  /**
   * Static temporary vectors pre-allocated to avoid GC in physics routines.
   * NEVER store references to temp vectors across function calls.
   */
  public static readonly t0 = new Vec2();
  public static readonly t1 = new Vec2();
  public static readonly t2 = new Vec2();
  public static readonly t3 = new Vec2();
  public static readonly t4 = new Vec2();
  public static readonly t5 = new Vec2();
}
