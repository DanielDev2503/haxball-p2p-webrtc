import { describe, it, expect, vi } from 'vitest';
import { PhysicsWorld } from '../../src/core/physics/PhysicsWorld';
import { PhysicsTicker } from '../../src/core/physics/PhysicsTicker';
import { Disc } from '../../src/core/entities/Disc';
import { Stadium } from '../../src/core/entities/Stadium';
import { PitchRenderer } from '../../src/render/PitchRenderer';
import { DiscRenderer } from '../../src/render/DiscRenderer';
import { StatsMonitor } from '../../src/ui/components/StatsMonitor';
import { GameEngine } from '../../src/core/game/GameEngine';
import { Player } from '../../src/core/game/Player';
import { JitterBuffer, hermite } from '../../src/net/transport/JitterBuffer';

describe('Performance and FPS Optimizations (Non-Host, Physics Replay & Canvas 2D)', () => {
  describe('A. GoalNet Bypass during Physics Replay', () => {
    it('PhysicsWorld.step with isReplay=true bypasses GoalNet mass-spring integration', () => {
      const world = new PhysicsWorld();
      const stadium = new Stadium();
      world.loadStadium(stadium);

      expect(world.goalNets.length).toBe(2);
      expect(world.goalNetLeft).toBeDefined();
      expect(world.goalNetRight).toBeDefined();

      const leftNetStepSpy = vi.spyOn(world.goalNets[0], 'step');
      const rightNetStepSpy = vi.spyOn(world.goalNets[1], 'step');

      // Normal step with isReplay=false: GoalNets should step
      world.step(1 / 60, false);
      expect(leftNetStepSpy).toHaveBeenCalledTimes(1);
      expect(rightNetStepSpy).toHaveBeenCalledTimes(1);

      // Replay step with isReplay=true: GoalNets step must NOT be called
      world.step(1 / 60, true);
      expect(leftNetStepSpy).toHaveBeenCalledTimes(1); // Still 1, not called again
      expect(rightNetStepSpy).toHaveBeenCalledTimes(1); // Still 1, not called again
    });

    it('PhysicsWorld.step integrates dynamic discs regardless of isReplay flag', () => {
      const world = new PhysicsWorld();
      const disc = new Disc({
        id: 1,
        x: 0,
        y: 0,
        radius: 15,
        mass: 1,
        damping: 0.96
      });
      disc.vel.set(60, 0);
      world.addDisc(disc);

      world.step(1 / 60, true);
      expect(disc.pos.x).toBeGreaterThan(0);
    });
  });

  describe('B. PhysicsTicker Death Spiral Protection', () => {
    it('caps raw delta to maxDelta = 0.1s (100ms)', () => {
      const ticker = new PhysicsTicker();
      let ticks = 0;
      ticker.onTick = () => { ticks++; };

      // Simulate a frozen tab returning after 1 second (1.0s raw delta)
      ticker.update(1.0);

      // Max steps is 4, each step consumes 1/60 (~0.0166s).
      // Since maxDelta is 0.1, accumulator starts at 0.1s.
      // 4 steps * (1/60) = 0.0666s. Remaining ~0.0333s is discarded because accumulator >= fixedStep.
      expect(ticks).toBe(4);
      expect(ticker.accumulator).toBe(0);
    });

    it('enforces MAX_STEPS_PER_FRAME = 4 and discards excess accumulator', () => {
      const ticker = new PhysicsTicker();
      let tickCount = 0;
      ticker.onTick = () => { tickCount++; };

      // Feed 0.1s (enough for 6 steps, but capped to 4 steps)
      ticker.update(0.1);

      expect(tickCount).toBe(4);
      // Residual accumulator (0.1 - 4*(1/60) = 0.0333s >= 1/60) must be discarded to 0
      expect(ticker.accumulator).toBe(0);
    });

    it('processes single tick normally under standard 60Hz delta (16.6ms)', () => {
      const ticker = new PhysicsTicker();
      let tickCount = 0;
      ticker.onTick = () => { tickCount++; };

      ticker.update(1 / 60);

      expect(tickCount).toBe(1);
      expect(ticker.accumulator).toBeCloseTo(0, 5);
    });
  });

  describe('C. Canvas 2D Pipeline Optimizations', () => {
    it('DiscRenderer does not use shadowBlur or shadowColor during render', () => {
      const renderer = new DiscRenderer();
      const mockCtx: any = {
        save: vi.fn(),
        restore: vi.fn(),
        beginPath: vi.fn(),
        arc: vi.fn(),
        fill: vi.fn(),
        stroke: vi.fn(),
        closePath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        strokeText: vi.fn(),
        fillText: vi.fn(),
        measureText: vi.fn(() => ({ width: 10 })),
        createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
        createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() }))
      };

      const playerDisc = {
        id: 1,
        x: 10,
        y: 20,
        vx: 5,
        vy: 0,
        radius: 15,
        team: 1 as const,
        avatar: '10',
        kicking: true,
        stamina: 80,
        isDashing: false,
        isTurbo: false
      };

      renderer.draw(mockCtx, [playerDisc], 1);

      expect(mockCtx.shadowBlur).toBeUndefined();
      expect(mockCtx.shadowColor).toBeUndefined();
    });

    it('PitchRenderer builds and reuses cached canvas for static field geometry', () => {
      const pitchRenderer = new PitchRenderer();
      const stadium = new Stadium();

      const mockCachedCtx: any = {
        save: vi.fn(),
        restore: vi.fn(),
        translate: vi.fn(),
        beginPath: vi.fn(),
        arc: vi.fn(),
        fill: vi.fn(),
        stroke: vi.fn(),
        fillRect: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        setLineDash: vi.fn(),
        createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() }))
      };

      const mockMainCtx: any = {
        save: vi.fn(),
        restore: vi.fn(),
        drawImage: vi.fn()
      };

      const originalCreateElement = (globalThis as any).document?.createElement;
      (globalThis as any).document = {
        createElement: (tag: string) => {
          if (tag === 'canvas') {
            return {
              width: 0,
              height: 0,
              getContext: () => mockCachedCtx
            };
          }
          return {};
        }
      };

      // First render: Builds cache and calls drawImage
      pitchRenderer.renderPitch(mockMainCtx, stadium);
      expect(mockMainCtx.drawImage).toHaveBeenCalledTimes(1);
      expect(pitchRenderer.cachedCanvas).not.toBeNull();

      // Second render with same stadium: Reuses cachedCanvas, does NOT rebuild
      pitchRenderer.renderPitch(mockMainCtx, stadium);
      expect(mockMainCtx.drawImage).toHaveBeenCalledTimes(2);

      if (originalCreateElement) {
        (globalThis as any).document.createElement = originalCreateElement;
      }
    });
  });

  describe('D. StatsMonitor DOM Update Throttling', () => {
    it('throttles DOM text mutation to 250ms interval while telemetry buffer updates every frame', () => {
      const mockCanvasEl: any = {
        width: 110,
        height: 28,
        getContext: () => ({
          clearRect: vi.fn(),
          fillRect: vi.fn(),
          beginPath: vi.fn(),
          moveTo: vi.fn(),
          lineTo: vi.fn(),
          stroke: vi.fn()
        })
      };

      const pingEl = { textContent: '' };
      const fpsEl = { textContent: '' };

      (globalThis as any).document = {
        getElementById: (id: string) => {
          if (id === 'statsSparkline') return mockCanvasEl;
          if (id === 'statsPingText') return pingEl;
          if (id === 'statsFpsText') return fpsEl;
          if (id === 'statsMonitor') return { appendChild: vi.fn() };
          return null;
        },
        createElement: (tag: string) => {
          if (tag === 'canvas') return mockCanvasEl;
          return { id: '', className: '', appendChild: vi.fn(), textContent: '' };
        },
        body: { appendChild: vi.fn() }
      };

      let simulatedTime = 1000;
      vi.spyOn(performance, 'now').mockImplementation(() => simulatedTime);

      const monitor = new StatsMonitor();

      // Frame 1 at t=1000ms: Initial DOM update fires
      monitor.update(30, 60);
      expect(fpsEl.textContent).toBe('Fps: 60');
      expect(pingEl.textContent).toContain('30ms');

      // Frame 2 at t=1050ms (50ms later): Throttled, DOM text should not update to new values
      monitor.update(80, 45);
      expect(fpsEl.textContent).toBe('Fps: 60'); // Unchanged due to throttling
      expect(monitor.getCurrentPing()).toBe(80); // Metric itself updated

      // Frame 3 at t=1200ms (200ms later): Still throttled (< 250ms)
      monitor.update(85, 40);
      expect(fpsEl.textContent).toBe('Fps: 60');

      // Frame 4 at t=1260ms (260ms later >= 250ms): Throttling window expired, DOM updates!
      simulatedTime = 1260;
      monitor.update(90, 55);
      expect(fpsEl.textContent).toBe('Fps: 55');
      expect(pingEl.textContent).toContain('90ms');
    });
  });

  describe('E. Adaptive Snapshot Broadcast Rate and Hermite Interpolation', () => {
    it('GameEngine.shouldBroadcastSnapshot maintains 60Hz (all ticks) for <= 3 players and 30Hz (alternating ticks) for >= 4 players', () => {
      const engine = new GameEngine();
      expect(engine.players.size).toBe(0);

      // <= 3 players: 60 Hz (broadcast every tick)
      expect(engine.getAdaptiveSnapshotRate()).toBe(60);
      expect(engine.shouldBroadcastSnapshot(0)).toBe(true);
      expect(engine.shouldBroadcastSnapshot(1)).toBe(true);
      expect(engine.shouldBroadcastSnapshot(2)).toBe(true);

      // Add 3 players
      engine.addPlayer(new Player({ id: 'p1', name: 'P1', avatar: '1', team: 'red' }));
      engine.addPlayer(new Player({ id: 'p2', name: 'P2', avatar: '2', team: 'blue' }));
      engine.addPlayer(new Player({ id: 'p3', name: 'P3', avatar: '3', team: 'spec' }));
      expect(engine.players.size).toBe(3);
      expect(engine.getAdaptiveSnapshotRate()).toBe(60);
      expect(engine.shouldBroadcastSnapshot(10)).toBe(true);
      expect(engine.shouldBroadcastSnapshot(11)).toBe(true);

      // Add 4th player: transitions to 30 Hz (even ticks only)
      engine.addPlayer(new Player({ id: 'p4', name: 'P4', avatar: '4', team: 'spec' }));
      expect(engine.players.size).toBe(4);
      expect(engine.getAdaptiveSnapshotRate()).toBe(30);
      expect(engine.shouldBroadcastSnapshot(0)).toBe(true);
      expect(engine.shouldBroadcastSnapshot(1)).toBe(false);
      expect(engine.shouldBroadcastSnapshot(2)).toBe(true);
      expect(engine.shouldBroadcastSnapshot(3)).toBe(false);
    });

    it('hermite cubic spline smoothly interpolates positions with C^1 derivative continuity', () => {
      // p0 = 0, p1 = 100, v0 = 0, v1 = 0, dt = 1s
      const mid = hermite(0, 100, 0, 0, 0.5, 1.0);
      expect(mid).toBe(50);

      // Boundary values
      expect(hermite(10, 20, 50, 50, 0, 0.033)).toBe(10);
      expect(hermite(10, 20, 50, 50, 1, 0.033)).toBe(20);

      // JitterBuffer interpolates discs using hermite
      const jb = new JitterBuffer(33, 30);
      const s0 = {
        tick: 1,
        matchPhase: 1, // PLAYING
        discs: [{ id: 0, team: 0, x: 0, y: 0, vx: 100, vy: 0, radius: 10 }]
      } as any;
      const s1 = {
        tick: 2,
        matchPhase: 1, // PLAYING
        discs: [{ id: 0, team: 0, x: 33.3, y: 0, vx: 100, vy: 0, radius: 10 }]
      } as any;

      jb.push(s0, 1000);
      jb.push(s1, 1033.3);

      const interp = jb.getInterpolatedSnapshot(1016.65 + 33);
      expect(interp).not.toBeNull();
      expect(interp!.discs[0].x).toBeGreaterThan(0);
      expect(interp!.discs[0].x).toBeLessThan(33.3);
    });
  });

  describe('F. Telemetry Handshake: Connection Type Display in StatsMonitor', () => {
    it('StatsMonitor displays Relayed (TURN Metered) vs Direct (STUN/P2P)', () => {
      const connEl = { textContent: '' };
      const pingEl = { textContent: '' };
      const fpsEl = { textContent: '' };
      const mockCanvasEl: any = {
        width: 110,
        height: 28,
        getContext: () => ({
          clearRect: vi.fn(),
          fillRect: vi.fn(),
          beginPath: vi.fn(),
          moveTo: vi.fn(),
          lineTo: vi.fn(),
          stroke: vi.fn()
        })
      };

      (globalThis as any).document = {
        getElementById: (id: string) => {
          if (id === 'statsConnText') return connEl;
          if (id === 'statsSparkline') return mockCanvasEl;
          if (id === 'statsPingText') return pingEl;
          if (id === 'statsFpsText') return fpsEl;
          if (id === 'statsMonitor') return { appendChild: vi.fn() };
          return null;
        },
        createElement: (tag: string) => {
          if (tag === 'canvas') return mockCanvasEl;
          return { id: '', className: '', appendChild: vi.fn(), textContent: '' };
        },
        body: { appendChild: vi.fn() }
      };

      const monitor = new StatsMonitor();
      monitor.update(25, 60, 16.6, 'Relayed (TURN Metered)');
      expect(monitor.currentConnectionType).toBe('Relayed (TURN Metered)');
      expect(connEl.textContent).toBe('Net: Relayed (TURN Metered)');

      // Update to Direct (STUN/P2P)
      monitor.update(10, 60, 16.6, 'Direct (STUN/P2P)');
      expect(monitor.currentConnectionType).toBe('Direct (STUN/P2P)');
    });
  });
});
