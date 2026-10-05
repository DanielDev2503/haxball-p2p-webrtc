import { describe, it, expect } from 'vitest';
import { GoalNet } from '../../src/core/entities/GoalNet';
import { GameEngine } from '../../src/core/game/GameEngine';
import { MatchPhase } from '../../src/core/game/GameFSM';
import { Player } from '../../src/core/game/Player';

describe('Stadium Box Net Model (4 Rigid Anchors, Anti-Loop Bending & Unilateral Containment)', () => {
  describe('1. 4-Anchor Geometry and Structural Topology', () => {
    it('constructs 4 rigid anchors (invMass = 0) and 13 curtain nodes with gentle rest concavity', () => {
      const netLeft = new GoalNet({
        side: 'left',
        mouthX: -600,
        backX: -636,
        depth: 36,
        topY: -85,
        bottomY: 85,
        nodeCount: 13
      });

      // Front posts: P_top and P_bottom
      expect(netLeft.pTopX).toBe(-600);
      expect(netLeft.pTopY).toBe(-85);
      expect(netLeft.pBottomX).toBe(-600);
      expect(netLeft.pBottomY).toBe(85);

      // Rear corners: S_top and S_bottom
      expect(netLeft.sTopX).toBe(-636);
      expect(netLeft.sTopY).toBe(-85);
      expect(netLeft.sBottomX).toBe(-636);
      expect(netLeft.sBottomY).toBe(85);

      // Curtain anchors at rear corners have invMass = 0
      expect(netLeft.invMass[0]).toBe(0);
      expect(netLeft.invMass[12]).toBe(0);
      expect(netLeft.restPosX[0]).toBe(-636);
      expect(netLeft.restPosY[0]).toBe(-85);
      expect(netLeft.restPosX[12]).toBe(-636);
      expect(netLeft.restPosY[12]).toBe(85);

      // Dynamic nodes have mass m = 0.40 => invMass = 2.5
      for (let i = 1; i <= 11; i++) {
        expect(netLeft.invMass[i]).toBeCloseTo(1 / 0.40, 2);
      }

      // Middle node has gentle concavity towards rear (X <= -636) and Y ≈ 0
      expect(netLeft.restPosX[6]).toBeLessThanOrEqual(-636);
      expect(netLeft.restPosY[6]).toBeCloseTo(0, 1);

      // Monotonic Y ordering at rest
      for (let i = 0; i < 12; i++) {
        expect(netLeft.restPosY[i + 1]).toBeGreaterThan(netLeft.restPosY[i]);
      }
    });
  });

  describe('2. Anti-Loop Bending Constraints (Second-Neighbor PBD)', () => {
    it('prevents net chain from collapsing, knotting or forming loops under extreme point force', () => {
      const net = new GoalNet({
        side: 'left',
        mouthX: -600,
        backX: -636,
        topY: -85,
        bottomY: 85,
        nodeCount: 13
      });

      // Attempt to violently compress alternate nodes together (simulating loop/knot condition)
      net.posX[5] = -636;
      net.posY[5] = -10;
      net.posX[7] = -636;
      net.posY[7] = -8; // Artificially close together (dist = 2px, while rest is ~28px)

      // Step physics relaxation
      net.step(1 / 60);

      // Bending constraint must enforce d_b >= L_bend * 0.85
      const dxb = net.posX[7] - net.posX[5];
      const dyb = net.posY[7] - net.posY[5];
      const distBend = Math.hypot(dxb, dyb);
      const minAllowed = net.restLenBend[5] * 0.85;

      expect(distBend).toBeGreaterThanOrEqual(minAllowed * 0.90);
    });

    it('strictly maintains monotonic Y order (y_i < y_{i+1}) under any perturbation', () => {
      const net = new GoalNet({
        side: 'left',
        mouthX: -600,
        backX: -636,
        topY: -85,
        bottomY: 85,
        nodeCount: 13
      });

      // Try to invert Y positions
      net.posY[6] = 50;
      net.posY[7] = -20; // Inverted order!

      net.step(1 / 60);

      // After step, Y order must be strictly restored
      for (let i = 0; i < 12; i++) {
        expect(net.posY[i + 1]).toBeGreaterThan(net.posY[i]);
      }
    });
  });

  describe('3. Semi-Rigid Side Nets (Laterales Tensados Deflectores)', () => {
    it('deflects angled shots elastically and slides them towards the back of the goal', () => {
      const net = new GoalNet({
        side: 'left',
        mouthX: -600,
        backX: -636,
        depth: 36,
        topY: -85,
        bottomY: 85,
        nodeCount: 13
      });

      // Ball entering near top post at an angle upwards hitting the top lateral
      const ball = {
        pos: { x: -615, y: -84 },
        vel: { x: 5, y: -20 }, // Moving towards mouth or outwards
        radius: 5.8,
        isBall: true
      };

      net.checkBallCollision(ball);

      // Ball must be deflected into goal (y >= topY + rBall)
      expect(ball.pos.y).toBeGreaterThanOrEqual(-85 + 5.8);
      // Velocity Y inverted elastically
      expect(ball.vel.y).toBeGreaterThan(0);
      // Velocity X directed towards the back of the goal (negative X for left goal)
      expect(ball.vel.x).toBeLessThan(0);
    });

    it('deflects bottom lateral impacts into the goal and towards the back', () => {
      const net = new GoalNet({
        side: 'left',
        mouthX: -600,
        backX: -636,
        depth: 36,
        topY: -85,
        bottomY: 85,
        nodeCount: 13
      });

      // Ball hitting bottom lateral
      const ball = {
        pos: { x: -620, y: 83 },
        vel: { x: 0, y: 25 },
        radius: 5.8,
        isBall: true
      };

      net.checkBallCollision(ball);

      // Ball kept inside (y <= bottomY - rBall)
      expect(ball.pos.y).toBeLessThanOrEqual(85 - 5.8);
      // Velocity Y deflected upwards
      expect(ball.vel.y).toBeLessThan(0);
      // Velocity X guided towards back
      expect(ball.vel.x).toBeLessThan(0);
    });
  });

  describe('4. Unilateral Containment (Anti-Tunneling Projection)', () => {
    it('strictly guarantees the ball never crosses through the back curtain under high velocity', () => {
      const netLeft = new GoalNet({
        side: 'left',
        mouthX: -600,
        backX: -636,
        depth: 36,
        topY: -85,
        bottomY: 85,
        rearLimitX: -652,
        nodeCount: 13
      });

      // Extreme velocity supersonic shot trying to tunnel through left goal
      const ball = {
        pos: { x: -642, y: 0 },
        vel: { x: -500, y: 0 },
        radius: 5.8,
        isBall: true
      };

      netLeft.checkBallCollision(ball);

      // Ball must not cross past the net curtain
      expect(ball.pos.x).toBeGreaterThanOrEqual(-652 + 5.8);
      expect(ball.vel.x).toBeGreaterThanOrEqual(0); // Outward normal velocity zeroed
    });

    it('prevents ball tunneling on right goal as well', () => {
      const netRight = new GoalNet({
        side: 'right',
        mouthX: 600,
        backX: 636,
        depth: 36,
        topY: -85,
        bottomY: 85,
        rearLimitX: 652,
        nodeCount: 13
      });

      const ball = {
        pos: { x: 642, y: 0 },
        vel: { x: 600, y: 0 },
        radius: 5.8,
        isBall: true
      };

      netRight.checkBallCollision(ball);

      expect(ball.pos.x).toBeLessThanOrEqual(652 - 5.8);
      expect(ball.vel.x).toBeLessThanOrEqual(0);
    });
  });

  describe('5. Progressive Momentum Transfer and Smooth Reset', () => {
    it('decelerates the ball progressively without instant dry stopping', () => {
      const net = new GoalNet({
        side: 'left',
        mouthX: -600,
        backX: -636,
        depth: 36,
        topY: -85,
        bottomY: 85,
        rearLimitX: -652,
        nodeCount: 13
      });

      const ball = {
        pos: { x: -635, y: 0 },
        vel: { x: -20, y: 0 },
        radius: 5.8,
        isBall: true
      };

      const initialVel = ball.vel.x;
      net.checkBallCollision(ball);

      // Ball decelerates smoothly: not wiped out to 0 immediately
      expect(ball.vel.x).toBeLessThan(0);
      expect(Math.abs(ball.vel.x)).toBeLessThan(Math.abs(initialVel));
      expect(Math.abs(ball.vel.x)).toBeGreaterThan(0.5); // Still retains momentum!
    });

    it('springs back elastically (no plastic memory) and also floats back on resetShape(smooth: true)', () => {
      const net = new GoalNet({
        side: 'left',
        mouthX: -600,
        backX: -636,
        depth: 36,
        topY: -85,
        bottomY: 85,
        nodeCount: 13
      });

      // Displace middle node: the restoring spring starts pulling it back immediately
      net.posX[6] = -645;
      net.oldPosX[6] = -645;
      net.step(1 / 60);
      expect(net.posX[6]).toBeGreaterThan(-645);

      // Trigger smooth reset (lerp 0.06) on top of the springs
      net.resetShape(true);
      expect(net.isRelaxing).toBe(true);

      for (let tick = 0; tick < 150; tick++) {
        net.step(1 / 60);
      }

      // Restored smoothly to rest position
      expect(Math.abs(net.posX[6] - net.restPosX[6])).toBeLessThan(0.1);
    });
  });

  describe('6. 5-Second (300 Ticks) Active Victory Celebration with Score Lock', () => {
    it('executes 300 ticks of active physics with player motor control and locked scoreboard', () => {
      const engine = new GameEngine({ scoreLimit: 1, timeLimitSeconds: 180 });
      const p1 = new Player({ id: 'p1', name: 'WinnerRed', team: 'red' });
      engine.addPlayer(p1);

      let winnerReported: 'red' | 'blue' | null | undefined = undefined;
      engine.onMatchEnd = (winner) => {
        winnerReported = winner;
      };

      engine.startMatch();
      const emptyInputs = new Map<string, number>();
      for (let i = 0; i < 180; i++) {
        engine.tick(emptyInputs);
      }
      expect(engine.fsm.currentState).toBe(MatchPhase.PLAYING);

      // Score winning goal
      engine.ball.pos.set(engine.stadium.halfWidth + 20, 0);
      engine.tick(emptyInputs);

      expect(engine.redScore).toBe(1);
      expect(engine.fsm.currentState).toBe(MatchPhase.VICTORY_CELEBRATION);
      expect(engine.fsm.stateTicksRemaining).toBe(299); // 1 tick elapsed out of 300

      // During the 300 ticks:
      // 1. Players move and retain control
      const moveInput = new Map<string, number>();
      moveInput.set('p1', 1); // UP key
      const startY = engine.playerDiscs.get('p1')!.pos.y;
      engine.tick(moveInput);
      expect(engine.playerDiscs.get('p1')!.pos.y).not.toBe(startY);

      // 2. Score Lock: ball entering goal does NOT change score
      engine.ball.pos.set(engine.stadium.halfWidth + 20, 0);
      engine.tick(emptyInputs);
      expect(engine.redScore).toBe(1);

      // Advance remaining 296 ticks
      for (let i = 0; i < 296; i++) {
        expect(engine.fsm.currentState).toBe(MatchPhase.VICTORY_CELEBRATION);
        engine.tick(emptyInputs);
      }

      // 300th tick finishes celebration and transitions to STOPPED
      engine.tick(emptyInputs);
      expect(engine.fsm.currentState).toBe(MatchPhase.STOPPED);
      expect(winnerReported).toBe('red');
    });
  });
});
