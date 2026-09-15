import { GameSnapshot, DiscSnapshot } from '../../core/game/GameState';
import { lerp } from '../../core/math/MathUtils';

interface BufferedSnapshot {
  snapshot: GameSnapshot;
  receivedAt: number;
}

export class JitterBuffer {
  public buffer: BufferedSnapshot[] = [];
  public interpolationDelayMs: number;
  public maxBufferSize: number;
  public currentMatchState: string = 'STOPPED';

  constructor(interpolationDelayMs: number = 70, maxBufferSize: number = 30) {
    this.interpolationDelayMs = interpolationDelayMs;
    this.maxBufferSize = maxBufferSize;
  }

  public setMatchState(state: string): void {
    this.currentMatchState = state;
  }

  public push(snapshot: GameSnapshot, now: number = performance.now()): void {
    // Drop outdated snapshots
    if (this.buffer.length > 0) {
      const latest = this.buffer[this.buffer.length - 1];
      if (snapshot.tick <= latest.snapshot.tick) {
        return;
      }
    }

    this.buffer.push({ snapshot, receivedAt: now });

    // Keep buffer trimmed
    if (this.buffer.length > this.maxBufferSize) {
      this.buffer.shift();
    }
  }

  public getInterpolatedSnapshot(now: number = performance.now()): GameSnapshot | null {
    if (this.buffer.length === 0) return null;

    // Freeze total cuando el juego no esté en PLAYING: no extrapolar ni calcular deltaSec
    const latestSnapshot = this.buffer[this.buffer.length - 1].snapshot;
    const effectiveState = this.currentMatchState || latestSnapshot.matchState;
    if (effectiveState !== 'PLAYING') {
      const frozenDiscs: DiscSnapshot[] = latestSnapshot.discs.map(d => ({
        ...d,
        vx: 0,
        vy: 0
      }));
      return {
        ...latestSnapshot,
        matchState: effectiveState as GameSnapshot['matchState'],
        discs: frozenDiscs
      };
    }

    if (this.buffer.length === 1) return this.buffer[0].snapshot;

    const renderTime = now - this.interpolationDelayMs;

    // Find the two consecutive snapshots surrounding renderTime
    let s0: BufferedSnapshot | null = null;
    let s1: BufferedSnapshot | null = null;

    for (let i = 0; i < this.buffer.length - 1; i++) {
      if (this.buffer[i].receivedAt <= renderTime && this.buffer[i + 1].receivedAt >= renderTime) {
        s0 = this.buffer[i];
        s1 = this.buffer[i + 1];
        break;
      }
    }

    // If renderTime is older than our oldest snapshot, use oldest
    if (!s0 && renderTime < this.buffer[0].receivedAt) {
      return this.buffer[0].snapshot;
    }

    // If renderTime is ahead of newest snapshot, extrapolate from latest
    if (!s0 || !s1) {
      const latest = this.buffer[this.buffer.length - 1];
      const deltaSec = Math.max(0, (renderTime - latest.receivedAt) / 1000);

      // Extrapolate with velocity
      const extrapolatedDiscs: DiscSnapshot[] = latest.snapshot.discs.map(d => ({
        ...d,
        x: d.x + d.vx * deltaSec,
        y: d.y + d.vy * deltaSec
      }));

      return {
        ...latest.snapshot,
        discs: extrapolatedDiscs
      };
    }

    // Calculate interpolation factor alpha [0, 1]
    const timeSpan = s1.receivedAt - s0.receivedAt;
    const alpha = timeSpan > 0 ? (renderTime - s0.receivedAt) / timeSpan : 0;

    // Interpolate discs between s0 and s1
    const s1DiscsById = new Map<number, DiscSnapshot>();
    for (const d of s1.snapshot.discs) {
      s1DiscsById.set(d.id, d);
    }

    const interpolatedDiscs: DiscSnapshot[] = [];
    for (const d0 of s0.snapshot.discs) {
      const d1 = s1DiscsById.get(d0.id);
      if (d1) {
        interpolatedDiscs.push({
          id: d0.id,
          team: d1.team,
          x: lerp(d0.x, d1.x, alpha),
          y: lerp(d0.y, d1.y, alpha),
          vx: lerp(d0.vx, d1.vx, alpha),
          vy: lerp(d0.vy, d1.vy, alpha),
          radius: d1.radius,
          kicking: d1.kicking,
          avatar: d1.avatar
        });
      } else {
        interpolatedDiscs.push(d0);
      }
    }

    return {
      tick: s1.snapshot.tick,
      matchState: s1.snapshot.matchState,
      matchTimerSeconds: s1.snapshot.matchTimerSeconds,
      redScore: s1.snapshot.redScore,
      blueScore: s1.snapshot.blueScore,
      discs: interpolatedDiscs
    };
  }

  public clear(): void {
    this.buffer = [];
  }
}
