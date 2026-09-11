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
import { RoomLobby, LobbyRoomConfig } from '../ui/components/RoomLobby';
import { NicknameGatekeeper } from '../ui/components/NicknameGatekeeper';
import { SignalingClient, SignalingMessage } from '../net/signaling/SignalingClient';
import { PeerConnection } from '../net/transport/PeerConnection';
import { InputPacket } from '../net/protocol/InputPacket';
import { SnapshotPacket } from '../net/protocol/SnapshotPacket';
import { JitterBuffer } from '../net/transport/JitterBuffer';
import { PhysicsTicker } from '../core/physics/PhysicsTicker';
import { RoomConfig } from '../server/signalingServer';

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
  public gatekeeper: NicknameGatekeeper;

  // Networking
  public signaling: SignalingClient;
  public peers: Map<string, PeerConnection> = new Map();
  public hostPeer: PeerConnection | null = null;
  public jitterBuffer: JitterBuffer;
  public clientInputSequence: number = 0;
  public bannedPeers: Set<string> = new Set();
  public currentRoomId: string = '';


  // Room & Admin state
  public roomConfig: RoomConfig = {
    name: 'Classic Match',
    maxPlayers: 12,
    isPrivate: false,
    timeLimit: 3,
    scoreLimit: 3,
    teamsLocked: false
  };
  private selectedPlayerForAction: Player | null = null;

  // Loop & timing
  private physicsTicker: PhysicsTicker;
  private isRunning: boolean = true;
  private frameCount: number = 0;
  private lastFpsUpdate: number = performance.now();
  private currentFps: number = 60;
  private currentPing: number = 0;

  // UI elements
  private btnLeaveRoom: HTMLElement | null;
  private btnStartStop: HTMLButtonElement | null;
  private btnPauseResume: HTMLButtonElement | null;
  private btnLockTeams: HTMLButtonElement | null;
  private inputTimeLimit: HTMLInputElement | null;
  private inputScoreLimit: HTMLInputElement | null;
  private contextMenu: HTMLElement | null;
  private menuPlayerName: HTMLElement | null;
  private roomNameBadge: HTMLElement | null;

  constructor() {
    const canvas = document.getElementById('gameCanvas') as HTMLCanvasElement;
    this.gatekeeper = new NicknameGatekeeper();
    const storedNick = this.gatekeeper.checkOrPrompt();
    const initialNick = storedNick || 'Player';

    this.localPlayer = new Player({
      id: 'local_' + Math.random().toString(36).substring(2, 7),
      name: initialNick,
      team: 'red',
      isHost: true,
      isAdmin: true
    });

    this.inputManager = new InputManager();
    this.audioManager = new AudioManager();
    this.hud = new ScoreboardHUD();
    this.chat = new ChatBox();
    this.teamSelect = new TeamSelectModal();
    this.jitterBuffer = new JitterBuffer(70);

    // Physics Engine por defecto
    this.engine = new GameEngine({
      scoreLimit: this.roomConfig.scoreLimit,
      timeLimitSeconds: this.roomConfig.timeLimit * 60
    });
    this.canvasRenderer = new CanvasRenderer(canvas, this.engine.stadium);

    // Physics Ticker desacoplado (Web Worker)
    this.physicsTicker = new PhysicsTicker();
    this.physicsTicker.onTick = () => this.physicsTick();

    // Detección dinámica de URL para el servidor de señalización WebSockets
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const signalingUrl = import.meta.env.VITE_SIGNALING_URL || `${protocol}//${window.location.host}`;
    this.signaling = new SignalingClient(signalingUrl);
    this.setupSignaling();

    // UI Cache
    this.btnLeaveRoom = document.getElementById('btnLeaveRoom');
    this.btnStartStop = document.getElementById('btn-start-stop') as HTMLButtonElement | null;
    this.btnPauseResume = document.getElementById('btn-pause-resume') as HTMLButtonElement | null;
    this.btnLockTeams = document.getElementById('btn-lock-teams') as HTMLButtonElement | null;
    this.inputTimeLimit = document.getElementById('time-limit') as HTMLInputElement | null;
    this.inputScoreLimit = document.getElementById('score-limit') as HTMLInputElement | null;
    this.contextMenu = document.getElementById('playerContextMenu');
    this.menuPlayerName = document.getElementById('menuPlayerName');
    this.roomNameBadge = document.getElementById('roomNameBadge');

    this.lobby = new RoomLobby({
      onCreateRoom: (nick, config) => this.startAsHost(nick, config),
      onJoinRoom: (nick, roomId, password) => this.startAsClient(nick, roomId, password),
      onSinglePlayer: (nick) => this.startPracticeMode(nick),
      onRefreshRooms: () => this.signaling.requestRoomList()
    });
    if (storedNick) {
      this.lobby.setNickname(storedNick);
    }

    this.gatekeeper.onNicknameConfirmed = (nick: string) => {
      this.localPlayer.name = nick;
      this.localPlayer.avatar = nick.substring(0, 2).toUpperCase();
      this.lobby.setNickname(nick);
      if (this.engine) {
        const p = this.engine.players.get(this.localPlayer.id);
        if (p) {
          p.name = nick;
          p.avatar = this.localPlayer.avatar;
        }
        this.updateTeamLists();
        this.syncPlayersWithClients();
      }
    };

    this.setupUIEvents();
    this.startRenderLoop();
    this.physicsTicker.start();
  }

  private setupUIEvents(): void {
    // Chat messaging
    this.chat.onSendMessage = (text) => {
      this.broadcastChat(this.localPlayer.name, text, this.localPlayer.team);
    };

    // Team Selection (Botones de unirse)
    this.teamSelect.onSelectTeam = (team) => {
      this.handleTeamChange(this.localPlayer.id, team);
    };

    // Team Selection (HTML5 Drag & Drop)
    this.teamSelect.onTeamChangeRequest = (playerId, team) => {
      this.handleTeamChange(playerId, team);
    };

    // Context Menu on player click for Admins
    this.teamSelect.onPlayerClick = (targetPlayer, e) => {
      if (!this.localPlayer.isAdmin) return;
      this.selectedPlayerForAction = targetPlayer;
      if (this.contextMenu && this.menuPlayerName) {
        this.menuPlayerName.textContent = `${targetPlayer.name} (${targetPlayer.team})`;
        this.contextMenu.style.left = `${Math.min(e.clientX, window.innerWidth - 180)}px`;
        this.contextMenu.style.top = `${Math.min(e.clientY, window.innerHeight - 200)}px`;
        this.contextMenu.style.display = 'block';
      }
    };

    // Close context menu on outside click
    window.addEventListener('click', (e) => {
      if (this.contextMenu && !this.contextMenu.contains(e.target as Node)) {
        this.contextMenu.style.display = 'none';
      }
    });

    // Setup Context Menu Action Buttons
    document.getElementById('ctxMoveRed')?.addEventListener('click', () => {
      if (this.selectedPlayerForAction) {
        this.transferPlayer(this.selectedPlayerForAction.id, 'red');
        this.closeContextMenu();
      }
    });
    document.getElementById('ctxMoveBlue')?.addEventListener('click', () => {
      if (this.selectedPlayerForAction) {
        this.transferPlayer(this.selectedPlayerForAction.id, 'blue');
        this.closeContextMenu();
      }
    });
    document.getElementById('ctxMoveSpec')?.addEventListener('click', () => {
      if (this.selectedPlayerForAction) {
        this.transferPlayer(this.selectedPlayerForAction.id, 'spec');
        this.closeContextMenu();
      }
    });
    document.getElementById('ctxMakeAdmin')?.addEventListener('click', () => {
      if (this.selectedPlayerForAction) {
        this.promotePlayerToAdmin(this.selectedPlayerForAction.id);
        this.closeContextMenu();
      }
    });
    document.getElementById('ctxKick')?.addEventListener('click', () => {
      if (this.selectedPlayerForAction) {
        this.kickPlayer(this.selectedPlayerForAction.id);
        this.closeContextMenu();
      }
    });
    document.getElementById('ctxBan')?.addEventListener('click', () => {
      if (this.selectedPlayerForAction) {
        this.banPlayer(this.selectedPlayerForAction.id);
        this.closeContextMenu();
      }
    });

    // In-game menu overlay toggle (Button & Escape key)
    const ingameMenu = document.getElementById('ingame-menu');
    const menuToggleBtn = document.getElementById('menu-toggle-btn');
    const menuCloseBtn = document.getElementById('menu-close-btn');

    const toggleMenu = () => {
      if (ingameMenu) {
        ingameMenu.classList.toggle('hidden');
        this.updateAdminControlsUI();
      }
    };

    if (menuToggleBtn) menuToggleBtn.addEventListener('click', toggleMenu);
    if (menuCloseBtn) menuCloseBtn.addEventListener('click', toggleMenu);

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        toggleMenu();
      }
    });

    // Audio Toggle Button en la barra superior derecha
    const audioToggleBtn = document.getElementById('audio-toggle-btn');
    if (audioToggleBtn) {
      audioToggleBtn.addEventListener('click', () => {
        this.audioManager.isMuted = !this.audioManager.isMuted;
        audioToggleBtn.textContent = this.audioManager.isMuted ? '🔇' : '🔊';
        audioToggleBtn.title = this.audioManager.isMuted ? 'Audio Silenciado' : 'Audio Activado';
      });
    }

    // Leave Room Button
    if (this.btnLeaveRoom) {
      this.btnLeaveRoom.addEventListener('click', () => {
        this.leaveCurrentRoom();
      });
    }

    // Match Iniciar / Detener
    const btnStartStop = document.getElementById('btn-start-stop');
    if (btnStartStop) {
      btnStartStop.addEventListener('click', () => {
        if (!this.localPlayer.isAdmin) return;
        if (this.engine) {
          if (this.engine.fsm.currentState === 'STOPPED') {
            this.engine.startMatch();
          } else {
            this.engine.stopMatch();
          }
          this.updateAdminControlsUI();
          this.broadcastGameState();
        }
      });
    }

    // Match Pausar / Reanudar
    const btnPauseResume = document.getElementById('btn-pause-resume');
    if (btnPauseResume) {
      btnPauseResume.addEventListener('click', () => {
        if (!this.localPlayer.isAdmin) return;
        if (this.engine) {
          this.engine.togglePause();
          this.updateAdminControlsUI();
          this.broadcastGameState();
        }
      });
    }

    // Admin Time Limit Input
    const inputTimeLimit = document.getElementById('time-limit') as HTMLInputElement | null;
    if (inputTimeLimit) {
      inputTimeLimit.addEventListener('change', () => {
        if (!this.localPlayer.isAdmin) return;
        const mins = parseInt(inputTimeLimit.value, 10);
        this.updateRoomConfig({ timeLimit: isNaN(mins) ? 3 : mins });
      });
    }

    // Admin Score Limit Input
    const inputScoreLimit = document.getElementById('score-limit') as HTMLInputElement | null;
    if (inputScoreLimit) {
      inputScoreLimit.addEventListener('change', () => {
        if (!this.localPlayer.isAdmin) return;
        const goals = parseInt(inputScoreLimit.value, 10);
        this.updateRoomConfig({ scoreLimit: isNaN(goals) ? 3 : goals });
      });
    }

    // Admin Lock Teams Button
    const btnLockTeams = document.getElementById('btn-lock-teams');
    if (btnLockTeams) {
      btnLockTeams.addEventListener('click', () => {
        if (!this.localPlayer.isAdmin) return;
        const newLock = !this.roomConfig.teamsLocked;
        this.updateRoomConfig({ teamsLocked: newLock });
      });
    }
  }

  private closeContextMenu(): void {
    if (this.contextMenu) this.contextMenu.style.display = 'none';
  }

  private setupSignaling(): void {
    this.signaling.onMessage = (msg: SignalingMessage) => {
      switch (msg.type) {
        case 'room_created': {
          this.currentRoomId = msg.roomId || '';
          if (msg.config) {
            this.roomConfig = { ...this.roomConfig, ...msg.config };
          }
          if (this.roomNameBadge) {
            this.roomNameBadge.textContent = `${this.roomConfig.name} [${this.currentRoomId}]`;
          }
          this.chat.addMessage({ author: 'Lobby', text: `Sala "${this.roomConfig.name}" creada. ID: ${this.currentRoomId}`, team: 'sys' });
          this.applyRoomConfigToEngine();
          this.updateAdminPanelVisibility();
          break;
        }

        case 'room_joined': {
          this.currentRoomId = msg.roomId || '';
          if (msg.config) {
            this.roomConfig = { ...this.roomConfig, ...msg.config };
          }
          if (this.roomNameBadge) {
            this.roomNameBadge.textContent = `${this.roomConfig.name} [${this.currentRoomId}]`;
          }
          this.chat.addMessage({ author: 'Lobby', text: `Conectado a la sala: ${this.roomConfig.name}`, team: 'sys' });
          this.updateAdminPanelVisibility();
          break;
        }

        case 'room_list': {
          if (msg.rooms) {
            this.lobby.setRoomList(msg.rooms);
          }
          break;
        }

        case 'peer_joined': {
          if (this.mode === 'host' && msg.peerId) {
            if (this.bannedPeers.has(msg.peerId)) {
              console.log(`[Host] Rechazando conexión de peer baneado: ${msg.peerId}`);
              return;
            }
            this.handlePeerJoinedAsHost(msg.peerId, msg.nickname);
          }
          break;
        }

        case 'signal_offer': {
          if (msg.senderId && msg.payload) {
            if (this.bannedPeers.has(msg.senderId)) {
              console.log(`[Host] Rechazando oferta de peer baneado: ${msg.senderId}`);
              return;
            }
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

        case 'host_left': {
          this.chat.addMessage({ author: 'Sistema', text: 'El Host ha cerrado la sala.', team: 'sys' });
          this.leaveCurrentRoom();
          break;
        }

        case 'room_config_updated': {
          if (msg.config) {
            this.roomConfig = { ...this.roomConfig, ...msg.config };
            this.applyRoomConfigToEngine();
            this.updateAdminControlsUI();
          }
          break;
        }

        case 'error': {
          console.warn('[Signaling Error]', msg);
          if (msg.code === 'INVALID_PASSWORD') {
            alert('❌ Contraseña incorrecta para esta sala privada.');
          } else if (msg.code === 'ROOM_FULL') {
            alert('❌ La sala ha alcanzado su límite máximo de jugadores.');
          } else if (msg.code === 'ROOM_NOT_FOUND') {
            alert('❌ La sala no existe o el Host se ha desconectado.');
          } else {
            alert(`Error: ${msg.message || 'Ocurrió un error de conexión'}`);
          }
          this.lobby.show();
          if (this.btnLeaveRoom) this.btnLeaveRoom.style.display = 'none';
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
    this.localPlayer.isAdmin = true;
    this.currentRoomId = 'PRACTICE';

    this.engine = new GameEngine({ scoreLimit: 0, timeLimitSeconds: 0 });
    this.setupEngineCallbacks(this.engine);
    this.engine.addPlayer(this.localPlayer);
    this.engine.startMatch();

    if (this.roomNameBadge) this.roomNameBadge.textContent = 'Modo Práctica';
    if (this.btnLeaveRoom) this.btnLeaveRoom.style.display = 'inline-block';
    this.updateAdminPanelVisibility();

    this.lobby.hide();
    this.chat.addMessage({ author: 'Sistema', text: '¡Modo de práctica activo! Usa WASD/Flechas para moverte y Espacio/X para patear.', team: 'sys' });
    this.updateTeamLists();
  }

  public async startAsHost(nickname: string, config: LobbyRoomConfig): Promise<void> {
    this.mode = 'host';
    this.localPlayer.name = nickname;
    this.localPlayer.avatar = nickname.substring(0, 2).toUpperCase();
    this.localPlayer.team = 'red';
    this.localPlayer.isHost = true;
    this.localPlayer.isAdmin = true;

    this.roomConfig = { ...config };
    this.engine = new GameEngine({
      scoreLimit: this.roomConfig.scoreLimit,
      timeLimitSeconds: this.roomConfig.timeLimit * 60
    });
    this.setupEngineCallbacks(this.engine);
    this.engine.addPlayer(this.localPlayer);

    if (this.btnLeaveRoom) this.btnLeaveRoom.style.display = 'inline-block';
    this.updateAdminPanelVisibility();
    this.updateAdminControlsUI();

    if (!this.signaling.isConnected) {
      try {
        await this.signaling.connect();
      } catch (err) {
        console.error('[Signaling] Failed to connect:', err);
        alert('No se pudo conectar al servidor de señalización.');
        return;
      }
    }

    this.signaling.createRoom(this.roomConfig, undefined, this.localPlayer.name);
    this.lobby.hide();
    this.updateTeamLists();
  }

  public async startAsClient(nickname: string, roomId: string, password?: string): Promise<void> {
    this.mode = 'client';
    this.localPlayer.name = nickname;
    this.localPlayer.avatar = nickname.substring(0, 2).toUpperCase();
    this.localPlayer.team = 'spec';
    this.localPlayer.isHost = false;
    this.localPlayer.isAdmin = false;
    this.currentRoomId = roomId;

    if (this.btnLeaveRoom) this.btnLeaveRoom.style.display = 'inline-block';
    this.updateAdminPanelVisibility();

    if (!this.signaling.isConnected) {
      try {
        await this.signaling.connect();
      } catch (err) {
        console.error('[Signaling] Failed to connect:', err);
        alert('No se pudo conectar al servidor de señalización.');
        return;
      }
    }

    this.signaling.joinRoom(roomId, password, this.localPlayer.name);
    this.lobby.hide();
  }

  public leaveCurrentRoom(): void {
    // Cerrar conexiones P2P
    for (const peer of this.peers.values()) {
      peer.close();
    }
    this.peers.clear();

    if (this.hostPeer) {
      this.hostPeer.close();
      this.hostPeer = null;
    }

    // Detener y resetear motor
    if (this.engine) {
      this.engine.stopMatch();
    }

    this.mode = 'practice';
    this.currentRoomId = '';
    this.localPlayer.team = 'red';
    this.localPlayer.isAdmin = true;

    if (this.btnLeaveRoom) this.btnLeaveRoom.style.display = 'none';
    if (this.roomNameBadge) this.roomNameBadge.textContent = 'Lobby';
    this.updateAdminPanelVisibility();

    this.lobby.show();
    this.signaling.requestRoomList();
    this.chat.addMessage({ author: 'Sistema', text: 'Has salido de la sala.', team: 'sys' });
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
      this.updateAdminControlsUI();
      this.broadcastGameState();
    };
  }

  private async handlePeerJoinedAsHost(peerId: string, initialNick?: string): Promise<void> {
    const peer = new PeerConnection(peerId, true);
    this.peers.set(peerId, peer);

    peer.onIceCandidate = (candidate) => {
      this.signaling.sendIceCandidate(peerId, candidate);
    };

    peer.onDataChannelOpen = () => {
      peer.sendReliable(JSON.stringify({
        type: 'room_config_sync',
        config: this.roomConfig
      }));
      peer.sendReliable(JSON.stringify({
        type: 'set_game_state',
        state: this.engine?.fsm.currentState || 'STOPPED',
        countdownSeconds: this.engine?.fsm.countdownSeconds
      }));
      this.syncPlayersWithClients();
    };

    peer.onConnected = () => {
      console.log(`[Host] Conexión P2P establecida con ${peerId}`);
      const nick = initialNick || `Guest_${peerId.substring(0, 4)}`;
      const newPlayer = new Player({
        id: peerId,
        name: nick,
        avatar: nick.substring(0, 2).toUpperCase(),
        team: 'spec',
        isHost: false,
        isAdmin: false
      });
      if (this.engine) {
        this.engine.addPlayer(newPlayer);
        this.updateTeamLists();
        this.syncPlayersWithClients();
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
        } else if (msg.type === 'peer_handshake') {
          const p = this.engine?.players.get(peerId);
          if (p && msg.nickname) {
            p.name = msg.nickname;
            p.avatar = msg.avatar || msg.nickname.substring(0, 2).toUpperCase();
            this.updateTeamLists();
            this.syncPlayersWithClients();
          }
        } else if (msg.type === 'change_team') {
          const requester = this.engine?.players.get(peerId);
          const isAdmin = requester?.isAdmin || false;
          const isSelf = peerId === msg.playerId;
          if (!isAdmin && (!isSelf || this.roomConfig.teamsLocked)) {
            // Rechazo silencioso
            return;
          }
          if (this.engine) {
            this.engine.setPlayerTeam(msg.playerId, msg.team);
            this.updateTeamLists();
            this.syncPlayersWithClients();
          }
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

    peer.onDataChannelOpen = () => {
      peer.sendReliable(JSON.stringify({
        type: 'peer_handshake',
        nickname: this.localPlayer.name,
        avatar: this.localPlayer.avatar
      }));
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
          const self = msg.players.find((p: any) => p.id === this.localPlayer.id);
          if (self) {
            this.localPlayer.isAdmin = Boolean(self.isAdmin);
            this.localPlayer.team = self.team;
          }
          this.teamSelect.updateLists(msg.players, this.localPlayer.isAdmin);
          this.updateAdminControlsUI();
        } else if (msg.type === 'set_game_state') {
          this.updateAdminControlsUI();
        } else if (msg.type === 'room_config_sync') {
          this.roomConfig = { ...this.roomConfig, ...msg.config };
          this.updateAdminControlsUI();
        } else if (msg.type === 'kicked') {
          alert('Has sido expulsado de la sala.');
          this.leaveCurrentRoom();
        } else if (msg.type === 'banned') {
          alert('Has sido baneado de esta sala.');
          this.leaveCurrentRoom();
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
      this.syncPlayersWithClients();
    }
    const peer = this.peers.get(peerId);
    if (peer) {
      peer.close();
      this.peers.delete(peerId);
    }
  }

  private handleTeamChange(playerId: string, team: TeamType): void {
    const isSelf = playerId === this.localPlayer.id;
    const isAdmin = this.localPlayer.isAdmin;

    if (!isAdmin && (!isSelf || this.roomConfig.teamsLocked)) {
      // Rechazo silencioso
      return;
    }

    if (this.mode === 'host' || this.mode === 'practice') {
      if (this.engine) {
        this.engine.setPlayerTeam(playerId, team);
        this.updateTeamLists();
        this.syncPlayersWithClients();
      }
    } else if (this.mode === 'client' && this.hostPeer) {
      this.hostPeer.sendReliable(JSON.stringify({
        type: 'change_team',
        playerId,
        team
      }));
    }
  }

  private syncPlayersWithClients(): void {
    if (this.mode === 'host' && this.engine) {
      const players = Array.from(this.engine.players.values());
      this.broadcastReliable(JSON.stringify({
        type: 'team_sync',
        players
      }));
    }
  }

  private updateTeamLists(): void {
    if (this.engine) {
      this.teamSelect.updateLists(Array.from(this.engine.players.values()), this.localPlayer.isAdmin);
    }
  }

  // --- Moderation & Admin actions ---
  public transferPlayer(playerId: string, newTeam: TeamType): void {
    this.handleTeamChange(playerId, newTeam);
  }

  public promotePlayerToAdmin(playerId: string): void {
    if (this.mode === 'host' && this.engine) {
      const p = this.engine.players.get(playerId);
      if (p) {
        p.isAdmin = true;
        this.updateTeamLists();
        this.syncPlayersWithClients();
        this.chat.addMessage({ author: 'Admin', text: `${p.name} ahora es Administrador.`, team: 'sys' });
      }
    }
  }

  public kickPlayer(playerId: string): void {
    if (this.mode === 'host') {
      const peer = this.peers.get(playerId);
      if (peer) {
        peer.sendReliable(JSON.stringify({ type: 'kicked' }));
        setTimeout(() => {
          this.handlePeerLeft(playerId);
        }, 100);
        this.chat.addMessage({ author: 'Admin', text: `Un jugador ha sido expulsado.`, team: 'sys' });
      }
    }
  }

  public banPlayer(playerId: string): void {
    if (this.mode === 'host') {
      this.bannedPeers.add(playerId);
      const peer = this.peers.get(playerId);
      if (peer) {
        peer.sendReliable(JSON.stringify({ type: 'banned' }));
        setTimeout(() => {
          this.handlePeerLeft(playerId);
        }, 100);
        this.chat.addMessage({ author: 'Admin', text: `Un jugador ha sido baneado de la sala.`, team: 'sys' });
      }
    }
  }

  public updateRoomConfig(newConfig: Partial<RoomConfig>): void {
    this.roomConfig = { ...this.roomConfig, ...newConfig };
    this.applyRoomConfigToEngine();
    this.updateAdminControlsUI();

    if (this.mode === 'host') {
      this.signaling.updateRoomConfig(this.roomConfig);
      this.broadcastReliable(JSON.stringify({
        type: 'room_config_sync',
        config: this.roomConfig
      }));
    }
  }

  private applyRoomConfigToEngine(): void {
    if (this.engine) {
      this.engine.updateConfig({
        scoreLimit: this.roomConfig.scoreLimit,
        timeLimitSeconds: this.roomConfig.timeLimit * 60
      });
    }
  }

  private updateAdminPanelVisibility(): void {
    this.updateAdminControlsUI();
  }

  private updateAdminControlsUI(): void {
    const isAdmin = this.localPlayer.isAdmin;
    const currentState = this.engine?.fsm.currentState || 'STOPPED';

    if (this.btnStartStop) {
      this.btnStartStop.disabled = !isAdmin;
      if (currentState === 'STOPPED') {
        this.btnStartStop.textContent = '▶ Iniciar Partido';
        this.btnStartStop.className = 'btn btn-primary';
      } else {
        this.btnStartStop.textContent = '⏹ Detener Partido';
        this.btnStartStop.className = 'btn btn-danger';
      }
    }

    if (this.btnPauseResume) {
      this.btnPauseResume.disabled = !isAdmin || currentState === 'STOPPED';
      if (currentState === 'PAUSED') {
        this.btnPauseResume.textContent = '▶ Reanudar';
        this.btnPauseResume.className = 'btn btn-primary';
      } else {
        this.btnPauseResume.textContent = '⏸ Pausar';
        this.btnPauseResume.className = 'btn btn-secondary';
      }
    }

    if (this.btnLockTeams) {
      this.btnLockTeams.disabled = !isAdmin;
      this.btnLockTeams.textContent = this.roomConfig.teamsLocked ? '🔒 Equipos Bloqueados' : '🔓 Equipos Libres';
      this.btnLockTeams.className = this.roomConfig.teamsLocked ? 'btn btn-danger' : 'btn btn-secondary';
    }

    if (this.inputTimeLimit) {
      this.inputTimeLimit.disabled = !isAdmin;
      this.inputTimeLimit.value = this.roomConfig.timeLimit.toString();
    }

    if (this.inputScoreLimit) {
      this.inputScoreLimit.disabled = !isAdmin;
      this.inputScoreLimit.value = this.roomConfig.scoreLimit.toString();
    }
  }

  private broadcastGameState(): void {
    if (this.mode === 'host' && this.engine) {
      this.broadcastReliable(JSON.stringify({
        type: 'set_game_state',
        state: this.engine.fsm.currentState,
        countdownSeconds: this.engine.fsm.countdownSeconds
      }));
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
   * Physics tick disparado por el PhysicsTicker (Web Worker) a 60 Hz constantes.
   * Continúa ejecutándose fluidamente aunque la pestaña esté minimizada o desenfocada.
   */
  private physicsTick(): void {
    if (!this.isRunning) return;

    if (this.mode === 'host' || this.mode === 'practice') {
      if (this.engine) {
        const inputs = new Map<string, number>();
        inputs.set(this.localPlayer.id, this.inputManager.getMask());
        this.engine.tick(inputs);

        // Si es Host, transmitir snapshot binario continuo
        if (this.mode === 'host' && this.peers.size > 0) {
          const snapshot = this.engine.getSnapshot();
          const buffer = SnapshotPacket.encode(snapshot);
          for (const peer of this.peers.values()) {
            peer.sendUnreliable(buffer);
          }
        }
      }
    } else if (this.mode === 'client') {
      this.clientInputSequence++;
      if (this.hostPeer) {
        const inputBuf = InputPacket.encode({
          sequence: this.clientInputSequence,
          inputMask: this.inputManager.getMask(),
          clientTimestamp: Math.round(performance.now()) & 0xffff
        });
        this.hostPeer.sendUnreliable(inputBuf);
      }
    }
  }

  /**
   * Bucle de Render pasivo: se ejecuta a la tasa de refresco nativa mediante requestAnimationFrame.
   * Si la pestaña está oculta (document.hidden), omite el render pero NO afecta el tick de física.
   */
  private startRenderLoop(): void {
    const loop = (now: number) => {
      if (!this.isRunning) return;

      if (!document.hidden) {
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

        // Medición de FPS
        this.frameCount++;
        if (now - this.lastFpsUpdate >= 1000) {
          this.currentFps = (this.frameCount * 1000) / (now - this.lastFpsUpdate);
          this.frameCount = 0;
          this.lastFpsUpdate = now;
          this.hud.updateStats(this.currentPing, this.currentFps);
        }
      }

      requestAnimationFrame(loop);
    };

    requestAnimationFrame(loop);
  }
}
