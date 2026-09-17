import { GameSnapshot, DiscSnapshot } from '../../core/game/GameState';
import { lerp } from '../../core/math/MathUtils';
import { MatchPhase, toMatchPhase } from '../../core/game/GameFSM';

interface BufferedSnapshot {
  snapshot: GameSnapshot;
  receivedAt: number;
}

export class JitterBuffer {
  public buffer: BufferedSnapshot[] = [];
  public interpolationDelayMs: number;
  public maxBufferSize: number;
  public currentMatchState: MatchPhase | string | null = null;

  constructor(interpolationDelayMs: number = 70, maxBufferSize: number = 30) {
    this.interpolationDelayMs = interpolationDelayMs;
    this.maxBufferSize = maxBufferSize;
  }

  public setMatchState(state: MatchPhase | string): void {
    this.currentMatchState = state;
  }

  public push(snapshot: GameSnapshot, now: number = performance.now()): void {
    // Sincronizar estado actual automáticamente desde el snapshot recibido
    this.currentMatchState = snapshot.matchPhase !== undefined
      ? snapshot.matchPhase
      : (snapshot.matchState ? toMatchPhase(snapshot.matchState) : this.currentMatchState);

    // Drop outdated snapshots
    if (this.buffer.length > 0) {
      const latest = this.buffer[this.buffer.length - 1];
      if (snapshot.tick <= latest.snapshot.tick) {
        // If tick wrapped or reset (e.g. new match started), clear stale buffer
        if (snapshot.tick < latest.snapshot.tick - 100) {
          this.clear();
        } else {
          return;
        }
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

    const latestSnapshot = this.buffer[this.buffer.length - 1].snapshot;
    const effectivePhase = typeof this.currentMatchState === 'number'
      ? this.currentMatchState
      : (this.currentMatchState ? toMatchPhase(this.currentMatchState) : (latestSnapshot.matchPhase ?? toMatchPhase(latestSnapshot.matchState)));

    // Físicas activas en PLAYING y GOAL_CELEBRATION
    const isSimulationActive = effectivePhase === MatchPhase.PLAYING || effectivePhase === MatchPhase.GOAL_CELEBRATION;

    if (!isSimulationActive) {
      const frozenDiscs: DiscSnapshot[] = latestSnapshot.discs.map(d => ({
        ...d,
        vx: 0,
        vy: 0
      }));
      return {
        ...latestSnapshot,
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
      const deltaSec = isSimulationActive ? Math.max(0, (renderTime - latest.receivedAt) / 1000) : 0;

      // Extrapolate with velocity
      const extrapolatedDiscs: DiscSnapshot[] = latest.snapshot.discs.map(d => ({
        ...d,
        x: d.x + (isSimulationActive ? d.vx * deltaSec : 0),
        y: d.y + (isSimulationActive ? d.vy * deltaSec : 0)
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
      ...s1.snapshot,
      discs: interpolatedDiscs
    };
  }

  public clear(): void {
    this.buffer = [];
  }
}
