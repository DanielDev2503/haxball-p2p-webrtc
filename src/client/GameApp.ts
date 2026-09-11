import { GameEngine } from '../core/game/GameEngine';
import { Player, TeamType } from '../core/game/Player';
import { MatchState } from '../core/game/GameFSM';
import { GameSnapshot } from '../core/game/GameState';
import { CanvasRenderer } from '../render/CanvasRenderer';
import { InputManager } from './InputManager';
import { AudioManager } from './AudioManager';
import { ScoreboardHUD } from '../ui/components/ScoreboardHUD';
import { ChatBox } from '../ui/components/ChatBox';
import { TeamSelectModal } from '../ui/components/TeamSelectModal';
import { RoomLobby } from '../ui/components/RoomLobby';
import { SignalingClient, SignalingMessage } from '../net/signaling/SignalingClient';
import { PeerConnection } from '../net/transport/PeerConnection';
import { InputPacket } from '../net/protocol/InputPacket';
import { SnapshotPacket } from '../net/protocol/SnapshotPacket';
import { JitterBuffer } from '../net/transport/JitterBuffer';

export type AppMode = 'practice' | 'host' | 'client';

export class GameApp {
  public mode: AppMode = 'practice';
  public localPlayer: Player;
  public engine: GameEngine | null = null;
  public canvasRenderer: CanvasRenderer;
  public inputManager: InputManager;
  public audioManager: AudioManager;
  public hud: ScoreboardHUD;
  public chat: ChatBox;
  public teamSelect: TeamSelectModal;
  public lobby: RoomLobby;

  // Networking
  public signaling: SignalingClient;
  public peers: Map<string, PeerConnection> = new Map();
  public hostPeer: PeerConnection | null = null;
  public jitterBuffer: JitterBuffer;
  public clientInputSequence: number = 0;

  // Loop & timing
  private isRunning: boolean = true;
  private lastTime: number = performance.now();
  private accumulator: number = 0;
  private readonly fixedDt: number = 1 / 60;
  private frameCount: number = 0;
  private lastFpsUpdate: number = performance.now();
  private currentFps: number = 60;
  private currentPing: number = 0;

  constructor() {
    const canvas = document.getElementById('gameCanvas') as HTMLCanvasElement;
    this.localPlayer = new Player({
      id: 'local_' + Math.random().toString(36).substring(2, 7),
      name: 'Player',
      team: 'red',
      isHost: true
    });

    this.inputManager = new InputManager();
    this.audioManager = new AudioManager();
    this.hud = new ScoreboardHUD();
    this.chat = new ChatBox();
    this.teamSelect = new TeamSelectModal();
    this.jitterBuffer = new JitterBuffer(70);

    // Default engine for practice
    this.engine = new GameEngine();
    this.canvasRenderer = new CanvasRenderer(canvas, this.engine.stadium);

    // Detección dinámica de URL para el servidor de señalización WebRTC
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const signalingUrl = import.meta.env.VITE_SIGNALING_URL || `${protocol}//${window.location.host}`;
    this.signaling = new SignalingClient(signalingUrl);
    this.setupSignaling();

    this.lobby = new RoomLobby({
      onCreateRoom: (nick, roomName) => this.startAsHost(nick, roomName),
      onJoinRoom: (nick, roomId) => this.startAsClient(nick, roomId),
      onSinglePlayer: (nick) => this.startPracticeMode(nick),
      onRefreshRooms: () => this.signaling.requestRoomList()
    });

    this.setupUIEvents();
    this.startRenderLoop();
  }

  private setupUIEvents(): void {
    // Chat messaging
    this.chat.onSendMessage = (text) => {
      this.broadcastChat(this.localPlayer.name, text, this.localPlayer.team);
    };

    // Team Selection
    this.teamSelect.onSelectTeam = (team) => {
      this.handleTeamChange(this.localPlayer.id, team);
      if (this.mode === 'client' && this.hostPeer) {
        this.hostPeer.sendReliable(JSON.stringify({
          type: 'change_team',
          playerId: this.localPlayer.id,
          team
        }));
      }
    };

    // Host match buttons
    const btnStart = document.getElementById('btnStartMatch');
    const btnStop = document.getElementById('btnStopMatch');
    const btnSound = document.getElementById('btnToggleSound');

    if (btnStart) {
      btnStart.addEventListener('click', () => {
        if (this.engine) {
          this.engine.startMatch();
          this.audioManager.playCountdown(false);
          this.broadcastMatchEvent('start');
        }
      });
    }

    if (btnStop) {
      btnStop.addEventListener('click', () => {
        if (this.engine) {
          this.engine.stopMatch();
          this.broadcastMatchEvent('stop');
        }
      });
    }

    if (btnSound) {
      btnSound.addEventListener('click', () => {
        this.audioManager.isMuted = !this.audioManager.isMuted;
        btnSound.textContent = this.audioManager.isMuted ? '🔇 Audio: OFF' : '🔊 Audio: ON';
      });
    }
  }

