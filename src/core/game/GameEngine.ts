import { PhysicsWorld } from '../physics/PhysicsWorld';
import { Stadium } from '../entities/Stadium';
import { GoalNet } from '../entities/GoalNet';
import { createStadium } from '../stadiums/StadiumRegistry';
import { Disc, COLLISION_GROUP_BALL, COLLISION_GROUP_RED, COLLISION_GROUP_BLUE } from '../entities/Disc';
import {
  Player,
  INPUT_UP,
  INPUT_DOWN,
  INPUT_LEFT,
  INPUT_RIGHT,
  INPUT_KICK,
  INPUT_TURBO,
  INPUT_DASH,
  INPUT_MAGNUS_LEFT,
  INPUT_MAGNUS_RIGHT,
  INPUT_TYPING
} from './Player';
import { GameFSM, MatchPhase } from './GameFSM';
import { GameSnapshot, DiscSnapshot, MatchConfig, KickoffState } from './GameState';
import { SOUND_KICK, SOUND_POST_HIT, SOUND_GOAL } from '../../net/protocol/BinaryProtocol';
import { GameplayConfig, sanitizeGameplayConfig, defaultStadium } from './GameConfig';
import { Vec2 } from '../math/Vec2';

export class GameEngine {
  public physicsWorld: PhysicsWorld;
  public get world(): PhysicsWorld { return this.physicsWorld; }
  public stadium: Stadium;
  public ball: Disc;
  public leftGoalNet?: GoalNet;
  public rightGoalNet?: GoalNet;
  public players: Map<string, Player> = new Map();
  public playerDiscs: Map<string, Disc> = new Map();
  public fsm: GameFSM;
  public kickoffState: KickoffState = {
    active: false,
    mode: 'NEUTRAL',
    possessingTeam: null
  };

  public tickCount: number = 0;
  public activePlayTicks: number = 0;
  public redScore: number = 0;
  public blueScore: number = 0;
  public matchTimerSeconds: number = 180;
  public config: MatchConfig;
  public gameplayConfig: GameplayConfig;
  public lastScoringTeam: 'red' | 'blue' | null = null;
  public soundMask: number = 0;
  public isGoldenGoal: boolean = false;

  // Event callbacks
  public onGoal?: (scoringTeam: 'red' | 'blue', redScore: number, blueScore: number) => void;
  public onKick?: (playerDisc: Disc, ball: Disc) => void;
  public onPostHit?: (ball: Disc, post: Disc) => void;
  public onMatchEnd?: (winner: 'red' | 'blue' | null) => void;
  public onStateChange?: (state: MatchPhase) => void;

  private nextDiscId: number = 1000;

  constructor(
    config: Partial<MatchConfig> = {},
    gameplayConfig: Partial<GameplayConfig> = {},
    stadiumOrId: Stadium | string = defaultStadium
  ) {
    this.config = {
      scoreLimit: config.scoreLimit ?? 3,
      timeLimitSeconds: config.timeLimitSeconds ?? 180
    };
    this.matchTimerSeconds = this.config.timeLimitSeconds;
    this.gameplayConfig = sanitizeGameplayConfig(gameplayConfig);

    this.physicsWorld = new PhysicsWorld({ fixedDt: 1 / 60, maxSubsteps: 8 });
    this.stadium = typeof stadiumOrId === 'string' ? createStadium(stadiumOrId) : stadiumOrId;
    this.fsm = new GameFSM();
    this.fsm.onStateChange = (state) => {
      this.onStateChange?.(state);
    };

    // Cargar estadio en PhysicsWorld (purga de muros rígidos de arco y creación de GoalNet)
    this.physicsWorld.loadStadium(this.stadium);
    this.leftGoalNet = this.physicsWorld.goalNets[0];
    this.rightGoalNet = this.physicsWorld.goalNets[1];

    // Create Ball using stadium.ballPhysics if defined, or gameplayConfig
    const ballRadius = this.stadium.ballPhysics?.radius ?? this.gameplayConfig.ballRadius;
    const ballMass = this.stadium.ballPhysics?.invMass ? (1 / this.stadium.ballPhysics.invMass) : (this.gameplayConfig.ballMass ?? 1);
    const ballRestitution = this.stadium.ballPhysics?.bCoef ?? this.gameplayConfig.ballRestitution;
    const ballColor = this.stadium.ballPhysics?.color ?? '#FFA500';

    this.ball = new Disc({
      id: 0,
      x: 0,
      y: 0,
      radius: ballRadius,
      mass: ballMass,
      damping: this.gameplayConfig.ballFriction ?? 0.99,
      bounciness: ballRestitution,
      cGroup: COLLISION_GROUP_BALL,
      isBall: true,
      color: ballColor
    });
    this.physicsWorld.addDisc(this.ball);

    // Register substep hook for deterministic kickoff barriers
    this.physicsWorld.onSubstep = () => {
      this.applyKickoffBarriers();
    };

    // Collision listener for post hits and kickoff ball contact
    this.physicsWorld.onCollision = (event) => {
      if (event.type === 'disc-disc' && event.discB) {
        const isBall = event.discA === this.ball || event.discB === this.ball;
        if (isBall) {
          if (this.kickoffState.active) {
            const playerDisc = event.discA === this.ball ? event.discB : event.discA;
            for (const [_, player] of this.players.entries()) {
              if (this.playerDiscs.get(player.id) === playerDisc) {
                this.kickoffState.active = false;
                this.updatePhysicsKickoffContext();
                break;
              }
            }
          }

          const post = this.stadium.posts.find(p => p === event.discA || p === event.discB);
          if (post) {
            this.soundMask |= SOUND_POST_HIT;
            if (this.onPostHit) {
              this.onPostHit(this.ball, post);
            }
          }
        }
      }
    };
  }

