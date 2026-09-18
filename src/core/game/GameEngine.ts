import { PhysicsWorld } from '../physics/PhysicsWorld';
import { Stadium } from '../entities/Stadium';
import { Disc, COLLISION_GROUP_BALL, COLLISION_GROUP_RED, COLLISION_GROUP_BLUE } from '../entities/Disc';
import { Player, INPUT_UP, INPUT_DOWN, INPUT_LEFT, INPUT_RIGHT, INPUT_KICK, INPUT_TURBO, INPUT_DASH } from './Player';
import { GameFSM, MatchPhase } from './GameFSM';
import { GameSnapshot, DiscSnapshot, MatchConfig, KickoffState } from './GameState';
import { SOUND_KICK, SOUND_POST_HIT, SOUND_GOAL } from '../../net/protocol/BinaryProtocol';

export class GameEngine {
  public physicsWorld: PhysicsWorld;
  public stadium: Stadium;
  public ball: Disc;
  public players: Map<string, Player> = new Map();
  public playerDiscs: Map<string, Disc> = new Map();
  public fsm: GameFSM;
  public kickoffState: KickoffState = {
    active: false,
    mode: 'NEUTRAL',
    possessingTeam: null
  };

  public tickCount: number = 0;
  public redScore: number = 0;
  public blueScore: number = 0;
  public matchTimerSeconds: number = 180;
  public config: MatchConfig;
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