  private setupSignaling(): void {
    this.signaling.onMessage = (msg: SignalingMessage) => {
      switch (msg.type) {
        case 'room_created': {
          this.chat.addMessage({ author: 'Lobby', text: `Sala creada con ID: ${msg.roomId}`, team: 'sys' });
          const roomBadge = document.getElementById('roomNameBadge');
          if (roomBadge) roomBadge.textContent = `Room: ${msg.roomId}`;
          break;
        }

        case 'room_list': {
          if (msg.rooms) {
            this.lobby.setRoomList(msg.rooms);
          }
          break;
        }

        case 'peer_joined': {
          // New peer joined our hosted room -> Host initiates WebRTC connection
          if (this.mode === 'host' && msg.peerId) {
            this.handlePeerJoinedAsHost(msg.peerId);
          }
          break;
        }

        case 'room_joined': {
          // We joined someone else's room as client
          this.chat.addMessage({ author: 'Lobby', text: `Conectado a la sala ${msg.roomId}`, team: 'sys' });
          const roomBadge = document.getElementById('roomNameBadge');
          if (roomBadge) roomBadge.textContent = `Room: ${msg.roomId}`;
          break;
        }

        case 'signal_offer': {
          if (msg.senderId && msg.payload) {
            this.handleSignalOffer(msg.senderId, msg.payload);
          }
          break;
        }

        case 'signal_answer': {
          if (msg.senderId && msg.payload) {
            this.handleSignalAnswer(msg.senderId, msg.payload);
          }
          break;
        }

        case 'signal_ice': {
          if (msg.senderId && msg.payload) {
            this.handleSignalIce(msg.senderId, msg.payload);
          }
          break;
        }

        case 'peer_left': {
          if (msg.peerId) {
            this.handlePeerLeft(msg.peerId);
          }
          break;
        }
      }
    };

    this.signaling.connect().then(() => {
      this.signaling.requestRoomList();
    }).catch(() => {
      console.log('Servidor de señalización no disponible, listo para modo práctica.');
    });
  }

  public startPracticeMode(nickname: string): void {
    this.mode = 'practice';
    this.localPlayer.name = nickname;
    this.localPlayer.avatar = nickname.substring(0, 2).toUpperCase();
    this.localPlayer.team = 'red';
    this.localPlayer.isHost = true;

    this.engine = new GameEngine();
    this.setupEngineCallbacks(this.engine);

    this.engine.addPlayer(this.localPlayer);
    this.engine.startMatch();

    this.lobby.hide();
    this.chat.addMessage({ author: 'Sistema', text: '¡Bienvenido al modo de práctica! Usa WASD/Flechas para moverte y Espacio/X para patear.', team: 'sys' });
    this.updateTeamLists();
  }

  public async startAsHost(nickname: string, roomName: string): Promise<void> {
    this.mode = 'host';
    this.localPlayer.name = nickname;
    this.localPlayer.avatar = nickname.substring(0, 2).toUpperCase();
    this.localPlayer.team = 'red';
    this.localPlayer.isHost = true;

    this.engine = new GameEngine();
    this.setupEngineCallbacks(this.engine);
    this.engine.addPlayer(this.localPlayer);

    if (!this.signaling.isConnected) {
      try {
        await this.signaling.connect();
      } catch (err) {
        console.error('[Signaling] Failed to connect:', err);
        this.chat.addMessage({ author: 'Sistema', text: 'No se pudo conectar al servidor de salas. Reintentando...', team: 'sys' });
        return;
      }
    }

    this.signaling.createRoom(roomName);
    this.lobby.hide();
    this.updateTeamLists();
  }

