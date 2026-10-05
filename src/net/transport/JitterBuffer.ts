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
  public isAdaptive: boolean;

  // Jitter tracking & dynamic delay (RFC 3550 standard)
  public meanJitter: number = 0;
  public lastProcessedTick: number = 0;
  private lastArrival: number | null = null;
  private lastTick: number | null = null;

  public static readonly MIN_DELAY_MS = 16;
  public static readonly MAX_DELAY_MS = 60;

  constructor(interpolationDelayMs: number = 33, maxBufferSize: number = 30, isAdaptive: boolean = false) {
    this.interpolationDelayMs = interpolationDelayMs;
    this.maxBufferSize = maxBufferSize;
    this.isAdaptive = isAdaptive;
  }

  public setAdaptive(enabled: boolean): void {
    this.isAdaptive = enabled;
  }

  public setMatchState(state: MatchPhase | string): void {
    this.currentMatchState = state;
  }

  /**
   * Actualiza el jitter acumulado y calcula el TargetDelay:
   * TargetDelay = clamp(meanJitter * 1.5, 16 ms, 60 ms)
   */
  public calculateTargetDelay(): number {
    const raw = this.meanJitter * 1.5;
    return Math.max(JitterBuffer.MIN_DELAY_MS, Math.min(JitterBuffer.MAX_DELAY_MS, raw));
  }

  public get targetDelay(): number {
    return this.calculateTargetDelay();
  }

  public push(snapshot: GameSnapshot, now: number = performance.now()): void {
    // Descartar paquetes obsoletos de forma inmediata sin procesamiento extra
    if (this.lastProcessedTick > 0 && snapshot.tick < this.lastProcessedTick) {
      // Si el tick se reinició (nuevo partido o wrap), limpiar buffer
      if (snapshot.tick < this.lastProcessedTick - 100) {
        this.clear();
        this.lastProcessedTick = snapshot.tick;
      } else {
        return;
      }
    }

    // Sincronizar estado actual automáticamente desde el snapshot recibido
    const newPhase = snapshot.matchPhase !== undefined
      ? snapshot.matchPhase
      : (snapshot.matchState ? toMatchPhase(snapshot.matchState) : this.currentMatchState);
    this.currentMatchState = newPhase;

    // Si el snapshot es STOPPED, vaciar inmediatamente el buffer previo para evitar deriva o interpolación residual
    if (newPhase === MatchPhase.STOPPED) {
      this.clear();
      this.buffer.push({ snapshot, receivedAt: now });
      this.lastProcessedTick = snapshot.tick;
      return;
    }

    // Descarte de snapshots duplicados o fuera de orden en buffer
    if (this.buffer.length > 0) {
      const latest = this.buffer[this.buffer.length - 1];
      if (snapshot.tick <= latest.snapshot.tick) {
        if (snapshot.tick < latest.snapshot.tick - 100) {
          this.clear();
        } else {
          return;
        }
      }
    }

    // Cálculo dinámico de fluctuación (jitter)
    if (this.lastArrival !== null && this.lastTick !== null && snapshot.tick > this.lastTick) {
      const expectedDelta = (snapshot.tick - this.lastTick) * (1000 / 60);
      const actualDelta = now - this.lastArrival;
      const instantJitter = Math.abs(actualDelta - expectedDelta);

      if (this.meanJitter === 0) {
        this.meanJitter = instantJitter;
      } else {
        // Filtro pasabajos exponencial
        this.meanJitter = this.meanJitter * 0.85 + instantJitter * 0.15;
      }

      if (this.isAdaptive) {
        const target = this.calculateTargetDelay();
        this.interpolationDelayMs = this.interpolationDelayMs * 0.9 + target * 0.1;
      }
    }

    this.lastArrival = now;
    this.lastTick = snapshot.tick;

    this.buffer.push({ snapshot, receivedAt: now });

    // Mantener buffer recortado
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

    // Físicas activas en PLAYING, GOAL_CELEBRATION y VICTORY_CELEBRATION
    const isSimulationActive = effectivePhase === MatchPhase.PLAYING ||
                               effectivePhase === MatchPhase.GOAL_CELEBRATION ||
                               effectivePhase === MatchPhase.VICTORY_CELEBRATION;

    if (!isSimulationActive) {
      const frozenDiscs: DiscSnapshot[] = latestSnapshot.discs.map(d => ({
        ...d,
        vx: 0,
        vy: 0
      }));
      this.lastProcessedTick = Math.max(this.lastProcessedTick, latestSnapshot.tick);
      return {
        ...latestSnapshot,
        discs: frozenDiscs
      };
    }

    if (this.buffer.length === 1) {
      this.lastProcessedTick = Math.max(this.lastProcessedTick, this.buffer[0].snapshot.tick);
      return this.buffer[0].snapshot;
    }

    const renderTime = now - this.interpolationDelayMs;

    // Buscar los dos snapshots consecutivos que rodean a renderTime
    let s0: BufferedSnapshot | null = null;
    let s1: BufferedSnapshot | null = null;

    for (let i = 0; i < this.buffer.length - 1; i++) {
      if (this.buffer[i].receivedAt <= renderTime && this.buffer[i + 1].receivedAt >= renderTime) {
        s0 = this.buffer[i];
        s1 = this.buffer[i + 1];
        break;
      }
    }

    // Si renderTime es anterior al snapshot más viejo, usar el más viejo
    if (!s0 && renderTime < this.buffer[0].receivedAt) {
      this.lastProcessedTick = Math.max(this.lastProcessedTick, this.buffer[0].snapshot.tick);
      return this.buffer[0].snapshot;
    }

    // Si renderTime supera al más nuevo, extrapolar con velocidad
    if (!s0 || !s1) {
      const latest = this.buffer[this.buffer.length - 1];
      const deltaSec = isSimulationActive ? Math.max(0, (renderTime - latest.receivedAt) / 1000) : 0;

      const extrapolatedDiscs: DiscSnapshot[] = latest.snapshot.discs.map(d => ({
        ...d,
        x: d.x + (isSimulationActive ? d.vx * deltaSec : 0),
        y: d.y + (isSimulationActive ? d.vy * deltaSec : 0)
      }));

      this.lastProcessedTick = Math.max(this.lastProcessedTick, latest.snapshot.tick);
      return {
        ...latest.snapshot,
        discs: extrapolatedDiscs
      };
    }

    // Calcular factor de interpolación alpha [0, 1]
    const timeSpan = s1.receivedAt - s0.receivedAt;
    const alpha = timeSpan > 0 ? (renderTime - s0.receivedAt) / timeSpan : 0;

    this.lastProcessedTick = Math.max(this.lastProcessedTick, s0.snapshot.tick);

    // Interpolar discos entre s0 y s1: P_render = lerp(P_0, P_1, alpha)
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
          avatar: d1.avatar,
          stamina: d1.stamina,
          isDashing: d1.isDashing,
          isTurbo: d1.isTurbo,
          isSpinActive: d1.isSpinActive,
          isCurvingAllowed: d1.isCurvingAllowed,
          lastKickerId: d1.lastKickerId,
          curveFactor: d1.curveFactor
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
    this.lastArrival = null;
    this.lastTick = null;
  }
}