  public addPlayer(player: Player): void {
    this.players.set(player.id, player);
    if (player.team !== 'spec') {
      this.spawnPlayerDisc(player);
    }
  }

  public removePlayer(playerId: string): void {
    const disc = this.playerDiscs.get(playerId);
    if (disc) {
      this.physicsWorld.removeDisc(disc);
      this.playerDiscs.delete(playerId);
    }
    this.players.delete(playerId);
  }

  public updateConfig(newConfig: Partial<MatchConfig>): void {
    if (newConfig.scoreLimit !== undefined) this.config.scoreLimit = newConfig.scoreLimit;
    if (newConfig.timeLimitSeconds !== undefined) {
      this.config.timeLimitSeconds = newConfig.timeLimitSeconds;
      if (this.fsm.currentState === MatchPhase.STOPPED) {
        this.matchTimerSeconds = this.config.timeLimitSeconds > 0 ? this.config.timeLimitSeconds : 0;
      }
    }
  }

  public setGameplayConfig(newConfig: Partial<GameplayConfig>): void {
    this.gameplayConfig = sanitizeGameplayConfig({ ...this.gameplayConfig, ...newConfig });
    if (this.ball) {
      this.ball.radius = this.gameplayConfig.ballRadius;
      this.ball.bounciness = this.gameplayConfig.ballRestitution;
      if (this.gameplayConfig.ballMass !== undefined) {
        this.ball.setMass(this.gameplayConfig.ballMass);
      }
      if (this.gameplayConfig.ballFriction !== undefined) {
        this.ball.damping = this.gameplayConfig.ballFriction;
      }
    }
    for (const disc of this.playerDiscs.values()) {
      disc.radius = this.gameplayConfig.playerRadius;
      if (this.gameplayConfig.playerMass !== undefined) {
        disc.setMass(this.gameplayConfig.playerMass);
      }
      if (this.gameplayConfig.playerFriction !== undefined) {
        disc.damping = this.gameplayConfig.playerFriction;
      }
    }
  }

  public setupGoalNets(): void {
    if (this.physicsWorld.goalNets.length === 2) {
      this.leftGoalNet = this.physicsWorld.goalNets[0];
      this.rightGoalNet = this.physicsWorld.goalNets[1];
      return;
    }
    this.physicsWorld.loadStadium(this.stadium);
    this.leftGoalNet = this.physicsWorld.goalNets[0];
    this.rightGoalNet = this.physicsWorld.goalNets[1];
  }

  public setStadium(stadiumOrId: Stadium | string): void {
    if (typeof stadiumOrId === 'string') {
      this.stadium = createStadium(stadiumOrId);
    } else {
      this.stadium = stadiumOrId;
    }

    this.physicsWorld.loadStadium(this.stadium);
    this.leftGoalNet = this.physicsWorld.goalNets[0];
    this.rightGoalNet = this.physicsWorld.goalNets[1];
  }

  public setPlayerTeam(playerId: string, team: 'red' | 'blue' | 'spec'): void {
    const player = this.players.get(playerId);
    if (!player) return;

    player.team = team;
    const existingDisc = this.playerDiscs.get(playerId);

    if (team === 'spec') {
      if (existingDisc) {
        this.physicsWorld.removeDisc(existingDisc);
        this.playerDiscs.delete(playerId);
        player.discId = null;
      }
    } else {
      const isRed = team === 'red';
      const goalSpawnX = isRed ? -this.stadium.halfWidth : this.stadium.halfWidth;
      const goalSpawnY = 0;

      if (!existingDisc) {
        this.spawnPlayerDisc(player, goalSpawnX, goalSpawnY);
      } else {
        existingDisc.radius = this.gameplayConfig.playerRadius;
        existingDisc.cGroup = isRed ? COLLISION_GROUP_RED : COLLISION_GROUP_BLUE;
        existingDisc.color = isRed ? '#e74c3c' : '#3498db';
        existingDisc.pos.set(goalSpawnX, goalSpawnY);
        existingDisc.prevPos.set(goalSpawnX, goalSpawnY);
        existingDisc.vel.set(0, 0);
      }
    }
  }

  private spawnPlayerDisc(player: Player, spawnX?: number, spawnY?: number): Disc {
    const isRed = player.team === 'red';
    const discId = this.nextDiscId++;
    const defaultX = isRed ? -this.stadium.halfWidth : this.stadium.halfWidth;
    const disc = new Disc({
      id: discId,
      x: spawnX ?? defaultX,
      y: spawnY ?? 0,
      radius: this.gameplayConfig.playerRadius,
      mass: this.gameplayConfig.playerMass ?? 2,
      damping: this.gameplayConfig.playerFriction ?? 0.96,
      bounciness: 0.5,
      cGroup: isRed ? COLLISION_GROUP_RED : COLLISION_GROUP_BLUE,
      isBall: false,
      color: isRed ? '#e74c3c' : '#3498db'
    });

    player.discId = discId;
    this.playerDiscs.set(player.id, disc);
    this.physicsWorld.addDisc(disc);
    return disc;
  }

