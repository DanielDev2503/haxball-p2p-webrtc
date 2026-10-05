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

      it(`instantiates two GoalNet instances with adaptive depth (Xback = xPost ± 38) for "${stadium.name}"`, () => {
        const world = new PhysicsWorld();
        world.loadStadium(stadium);

        expect(world.goalNets).toHaveLength(2);
        const [netLeft, netRight] = world.goalNets;

        expect(netLeft.side).toBe('left');
        expect(netRight.side).toBe('right');

        expect(netLeft.nodeCount).toBe(11);
        expect(netRight.nodeCount).toBe(11);

        // Find reference goal post positions
        const redGoal = stadium.goals.find(g => g.team === 'red') || stadium.goals[0];
        const blueGoal = stadium.goals.find(g => g.team === 'blue') || stadium.goals[1];

        const leftPostX = redGoal.p0.x;
        const rightPostX = blueGoal.p0.x;

        // Depth should be mouthX + (sign * 38)
        expect(netLeft.mouthX).toBe(leftPostX);
        expect(netLeft.backX).toBe(leftPostX - 38);

        expect(netRight.mouthX).toBe(rightPostX);
        expect(netRight.backX).toBe(rightPostX + 38);
      });
    });
  });

  describe('2. Slack Trapezoid 11-Node Geometry and Kinetic Damping', () => {
    it('anchors post nodes (0 and 10) firmly while intermediate nodes have invMass = 2.5', () => {
      const net = new GoalNet({
        side: 'left',
        mouthX: -400,
        backX: -438,
        topY: -75,
        bottomY: 75,
        nodeCount: 11
      });

      expect(net.invMass[0]).toBe(0); // Top post anchor
      expect(net.invMass[10]).toBe(0); // Bottom post anchor

      for (let i = 1; i <= 9; i++) {
        expect(net.invMass[i]).toBe(2.5); // Mobile nodes
      }

      // Rest positions check
      expect(net.restPosX[0]).toBe(-400);
      expect(net.restPosY[0]).toBe(-75);

      expect(net.restPosX[10]).toBe(-400);
      expect(net.restPosY[10]).toBe(75);

      // Back wall nodes 4..6 at X = -438
      expect(net.restPosX[4]).toBe(-438);
      expect(net.restPosX[5]).toBe(-438);
      expect(net.restPosX[6]).toBe(-438);
    });

    it('absorbs ball kinetic energy and holds it at the rear containment limit (Xback ± 12)', () => {
      const net = new GoalNet({
        side: 'left',
        mouthX: -400,
        backX: -438,
        rearLimitX: -450, // -438 - 12
        topY: -75,
        bottomY: 75,
        nodeCount: 11
      });

      const ball = {
        pos: { x: -437, y: 0 }, // Within ball radius (5.8) of the back wall (-438)
        vel: { x: -30, y: 0 },  // High velocity shot into net
        radius: 5.8,
        isBall: true
      };

      const initialSpeed = Math.abs(ball.vel.x);
      net.step(ball, 1 / 60);

      // Kinetic damping: speed dissipated by 0.65 factor
      expect(Math.abs(ball.vel.x)).toBeLessThan(initialSpeed);
      expect(ball.vel.x).toBeCloseTo(-30 * 0.65, 1);

      // Sustained steps to rear limit
      for (let i = 0; i < 40; i++) {
        ball.pos.x += ball.vel.x * (1 / 60);
        net.step(ball, 1 / 60);
      }

      // Ball contained within goal without blowing past rear limit
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
