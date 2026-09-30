import { describe, it, expect, beforeEach } from 'vitest';
import { GameEngine } from '../../src/core/game/GameEngine';
import { Player, INPUT_KICK } from '../../src/core/game/Player';
import { MatchPhase } from '../../src/core/game/GameFSM';
import {
  DEFAULT_GAMEPLAY_CONFIG,
  sanitizeGameplayConfig,
  GAMEPLAY_CONFIG_LIMITS
} from '../../src/core/game/GameConfig';
import { $theme, setTheme, toggleTheme } from '../../src/ui/stores/gameStore';

describe('Gameplay Modifiers & Continuous A/D Magnus Physics Suite', () => {
  let engine: GameEngine;
  let player: Player;

  beforeEach(() => {
    engine = new GameEngine();
    player = new Player({ id: 'p1', name: 'HostTester', team: 'red', isHost: true });
    engine.addPlayer(player);
    engine.fsm.currentState = MatchPhase.PLAYING;
  });

  describe('Theme Store & Persistence', () => {
    it('toggles theme and persists correctly', () => {
      setTheme('light');
      expect($theme.get()).toBe('light');

      const toggled = toggleTheme();
      expect(toggled).toBe('dark');
      expect($theme.get()).toBe('dark');

      const toggledAgain = toggleTheme();
      expect(toggledAgain).toBe('light');
      expect($theme.get()).toBe('light');
    });
  });

  describe('GameConfig Sanitization & Sandbox Limits', () => {
    it('initializes with default config and falls back properly', () => {
      expect(engine.gameplayConfig).toEqual(DEFAULT_GAMEPLAY_CONFIG);
      expect(sanitizeGameplayConfig({})).toEqual(DEFAULT_GAMEPLAY_CONFIG);
    });

    it('clamps values below safe minimums to min limits', () => {
      const clamped = sanitizeGameplayConfig({
        playerMaxSpeed: 0.1, // min is 1.5
        playerAcceleration: 0.001, // min is 0.04
        kickStrength: 0.5, // min is 2.0
        playerRadius: 5.0, // min is 10.0
        ballRadius: 1.0, // min is 3.8
        ballRestitution: 0.05, // min is 0.15
        boostMultiplier: 0.5, // min is 1.2
        dashDistance: 10.0, // min is 40.0
        staminaRechargeRate: 2.0, // min is 10.0
        magnusCurveStrength: 0.01 // min is 0.08
      });

      expect(clamped.playerMaxSpeed).toBe(GAMEPLAY_CONFIG_LIMITS.playerMaxSpeed.min);
      expect(clamped.playerAcceleration).toBe(GAMEPLAY_CONFIG_LIMITS.playerAcceleration.min);
      expect(clamped.kickStrength).toBe(GAMEPLAY_CONFIG_LIMITS.kickStrength.min);
      expect(clamped.playerRadius).toBe(GAMEPLAY_CONFIG_LIMITS.playerRadius.min);
      expect(clamped.ballRadius).toBe(GAMEPLAY_CONFIG_LIMITS.ballRadius.min);
      expect(clamped.ballRestitution).toBe(GAMEPLAY_CONFIG_LIMITS.ballRestitution.min);
      expect(clamped.boostMultiplier).toBe(GAMEPLAY_CONFIG_LIMITS.boostMultiplier.min);
      expect(clamped.dashDistance).toBe(GAMEPLAY_CONFIG_LIMITS.dashDistance.min);
      expect(clamped.staminaRechargeRate).toBe(GAMEPLAY_CONFIG_LIMITS.staminaRechargeRate.min);
      expect(clamped.magnusCurveStrength).toBe(GAMEPLAY_CONFIG_LIMITS.magnusCurveStrength.min);
    });

    it('clamps values above safe maximums to max limits', () => {
      const clamped = sanitizeGameplayConfig({
        playerMaxSpeed: 99.0, // max is 5.5
        playerAcceleration: 5.0, // max is 0.28
        kickStrength: 50.0, // max is 9.0
        playerRadius: 100.0, // max is 26.0
        ballRadius: 50.0, // max is 12.0
        ballRestitution: 1.5, // max is 0.92
        boostMultiplier: 10.0, // max is 3.0
        dashDistance: 500.0, // max is 140.0
        staminaRechargeRate: 200.0, // max is 70.0
        magnusCurveStrength: 2.0 // max is 0.70
      });

      expect(clamped.playerMaxSpeed).toBe(GAMEPLAY_CONFIG_LIMITS.playerMaxSpeed.max);
      expect(clamped.playerAcceleration).toBe(GAMEPLAY_CONFIG_LIMITS.playerAcceleration.max);
      expect(clamped.kickStrength).toBe(GAMEPLAY_CONFIG_LIMITS.kickStrength.max);
      expect(clamped.playerRadius).toBe(GAMEPLAY_CONFIG_LIMITS.playerRadius.max);
      expect(clamped.ballRadius).toBe(GAMEPLAY_CONFIG_LIMITS.ballRadius.max);
      expect(clamped.ballRestitution).toBe(GAMEPLAY_CONFIG_LIMITS.ballRestitution.max);
      expect(clamped.boostMultiplier).toBe(GAMEPLAY_CONFIG_LIMITS.boostMultiplier.max);
      expect(clamped.dashDistance).toBe(GAMEPLAY_CONFIG_LIMITS.dashDistance.max);
      expect(clamped.staminaRechargeRate).toBe(GAMEPLAY_CONFIG_LIMITS.staminaRechargeRate.max);
      expect(clamped.magnusCurveStrength).toBe(GAMEPLAY_CONFIG_LIMITS.magnusCurveStrength.max);
    });

    it('dynamically reconfigures GameEngine and PhysicsWorld parameters in real time', () => {
      engine.setGameplayConfig({
        ballRadius: 8.5,
        ballRestitution: 0.85
      });

      expect(engine.gameplayConfig.ballRadius).toBe(8.5);
      expect(engine.ball.radius).toBe(8.5);
      expect(engine.ball.bounciness).toBe(0.85);
    });
  });

  describe('Continuous A/D Relative Magnus Curve', () => {
    it('curves the ball laterally to the left when kicker presses Key A (curveInput = 1)', () => {
      const disc = engine.playerDiscs.get('p1')!;
      // Player kicks ball forwards (+X)
      disc.pos.set(-25, 0);
      disc.prevPos.set(-25, 0);
      disc.vel.set(0, 0);

      engine.ball.pos.set(0, 0);
      engine.ball.prevPos.set(0, 0);
      engine.ball.vel.set(0, 0);

      // Initial kick with no curve
      const kickInputs = new Map<string, number>();
      kickInputs.set('p1', INPUT_KICK);
      engine.tick(kickInputs);

      expect(engine.ball.isCurvingAllowed).toBe(true);
      expect(engine.ball.lastKickerId).toBe('p1');
      expect(engine.ball.kickerHeading).not.toBeNull();

      // In-flight: player steers curve continuously with Key A (curveInput = 1)
      player.curveInput = 1;
      const initialVy = engine.ball.vel.y;

      for (let i = 0; i < 20; i++) {
        engine.tick(new Map());
      }

      // Ball curves along u_izq = (0, -1) in screen coordinates -> vel.y develops towards top (negative)
      expect(engine.ball.vel.y).toBeLessThan(initialVy);
      expect(engine.ball.pos.y).toBeLessThan(-1.0);
    });

    it('curves the ball laterally to the right when kicker presses Key D (curveInput = 2)', () => {
      const disc = engine.playerDiscs.get('p1')!;
      // Player kicks ball forwards (+X)
      disc.pos.set(-25, 0);
      disc.prevPos.set(-25, 0);
      disc.vel.set(0, 0);

      engine.ball.pos.set(0, 0);
      engine.ball.prevPos.set(0, 0);
      engine.ball.vel.set(0, 0);

      // Initial kick with no curve
      const kickInputs = new Map<string, number>();
      kickInputs.set('p1', INPUT_KICK);
      engine.tick(kickInputs);

      expect(engine.ball.isCurvingAllowed).toBe(true);

      // In-flight: player steers curve continuously with Key D (curveInput = 2)
      player.curveInput = 2;
      const initialVy = engine.ball.vel.y;

      for (let i = 0; i < 20; i++) {
        engine.tick(new Map());
      }

      // Ball curves along u_der = (0, 1) in screen coordinates -> vel.y develops towards bottom (positive)
      expect(engine.ball.vel.y).toBeGreaterThan(initialVy);
      expect(engine.ball.pos.y).toBeGreaterThan(1.0);
    });

    it('extinguishes isCurvingAllowed as soon as ball collides with another entity', () => {
      engine.ball.isCurvingAllowed = true;
      engine.ball.lastKickerId = 'p1';
      engine.ball.lastKickerDiscId = -1; // Ball already separated from kicker

      // Collision with a post or another player clears curve
      engine.ball.resetCurve();
      expect(engine.ball.isCurvingAllowed).toBe(false);
      expect(engine.ball.lastKickerId).toBeNull();
    });
  });
});