  public startMatch(): void {
    this.redScore = 0;
    this.blueScore = 0;
    this.lastScoringTeam = null;
    this.isGoldenGoal = false;
    this.kickoffState = {
      active: true,
      mode: 'NEUTRAL',
      possessingTeam: null
    };
    this.updatePhysicsKickoffContext();
    this.activePlayTicks = 0;
    this.matchTimerSeconds = this.config.timeLimitSeconds > 0 ? this.config.timeLimitSeconds : 0;
    this.resetKickoffPositions(false);
    this.fsm.startMatch();
    if (this.onStateChange) {
      this.onStateChange(this.fsm.currentState);
    }
  }

  public stopMatch(): void {
    this.redScore = 0;
    this.blueScore = 0;
    this.lastScoringTeam = null;
    this.isGoldenGoal = false;
    this.kickoffState = {
      active: false,
      mode: 'NEUTRAL',
      possessingTeam: null
    };
    this.updatePhysicsKickoffContext();
    this.activePlayTicks = 0;
    this.matchTimerSeconds = 0;
    this.soundMask = 0;
    this.fsm.stopMatch();
    this.resetKickoffPositions(false);
    this.tickCount++;
    if (this.onStateChange) {
      this.onStateChange(this.fsm.currentState);
    }
  }

  public togglePause(): void {
    if (this.fsm.currentState === MatchPhase.PLAYING) {
      this.pauseMatch();
    } else if (this.fsm.currentState === MatchPhase.PAUSED) {
      this.resumeMatch();
    }
  }

  public pauseMatch(): void {
    if (this.fsm.currentState === MatchPhase.PLAYING) {
      this.fsm.pauseMatch();
      if (this.onStateChange) {
        this.onStateChange(this.fsm.currentState);
      }
    }
  }

  public resumeMatch(): void {
    this.fsm.resumeMatch();
    if (this.onStateChange) {
      this.onStateChange(this.fsm.currentState);
    }
  }

  public resetPositionsForKickoff(smooth: boolean = true): void {
    this.resetKickoffPositions(smooth);
  }

  public resetKickoffPositions(smooth: boolean = true): void {
    // Restaurar forma de las redes (instantánea o relajación suave según flag)
    if (this.physicsWorld) {
      this.physicsWorld.resetNets(smooth);
    }

    // Reset ball to center with strictly zero kinematics
    this.ball.pos.set(0, 0);
    this.ball.vel.zero();
    this.ball.prevPos.set(0, 0);
    this.ball.resetCurve();

    // Arrange Red and Blue players
    let redIndex = 0;
    let blueIndex = 0;

    for (const [playerId, player] of this.players.entries()) {
      player.inputMask = 0;
      player.stamina = 100;
      player.isDashing = false;
      player.dashTicksRemaining = 0;
      player.isTurbo = false;
      player.triggerDash = false;

      const disc = this.playerDiscs.get(playerId);
      if (!disc) continue;

      disc.vel.zero();
      disc.kicking = false;
      disc.stamina = 100;
      disc.isDashing = false;
      disc.isTurbo = false;

      const spawnDist = this.stadium.spawnDistance ?? 180;
      if (player.team === 'red') {
        const offset = redIndex * 40 - 20 * redIndex;
        disc.pos.set(-spawnDist, offset);
        disc.prevPos.copy(disc.pos);
        redIndex++;
      } else if (player.team === 'blue') {
        const offset = blueIndex * 40 - 20 * blueIndex;
        disc.pos.set(spawnDist, offset);
        disc.prevPos.copy(disc.pos);
        blueIndex++;
      }
    }
  }