  public async startAsClient(nickname: string, roomId: string): Promise<void> {
    this.mode = 'client';
    this.localPlayer.name = nickname;
    this.localPlayer.avatar = nickname.substring(0, 2).toUpperCase();
    this.localPlayer.team = 'blue';
    this.localPlayer.isHost = false;

    if (!this.signaling.isConnected) {
      try {
        await this.signaling.connect();
      } catch (err) {
        console.error('[Signaling] Failed to connect:', err);
        this.chat.addMessage({ author: 'Sistema', text: 'No se pudo conectar al servidor de salas. Reintentando...', team: 'sys' });
        return;
      }
    }

    this.signaling.joinRoom(roomId);
    this.lobby.hide();
  }

  private setupEngineCallbacks(engine: GameEngine): void {
    engine.onGoal = (scoringTeam, redScore, blueScore) => {
      this.audioManager.playGoalWhistle();
      const color = scoringTeam === 'red' ? 'Rojo' : 'Azul';
      this.chat.addMessage({ author: 'GOL', text: `¡Gol del equipo ${color}! (${redScore} - ${blueScore})`, team: 'sys' });
    };

    engine.onKick = () => {
      this.audioManager.playKick();
    };

    engine.onPostHit = () => {
      this.audioManager.playPostHit();
    };

    engine.onStateChange = (state) => {
      if (state === MatchState.COUNTDOWN) {
        this.audioManager.playCountdown(false);
      } else if (state === MatchState.PLAYING) {
        this.audioManager.playCountdown(true);
      }
    };
  }

  private async handlePeerJoinedAsHost(peerId: string): Promise<void> {
    const peer = new PeerConnection(peerId, true);
    this.peers.set(peerId, peer);

    peer.onIceCandidate = (candidate) => {
      this.signaling.sendIceCandidate(peerId, candidate);
    };

    peer.onConnected = () => {
      console.log(`[Host] Conexión P2P establecida con ${peerId}`);
      // Send welcome message and register player
      const newPlayer = new Player({
        id: peerId,
        name: `Guest_${peerId.substring(0, 4)}`,
        team: 'blue'
      });
      if (this.engine) {
        this.engine.addPlayer(newPlayer);
        this.updateTeamLists();
      }
    };

    peer.onUnreliableMessage = (data: ArrayBuffer) => {
      const input = InputPacket.decode(data);
      if (input && this.engine) {
        const p = this.engine.players.get(peerId);
        if (p) {
          p.inputMask = input.inputMask;
        }
      }
    };

    peer.onReliableMessage = (data: string) => {
      try {
        const msg = JSON.parse(data);
        if (msg.type === 'chat') {
          this.chat.addMessage({ author: msg.author, text: msg.text, team: msg.team });
          this.broadcastReliable(data, peerId);
        } else if (msg.type === 'change_team') {
          this.handleTeamChange(msg.playerId, msg.team);
          this.broadcastReliable(data);
        }
      } catch (e) {}
    };

    const offer = await peer.createOffer();
    this.signaling.sendOffer(peerId, offer);
  }

  private async handleSignalOffer(senderId: string, offer: RTCSessionDescriptionInit): Promise<void> {
    const peer = new PeerConnection(senderId, false);
    this.hostPeer = peer;

    peer.onIceCandidate = (candidate) => {
      this.signaling.sendIceCandidate(senderId, candidate);
    };

    peer.onUnreliableMessage = (data: ArrayBuffer) => {
      const snap = SnapshotPacket.decode(data);
      if (snap) {
        this.jitterBuffer.push(snap);
      }
    };

    peer.onReliableMessage = (data: string) => {
      try {
        const msg = JSON.parse(data);
        if (msg.type === 'chat') {
          this.chat.addMessage({ author: msg.author, text: msg.text, team: msg.team });
        } else if (msg.type === 'team_sync') {
          this.teamSelect.updateLists(msg.players);
        }
      } catch (e) {}
    };

    const answer = await peer.handleOffer(offer);
    this.signaling.sendAnswer(senderId, answer);
  }

  private async handleSignalAnswer(senderId: string, answer: RTCSessionDescriptionInit): Promise<void> {
    const peer = this.peers.get(senderId);
    if (peer) {
      await peer.handleAnswer(answer);
    }
  }

  private async handleSignalIce(senderId: string, candidate: RTCIceCandidateInit): Promise<void> {
    if (this.mode === 'client' && this.hostPeer) {
      await this.hostPeer.addIceCandidate(candidate);
    } else {
      const peer = this.peers.get(senderId);
      if (peer) {
        await peer.addIceCandidate(candidate);
      }
    }
  }

