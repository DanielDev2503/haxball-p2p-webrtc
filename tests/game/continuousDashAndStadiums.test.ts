import { describe, it, expect } from 'vitest';
import { StadiumRegistry, createStadium } from '../../src/core/stadiums/StadiumRegistry';
import { Camera } from '../../src/render/Camera';
import { GameEngine } from '../../src/core/game/GameEngine';
import { MatchPhase } from '../../src/core/game/GameFSM';
import { Player, INPUT_UP, INPUT_RIGHT, INPUT_DASH, INPUT_MAGNUS_RIGHT } from '../../src/core/game/Player';
import { Disc, COLLISION_GROUP_BALL, COLLISION_GROUP_RED, COLLISION_GROUP_BLUE, COLLISION_GROUP_WALL } from '../../src/core/entities/Disc';
import { InputPacket } from '../../src/net/protocol/InputPacket';

describe('Mission Engineering Suite: Continuous Vector Dash, Stadiums, Camera & Magnus', () => {
  describe('1. Stadium Registry & Dual Boundary Geometry', () => {
    it('defines 3 valid stadium sizes (small, classic, big) with accurate dimensions', () => {
      expect(StadiumRegistry.small).toBeDefined();
      expect(StadiumRegistry.small.width).toBe(1000);
      expect(StadiumRegistry.small.height).toBe(460);
      expect(StadiumRegistry.small.goalWidth).toBe(140);

      expect(StadiumRegistry.classic).toBeDefined();
      expect(StadiumRegistry.classic.width).toBe(1200);
      expect(StadiumRegistry.classic.height).toBe(540);
      expect(StadiumRegistry.classic.goalWidth).toBe(170);

      expect(StadiumRegistry.big).toBeDefined();
      expect(StadiumRegistry.big.width).toBe(1600);
      expect(StadiumRegistry.big.height).toBe(720);
      expect(StadiumRegistry.big.goalWidth).toBe(200);
    });

    it('creates stadium with dual boundary (pitch lines for ball vs run-off 45px for players)', () => {
      const stadium = createStadium('small');
      expect(stadium.width).toBe(1000);
      expect(stadium.height).toBe(460);
      expect(stadium.runOff).toBe(45);

      // Pitch segments (inner boundary) must only collide with ball
      const pitchLineSegments = stadium.segments.filter(s => s.cGroup === COLLISION_GROUP_WALL && s.cMask === COLLISION_GROUP_BALL);
      expect(pitchLineSegments.length).toBeGreaterThan(0);
      pitchLineSegments.forEach(s => {
        expect(s.visible).toBe(true);
      });

      // Outer perimeter segments (run-off boundary) must be invisible and only collide with players
      const outerSegments = stadium.segments.filter(s => !s.visible);
      expect(outerSegments.length).toBeGreaterThan(0);
      outerSegments.forEach(s => {
        expect(s.cMask).toBe(COLLISION_GROUP_RED | COLLISION_GROUP_BLUE);
      });
    });
  });

  describe('2. Continuous Vector Dash & Stamina Deduction', () => {
    it('orients dash dynamically along current velocity vector when |v| > 0.05', () => {
      const engine = new GameEngine();
      engine.fsm.currentState = MatchPhase.PLAYING;
      const player = new Player({ id: 'p1', name: 'Tester', team: 'red', isHost: true });
      engine.addPlayer(player);
      const disc = engine.playerDiscs.get('p1')!;

      // Impart diagonal physical velocity (30, 40) -> |v| = 50 > 0.05
      disc.vel.set(30, 40);
      disc.pos.set(0, 0);

      // Trigger Dash with NO direction keys pressed
      const inputs = new Map<string, number>();
      inputs.set('p1', INPUT_DASH);
      engine.tick(inputs);

      // Dash direction should match v / |v| = (0.6, 0.8)
      expect(player.dashDirX).toBeCloseTo(0.6, 3);
      expect(player.dashDirY).toBeCloseTo(0.8, 3);
      expect(player.stamina).toBe(50);
      expect(player.isDashing).toBe(true);
    });

    it('orients dash along direction keys when disc is stationary (|v| <= 0.05)', () => {
      const engine = new GameEngine();
      engine.fsm.currentState = MatchPhase.PLAYING;
      const player = new Player({ id: 'p1', name: 'Tester', team: 'red', isHost: true });
      engine.addPlayer(player);
      const disc = engine.playerDiscs.get('p1')!;

      disc.vel.set(0, 0);
      disc.pos.set(0, 0);

      // Trigger Dash with UP and RIGHT keys pressed -> diagonal (1/sqrt(2), -1/sqrt(2))
      const inputs = new Map<string, number>();
      inputs.set('p1', INPUT_DASH | INPUT_UP | INPUT_RIGHT);
      engine.tick(inputs);

      expect(player.dashDirX).toBeCloseTo(Math.SQRT1_2, 3);
      expect(player.dashDirY).toBeCloseTo(-Math.SQRT1_2, 3);
      expect(player.stamina).toBe(50);
    });

    it('orients dash towards rival goal when disc is stationary and no keys are pressed', () => {
      const engine = new GameEngine();
      engine.fsm.currentState = MatchPhase.PLAYING;
      const redPlayer = new Player({ id: 'p1', name: 'Red', team: 'red' });
      const bluePlayer = new Player({ id: 'p2', name: 'Blue', team: 'blue' });
      engine.addPlayer(redPlayer);
      engine.addPlayer(bluePlayer);

      const redDisc = engine.playerDiscs.get('p1')!;
      const blueDisc = engine.playerDiscs.get('p2')!;

      redDisc.vel.set(0, 0);
      blueDisc.vel.set(0, 0);

      const inputs = new Map<string, number>();
      inputs.set('p1', INPUT_DASH);
      inputs.set('p2', INPUT_DASH);
      engine.tick(inputs);

      // Red dashes towards +X (blue goal), Blue dashes towards -X (red goal)
      expect(redPlayer.dashDirX).toBe(1);
      expect(redPlayer.dashDirY).toBe(0);

      expect(bluePlayer.dashDirX).toBe(-1);
      expect(bluePlayer.dashDirY).toBe(0);
    });

    it('applies calibrated 37.5 px displacement with at least 4 substeps in PhysicsWorld during dash', () => {
      const engine = new GameEngine();
      engine.fsm.currentState = MatchPhase.PLAYING;
      const player = new Player({ id: 'p1', name: 'Tester', team: 'red', isHost: true });
      engine.addPlayer(player);
      engine.ball.pos.set(1000, 1000);
      const disc = engine.playerDiscs.get('p1')!;
      disc.pos.set(0, 0);
      disc.prevPos.set(0, 0);
      disc.vel.set(0, 0);

      let substepCallsInTick = 0;
      engine.physicsWorld.onSubstep = () => {
        substepCallsInTick++;
      };

      const inputs = new Map<string, number>();
      inputs.set('p1', INPUT_DASH | INPUT_RIGHT);

      // Tick 1
      substepCallsInTick = 0;
      engine.tick(inputs);
      expect(substepCallsInTick).toBeGreaterThanOrEqual(4);

      // Remaining 3 ticks
      inputs.set('p1', 0);
      for (let i = 0; i < 3; i++) {
        substepCallsInTick = 0;
        engine.tick(inputs);
        expect(substepCallsInTick).toBeGreaterThanOrEqual(4);
      }

      expect(player.isDashing).toBe(false);
      expect(disc.pos.x).toBeGreaterThanOrEqual(36.0);
      expect(disc.pos.x).toBeLessThanOrEqual(38.4);
    });
  });

  describe('3. Dynamic Camera & Smooth Tracking', () => {
    it('applies exponential smoothing (lerp factor 0.12) towards target position', () => {
      const camera = new Camera(0, 0);
      expect(camera.x).toBe(0);
      expect(camera.y).toBe(0);

      camera.follow(100, 200);
      // First frame: 0 + (100 - 0) * 0.12 = 12
      expect(camera.x).toBeCloseTo(12, 4);
      expect(camera.y).toBeCloseTo(24, 4);

      camera.follow(100, 200);
      // Second frame: 12 + (100 - 12) * 0.12 = 22.56
      expect(camera.x).toBeCloseTo(22.56, 4);
      expect(camera.y).toBeCloseTo(45.12, 4);
    });

    it('clamps camera within outer stadium perimeter to prevent rendering empty void', () => {
      const camera = new Camera(800, 500);
      const wExt = 1200 + 45 * 2; // 1290
      const hExt = 540 + 45 * 2;  // 630
      const vWidth = 800;
      const vHeight = 500;

      // BoundX = (1290 - 800) / 2 = 245
      // BoundY = (630 - 500) / 2 = 65
      camera.clamp(wExt, hExt, vWidth, vHeight);

      expect(camera.x).toBe(245);
      expect(camera.y).toBe(65);
    });

    it('centers camera on origin if canvas viewport is larger than stadium size', () => {
      const camera = new Camera(100, 50);
      const wExt = 1000;
      const hExt = 460;
      const vWidth = 1200; // Larger than stadium
      const vHeight = 800; // Larger than stadium

      camera.clamp(wExt, hExt, vWidth, vHeight);
      expect(camera.x).toBe(0);
      expect(camera.y).toBe(0);
    });
  });

  describe('4. Corrected Magnus Normal Vectors', () => {
    it('applies perpendicular acceleration u_izq = (u_y, -u_x) and u_der = (-u_y, u_x)', () => {
      const ball = new Disc({
        id: 0,
        x: 0,
        y: 0,
        radius: 10,
        mass: 1,
        isBall: true,
        cGroup: COLLISION_GROUP_BALL
      });
      ball.isCurvingAllowed = true;

      // Case 1: Ball moving along +X -> u = (1, 0)
      // u_izq = (0, -1) -> vel.y should decrease by kMagnus
      ball.vel.set(100, 0);
      ball.applyMagnusCurve(true, false, 0.35);
      expect(ball.vel.x).toBe(100);
      expect(ball.vel.y).toBeCloseTo(-0.35, 4);

      // Case 2: Ball moving along +Y -> u = (0, 1)
      // u_der = (-u_y, u_x) = (-1, 0) -> vel.x should decrease by kMagnus
      ball.vel.set(0, 100);
      ball.applyMagnusCurve(false, true, 0.35);
      expect(ball.vel.x).toBeCloseTo(-0.35, 4);
      expect(ball.vel.y).toBe(100);
    });
  });

  describe('5. Clean 9-bit Bitmask Serialization without Collisions', () => {
    it('encodes and decodes all 9 action bits across Uint16 without overlap', () => {
      const input = {
        sequence: 1234,
        inputMask: 0,
        clientTimestamp: 34567,
        isTurbo: true,
        triggerDash: true,
        curveInput: 2 // Magnus Right
      };

      const buffer = InputPacket.encode(input);
      expect(buffer.byteLength).toBe(9);

      const decoded = InputPacket.decode(buffer);
      expect(decoded).not.toBeNull();
      expect(decoded!.sequence).toBe(1234);
      expect(decoded!.isTurbo).toBe(true);
      expect(decoded!.triggerDash).toBe(true);
      expect(decoded!.curveInput).toBe(2);
      expect(decoded!.curveX).toBe(1);
      expect((decoded!.inputMask & INPUT_MAGNUS_RIGHT)).not.toBe(0);
    });
  });
});