  /**
   * Deterministic 60Hz tick update.
   */
  public tick(inputs: Map<string, number>): void {
    // Si el partido está detenido, la física y el reloj permanecen completamente congelados
    if (this.fsm.currentState === MatchPhase.STOPPED) {
      return;
    }

    this.soundMask = 0;
    this.tickCount++;

    // Si el partido está pausado, la física y el reloj permanecen congelados pero tickCount avanza para emitir snapshots continuos de pausa
    if (this.fsm.currentState === MatchPhase.PAUSED) {
      return;
    }

    // Si está en cuenta regresiva (3, 2, 1), avanza la cuenta y relaja suavemente las redes
    if (this.fsm.currentState === MatchPhase.COUNTDOWN) {
      this.physicsWorld.stepNets(1 / 60);
      const transitioned = this.fsm.tick();
      if (transitioned) {
        this.physicsWorld.resetNets(false);
        if (this.onStateChange) {
          this.onStateChange(this.fsm.currentState);
        }
      }
      return;
    }

    // Estados activos: PLAYING, GOAL_CELEBRATION o VICTORY_CELEBRATION (300 ticks con física viva)
    // Tarea 1: Durante el estado de saque (kickoffState.active), el cronómetro de la partida permanece estrictamente congelado
    if (this.fsm.currentState === MatchPhase.PLAYING && !this.kickoffState.active) {
      this.activePlayTicks++;
      // Advance match timer (every 60 ticks = 1 second) únicamente cuando el balón está en juego activo
      if (this.activePlayTicks % 60 === 0) {
        if (this.isGoldenGoal) {
          // En prórroga (Gol de Oro): el cronómetro avanza como tiempo extra suplementario
          this.matchTimerSeconds++;
        } else if (this.config.timeLimitSeconds > 0) {
          if (this.matchTimerSeconds > 0) {
            this.matchTimerSeconds--;
            if (this.matchTimerSeconds === 0) {
              this.checkMatchConclusion();
            }
          }
        } else {
          // Tiempo indefinido: cuenta hacia arriba
          this.matchTimerSeconds++;
        }
      }
    }

    // Apply player movement, stamina, turbo, dash and kicking (tanto en PLAYING como en GOAL_CELEBRATION)
    const dt = 1 / 60;
    const accel = (this.gameplayConfig.playerAcceleration / 0.11) * 7.5;
    const kickStrength = (this.gameplayConfig.kickStrength / 4.545) * 320.0;
    const kickReach = this.gameplayConfig.playerRadius + this.gameplayConfig.ballRadius + 9.0;

    for (const [playerId, player] of this.players.entries()) {
      const disc = this.playerDiscs.get(playerId);
      if (!disc) continue;

      const mask = inputs.get(playerId) ?? player.inputMask;
      player.inputMask = mask;
      player.isTyping = Boolean(mask & INPUT_TYPING);
      disc.isTyping = player.isTyping;

      // Movement input
      let dirX = 0;
      let dirY = 0;
      if (mask & INPUT_UP) dirY -= 1;
      if (mask & INPUT_DOWN) dirY += 1;
      if (mask & INPUT_LEFT) dirX -= 1;
      if (mask & INPUT_RIGHT) dirX += 1;

      const hasMoveInput = (dirX !== 0 || dirY !== 0);
      let uMoveX = 0;
      let uMoveY = 0;
      if (hasMoveInput) {
        const len = Math.hypot(dirX, dirY);
        uMoveX = dirX / len;
        uMoveY = dirY / len;
      }

      const vSpeed = Math.hypot(disc.vel.x, disc.vel.y);

      // Dash Mechanic (salto rápido por flanco ascendente, consume coste calibrado de estamina)
      const isDashKeyDown = (mask & INPUT_DASH) !== 0;
      const wantsDash = player.triggerDash || (isDashKeyDown && !player.prevDashState);
      const dashCost = 100 / (this.gameplayConfig.dashesPerFullBar || 4);
      const canDash = this.gameplayConfig.dashEnabled !== false;

      if (canDash && wantsDash && !player.prevDashState && player.stamina >= dashCost && !player.isDashing) {
        player.stamina = Math.max(0, player.stamina - dashCost);
        player.isDashing = true;
        player.dashTicksRemaining = 4; // K = 4 ticks (66.6 ms)

        // Dash vectorial continuo: se orienta según la velocidad física actual si ||v|| > 0.05
        if (vSpeed > 0.05) {
          player.dashDirX = disc.vel.x / vSpeed;
          player.dashDirY = disc.vel.y / vSpeed;
        } else if (hasMoveInput) {
          player.dashDirX = uMoveX;
          player.dashDirY = uMoveY;
        } else {
          player.dashDirX = player.team === 'red' ? 1 : -1;
          player.dashDirY = 0;
        }
      }
      player.prevDashState = isDashKeyDown;
      player.triggerDash = false;

      const wasDashing = player.isDashing;
      if (player.isDashing) {
        player.dashTicksRemaining--;
        // v_dash = (dashDistance / 4 ticks) * 60 ticks/s (impulso de 37.5 px en 4 ticks a velocidad 562.5 px/s)
        const dashSpeed = (this.gameplayConfig.dashDistance / 4) * 60;
        disc.vel.x = player.dashDirX * dashSpeed;
        disc.vel.y = player.dashDirY * dashSpeed;

        if (player.dashTicksRemaining <= 0) {
          player.isDashing = false;
        }
      } else {
        // Cinemática de Velocidad Base y Turbo Escalado
        const baseMaxSpeed = (this.gameplayConfig.playerMaxSpeed / 2.8) * 168.0;
        const kSpeedTurbo = this.gameplayConfig.boostMultiplier ?? 2.0;
        const turboMaxSpeed = baseMaxSpeed * kSpeedTurbo;
        const kAccelTurbo = Math.max(2.8, kSpeedTurbo * 1.5);
        const turboAccel = accel * kAccelTurbo;

        const canTurbo = this.gameplayConfig.turboEnabled !== false;
        const wantsTurbo = canTurbo && (((mask & INPUT_TURBO) !== 0) || player.isTurbo);
        if (wantsTurbo && hasMoveInput && player.stamina > 0) {
          player.isTurbo = true;
          player.stamina = Math.max(0, player.stamina - 40 * dt);
          if (player.stamina <= 0) {
            player.isTurbo = false;
          }

          disc.vel.x += uMoveX * turboAccel;
          disc.vel.y += uMoveY * turboAccel;

          const curSpeed = Math.hypot(disc.vel.x, disc.vel.y);
          if (curSpeed > turboMaxSpeed) {
            disc.vel.x = (disc.vel.x / curSpeed) * turboMaxSpeed;
            disc.vel.y = (disc.vel.y / curSpeed) * turboMaxSpeed;
          }
        } else {
          player.isTurbo = false;
          if (hasMoveInput) {
            const curSpeed = Math.hypot(disc.vel.x, disc.vel.y);
            if (curSpeed < baseMaxSpeed) {
              disc.vel.x += uMoveX * accel;
              disc.vel.y += uMoveY * accel;
              const postSpeed = Math.hypot(disc.vel.x, disc.vel.y);
              if (postSpeed > baseMaxSpeed) {
                disc.vel.x = (disc.vel.x / postSpeed) * baseMaxSpeed;
                disc.vel.y = (disc.vel.y / postSpeed) * baseMaxSpeed;
              }
            }
          }
        }
      }

      // Regeneración de Estamina Condicionada a Inputs Nulos
      // Recarga activa <=> !isMovingInput && !isDashing && !wasDashing
      const isMovingInput = hasMoveInput;
      if (!isMovingInput && !player.isDashing && !wasDashing) {
        player.stamina = Math.min(100, player.stamina + this.gameplayConfig.staminaRechargeRate * dt);
      }

      // Sincronizar escalares en disc para resolución de colisiones y renderizado
      disc.stamina = player.stamina;
      disc.isDashing = player.isDashing;
      disc.isTurbo = player.isTurbo;

      // Kicking mechanic con golpe potenciado (Dash x1.35, Turbo x1.15) y Efecto Magnus
      const isKicking = (mask & INPUT_KICK) !== 0;
      disc.kicking = isKicking;

      if (isKicking) {
        const diffX = this.ball.pos.x - disc.pos.x;
        const diffY = this.ball.pos.y - disc.pos.y;
        const distSq = diffX * diffX + diffY * diffY;

        if (distSq <= kickReach * kickReach) {
          const dist = Math.sqrt(distSq);
          const kickDirX = dist > 1e-6 ? diffX / dist : 1;
          const kickDirY = dist > 1e-6 ? diffY / dist : 0;

          let effectiveKickStrength = kickStrength;
          if (player.isDashing) {
            effectiveKickStrength = kickStrength * 1.35;
          } else if (player.isTurbo) {
            effectiveKickStrength = kickStrength * 1.15;
          }

          this.ball.vel.x += kickDirX * effectiveKickStrength;
          this.ball.vel.y += kickDirY * effectiveKickStrength;

          // Registro de autoría y vector perpendicular de referencia para Magnus
          this.ball.lastKickerId = player.id;
          this.ball.lastKickerDiscId = disc.id;
          const pSpeed = Math.hypot(disc.vel.x, disc.vel.y);
          if (pSpeed > 0.1) {
            this.ball.kickerHeading = new Vec2(disc.vel.x / pSpeed, disc.vel.y / pSpeed);
          } else {
            const dLen = dist > 1e-6 ? dist : 1;
            this.ball.kickerHeading = new Vec2(diffX / dLen, diffY / dLen);
          }
          this.ball.isCurvingAllowed = true;
          this.ball.isCurving = false;
          this.ball.curvePerp = 0;
          this.ball.curveBrake = 0;

          // Iniciación o compatibilidad de Efecto Magnus con inputs inmediatos
          let ex = player.curveX;
          let ey = player.curveY;
          if (player.curveInput === 1 || Boolean(player.inputMask & INPUT_MAGNUS_LEFT)) ex = -1;
          else if (player.curveInput === 2 || Boolean(player.inputMask & INPUT_MAGNUS_RIGHT)) ex = 1;

          if (ex !== 0 || ey !== 0) {
            const eLen = Math.hypot(ex, ey);
            ex /= eLen;
            ey /= eLen;

            const bSpeed = Math.hypot(this.ball.vel.x, this.ball.vel.y);
            if (bSpeed > 1e-6) {
              const ux = this.ball.vel.x / bSpeed;
              const uy = this.ball.vel.y / bSpeed;
              const cParallel = ex * ux + ey * uy;
              this.ball.curveBrake = cParallel < 0 ? Math.abs(cParallel) : 0;
            }
          }

          if (this.kickoffState.active) {
            this.kickoffState.active = false;
            this.updatePhysicsKickoffContext();
          }

          this.soundMask |= SOUND_KICK;
          if (this.onKick) {
            this.onKick(disc, this.ball);
          }
        }
      }
    }

    // Integración continua del Efecto Magnus Dirigido (Z / C / Flechas post-disparo)
    // Regla estricta: se aplica única y exclusivamente con magnusEnabled activo y tecla presionada activa
    const canMagnus = this.gameplayConfig.magnusEnabled !== false;
    if (canMagnus && this.ball.isCurvingAllowed && this.ball.lastKickerId) {
      const kicker = this.players.get(this.ball.lastKickerId);
      const bSpeed = Math.hypot(this.ball.vel.x, this.ball.vel.y);
      if (bSpeed > 0.05 && kicker) {
        const kMagnus = this.gameplayConfig.magnusCurveStrength ?? 1.05;
        const hasZ = kicker.curveInput === 1 || Boolean(kicker.inputMask & INPUT_MAGNUS_LEFT) || (kicker.curveX === -1);
        const hasC = kicker.curveInput === 2 || Boolean(kicker.inputMask & INPUT_MAGNUS_RIGHT) || (kicker.curveX === 1);

        if (hasZ && !hasC) {
          this.ball.applyMagnusCurve(true, false, kMagnus);
        } else if (hasC && !hasZ) {
          this.ball.applyMagnusCurve(false, true, kMagnus);
        } else {
          // Soltar tecla => aceleración lateral exactamente cero
          this.ball.isCurving = false;
          this.ball.curvePerp = 0;
        }

        if (this.ball.curveBrake > 0) {
          const ux = this.ball.vel.x / bSpeed;
          const uy = this.ball.vel.y / bSpeed;
          const aBrake = 1.8 * this.ball.curveBrake * bSpeed;
          this.ball.vel.x -= aBrake * ux * dt;
          this.ball.vel.y -= aBrake * uy * dt;
        }
      } else if (bSpeed <= 0.05) {
        this.ball.resetCurve();
      }
    } else if (this.ball.isCurving) {
      this.ball.resetCurve();
    }

    // Step physics simulation (activa en PLAYING y GOAL_CELEBRATION)
    this.physicsWorld.step();

    // Resetear lastKickerDiscId una vez el balón se separe completamente del pateador
    if (this.ball.lastKickerDiscId !== -1) {
      for (let i = 0; i < this.physicsWorld.discs.length; i++) {
        const d = this.physicsWorld.discs[i];
        if (d.id === this.ball.lastKickerDiscId) {
          const dx = this.ball.pos.x - d.pos.x;
          const dy = this.ball.pos.y - d.pos.y;
          const minDist = this.ball.radius + d.radius + 1.0;
          if (dx * dx + dy * dy >= minDist * minDist) {
            this.ball.lastKickerDiscId = -1;
          }
          break;
        }
      }
    }

    // Detección de contacto con el balón para desactivar barreras de saque
    if (this.kickoffState.active) {
      for (const [playerId, player] of this.players.entries()) {
        if (player.team === 'spec') continue;
        const disc = this.playerDiscs.get(playerId);
        if (!disc) continue;
        const touchDist = this.ball.radius + disc.radius;
        const dx = this.ball.pos.x - disc.pos.x;
        const dy = this.ball.pos.y - disc.pos.y;
        if (dx * dx + dy * dy <= touchDist * touchDist + 1.0) {
          this.kickoffState.active = false;
          this.updatePhysicsKickoffContext();
          break;
        }
      }
    }

    // Detección de gol y candado infranqueable del marcador (Score Lock)
    if (this.fsm.isVictoryCelebration() || this.fsm.isMatchEnded()) {
      // Candado Crítico: Prohibido registrar nuevos goles o alterar el score
      // Si un jugador empuja la pelota hacia cualquier portería durante los 5 segundos de celebración,
      // la pelota interactuará físicamente con el arco pero el marcador no se incrementará ni se emitirán eventos de gol adicionales.
    } else if (this.fsm.currentState === MatchPhase.PLAYING) {
      const goalScored = this.stadium.checkGoal(this.ball.pos.x, this.ball.pos.y);
      if (goalScored) {
        if (goalScored === 'red') {
          this.redScore++;
          this.lastScoringTeam = 'red';
        } else {
          this.blueScore++;
          this.lastScoringTeam = 'blue';
        }

        this.soundMask |= SOUND_GOAL;
        if (this.onGoal) {
          this.onGoal(goalScored, this.redScore, this.blueScore);
        }

        if (this.isGoldenGoal) {
          // ¡GOL DE ORO! En prórroga cualquier gol concluye la partida con celebración de victoria activa (5.0s / 300 ticks)
          this.fsm.startVictoryCelebration(goalScored, 300);
          if (this.onStateChange) {
            this.onStateChange(this.fsm.currentState);
          }
        } else {
          const matchEnded = this.checkMatchConclusion();
          if (!matchEnded) {
            this.fsm.startGoalCelebration(180);
            if (this.onStateChange) {
              this.onStateChange(this.fsm.currentState);
            }
          }
        }
      }
    }

    // Actualización de temporizadores de estados de celebración
    if (this.fsm.currentState === MatchPhase.GOAL_CELEBRATION) {
      const transitioned = this.fsm.tick();
      if (transitioned) {
        // Al expirar los 3 segundos de celebración: el equipo que recibió el gol saca de centro
        const possessingTeam = this.lastScoringTeam === 'red' ? 'blue' : (this.lastScoringTeam === 'blue' ? 'red' : null);
        this.kickoffState = {
          active: true,
          mode: 'TEAM_KICKOFF',
          possessingTeam
        };
        this.updatePhysicsKickoffContext();
        this.activePlayTicks = 0;
        this.lastScoringTeam = null;
        this.resetPositionsForKickoff(true);
        if (this.onStateChange) {
          this.onStateChange(this.fsm.currentState);
        }
      }
    } else if (this.fsm.currentState === MatchPhase.VICTORY_CELEBRATION || this.fsm.currentState === MatchPhase.MATCH_ENDED) {
      const transitioned = this.fsm.tick();
      if (transitioned) {
        if (this.onMatchEnd) {
          this.onMatchEnd(this.fsm.winningTeam);
        }
        if (this.onStateChange) {
          this.onStateChange(this.fsm.currentState);
        }
      }
    }
  }