  private handlePeerLeft(peerId: string): void {
    if (this.engine) {
      this.engine.removePlayer(peerId);
      this.updateTeamLists();
    }
    const peer = this.peers.get(peerId);
    if (peer) {
      peer.close();
      this.peers.delete(peerId);
    }
  }

  private handleTeamChange(playerId: string, team: TeamType): void {
    if (this.engine) {
      this.engine.setPlayerTeam(playerId, team);
      this.updateTeamLists();
      this.broadcastReliable(JSON.stringify({
        type: 'team_sync',
        players: Array.from(this.engine.players.values())
      }));
    }
  }

  private updateTeamLists(): void {
    if (this.engine) {
      this.teamSelect.updateLists(Array.from(this.engine.players.values()));
    }
  }

  private broadcastReliable(text: string, excludePeerId?: string): void {
    for (const [id, peer] of this.peers.entries()) {
      if (id !== excludePeerId) {
        peer.sendReliable(text);
      }
    }
  }

  private broadcastChat(author: string, text: string, team: TeamType): void {
    this.chat.addMessage({ author, text, team });
    const payload = JSON.stringify({ type: 'chat', author, text, team });

    if (this.mode === 'host') {
      this.broadcastReliable(payload);
    } else if (this.mode === 'client' && this.hostPeer) {
      this.hostPeer.sendReliable(payload);
    }
  }

  private broadcastMatchEvent(event: string): void {
    this.broadcastReliable(JSON.stringify({ type: 'match_event', event }));
  }

  /**
   * Main game & render loop running at native display refresh rate.
   */
  private startRenderLoop(): void {
    const loop = (now: number) => {
      if (!this.isRunning) return;

      const frameTime = Math.min((now - this.lastTime) / 1000, 0.1);
      this.lastTime = now;
      this.accumulator += frameTime;

      // 1. Host or Practice Physics Updates (Fixed 60 Hz)
      if (this.mode === 'host' || this.mode === 'practice') {
        if (this.engine) {
          while (this.accumulator >= this.fixedDt) {
            const inputs = new Map<string, number>();
            // Local player inputs
            inputs.set(this.localPlayer.id, this.inputManager.getMask());
            this.engine.tick(inputs);

            // If Host, broadcast snapshot to all connected clients over unreliable WebRTC
            if (this.mode === 'host' && this.peers.size > 0) {
              const snapshot = this.engine.getSnapshot();
              const buffer = SnapshotPacket.encode(snapshot);
              for (const peer of this.peers.values()) {
                peer.sendUnreliable(buffer);
              }
            }

            this.accumulator -= this.fixedDt;
          }
        }
      } else if (this.mode === 'client') {
        // Client sends inputs to host at 60 Hz
        while (this.accumulator >= this.fixedDt) {
          this.clientInputSequence++;
          if (this.hostPeer) {
            const inputBuf = InputPacket.encode({
              sequence: this.clientInputSequence,
              inputMask: this.inputManager.getMask(),
              clientTimestamp: Math.round(now) & 0xffff
            });
            this.hostPeer.sendUnreliable(inputBuf);
          }
          this.accumulator -= this.fixedDt;
        }
      }

      // 2. Render State
      let activeSnapshot: GameSnapshot | null = null;
      let localDiscId: number | null = null;

      if (this.mode === 'host' || this.mode === 'practice') {
        if (this.engine) {
          activeSnapshot = this.engine.getSnapshot();
          localDiscId = this.localPlayer.discId;
        }
      } else if (this.mode === 'client') {
        activeSnapshot = this.jitterBuffer.getInterpolatedSnapshot(now);
      }

      if (activeSnapshot) {
        this.canvasRenderer.render(activeSnapshot, localDiscId);
        this.hud.update(
          activeSnapshot.redScore,
          activeSnapshot.blueScore,
          activeSnapshot.matchTimerSeconds
        );
      }

      // 3. Performance stats (FPS)
      this.frameCount++;
      if (now - this.lastFpsUpdate >= 1000) {
        this.currentFps = (this.frameCount * 1000) / (now - this.lastFpsUpdate);
        this.frameCount = 0;
        this.lastFpsUpdate = now;
        this.hud.updateStats(this.currentPing, this.currentFps);
      }

      requestAnimationFrame(loop);
    };

    requestAnimationFrame(loop);
  }
}
