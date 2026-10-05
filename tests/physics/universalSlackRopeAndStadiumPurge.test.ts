import { describe, it, expect } from 'vitest';
import { STADIUM_PRESETS, createStadium } from '../../src/core/stadiums/StadiumRegistry';
import { PhysicsWorld } from '../../src/core/physics/PhysicsWorld';
import { COLLISION_GROUP_BALL } from '../../src/core/entities/Disc';
import { GoalNet } from '../../src/core/entities/GoalNet';
import { Disc } from '../../src/core/entities/Disc';
import { GameEngine } from '../../src/core/game/GameEngine';
import { Player } from '../../src/core/game/Player';
import { MatchPhase } from '../../src/core/game/GameFSM';

describe('Universal Slack Rope Net Physics & Goal Boundary Purge', () => {
  describe('1. Purge of Rigid Goal Boundaries in all Registered Stadiums', () => {
    const presetKeys = Object.keys(STADIUM_PRESETS);

    presetKeys.forEach((key) => {
      const stadium = createStadium(key);
      it(`purges ball collision mask from all segments behind goal lines in "${stadium.name}"`, () => {
        const world = new PhysicsWorld();
        world.loadStadium(stadium);

        const goals = stadium.goals || [];
        expect(goals.length).toBeGreaterThanOrEqual(2);

        goals.forEach((goal) => {
          const xPost = Math.abs(goal.p0.x);
          const yPost = Math.abs(goal.p0.y);
          const isLeft = goal.p0.x < 0;

          // Check all segments in world: none in the goal area should collide with the ball
          world.segments.forEach((seg) => {
            const minX = Math.min(seg.p0.x, seg.p1.x);
            const maxX = Math.max(seg.p0.x, seg.p1.x);
            const maxY = Math.max(Math.abs(seg.p0.y), Math.abs(seg.p1.y));

            const inGoalY = maxY <= yPost + 15;
            const inLeftGoalArea = isLeft && minX < -xPost + 1;
            const inRightGoalArea = !isLeft && maxX > xPost - 1;

            if (inGoalY && (inLeftGoalArea || inRightGoalArea)) {
              // cMask must NOT contain COLLISION_GROUP_BALL
              expect(seg.cMask & COLLISION_GROUP_BALL).toBe(0);
            }
          });
        });
      });

      it(`instantiates two GoalNet instances with adaptive depth (Xback = xPost ± 36) for "${stadium.name}"`, () => {
        const world = new PhysicsWorld();
        world.loadStadium(stadium);

        expect(world.goalNets).toHaveLength(2);
        const [netLeft, netRight] = world.goalNets;

        expect(netLeft.side).toBe('left');
        expect(netRight.side).toBe('right');

        expect(netLeft.nodeCount).toBe(15);
        expect(netRight.nodeCount).toBe(15);

        // Find reference goal post positions
        const redGoal = stadium.goals.find(g => g.team === 'red') || stadium.goals[0];
        const blueGoal = stadium.goals.find(g => g.team === 'blue') || stadium.goals[1];

        const leftPostX = redGoal.p0.x;
        const rightPostX = blueGoal.p0.x;

        // Depth should be mouthX + (sign * 36)
        expect(netLeft.mouthX).toBe(leftPostX);
        expect(netLeft.backX).toBe(leftPostX - 36);

        expect(netRight.mouthX).toBe(rightPostX);
        expect(netRight.backX).toBe(rightPostX + 36);
      });
    });
  });

  describe('2. Stadium Box Net (4-Anchor, N=13 Back Curtain) Geometry and Kinetic Damping', () => {
    it('anchors rear corners (0 and N-1) and front posts firmly (invMass = 0) while intermediate nodes have invMass = 1 / 0.40 = 2.5', () => {
      const net = new GoalNet({
        side: 'left',
        mouthX: -400,
        backX: -436,
        depth: 36,
        topY: -75,
        bottomY: 75,
        nodeCount: 13
      });

      // 4 Anchors
      expect(net.pTopX).toBe(-400);
      expect(net.pTopY).toBe(-75);
      expect(net.pBottomX).toBe(-400);
      expect(net.pBottomY).toBe(75);
      expect(net.sTopX).toBe(-436);
      expect(net.sTopY).toBe(-75);
      expect(net.sBottomX).toBe(-436);
      expect(net.sBottomY).toBe(75);

      // Back curtain anchors
      expect(net.invMass[0]).toBe(0); // Top rear corner anchor
      expect(net.invMass[12]).toBe(0); // Bottom rear corner anchor

      for (let i = 1; i <= 11; i++) {
        expect(net.invMass[i]).toBeCloseTo(1 / 0.40, 2); // Mobile nodes
      }

      // Rest positions check: curtain spans from S_top to S_bottom
      expect(net.restPosX[0]).toBe(-436);
      expect(net.restPosY[0]).toBe(-75);

      expect(net.restPosX[12]).toBe(-436);
      expect(net.restPosY[12]).toBe(75);

      // Monotonic Y ordering at rest
      for (let i = 0; i < 12; i++) {
        expect(net.restPosY[i + 1]).toBeGreaterThan(net.restPosY[i]);
      }
    });

    it('absorbs ball kinetic energy through progressive tension and pocket funneling', () => {
      const net = new GoalNet({
        side: 'left',
        mouthX: -400,
        backX: -436,
        rearLimitX: -450,
        topY: -75,
        bottomY: 75,
        nodeCount: 13
      });

      const ball = {
        pos: { x: -435, y: 0 },
        vel: { x: -30, y: 0 },  // High velocity shot into net
        radius: 5.8,
        isBall: true
      };

      const initialSpeed = Math.abs(ball.vel.x);
      // First step: progressive momentum transfer pushes middle node backward
      net.step(ball, 1 / 60);

      expect(net.posX[6]).not.toBe(net.restPosX[6]);

      // Sustained steps to rear limit with pocket funneling
      for (let i = 0; i < 40; i++) {
        ball.pos.x += ball.vel.x * (1 / 60);
        net.step(ball, 1 / 60);
      }

      // Ball contained within goal pocket and decelerated
      expect(Math.abs(ball.vel.x)).toBeLessThan(initialSpeed);
      expect(ball.pos.x).toBeGreaterThanOrEqual(-450);
      expect(ball.pos.x).toBeLessThan(-400);
    });

    it('remains 100% permeable to player discs', () => {
      const net = new GoalNet({
        side: 'left',
        mouthX: -400,
        backX: -438,
        topY: -75,
        bottomY: 75,
        nodeCount: 11
      });

      const player = new Disc({
        id: 1,
        x: -420,
        y: 0,
        radius: 15,
        isBall: false
      });
      player.vel.set(-10, 0);

      const oldX = player.pos.x;
      const oldVelX = player.vel.x;

      net.step(player, 1 / 60);

      // Player must not be affected at all
      expect(player.pos.x).toBe(oldX);
      expect(player.vel.x).toBe(oldVelX);
    });
  });

  describe('3. GameEngine Non-Host Admin Match Control Flow', () => {
    it('allows GameEngine to start and stop match when authorized', () => {
      const engine = new GameEngine();
      expect(engine.fsm.currentState).toBe(MatchPhase.STOPPED);

      // Add dummy players using Player class
      engine.addPlayer(new Player({ id: 'host_1', name: 'HostPlayer', team: 'red', isHost: true }));
      engine.addPlayer(new Player({ id: 'client_admin', name: 'AdminPlayer', team: 'blue', isAdmin: true }));

      // Start match
      engine.startMatch();
      expect(engine.fsm.currentState).toBe(MatchPhase.COUNTDOWN);

      // Stop match
      engine.stopMatch();
      expect(engine.fsm.currentState).toBe(MatchPhase.STOPPED);
    });
  });
});