  private checkMatchConclusion(): boolean {
    if (this.config.scoreLimit > 0) {
      if (this.redScore >= this.config.scoreLimit) {
        this.fsm.startVictoryCelebration('red', 300);
        if (this.onStateChange) this.onStateChange(this.fsm.currentState);
        return true;
      } else if (this.blueScore >= this.config.scoreLimit) {
        this.fsm.startVictoryCelebration('blue', 300);
        if (this.onStateChange) this.onStateChange(this.fsm.currentState);
        return true;
      }
    }
    if (this.config.timeLimitSeconds > 0 && this.matchTimerSeconds <= 0 && !this.isGoldenGoal) {
      if (this.redScore === this.blueScore) {
        // Empate reglamentario al agotarse el tiempo: activar prórroga indefinida de Gol de Oro
        this.isGoldenGoal = true;
        this.matchTimerSeconds = 0;
        return false;
      } else {
        const winner = this.redScore > this.blueScore ? 'red' : 'blue';
        this.fsm.startVictoryCelebration(winner, 300);
        if (this.onStateChange) this.onStateChange(this.fsm.currentState);
        return true;
      }
    }
    return false;
  }

  public getSnapshot(): GameSnapshot {
    // Freeze velocity in any non-active state to prevent false extrapolation on clients
    const isFrozen = this.fsm.currentState !== MatchPhase.PLAYING &&
                     this.fsm.currentState !== MatchPhase.GOAL_CELEBRATION &&
                     this.fsm.currentState !== MatchPhase.VICTORY_CELEBRATION;
    const discSnapshots: DiscSnapshot[] = [];

    // Ball
    const kickerDiscId = this.ball.lastKickerDiscId !== -1
      ? this.ball.lastKickerDiscId
      : (this.ball.lastKickerId ? (this.playerDiscs.get(this.ball.lastKickerId)?.id ?? null) : null);

    discSnapshots.push({
      id: this.ball.id,
      team: 0,
      x: this.ball.pos.x,
      y: this.ball.pos.y,
      vx: isFrozen ? 0 : this.ball.vel.x,
      vy: isFrozen ? 0 : this.ball.vel.y,
      radius: this.ball.radius,
      kicking: false,
      avatar: '',
      isSpinActive: this.ball.isCurving,
      isCurvingAllowed: this.ball.isCurvingAllowed,
      lastKickerId: kickerDiscId,
      curveFactor: Math.round(this.ball.curvePerp * 10),
      spin: this.ball.spin || this.ball.curvePerp
    });

    // Players
    for (const [playerId, player] of this.players.entries()) {
      const disc = this.playerDiscs.get(playerId);
      if (disc) {
        discSnapshots.push({
          id: disc.id,
          team: player.team === 'red' ? 1 : 2,
          x: disc.pos.x,
          y: disc.pos.y,
          vx: isFrozen ? 0 : disc.vel.x,
          vy: isFrozen ? 0 : disc.vel.y,
          radius: disc.radius,
          kicking: disc.kicking,
          avatar: player.avatar,
          stamina: Math.round(player.stamina),
          isDashing: player.isDashing,
          isTurbo: player.isTurbo,
          isTyping: disc.isTyping
        });
      }
    }

    let targetTeam = 0;
    if (this.fsm.currentState === MatchPhase.GOAL_CELEBRATION) {
      targetTeam = this.lastScoringTeam === 'red' ? 1 : (this.lastScoringTeam === 'blue' ? 2 : 0);
    } else if (this.fsm.currentState === MatchPhase.VICTORY_CELEBRATION || this.fsm.currentState === MatchPhase.MATCH_ENDED) {
      targetTeam = this.fsm.winningTeam === 'red' ? 1 : (this.fsm.winningTeam === 'blue' ? 2 : 0);
    }

    const subStateTimer = this.fsm.stateTicksRemaining > 0 ? this.fsm.stateTicksRemaining / 60 : 0;

    return {
      tick: this.tickCount,
      matchPhase: this.fsm.currentState,
      timerSeconds: this.matchTimerSeconds,
      subStateTimer,
      targetTeam,
      scoreRed: this.redScore,
      scoreBlue: this.blueScore,
      soundMask: this.soundMask,
      kickoffActive: this.kickoffState.active,
      kickoffMode: this.kickoffState.mode,
      possessingTeam: this.kickoffState.possessingTeam,
      isGoldenGoal: this.isGoldenGoal,
      discs: discSnapshots,

      // Compatibilidad
      matchState: this.fsm.currentState,
      matchTimerSeconds: this.matchTimerSeconds,
      redScore: this.redScore,
      blueScore: this.blueScore,
      countdownSeconds: this.fsm.countdownSeconds
    };
  }