  constructor(config: Partial<MatchConfig> = {}) {
    this.config = {
      scoreLimit: config.scoreLimit ?? 3,
      timeLimitSeconds: config.timeLimitSeconds ?? 180
    };
    this.matchTimerSeconds = this.config.timeLimitSeconds;

    this.physicsWorld = new PhysicsWorld({ fixedDt: 1 / 60, maxSubsteps: 8 });
    this.stadium = new Stadium();
    this.fsm = new GameFSM();
    this.fsm.onStateChange = (state) => {
      this.onStateChange?.(state);
    };

    // Register stadium walls and goal posts
    for (const seg of this.stadium.segments) {
      this.physicsWorld.addSegment(seg);
    }
    for (const post of this.stadium.posts) {
      this.physicsWorld.addDisc(post);
    }

    // Create Ball
    this.ball = new Disc({
      id: 0,
      x: 0,
      y: 0,
      radius: 10,
      mass: 1,
      damping: 0.99,
      bounciness: 0.5,
      cGroup: COLLISION_GROUP_BALL,
      isBall: true,
      color: '#ffffff'
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
                if (this.kickoffState.mode === 'NEUTRAL' || player.team === this.kickoffState.possessingTeam) {
                  this.kickoffState.active = false;
                }
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
      radius: 15,
      mass: 2,
      damping: 0.96,
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
    this.matchTimerSeconds = this.config.timeLimitSeconds > 0 ? this.config.timeLimitSeconds : 0;
    this.resetKickoffPositions();
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
    this.matchTimerSeconds = 0;
    this.soundMask = 0;
    this.fsm.stopMatch();
    this.resetKickoffPositions();
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

  public resetKickoffPositions(): void {
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

      if (player.team === 'red') {
        const offset = redIndex * 40 - 20 * redIndex;
        disc.pos.set(-180, offset);
        disc.prevPos.copy(disc.pos);
        redIndex++;
      } else if (player.team === 'blue') {
        const offset = blueIndex * 40 - 20 * blueIndex;
        disc.pos.set(180, offset);
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

    // Si está en cuenta regresiva (3, 2, 1), avanza la cuenta pero congela la física
    if (this.fsm.currentState === MatchPhase.COUNTDOWN) {
      const transitioned = this.fsm.tick();
      if (transitioned && this.onStateChange) {
        this.onStateChange(this.fsm.currentState);
      }
      return;
    }

    // Si está en MATCH_ENDED (3s de pantalla de victoria), congela patadas y avanza temporizador síncrono
    if (this.fsm.currentState === MatchPhase.MATCH_ENDED) {
      const transitioned = this.fsm.tick();
      if (transitioned) {
        if (this.onMatchEnd) {
          this.onMatchEnd(this.fsm.winningTeam);
        }
        if (this.onStateChange) {
          this.onStateChange(this.fsm.currentState);
        }
      }
      return;
    }

    // Estados activos: PLAYING o GOAL_CELEBRATION
    if (this.fsm.currentState === MatchPhase.PLAYING) {
      // Advance match timer (every 60 ticks = 1 second) únicamente en PLAYING
      if (this.tickCount % 60 === 0) {
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
    const accel = 7.5;
    const kickStrength = 320.0;
    const kickReach = 15 + 10 + 6; // player radius (15) + ball radius (10) + reach margin (6)

    for (const [playerId, player] of this.players.entries()) {
      const disc = this.playerDiscs.get(playerId);
      if (!disc) continue;

      const mask = inputs.get(playerId) ?? player.inputMask;
      player.inputMask = mask;

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

      // Dash Mechanic (salto rápido predeterminado, consume 50% de estamina)
      const wantsDash = ((mask & INPUT_DASH) !== 0) || player.triggerDash;
      if (wantsDash && player.stamina >= 50 && !player.isDashing) {
        player.stamina -= 50;
        player.isDashing = true;
        player.dashTicksRemaining = 4; // K = 4 ticks (66.6 ms)

        if (hasMoveInput) {
          player.dashDirX = uMoveX;
          player.dashDirY = uMoveY;
        } else if (vSpeed > 0.01) {
          player.dashDirX = disc.vel.x / vSpeed;
          player.dashDirY = disc.vel.y / vSpeed;
        } else {
          player.dashDirX = player.team === 'red' ? 1 : -1;
          player.dashDirY = 0;
        }
        player.triggerDash = false;
      }

      if (player.isDashing) {
        player.dashTicksRemaining--;
        // v_dash = u_dir * 18.75 px/tick (18.75 * 60 = 1125 px/s)
        const dashSpeed = 18.75 * 60;
        disc.vel.x = player.dashDirX * dashSpeed;
        disc.vel.y = player.dashDirY * dashSpeed;

        if (player.dashTicksRemaining <= 0) {
          player.isDashing = false;
        }
      } else {
        // Turbo Mechanic (sprint continuo a 40%/s mientras se mantenga presionada la tecla y se mueva)
        const wantsTurbo = ((mask & INPUT_TURBO) !== 0) || player.isTurbo;
        if (wantsTurbo && hasMoveInput && player.stamina > 0) {
          player.isTurbo = true;
          player.stamina = Math.max(0, player.stamina - 40 * dt);
          if (player.stamina <= 0) {
            player.isTurbo = false;
          }

          // Aceleración de Turbo alcanzando v_turbo = 150 px/s (2.5 px/tick, ~45% sobre base)
          disc.vel.x += uMoveX * (accel * 1.45);
          disc.vel.y += uMoveY * (accel * 1.45);

          const curSpeed = Math.hypot(disc.vel.x, disc.vel.y);
          if (curSpeed > 150) {
            disc.vel.x = (disc.vel.x / curSpeed) * 150;
            disc.vel.y = (disc.vel.y / curSpeed) * 150;
          }
        } else {
          player.isTurbo = false;
          if (hasMoveInput) {
            disc.vel.x += uMoveX * accel;
            disc.vel.y += uMoveY * accel;
          }
        }
      }

      // Regla Estricta de Recarga en Inmovilidad Total
      // Recarga activa <=> ||v_player|| < 0.01 && ||inputs_movimiento|| == 0 && !isDashing (+25%/s)
      const isCompletelyStill = vSpeed < 0.01 && !hasMoveInput && !player.isDashing;
      if (isCompletelyStill) {
        player.stamina = Math.min(100, player.stamina + 25 * dt);
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

          // Iniciación del Efecto Magnus 2D Dirigido
          let ex = player.curveX;
          let ey = player.curveY;
          if (ex !== 0 || ey !== 0) {
            const eLen = Math.hypot(ex, ey);
            ex /= eLen;
            ey /= eLen;

            const bSpeed = Math.hypot(this.ball.vel.x, this.ball.vel.y);
            if (bSpeed > 1e-6) {
              const ux = this.ball.vel.x / bSpeed;
              const uy = this.ball.vel.y / bSpeed;
              const uPerpX = -uy;
              const uPerpY = ux;

              const cParallel = ex * ux + ey * uy;
              const cPerp = ex * uPerpX + ey * uPerpY;

              this.ball.isCurving = true;
              this.ball.curvePerp = cPerp;
              this.ball.curveBrake = cParallel < 0 ? Math.abs(cParallel) : 0;
            }
          }

          this.ball.lastKickerId = disc.id;

          if (this.kickoffState.active) {
            if (this.kickoffState.mode === 'NEUTRAL' || player.team === this.kickoffState.possessingTeam) {
              this.kickoffState.active = false;
            }
          }

          this.soundMask |= SOUND_KICK;
          if (this.onKick) {
            this.onKick(disc, this.ball);
          }
        }
      }
    }

    // Integración continua del Efecto Magnus en el bucle fijo a 60 Hz
    if (this.ball.isCurving) {
      const bvx = this.ball.vel.x;
      const bvy = this.ball.vel.y;
      const bSpeed = Math.hypot(bvx, bvy);
      if (bSpeed > 0.1) {
        const ux = bvx / bSpeed;
        const uy = bvy / bSpeed;
        const uPerpX = -uy;
        const uPerpY = ux;

        const kMagnus = 0.08;
        const kBrake = 1.8;

        const aCurveMag = kMagnus * this.ball.curvePerp * bSpeed;
        const aCurveX = aCurveMag * uPerpX;
        const aCurveY = aCurveMag * uPerpY;

        const aBrakeMag = kBrake * this.ball.curveBrake * bSpeed;
        const aBrakeX = -aBrakeMag * ux;
        const aBrakeY = -aBrakeMag * uy;

        this.ball.vel.x += (aCurveX + aBrakeX) * dt;
        this.ball.vel.y += (aCurveY + aBrakeY) * dt;
      } else {
        this.ball.resetCurve();
      }
    }

    // Step physics simulation (activa en PLAYING y GOAL_CELEBRATION)
    this.physicsWorld.step();

    // Resetear lastKickerId una vez el balón se separe completamente del pateador
    if (this.ball.lastKickerId !== -1) {
      for (let i = 0; i < this.physicsWorld.discs.length; i++) {
        const d = this.physicsWorld.discs[i];
        if (d.id === this.ball.lastKickerId) {
          const dx = this.ball.pos.x - d.pos.x;
          const dy = this.ball.pos.y - d.pos.y;
          const minDist = this.ball.radius + d.radius + 1.0;
          if (dx * dx + dy * dy >= minDist * minDist) {
            this.ball.lastKickerId = -1;
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
          if (this.kickoffState.mode === 'NEUTRAL' || player.team === this.kickoffState.possessingTeam) {
            this.kickoffState.active = false;
            break;
          }
        }
      }
    }

    // Detección de gol (deshabilitada durante GOAL_CELEBRATION para evitar conteos dobles)
    if (this.fsm.currentState === MatchPhase.PLAYING) {
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
          // ¡GOL DE ORO! En prórroga cualquier gol concluye la partida inmediatamente
          this.fsm.startMatchEnded(goalScored, 180);
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
    } else if (this.fsm.currentState === MatchPhase.GOAL_CELEBRATION) {
      const transitioned = this.fsm.tick();
      if (transitioned) {
        // Al expirar los 3 segundos de celebración: el equipo que recibió el gol saca de centro
        const possessingTeam = this.lastScoringTeam === 'red' ? 'blue' : (this.lastScoringTeam === 'blue' ? 'red' : null);
        this.kickoffState = {
          active: true,
          mode: 'TEAM_KICKOFF',
          possessingTeam
        };
        this.lastScoringTeam = null;
        this.resetKickoffPositions();
        if (this.onStateChange) {
          this.onStateChange(this.fsm.currentState);
        }
      }
    }
  }

  private checkMatchConclusion(): boolean {
    if (this.config.scoreLimit > 0) {
      if (this.redScore >= this.config.scoreLimit) {
        this.fsm.startMatchEnded('red', 180);
        if (this.onStateChange) this.onStateChange(this.fsm.currentState);
        return true;
      } else if (this.blueScore >= this.config.scoreLimit) {
        this.fsm.startMatchEnded('blue', 180);
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
        this.fsm.startMatchEnded(winner, 180);
        if (this.onStateChange) this.onStateChange(this.fsm.currentState);
        return true;
      }
    }
    return false;
  }

  public getSnapshot(): GameSnapshot {
    // Freeze velocity in any non-active state to prevent false extrapolation on clients
    const isFrozen = this.fsm.currentState !== MatchPhase.PLAYING && this.fsm.currentState !== MatchPhase.GOAL_CELEBRATION;
    const discSnapshots: DiscSnapshot[] = [];

    // Ball
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
      curveFactor: Math.round(this.ball.curvePerp * 10)
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
          isTurbo: player.isTurbo
        });
      }
    }

    let targetTeam = 0;
    if (this.fsm.currentState === MatchPhase.GOAL_CELEBRATION) {
      targetTeam = this.lastScoringTeam === 'red' ? 1 : (this.lastScoringTeam === 'blue' ? 2 : 0);
    } else if (this.fsm.currentState === MatchPhase.MATCH_ENDED) {
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
   * Resolución física pura y sin GC de las barreras reglamentarias de saque.
   */
  public applyKickoffBarriers(): void {
    if (!this.kickoffState.active) return;

    for (const [playerId, player] of this.players.entries()) {
      if (player.team === 'spec') continue;
      const disc = this.playerDiscs.get(playerId);
      if (!disc) continue;

      const r = disc.radius;

      // 1. Barrera de Mitad de Cancha (X = 0)
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

      // 2. Barrera de Rotonda Central (R = 80)
      if (this.kickoffState.mode === 'TEAM_KICKOFF' && player.team !== this.kickoffState.possessingTeam) {
        const limitR = 80 + r;
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
        }
      }
    }
  }
}

