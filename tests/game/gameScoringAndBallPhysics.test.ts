import { describe, it, expect, beforeEach } from 'vitest';
import { GameEngine } from '../../src/core/game/GameEngine';
import { Player, INPUT_KICK } from '../../src/core/game/Player';
import { MatchPhase } from '../../src/core/game/GameFSM';
import { POWER_SHOT_SPEED_THRESHOLD } from '../../src/core/entities/Disc';
import { MatchStatsModal } from '../../src/ui/components/MatchStatsModal';

describe('Game Scoring Engine & Ball Kinematics (Phase 1)', () => {
  let engine: GameEngine;
  let pRed1: Player;
  let pRed2: Player;
  let pBlue1: Player;
  let pBlue2: Player;

  beforeEach(() => {
    engine = new GameEngine();
    pRed1 = new Player({ id: 'r1', name: 'Ronaldo', team: 'red', isHost: true });
    pRed2 = new Player({ id: 'r2', name: 'Messi', team: 'red' });
    pBlue1 = new Player({ id: 'b1', name: 'Buffon', team: 'blue' });
    pBlue2 = new Player({ id: 'b2', name: 'Zidane', team: 'blue' });

    engine.addPlayer(pRed1);
    engine.addPlayer(pRed2);
    engine.addPlayer(pBlue1);
    engine.addPlayer(pBlue2);

    engine.fsm.currentState = MatchPhase.PLAYING;
  });

  describe('1. Magnus Effect Limits (Max 2 Presses & 3.0s Timer)', () => {
    it('initializes magnus controller, 2 presses and 3.0s timer when ball is kicked', () => {
      const disc = engine.playerDiscs.get('r1')!;
      disc.pos.set(-25, 0);
      engine.ball.pos.set(0, 0);

      const inputs = new Map<string, number>();
      inputs.set('r1', INPUT_KICK);
      engine.tick(inputs);

      expect(engine.ball.magnusControllerId).toBe('r1');
      expect(engine.ball.magnusPressesRemaining).toBe(2);
      expect(engine.ball.magnusTimer).toBeCloseTo(3.0, 1);
    });

    it('allows at most 2 directional curve presses, blocking the 3rd attempt', () => {
      const disc = engine.playerDiscs.get('r1')!;
      disc.pos.set(-25, 0);
      engine.ball.pos.set(0, 0);

      const kickInputs = new Map<string, number>();
      kickInputs.set('r1', INPUT_KICK);
      engine.tick(kickInputs);

      expect(engine.ball.magnusPressesRemaining).toBe(2);

      // 1st press: curveLeft (curveInput = 1)
      pRed1.curveInput = 1;
      engine.tick(new Map());
      expect(engine.ball.magnusPressesRemaining).toBe(1);
      expect(engine.ball.isCurving).toBe(true);

      // Release key
      pRed1.curveInput = 0;
      engine.tick(new Map());
      expect(engine.ball.magnusPressesRemaining).toBe(1);
      expect(engine.ball.isCurving).toBe(false);

      // 2nd press: curveRight (curveInput = -1)
      pRed1.curveInput = -1;
      engine.tick(new Map());
      expect(engine.ball.magnusPressesRemaining).toBe(0);
      expect(engine.ball.isCurving).toBe(true);

      // Release key
      pRed1.curveInput = 0;
      engine.tick(new Map());
      expect(engine.ball.magnusPressesRemaining).toBe(0);
      expect(engine.ball.isCurving).toBe(false);

      // 3rd press attempt: curveLeft (curveInput = 1) -> must be blocked!
      pRed1.curveInput = 1;
      engine.tick(new Map());
      expect(engine.ball.magnusPressesRemaining).toBe(0);
      expect(engine.ball.isCurving).toBe(false);
      expect(engine.ball.spin).toBe(0);
    });

    it('revokes aerodynamic control after 3.0 seconds (180 ticks)', () => {
      const disc = engine.playerDiscs.get('r1')!;
      disc.pos.set(-25, 0);
      engine.ball.pos.set(0, 0);

      const kickInputs = new Map<string, number>();
      kickInputs.set('r1', INPUT_KICK);
      engine.tick(kickInputs);

      expect(engine.ball.magnusTimer).toBeGreaterThan(0);

      // Simulate 185 ticks (~3.08 seconds)
      for (let i = 0; i < 185; i++) {
        engine.tick(new Map());
      }

      expect(engine.ball.magnusTimer).toBe(0);

      // Player attempts to curve now:
      pRed1.curveInput = 1;
      engine.tick(new Map());
      expect(engine.ball.isCurving).toBe(false);
      expect(engine.ball.spin).toBe(0);
    });
  });

  describe('2. Power Shot Threshold', () => {
    it('activates isPowerShot when ball speed >= 700 px/s', () => {
      engine.ball.vel.set(750, 0);
      const speed = Math.hypot(engine.ball.vel.x, engine.ball.vel.y);
      expect(speed).toBeGreaterThanOrEqual(POWER_SHOT_SPEED_THRESHOLD);

      // Register touch with high speed
      engine.registerBallTouch('r1', false);
      expect(engine.ball.isPowerShot).toBe(true);
    });

    it('deactivates isPowerShot when ball speed < 700 px/s', () => {
      engine.ball.vel.set(500, 0);
      engine.registerBallTouch('r1', false);
      expect(engine.ball.isPowerShot).toBe(false);
    });
  });

  describe('3. Cumulative Scoring Engine', () => {
    it('awards +2 pts per ball touch with cooldown', () => {
      engine.registerBallTouch('r1');
      const stats = engine.getOrCreatePlayerStats('r1');
      expect(stats.points).toBe(2);
      expect(stats.touches).toBe(1);

      // Immediate touch within cooldown (< 15 ticks) should not award points again
      engine.registerBallTouch('r1');
      expect(stats.points).toBe(2);
      expect(stats.touches).toBe(1);

      // Advance 16 ticks
      for (let i = 0; i < 16; i++) {
        engine.tick(new Map());
      }

      // Next touch after cooldown
      engine.registerBallTouch('r1');
      expect(stats.points).toBe(4);
      expect(stats.touches).toBe(2);
    });

    it('awards +10 pts for completed pass between teammates', () => {
      engine.registerBallTouch('r1');
      const r1Stats = engine.getOrCreatePlayerStats('r1');
      expect(r1Stats.points).toBe(2);

      // Advance ticks
      for (let i = 0; i < 16; i++) engine.tick(new Map());

      // Teammate touches ball
      engine.registerBallTouch('r2');
      const r2Stats = engine.getOrCreatePlayerStats('r2');
      expect(r2Stats.points).toBe(2);
      expect(r1Stats.passes).toBe(1);
      expect(r1Stats.points).toBe(12); // 2 touch + 10 pass
    });

    it('strictly awards save (+100 pts) only if intercepted in own half', () => {
      const redGoal = engine.stadium.goals[0]; // Left goal (x around -370)
      const blueGoal = engine.stadium.goals[1]; // Right goal (x around +370)
      expect(redGoal).toBeDefined();
      expect(blueGoal).toBeDefined();

      // Case A: Ronaldo (red) shoots at blue goal.
      // Buffon (blue) intercepts at x = 100 (in blue's own half: x >= 0 for blue defender)
      engine.ball.pos.set(50, 0);
      engine.ball.vel.set(300, 0); // heading towards blue goal on right
      engine.registerBallTouch('r1', true); // r1 shot

      for (let i = 0; i < 16; i++) engine.tick(new Map());
      const buffonDisc = engine.playerDiscs.get('b1')!;
      buffonDisc.pos.set(100, 0); // in blue half (x >= 0)
      engine.ball.pos.set(100, 0);

      // Buffon intercepts
      engine.registerBallTouch('b1', false);

      const buffonStats = engine.getOrCreatePlayerStats('b1');
      expect(buffonStats.saves).toBe(1);
      expect(buffonStats.points).toBe(102); // 2 touch + 100 save

      // Case B: Zidane (blue) shoots at red goal.
      // Ronaldo (red) intercepts at x = 100 (in opponent half! x > 0, NOT red own half)
      engine.ball.pos.set(0, 0);
      engine.ball.vel.set(-300, 0); // heading towards red goal on left
      engine.registerBallTouch('b2', true); // b2 shot

      const ronaldoDisc = engine.playerDiscs.get('r1')!;
      ronaldoDisc.pos.set(100, 0); // in opponent half (x > 0)
      engine.ball.pos.set(100, 0);

      for (let i = 0; i < 16; i++) engine.tick(new Map());
      const ronaldoStats = engine.getOrCreatePlayerStats('r1');
      const r1PrevSaves = ronaldoStats.saves || 0;
      const r1PrevPoints = ronaldoStats.points;
      engine.registerBallTouch('r1', false);

      expect(ronaldoStats.saves).toBe(r1PrevSaves); // Save rejected!
      expect(ronaldoStats.points).toBe(r1PrevPoints + 2); // Only touch awarded

      // Case C: Ronaldo (red) intercepts in own half (x = -50 <= 0)
      ronaldoDisc.pos.set(-50, 0);
      engine.ball.pos.set(-50, 0);
      engine.ball.vel.set(-300, 0);
      engine.registerBallTouch('b2', true); // b2 shot again

      for (let i = 0; i < 16; i++) engine.tick(new Map());
      engine.registerBallTouch('r1', false);
      expect(ronaldoStats.saves).toBe(r1PrevSaves + 1); // Save granted!
      expect(ronaldoStats.points).toBeGreaterThanOrEqual(100);
    });

    it('awards +50 for normal assist and +70 for curve assist, +100 for goal', () => {
      // Normal assist: r2 passes to r1, then goal
      engine.registerBallTouch('r2', false);
      for (let i = 0; i < 16; i++) engine.tick(new Map());

      engine.ball.vel.set(400, 0);
      engine.registerBallTouch('r1', true); // r1 shot

      const r1Stats = engine.getOrCreatePlayerStats('r1');
      const r2Stats = engine.getOrCreatePlayerStats('r2');
      const r1PointsBeforeGoal = r1Stats.points;
      const r2PointsBeforeGoal = r2Stats.points;

      // Simulate ball crossing blue goal line
      const blueGoal = engine.stadium.goals[1];
      engine.ball.pos.set(blueGoal.p0.x + 10, 0);

      // Trigger goal check in engine tick
      engine.fsm.currentState = MatchPhase.PLAYING;
      engine.tick(new Map());

      expect(r1Stats.goals).toBe(1);
      expect(r1Stats.points).toBe(r1PointsBeforeGoal + 100); // +100 goal

      expect(r2Stats.assists).toBe(1);
      expect(r2Stats.points).toBe(r2PointsBeforeGoal + 50); // +50 normal assist
    });

    it('awards +70 for assist with active curve (wasCurve = true)', () => {
      // Curve assist: r2 passes with curve active
      engine.ball.spin = 3.5;
      engine.registerBallTouch('r2', false);
      for (let i = 0; i < 16; i++) engine.tick(new Map());

      engine.ball.spin = 0;
      engine.ball.vel.set(400, 0);
      engine.registerBallTouch('r1', true);

      const r2Stats = engine.getOrCreatePlayerStats('r2');
      const r2PointsBefore = r2Stats.points;

      const blueGoal = engine.stadium.goals[1];
      engine.ball.pos.set(blueGoal.p0.x + 10, 0);
      engine.fsm.currentState = MatchPhase.PLAYING;
      engine.tick(new Map());

      expect(r2Stats.assists).toBe(1);
      expect(r2Stats.points).toBe(r2PointsBefore + 70); // +70 assist with curve
    });

    it('awards hattrick bonus (+100 pts) once when reaching 3 goals', () => {
      const stats = engine.getOrCreatePlayerStats('r1');
      stats.goals = 2;
      stats.points = 200;

      engine.checkHattrickBonus(stats);
      expect(stats.hasHattrickBonus).toBe(false);
      expect(stats.points).toBe(200);

      stats.goals = 3;
      engine.checkHattrickBonus(stats);
      expect(stats.hasHattrickBonus).toBe(true);
      expect(stats.points).toBe(300); // 200 + 100 bonus

      // Re-triggering does not award bonus again
      stats.goals = 4;
      engine.checkHattrickBonus(stats);
      expect(stats.points).toBe(300);
    });
  });

  describe('4. MVP Determination & MatchStatsModal Presentation', () => {
    it('correctly selects MVP based on highest total score', () => {
      const s1 = engine.getOrCreatePlayerStats('r1');
      const s2 = engine.getOrCreatePlayerStats('r2');
      const s3 = engine.getOrCreatePlayerStats('b1');

      s1.points = 180;
      s2.points = 320;
      s3.points = 110;

      const mvp = engine.getMVP();
      expect(mvp).not.toBeNull();
      expect(mvp?.playerId).toBe('r2');
      expect(mvp?.points).toBe(320);
    });

    it('MatchStatsModal renders table ranked by points and crowns the MVP', () => {
      const createdElements: Record<string, any> = {};
      const mockElement = (tag: string) => {
        const el: any = {
          tagName: tag.toUpperCase(),
          id: '',
          className: '',
          style: {},
          children: [] as any[],
          innerHTML: '',
          appendChild: (c: any) => {
            if (c.id) createdElements[c.id] = c;
            if (c.className && c.className.includes('match-stats-card')) createdElements['match-stats-card'] = c;
            el.children.push(c);
            return c;
          },
          removeChild: () => {},
          querySelector: (sel: string) => {
            if (sel === '.match-stats-card') return createdElements['match-stats-card'];
            return null;
          },
          addEventListener: () => {}
        };
        return el;
      };

      const originalDoc = (globalThis as any).document;
      const bodyEl = mockElement('body');
      (globalThis as any).document = {
        body: bodyEl,
        getElementById: (id: string) => createdElements[id] || null,
        createElement: (tag: string) => mockElement(tag)
      };

      const modal = new MatchStatsModal();
      const statsList = [
        {
          playerId: 'p1',
          playerName: 'Alpha',
          team: 'red' as const,
          points: 120,
          goals: 1,
          assists: 0,
          passes: 2,
          saves: 0,
          shots: 2,
          touches: 10,
          hasHattrickBonus: false
        },
        {
          playerId: 'p2',
          playerName: 'Beta',
          team: 'blue' as const,
          points: 350,
          goals: 2,
          assists: 1,
          passes: 5,
          saves: 1,
          shots: 4,
          touches: 20,
          hasHattrickBonus: false
        }
      ];

      modal.show(statsList);
      expect(modal.isOpen()).toBe(true);

      const overlay = (globalThis as any).document.getElementById('matchStatsModal');
      expect(overlay).not.toBeNull();
      const card = overlay.children.find((c: any) => c.className?.includes('match-stats-card')) || overlay;
      expect(card.innerHTML).toContain('Beta');
      expect(card.innerHTML).toContain('MVP');
      expect(card.innerHTML).toContain('350');
      expect(card.innerHTML).toContain('👑');

      modal.close();
      expect(modal.isOpen()).toBe(false);
      modal.destroy();

      (globalThis as any).document = originalDoc;
    });
  });
});
