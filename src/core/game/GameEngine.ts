import { PhysicsWorld } from '../physics/PhysicsWorld';
import { Stadium } from '../entities/Stadium';
import { Disc, COLLISION_GROUP_BALL, COLLISION_GROUP_RED, COLLISION_GROUP_BLUE } from '../entities/Disc';
import { Player, INPUT_UP, INPUT_DOWN, INPUT_LEFT, INPUT_RIGHT, INPUT_KICK } from './Player';
import { GameFSM, MatchState } from './GameFSM';
import { GameSnapshot, DiscSnapshot, MatchConfig } from './GameState';

export class GameEngine {
  public physicsWorld: PhysicsWorld;
  public stadium: Stadium;
  public ball: Disc;
  public players: Map<string, Player> = new Map();
  public playerDiscs: Map<string, Disc> = new Map();
  public fsm: GameFSM;

  public tickCount: number = 0;
  public redScore: number = 0;
  public blueScore: number = 0;
  public matchTimerSeconds: number = 180;
  public config: MatchConfig;

  // Event callbacks
  public onGoal?: (scoringTeam: 'red' | 'blue', redScore: number, blueScore: number) => void;
  public onKick?: (playerDisc: Disc, ball: Disc) => void;
  public onPostHit?: (ball: Disc, post: Disc) => void;
  public onMatchEnd?: (winner: 'red' | 'blue' | null) => void;
  public onStateChange?: (state: MatchState) => void;

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

    // Collision listener for post hits
    this.physicsWorld.onCollision = (event) => {
      if (event.type === 'disc-disc' && event.discB) {
        const isBall = event.discA === this.ball || event.discB === this.ball;
        const post = this.stadium.posts.find(p => p === event.discA || p === event.discB);
        if (isBall && post && this.onPostHit) {
          this.onPostHit(this.ball, post);
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
      if (this.fsm.currentState === MatchState.WAITING) {
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
    this.matchTimerSeconds = this.config.timeLimitSeconds > 0 ? this.config.timeLimitSeconds : 0;
    this.fsm.startMatch();
    this.resetKickoffPositions();
    if (this.onStateChange) {
      this.onStateChange(this.fsm.currentState);
    }
  }

  public stopMatch(): void {
    this.fsm.resetToWaiting();
    this.resetKickoffPositions();
    if (this.onStateChange) {
      this.onStateChange(this.fsm.currentState);
    }
  }

  public resetKickoffPositions(): void {
    // Reset ball to center
    this.ball.pos.set(0, 0);
    this.ball.vel.zero();
    this.ball.prevPos.set(0, 0);

    // Arrange Red and Blue players
    let redIndex = 0;
    let blueIndex = 0;

    for (const [playerId, player] of this.players.entries()) {
      const disc = this.playerDiscs.get(playerId);
      if (!disc) continue;

      disc.vel.zero();
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
    this.tickCount++;

    const prevState = this.fsm.currentState;
    const transitioned = this.fsm.tick();

    if (transitioned) {
      if (this.fsm.currentState === MatchState.COUNTDOWN && prevState === MatchState.GOAL_SCORED) {
        this.resetKickoffPositions();
      }
      if (this.onStateChange) {
        this.onStateChange(this.fsm.currentState);
      }
    }

    const state = this.fsm.currentState;

    if (state === MatchState.PLAYING) {
      // Advance match timer (every 60 ticks = 1 second)
      if (this.tickCount % 60 === 0) {
        if (this.config.timeLimitSeconds > 0) {
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

    // Apply player movement and kicking in COUNTDOWN or PLAYING
    if (state === MatchState.COUNTDOWN || state === MatchState.PLAYING) {
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

        if (dirX !== 0 || dirY !== 0) {
          const len = Math.sqrt(dirX * dirX + dirY * dirY);
          disc.vel.x += (dirX / len) * accel;
          disc.vel.y += (dirY / len) * accel;
        }

        // Kicking mechanic
        const isKicking = (mask & INPUT_KICK) !== 0;
        disc.kicking = isKicking;

        if (isKicking && state === MatchState.PLAYING) {
          const diffX = this.ball.pos.x - disc.pos.x;
          const diffY = this.ball.pos.y - disc.pos.y;
          const distSq = diffX * diffX + diffY * diffY;

          if (distSq <= kickReach * kickReach) {
            const dist = Math.sqrt(distSq);
            const kickDirX = dist > 1e-6 ? diffX / dist : 1;
            const kickDirY = dist > 1e-6 ? diffY / dist : 0;

            this.ball.vel.x += kickDirX * kickStrength;
            this.ball.vel.y += kickDirY * kickStrength;

            if (this.onKick) {
              this.onKick(disc, this.ball);
            }
          }
        }
      }

      // Step physics simulation
      this.physicsWorld.step();

      // Check for goal
      if (state === MatchState.PLAYING) {
        const goalScored = this.stadium.checkGoal(this.ball.pos.x, this.ball.pos.y);
        if (goalScored) {
          if (goalScored === 'red') {
            this.redScore++;
          } else {
            this.blueScore++;
          }

          this.fsm.scoreGoal(goalScored);
          if (this.onGoal) {
            this.onGoal(goalScored, this.redScore, this.blueScore);
          }

          if (this.onStateChange) {
            this.onStateChange(this.fsm.currentState);
          }

          this.checkMatchConclusion();
        }
      }
    }
  }

  private checkMatchConclusion(): void {
    if (this.config.scoreLimit > 0) {
      if (this.redScore >= this.config.scoreLimit) {
        this.fsm.endMatch('red');
        if (this.onMatchEnd) this.onMatchEnd('red');
        return;
      } else if (this.blueScore >= this.config.scoreLimit) {
        this.fsm.endMatch('blue');
        if (this.onMatchEnd) this.onMatchEnd('blue');
        return;
      }
    }
    if (this.config.timeLimitSeconds > 0 && this.matchTimerSeconds <= 0) {
      let winner: 'red' | 'blue' | null = null;
      if (this.redScore > this.blueScore) winner = 'red';
      else if (this.blueScore > this.redScore) winner = 'blue';
      this.fsm.endMatch(winner);
      if (this.onMatchEnd) this.onMatchEnd(winner);
    }
  }

  public getSnapshot(): GameSnapshot {
    const discSnapshots: DiscSnapshot[] = [];

    // Ball
    discSnapshots.push({
      id: this.ball.id,
      team: 0,
      x: this.ball.pos.x,
      y: this.ball.pos.y,
      vx: this.ball.vel.x,
      vy: this.ball.vel.y,
      radius: this.ball.radius,
      kicking: false,
      avatar: ''
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
          vx: disc.vel.x,
          vy: disc.vel.y,
          radius: disc.radius,
          kicking: disc.kicking,
          avatar: player.avatar
        });
      }
    }

    return {
      tick: this.tickCount,
      matchState: this.fsm.currentState,
      matchTimerSeconds: this.matchTimerSeconds,
      redScore: this.redScore,
      blueScore: this.blueScore,
      discs: discSnapshots
    };
  }
}
