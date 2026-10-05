import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GoalNet } from '../../src/core/entities/GoalNet';
import { PhysicsWorld } from '../../src/core/physics/PhysicsWorld';
import { Disc, COLLISION_GROUP_RED, COLLISION_GROUP_BLUE } from '../../src/core/entities/Disc';
import { UIStateMachine } from '../../src/ui/UIStateMachine';
import { MatchPhase } from '../../src/core/game/GameFSM';
import { TeamSelectModal } from '../../src/ui/components/TeamSelectModal';

describe('Slack Trapezoid Rope Net, Player Permeability & Non-Host Modal Toggle', () => {
  describe('1. Non-Host Universal Modal Toggle in UIStateMachine', () => {
    let ingameMenuEl: any;
    let classes: Set<string>;

    beforeEach(() => {
      classes = new Set<string>(['hidden']);
      ingameMenuEl = {
        id: 'ingame-menu',
        style: { display: 'none', pointerEvents: 'none' },
        classList: {
          add: vi.fn((...c: string[]) => c.forEach(cls => classes.add(cls))),
          remove: vi.fn((...c: string[]) => c.forEach(cls => classes.delete(cls))),
          contains: vi.fn((cls: string) => classes.has(cls))
        }
      };

      (globalThis as any).document = {
        getElementById: (id: string) => (id === 'ingame-menu' ? ingameMenuEl : null),
        querySelector: () => null,
        querySelectorAll: () => []
      };
    });

    it('allows a Non-Host user (isHost = false) to toggle the menu open and closed during PLAYING phase', () => {
      const fsm = new UIStateMachine('STATE_IN_GAME');

      // Non-host toggles during active match (MatchPhase.PLAYING)
      const isHost = false;
      const opened = fsm.toggleModal('teamSelect', isHost, MatchPhase.PLAYING);
      expect(opened).toBe(true);
      expect(fsm.isModalOpen('teamSelect')).toBe(true);
      expect(ingameMenuEl.classList.remove).toHaveBeenCalledWith('hidden', 'u-hidden', 'ui-screen-hidden');
      expect(ingameMenuEl.style.display).toBe('flex');

      // Non-host toggles again to close
      const closed = fsm.toggleModal('teamSelect', isHost, MatchPhase.PLAYING);
      expect(closed).toBe(false);
      expect(fsm.isModalOpen('teamSelect')).toBe(false);
      expect(ingameMenuEl.classList.add).toHaveBeenCalledWith('hidden');
      expect(ingameMenuEl.style.display).toBe('none');
    });

    it('keeps menu open and prevents closing during STOPPED phase even for Non-Host', () => {
      const fsm = new UIStateMachine('STATE_IN_GAME');

      const isHost = false;
      // In STOPPED phase, toggleModal keeps the menu open
      const res = fsm.toggleModal('teamSelect', isHost, MatchPhase.STOPPED);
      expect(res).toBe(true);
      expect(fsm.isModalOpen('teamSelect')).toBe(true);

      // Attempting to toggle again in STOPPED phase does not close the menu
      const res2 = fsm.toggleModal('teamSelect', isHost, MatchPhase.STOPPED);
      expect(res2).toBe(true);
      expect(fsm.isModalOpen('teamSelect')).toBe(true);
    });
  });

  describe('2. Stadium Box Net (4-Anchor, N=13 Back Curtain) Geometry & Dynamics', () => {
    it('initializes 4-anchor box net with rigid side nets, vertical back curtain and anti-loop bending constraints (13 nodes)', () => {
      const netLeft = new GoalNet({
        side: 'left',
        mouthX: -600,
        backX: -636,
        depth: 36,
        topY: -85,
        bottomY: 85,
        nodeCount: 13
      });

      expect(netLeft.nodeCount).toBe(13);
      // 4 Anclajes Rígidos
      expect(netLeft.pTopX).toBe(-600);
      expect(netLeft.pTopY).toBe(-85);
      expect(netLeft.pBottomX).toBe(-600);
      expect(netLeft.pBottomY).toBe(85);
      expect(netLeft.sTopX).toBe(-636);
      expect(netLeft.sTopY).toBe(-85);
      expect(netLeft.sBottomX).toBe(-636);
      expect(netLeft.sBottomY).toBe(85);

      // Cortina de fondo: Anclajes fijos en S_top y S_bottom
      expect(netLeft.restPosX[0]).toBe(-636);
      expect(netLeft.restPosY[0]).toBe(-85);
      expect(netLeft.invMass[0]).toBe(0);

      expect(netLeft.restPosX[12]).toBe(-636);
      expect(netLeft.restPosY[12]).toBe(85);
      expect(netLeft.invMass[12]).toBe(0);

      // Mobile nodes have mass m = 0.35 => invMass ≈ 2.857
      for (let i = 1; i <= 11; i++) {
        expect(netLeft.invMass[i]).toBeCloseTo(1 / 0.35, 2);
      }

      // Center back node (i = 6) cuelga con suave concavidad hacia atrás (X <= -636) y Y = 0
      expect(netLeft.restPosX[6]).toBeLessThanOrEqual(-636);
      expect(netLeft.restPosY[6]).toBeCloseTo(0, 1);

      // Orden monótono en Y garantizado
      for (let i = 0; i < 12; i++) {
        expect(netLeft.restPosY[i + 1]).toBeGreaterThan(netLeft.restPosY[i]);
      }

      // Restricciones de flexión segundo vecino inicializadas
      expect(netLeft.restLenBend.length).toBe(11);
      for (let i = 0; i < 11; i++) {
        expect(netLeft.restLenBend[i]).toBeGreaterThan(0);
      }
    });

    it('deforms with dynamic stretching, transfers momentum, deflects off side nets, and retains plastic shape', () => {
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

      const fastBall = {
        pos: { x: -635, y: 0 },
        vel: { x: -35, y: 5 }, // High velocity shot
        radius: 5.8,
        isBall: true
      };

      const initialSpeed = Math.hypot(fastBall.vel.x, fastBall.vel.y);

      // Step simulation: momentum transfer occurs without instant dry wipeout
      net.step(fastBall, 1 / 60);

      // Nodes must not have NaN
      for (let i = 0; i < net.nodeCount; i++) {
        expect(Number.isNaN(net.posX[i])).toBe(false);
        expect(Number.isNaN(net.posY[i])).toBe(false);
        expect(Number.isFinite(net.posX[i])).toBe(true);
        expect(Number.isFinite(net.posY[i])).toBe(true);
      }

      // Ball comes to rest inside net over several ticks through progressive tension and pocket funneling
      for (let tick = 0; tick < 60; tick++) {
        net.step(fastBall, 1 / 60);
      }

      // Ball is retained within goal and decelerated into the pocket
      expect(fastBall.pos.x).toBeLessThan(-600);
      expect(fastBall.pos.x).toBeGreaterThanOrEqual(-652);
      expect(Math.hypot(fastBall.vel.x, fastBall.vel.y)).toBeLessThan(initialSpeed);

      // Memoria plástica transitoria: los nodos permanecen deformados envolviendo el balón (kShape = 0, sin resorte de retorno)
      const deformedMiddleX = net.posX[6];
      expect(deformedMiddleX).not.toBeCloseTo(net.restPosX[6], 0.5);

      // Ticks adicionales con el balón en reposo: la red NO intenta regresar a reposo
      for (let tick = 0; tick < 30; tick++) {
        net.step(fastBall, 1 / 60);
      }
      expect(net.posX[6]).toBeCloseTo(deformedMiddleX, 0.5);

      // Restauración suave (COUNTDOWN Kickoff Reset: resetShape(true))
      net.resetShape(true);
      expect(net.isRelaxing).toBe(true);
      for (let tick = 0; tick < 80; tick++) {
        net.step(1 / 60);
      }
      // Nodos relajados suavemente hacia reposo
      expect(Math.abs(net.posX[6] - net.restPosX[6])).toBeLessThan(0.5);

      // Restauración instantánea (resetShape(false))
      net.posX[6] = -639;
      net.resetShape(false);
      expect(net.posX[6]).toBe(net.restPosX[6]);
      expect(net.isRelaxing).toBe(false);
    });
  });

  describe('3. Absolute Net Permeability for Players', () => {
    it('completely ignores player discs in GoalNet with zero collision and zero velocity alteration', () => {
      const net = new GoalNet({
        side: 'left',
        mouthX: -600,
        backX: -635,
        topY: -85,
        bottomY: 85,
        nodeCount: 11
      });

      const playerDisc = new Disc({
        id: 1,
        x: -634,
        y: 0, // In the middle of the goal net
        radius: 15,
        cGroup: COLLISION_GROUP_RED,
        isBall: false
      });
      playerDisc.vel.set(-15, 2);

      const initialPosX = playerDisc.pos.x;
      const initialPosY = playerDisc.pos.y;
      const initialVelX = playerDisc.vel.x;
      const initialVelY = playerDisc.vel.y;

      const middleNodeX = net.posX[5];
      const middleNodeY = net.posY[5];

      // Step GoalNet passing the player disc
      net.step(playerDisc, 1 / 60);
      net.resolveDiscCollision(playerDisc);

      // Player must be completely unaffected
      expect(playerDisc.pos.x).toBe(initialPosX);
      expect(playerDisc.pos.y).toBe(initialPosY);
      expect(playerDisc.vel.x).toBe(initialVelX);
      expect(playerDisc.vel.y).toBe(initialVelY);

      // Net nodes must not be perturbed
      expect(net.posX[5]).toBe(middleNodeX);
      expect(net.posY[5]).toBe(middleNodeY);
    });

    it('does not register any collision when players move through goal nets in PhysicsWorld', () => {
      const world = new PhysicsWorld();
      const net = new GoalNet({
        side: 'left',
        mouthX: -600,
        backX: -635,
        topY: -85,
        bottomY: 85,
        nodeCount: 17
      });
      world.goalNets = [net];

      const player = new Disc({
        id: 2,
        x: -610,
        y: 0,
        radius: 15,
        mass: 2,
        cGroup: COLLISION_GROUP_BLUE,
        isBall: false
      });
      player.vel.set(-20, 0); // Running into the goal net
      world.addDisc(player);

      const collisions: any[] = [];
      world.onCollision = (e) => collisions.push(e);

      // Run multiple physics steps
      for (let i = 0; i < 5; i++) {
        world.step();
      }

      // No collisions recorded for the player with the net
      expect(collisions).toHaveLength(0);
      // Player continues moving through the net unobstructed
      expect(player.pos.x).toBeLessThan(-610);
    });
  });

  describe('4. TeamSelectModal Permissions Isolation for Non-Host', () => {
    let elements: Record<string, any>;

    beforeEach(() => {
      elements = {
        'ingame-menu': { classList: { add: vi.fn(), remove: vi.fn(), contains: () => false }, style: {} },
        'menu-close-btn': { style: {}, addEventListener: vi.fn() },
        'btn-return-game': { style: {}, addEventListener: vi.fn() },
        'btn-match-toggle': { style: {}, disabled: false, textContent: '', className: '', addEventListener: vi.fn() },
        'btn-open-physics-modifiers': { style: {}, disabled: false, addEventListener: vi.fn() },
        'btn-pick-stadium': { style: {}, disabled: false, addEventListener: vi.fn() },
        'select-stadium-size': { disabled: false, addEventListener: vi.fn() },
        'select-time-limit': { disabled: false, addEventListener: vi.fn() },
        'select-goal-limit': { disabled: false, addEventListener: vi.fn() },
        'btn-lock-teams': { style: {}, disabled: false, addEventListener: vi.fn() },
        'btn-pause-resume': { style: {}, disabled: false, addEventListener: vi.fn() },
        'joinRedBtn': { disabled: false, addEventListener: vi.fn() },
        'joinBlueBtn': { disabled: false, addEventListener: vi.fn() },
        'joinSpecBtn': { disabled: false, addEventListener: vi.fn() },
        'btn-copy-link': { addEventListener: vi.fn() },
        'btn-leave-room': { addEventListener: vi.fn() }
      };

      (globalThis as any).document = {
        getElementById: (id: string) => elements[id] || null,
        querySelector: () => null,
        querySelectorAll: () => []
      };
    });

    it('hides or disables admin controls for non-host non-admin player while keeping team and leave buttons active', () => {
      const modal = new TeamSelectModal();

      // Configure as Non-Host & Non-Admin
      modal.setHost(false);
      modal.updateMatchControlButton(MatchPhase.STOPPED, false, false);

      // Admin controls must be hidden or disabled
      expect(elements['btn-match-toggle'].disabled).toBe(true);
      expect(elements['btn-match-toggle'].style.display).toBe('none');

      expect(elements['btn-pick-stadium'].disabled).toBe(true);
      expect(elements['btn-pick-stadium'].style.display).toBe('none');

      expect(elements['btn-open-physics-modifiers'].disabled).toBe(true);
      expect(elements['btn-open-physics-modifiers'].style.display).toBe('none');

      expect(elements['select-stadium-size'].disabled).toBe(true);
      expect(elements['select-time-limit'].disabled).toBe(true);
      expect(elements['select-goal-limit'].disabled).toBe(true);

      // Team switch and interaction buttons must remain enabled
      expect(elements['joinRedBtn'].disabled).toBe(false);
      expect(elements['joinBlueBtn'].disabled).toBe(false);
      expect(elements['joinSpecBtn'].disabled).toBe(false);
    });
  });
});