  /**
   * Resolución física pura y sin GC de las barreras reglamentarias de saque:
   * - Equipo con derecho al saque: libre acceso a todo su semicampo y a la totalidad del
   *   círculo central (R <= centerR), incluyendo la mitad en campo rival. No pueden salir
   *   del círculo central hacia el resto del campo contrario.
   * - Equipo rival: no pueden traspasar su línea media (X = 0) ni ingresar al círculo central (R >= centerR + r).
   * - En saque NEUTRAL: ambos equipos limitados a su respectivo semicampo en X = 0.
   */
  public updatePhysicsKickoffContext(): void {
    if (this.kickoffState.active && this.kickoffState.possessingTeam) {
      this.physicsWorld.kickoffContext = {
        active: true,
        possessingTeam: this.kickoffState.possessingTeam,
        centerRadius: this.stadium.centerRadius ?? 80
      };
    } else {
      this.physicsWorld.kickoffContext = null;
    }
  }

  /**
   * Resolución física pura y sin GC de las barreras reglamentarias de saque:
   * - Desacoplamiento de restricciones en semicampos:
   *   - En propio campo: sin restricción circular ni barrera de línea media.
   *   - En semicampo rival: si |y| >= R_círculo impide cruce (x <= 0 o x >= 0, v_x anulada).
   *     si |y| < R_círculo, permite paso dentro del círculo y proyecta suavemente a la
   *     circunferencia interior sin saltos ni teleporting.
   * - Eliminación de impulsos espurios en vértices (0, ±R_círculo) para jugadores que sacan.
   * - Equipo rival: no pueden traspasar su línea media (X = 0) ni ingresar al círculo central (R >= centerR + r).
   * - En saque NEUTRAL: ambos equipos limitados a su respectivo semicampo en X = 0.
   */
  public applyKickoffBarriers(): void {
    if (!this.kickoffState.active) {
      if (this.physicsWorld.kickoffContext) {
        this.physicsWorld.kickoffContext = null;
      }
      return;
    }

    this.updatePhysicsKickoffContext();

    const centerR = this.stadium.centerRadius ?? 80;

    for (const [playerId, player] of this.players.entries()) {
      if (player.team === 'spec') continue;
      const disc = this.playerDiscs.get(playerId);
      if (!disc) continue;

      const r = disc.radius;

      // 1. Caso TEAM_KICKOFF con equipo poseedor determinado
      if (this.kickoffState.mode === 'TEAM_KICKOFF' && this.kickoffState.possessingTeam) {
        const isPossessing = player.team === this.kickoffState.possessingTeam;

        if (isPossessing) {
          // Equipo con posesión del saque:
          // Restricción estricta de línea media: NO cruzar la línea media bajo ninguna circunstancia.
          // Línea recta infinita X = 0, sin cálculos de arcos ni esquinas en (0, ±R), deslizamiento continuo.
          this.physicsWorld.enforceMidfieldBarrier(disc, player.team as 'red' | 'blue');
        } else {
          // Equipo rival (defensa sin cambios):
          // 1. No pueden traspasar su línea media (X = 0)
          if (player.team === 'red') {
            if (disc.pos.x > -r) {
              disc.pos.x = -r;
              if (disc.vel.x > 0) disc.vel.x = 0;
            }
          } else if (player.team === 'blue') {
            if (disc.pos.x < r) {
              disc.pos.x = r;
              if (disc.vel.x < 0) disc.vel.x = 0;
            }
          }

          // 2. Vetado de todo el radio del círculo central (dist >= centerR + r)
          const limitR = centerR + r;
          const px = disc.pos.x;
          const py = disc.pos.y;
          const distSq = px * px + py * py;

          if (distSq < limitR * limitR) {
            const dist = Math.sqrt(distSq);
            if (dist > 1e-6) {
              const nx = px / dist;
              const ny = py / dist;
              disc.pos.x = nx * limitR;
              disc.pos.y = ny * limitR;

              // Anular la componente de velocidad entrante hacia el centro
              const vDotN = disc.vel.x * nx + disc.vel.y * ny;
              if (vDotN < 0) {
                disc.vel.x -= vDotN * nx;
                disc.vel.y -= vDotN * ny;
              }
            } else {
              const dirX = player.team === 'red' ? -1 : 1;
              disc.pos.x = dirX * limitR;
              disc.pos.y = 0;
              if (player.team === 'red' && disc.vel.x > 0) disc.vel.x = 0;
              if (player.team === 'blue' && disc.vel.x < 0) disc.vel.x = 0;
            }

            // Asegurar que el empuje radial no lo empuje hacia el campo rival
            if (player.team === 'red' && disc.pos.x > -r) {
              disc.pos.x = -r;
              if (disc.vel.x > 0) disc.vel.x = 0;
            } else if (player.team === 'blue' && disc.pos.x < r) {
              disc.pos.x = r;
              if (disc.vel.x < 0) disc.vel.x = 0;
            }
          }
        }
      } else {
        // 2. Caso NEUTRAL (saque inicial neutral sin equipo poseedor único):
        // Ambos equipos restringidos a su mitad sin cruzar la línea media (X = 0)
        this.physicsWorld.enforceMidfieldBarrier(disc, player.team as 'red' | 'blue');
      }
    }
  }

  /**
   * Determina si el Host debe emitir un SnapshotPacket en el tick actual para
   * broadcast rate adaptativo:
   * - <= 3 jugadores: 60 Hz (cada tick de 16.6 ms)
   * - >= 4 jugadores: 30 Hz (cada 2 ticks / 33.3 ms) para economizar CPU y ancho de banda TURN
   */
  public shouldBroadcastSnapshot(tickIndex: number): boolean {
    if (this.players.size <= 3) {
      return true;
    }
    return tickIndex % 2 === 0;
  }

  public getAdaptiveSnapshotRate(): number {
    return this.players.size <= 3 ? 60 : 30;
  }
}

