import { GameEngine } from '../core/game/GameEngine';
import { Player, TeamType, INPUT_UP, INPUT_DOWN, INPUT_LEFT, INPUT_RIGHT, INPUT_KICK } from '../core/game/Player';
import { MatchPhase, MatchState, toMatchPhase } from '../core/game/GameFSM';
import { GameSnapshot, DiscSnapshot } from '../core/game/GameState';
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
import { MatchStatePayload } from '../net/protocol/ControlMessages';
import { KeyBinds } from './InputManager';
import { UIStateMachine, UIState } from '../ui/UIStateMachine';

export function canChangeTeam(
  senderPeerId: string,
  targetPlayerId: string,
  teamsLocked: boolean,
  isAdmin: boolean
): boolean {
  if (isAdmin) return true; // El admin puede mover a cualquiera
  if (senderPeerId === targetPlayerId && !teamsLocked) return true; // El usuario puede moverse a sí mismo si no está bloqueado
  return false;
}

export type AppMode = 'practice' | 'host' | 'client';

export class GameApp {
  public mode: AppMode = 'practice';
  public currentMatchState: MatchPhase = MatchPhase.STOPPED;
  private lastClientPhase: MatchPhase | null = null;
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
  public uiStateMachine: UIStateMachine;

  // Networking
  public signaling: SignalingClient;
  public peers: Map<string, PeerConnection> = new Map();
  public hostPeer: PeerConnection | null = null;
  public jitterBuffer: JitterBuffer;
  public clientInputSequence: number = 0;
  public bannedPeers: Set<string> = new Set();
  public kickedPeers: Set<string> = new Set();
  public currentRoomId: string = '';
  public currentHostId: string | null = null;

  // Predicción cinemática del jugador local (cero lag de controles, sin alocaciones GC en bucle caliente)
  private predictedPos: { x: number; y: number } = { x: 0, y: 0 };
  private predictedVel: { x: number; y: number } = { x: 0, y: 0 };
  private hasPredictedPos: boolean = false;

  // Handshake timeout: cancel if initial_state is received within 10s
  private joinTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private static readonly JOIN_TIMEOUT_MS = 10000;

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
  private renderLoopId: number | null = null;
  private frameCount: number = 0;
  private lastFpsUpdate: number = performance.now();
  private currentFps: number = 60;
  private currentPing: number = 0;

  // UI elements
  // btnLeaveRoom removed from HUD header — only #btn-leave-room inside the menu exists
  private btnStartStop: HTMLButtonElement | null;
  private btnPauseResume: HTMLButtonElement | null;
  private btnLockTeams: HTMLButtonElement | null;
  private selectTimeLimit: HTMLSelectElement | HTMLInputElement | null;
  private selectScoreLimit: HTMLSelectElement | HTMLInputElement | null;
  private contextMenu: HTMLElement | null;
  private menuPlayerName: HTMLElement | null;
  private roomNameBadge: HTMLElement | null;

  constructor() {
    let canvas = (document.getElementById('gameCanvas') || document.getElementById('game-canvas')) as HTMLCanvasElement | null;
    if (!canvas) {
      console.warn('[GameApp] Canvas element "#gameCanvas" was not found in DOM. Creating fallback canvas.');
      canvas = document.createElement('canvas');
    }
    this.gatekeeper = new NicknameGatekeeper();
    const savedNick = NicknameGatekeeper.getSavedNickname();
    const initialNick = savedNick || 'Player';

    this.localPlayer = new Player({
      id: 'local_' + Math.random().toString(36).substring(2, 7),
      name: initialNick,
      team: 'red',
      isHost: true,
      isAdmin: true
    });
    this.currentHostId = this.localPlayer.id;

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
    const defaultWs = typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin.replace(/^http/, 'ws')
      : 'ws://localhost:3000';
    const signalingUrl = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SIGNALING_URL) || defaultWs;
    this.signaling = new SignalingClient(signalingUrl);

    // UI Cache
    // btnLeaveRoom removed — leave button only exists inside ingame-menu
    this.btnStartStop = document.getElementById('btn-start-stop') as HTMLButtonElement | null;
    this.btnPauseResume = document.getElementById('btn-pause-resume') as HTMLButtonElement | null;
    this.btnLockTeams = document.getElementById('btn-lock-teams') as HTMLButtonElement | null;
    this.selectTimeLimit = (document.getElementById('select-time-limit') || document.getElementById('time-limit')) as HTMLSelectElement | HTMLInputElement | null;
    this.selectScoreLimit = (document.getElementById('select-goal-limit') || document.getElementById('score-limit')) as HTMLSelectElement | HTMLInputElement | null;
    this.contextMenu = document.getElementById('playerContextMenu');
    this.menuPlayerName = document.getElementById('menuPlayerName');
    this.roomNameBadge = document.getElementById('roomNameBadge');

    this.lobby = new RoomLobby({
      onCreateRoom: (nick, config) => this.startAsHost(nick, config),
      onJoinRoom: (nick, roomId, password) => this.startAsClient(nick, roomId, password),
      onSinglePlayer: (nick) => this.startPracticeMode(nick),
      onRefreshRooms: () => this.signaling.requestRoomList(),
      onEditNickname: () => {
        this.gatekeeper.setInputValue(this.localPlayer.name);
        this.uiStateMachine.transitionTo('STATE_NICKNAME');
      },
      onCancelConnecting: () => {
        this.lobby.hideConnecting();
      }
    });
    if (savedNick) {
      this.lobby.setNickname(savedNick);
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
      this.uiStateMachine.transitionTo('STATE_LOBBY');
    };

    // UI State Machine
    const initialUIState: UIState = savedNick ? 'STATE_LOBBY' : 'STATE_NICKNAME';
    this.uiStateMachine = new UIStateMachine(initialUIState, {
      onStateChange: (newState, prevState) => this.handleUIStateChange(newState, prevState)
    });

    this.setupUIEvents();
    this.setupKeybindsModal();
    this.handleUIStateChange(initialUIState, initialUIState);
    this.setupSignaling();
  }

  private handleUIStateChange(newState: UIState, _prevState: UIState): void {
    if (newState === 'STATE_IN_GAME') {
      this.inputManager.setEnabled(true);
      this.physicsTicker.start();
      const matchState = this.getAuthoritativeMatchState();
      this.enforceMenuState(matchState);
      this.canvasRenderer.resize();
      this.startRenderLoop();
    } else {
      this.inputManager.setEnabled(false);
      this.physicsTicker.stop();
      this.stopRenderLoop();
      this.canvasRenderer.clear();
      this.teamSelect.close(true);
      if (newState === 'STATE_LOBBY') {
        this.lobby.updateUserBar(this.localPlayer.name);
        this.signaling.requestRoomList();
      } else if (newState === 'STATE_NICKNAME') {
        this.gatekeeper.setInputValue(this.localPlayer.name || '');
        this.gatekeeper.show();
      }
    }
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
        const isTargetHost = Boolean(
          targetPlayer.isHost ||
          (this.currentHostId && targetPlayer.id === this.currentHostId) ||
          (this.mode === 'host' && targetPlayer.id === this.localPlayer.id) ||
          (this.localPlayer.isHost && targetPlayer.id === this.localPlayer.id) ||
          (this.engine?.players.get(targetPlayer.id)?.isHost)
        );
        const isSelf = targetPlayer.id === this.localPlayer.id;

        const ctxMakeAdmin = document.getElementById('ctxMakeAdmin');
        if (ctxMakeAdmin) {
          // El host no debería ni podría quitarse el admin a sí mismo ni nadie puede quitárselo
          if (isTargetHost) {
            ctxMakeAdmin.style.display = 'none';
          } else {
            ctxMakeAdmin.style.display = '';
            ctxMakeAdmin.textContent = targetPlayer.isAdmin ? '⭐ Quitar Admin' : '⭐ Hacer Admin';
          }
        }

        const ctxKick = document.getElementById('ctxKick');
        if (ctxKick) {
          ctxKick.style.display = (isTargetHost || isSelf) ? 'none' : '';
        }

        const ctxBan = document.getElementById('ctxBan');
        if (ctxBan) {
          ctxBan.style.display = (isTargetHost || isSelf) ? 'none' : '';
        }

        let left = e.clientX;
        let top = e.clientY;
        const targetEl = (e.target as HTMLElement | null)?.closest('button, .player-item') as HTMLElement | null;
        if (targetEl && typeof targetEl.getBoundingClientRect === 'function') {
          const rect = targetEl.getBoundingClientRect();
          left = rect.left;
          top = rect.bottom + 4;
        }

        const menuWidth = 200;
        const menuHeight = 240;
        const adjustedLeft = Math.max(8, Math.min(left, window.innerWidth - menuWidth - 8));
        const adjustedTop = Math.max(8, Math.min(top, window.innerHeight - menuHeight - 8));

        // Remove all hiding classes so the menu is actually visible
        this.contextMenu.classList.remove('u-hidden', 'ui-screen-hidden');
        this.contextMenu.classList.add('ctx-open');
        this.contextMenu.style.position = 'fixed';
        this.contextMenu.style.zIndex = '20000';
        this.contextMenu.style.left = `${adjustedLeft}px`;
        this.contextMenu.style.top = `${adjustedTop}px`;
        this.contextMenu.style.display = 'block';
        this.contextMenu.style.pointerEvents = 'auto';
      }
    };

    // Close context menu on outside click
    window.addEventListener('click', (e) => {
      if (this.contextMenu && !this.contextMenu.contains(e.target as Node)) {
        this.closeContextMenu();
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
        this.togglePlayerAdmin(this.selectedPlayerForAction.id);
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

    // Botón de salir de sala en la cabecera del menú in-game
    document.getElementById('btn-leave-room')?.addEventListener('click', () => {
      this.leaveCurrentRoom();
    });

    // Notificar salida de sala al cerrar pestaña o recargar
    window.addEventListener('beforeunload', () => {
      if (this.currentRoomId) {
        this.signaling.leaveRoom(this.currentRoomId);
      }
    });

    // In-game menu overlay toggle (Button & Escape/Menu key)
    const menuToggleBtn = document.getElementById('menu-toggle-btn');

    const toggleMenu = () => {
      if (this.uiStateMachine.getState() !== 'STATE_IN_GAME') return;
      this.teamSelect.toggle();
      this.updateAdminControlsUI();
      this.updateTeamLists();
    };

    if (menuToggleBtn) menuToggleBtn.addEventListener('click', toggleMenu);

    window.addEventListener('keydown', (e) => {
      // Si no estamos en STATE_IN_GAME, no procesar atajos de partido
      if (this.uiStateMachine.getState() !== 'STATE_IN_GAME') {
        return;
      }

      // Escape o atajo de menú
      if (e.key === 'Escape' || this.inputManager.isActionKey('menu', e.code)) {
        // Si el chat está enfocado, primero desenfocar el chat y NO cerrar/abrir el menú
        if (this.chat.isFocused()) {
          e.preventDefault();
          this.chat.blur();
          return;
        }

        // Si el modal de teclas está abierto, cerrarlo
        const settingsModal = document.getElementById('settingsModal');
        if (settingsModal && settingsModal.style.display !== 'none' && !settingsModal.classList.contains('ui-screen-hidden') && !settingsModal.classList.contains('u-hidden')) {
          settingsModal.style.display = 'none';
          settingsModal.classList.add('u-hidden');
          return;
        }

        // Si el partido está en STOPPED, el menú está forzado y no se debe alternar ni mutar
        if (this.getAuthoritativeMatchState() === MatchPhase.STOPPED || this.teamSelect.getMatchState() === MatchPhase.STOPPED) {
          e.preventDefault();
          return;
        }

        toggleMenu();
        return;
      }

      // Tecla Enter para enfocar el chat sin movimiento residual
      if (e.code === 'Enter') {
        if (!this.chat.isFocused()) {
          if (!(document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement)) {
            e.preventDefault();
            this.chat.focus();
            this.inputManager.resetMovement();
            return;
          }
        }
      }

      // Evitar atajos de teclado mientras se escribe en chat o inputs de formulario
      if (
        document.activeElement instanceof HTMLInputElement ||
        document.activeElement instanceof HTMLTextAreaElement
      ) {
        return;
      }

      // Pausa con tecla configurable (exclusivo Admin)
      if (this.inputManager.isActionKey('pause', e.code)) {
        if (this.localPlayer.isAdmin) {
          this.requestTogglePause();
          return;
        }
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

    // Leave Room Button — only #btn-leave-room inside the menu exists (header button removed)

    // Match Iniciar / Detener
    const btnStartStop = document.getElementById('btn-start-stop');
    if (btnStartStop) {
      btnStartStop.addEventListener('click', () => {
        if (!this.localPlayer.isAdmin) return;
        const currentPhase = this.engine ? this.engine.fsm.currentState : (typeof this.currentMatchState === 'number' ? this.currentMatchState : toMatchPhase(this.currentMatchState));
        const action = currentPhase === MatchPhase.STOPPED ? 'START' : 'STOP';

        if (this.mode === 'client' && this.hostPeer) {
          // Delegate to host via match_control message
          this.hostPeer.sendReliable(JSON.stringify({
            type: 'match_control',
            action
          }));
        } else if (this.engine) {
          // Host/practice: execute directly
          if (action === 'START') {
            this.engine.startMatch();
          } else {
            this.engine.stopMatch();
          }
          this.updateAdminControlsUI();
          this.broadcastMatchStateSync();
        }
      });
    }

    // Match Pausar / Reanudar
    const btnPauseResume = document.getElementById('btn-pause-resume');
    if (btnPauseResume) {
      btnPauseResume.addEventListener('click', () => {
        if (!this.localPlayer.isAdmin) return;
        this.requestTogglePause();
      });
    }

    // Admin Time Limit Select
    const selectTimeLimit = (document.getElementById('select-time-limit') || document.getElementById('time-limit')) as HTMLSelectElement | HTMLInputElement | null;
    if (selectTimeLimit) {
      selectTimeLimit.addEventListener('change', () => {
        if (!this.localPlayer.isAdmin && !this.localPlayer.isHost) return;
        const mins = parseInt(selectTimeLimit.value, 10);
        this.updateRoomConfig({ timeLimit: isNaN(mins) ? 3 : mins });
      });
    }

    // Admin Score Limit Select
    const selectScoreLimit = (document.getElementById('select-goal-limit') || document.getElementById('score-limit')) as HTMLSelectElement | HTMLInputElement | null;
    if (selectScoreLimit) {
      selectScoreLimit.addEventListener('change', () => {
        if (!this.localPlayer.isAdmin && !this.localPlayer.isHost) return;
        const goals = parseInt(selectScoreLimit.value, 10);
        this.updateRoomConfig({ scoreLimit: isNaN(goals) ? 3 : goals });
      });
    }

    // Admin Lock Teams Button
    const btnLockTeams = document.getElementById('btn-lock-teams');
    if (btnLockTeams) {
      btnLockTeams.addEventListener('click', () => {
        if (!this.localPlayer.isAdmin && !this.localPlayer.isHost) return;
        const newLock = !this.roomConfig.teamsLocked;
        this.updateRoomConfig({ teamsLocked: newLock });
      });
    }
  }

  private closeContextMenu(): void {
    if (this.contextMenu) {
      this.contextMenu.style.display = 'none';
      this.contextMenu.classList.remove('ctx-open');
    }
  }

  private setupSignaling(): void {
    this.signaling.onOpen = () => {
      this.lobby?.setSignalingStatus('connected');
    };

    this.signaling.onClose = () => {
      this.lobby?.setSignalingStatus('disconnected');
    };

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
          this.lobby?.hideConnecting();
          this.uiStateMachine?.transitionTo('STATE_IN_GAME');
          break;
        }

        case 'room_joined': {
          // Client received room_joined from signaling — but do NOT transition to game yet.
          // Wait for P2P connection + initial_state handshake from host.
          this.currentRoomId = msg.roomId || '';
          this.localPlayer.id = this.signaling.peerId;
          if (msg.config) {
            this.roomConfig = { ...this.roomConfig, ...msg.config };
          }
          if (this.roomNameBadge) {
            this.roomNameBadge.textContent = `${this.roomConfig.name} [${this.currentRoomId}]`;
          }
          this.updateAdminPanelVisibility();
          // Keep the connecting indicator visible — transition happens on initial_state
          this.lobby?.showConnecting('Estableciendo conexión P2P con el anfitrión...');
          break;
        }

        case 'room_list': {
          if (msg.rooms) {
            this.lobby?.setRoomList(msg.rooms);
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
          this.lobby?.hideConnecting();
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
          this.uiStateMachine?.transitionTo('STATE_LOBBY');
          // Leave button is inside ingame-menu, no separate cleanup needed
          break;
        }
      }
    };

    // Auto-reconnection handler: re-register room if we were hosting
    this.signaling.onReconnected = () => {
      this.lobby?.setSignalingStatus('connected');
      if (this.mode === 'host' && this.currentRoomId) {
        // Attempt to rejoin our room during grace period
        this.signaling.rejoinRoom(this.currentRoomId);
      }
      this.signaling.requestRoomList();
    };

    this.lobby?.setSignalingStatus('connecting');
    this.signaling.connect().then(() => {
      this.lobby?.setSignalingStatus('connected');
      this.signaling.requestRoomList();
    }).catch(() => {
      this.lobby?.setSignalingStatus('disconnected', 'Modo offline');
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
    this.currentHostId = this.localPlayer.id;
    this.currentRoomId = 'PRACTICE';

    this.engine = new GameEngine({ scoreLimit: 0, timeLimitSeconds: 0 });
    this.setupEngineCallbacks(this.engine);
    this.engine.addPlayer(this.localPlayer);
    this.engine.startMatch();

    if (this.roomNameBadge) this.roomNameBadge.textContent = 'Modo Práctica';
    // Leave button is inside ingame-menu only
    this.updateAdminPanelVisibility();

    this.uiStateMachine.transitionTo('STATE_IN_GAME');
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
    this.currentHostId = this.localPlayer.id;

    this.roomConfig = { ...config };
    this.engine = new GameEngine({
      scoreLimit: this.roomConfig.scoreLimit,
      timeLimitSeconds: this.roomConfig.timeLimit * 60
    });
    this.setupEngineCallbacks(this.engine);
    this.engine.addPlayer(this.localPlayer);

    // Leave button is inside ingame-menu only
    this.updateAdminPanelVisibility();
    this.updateAdminControlsUI();

    this.lobby.showConnecting(`Creando sala "${this.roomConfig.name}"...`);

    if (!this.signaling.isConnected) {
      try {
        await this.signaling.connect();
        this.lobby.setSignalingStatus('connected');
      } catch (err) {
        this.lobby.hideConnecting();
        console.error('[Signaling] Failed to connect:', err);
        alert('No se pudo conectar al servidor de señalización.');
        return;
      }
    }

    this.signaling.createRoom(this.roomConfig, undefined, this.localPlayer.name);
    this.updateTeamLists();
  }

  public async startAsClient(nickname: string, roomId: string, password?: string): Promise<void> {
    this.mode = 'client';
    this.localPlayer.id = this.signaling.peerId;
    this.localPlayer.name = nickname;
    this.localPlayer.avatar = nickname.substring(0, 2).toUpperCase();
    this.localPlayer.team = 'spec';
    this.localPlayer.isHost = false;
    this.localPlayer.isAdmin = false;
    this.currentHostId = null;
    this.currentRoomId = roomId;
    this.currentMatchState = MatchPhase.STOPPED;
    this.lastClientPhase = null;
    this.resetClientPrediction();

    // Leave button is inside ingame-menu only
    this.updateAdminPanelVisibility();

    this.lobby.showConnecting(`Conectando a la sala ${roomId}...`);

    if (!this.signaling.isConnected) {
      try {
        await this.signaling.connect();
        this.lobby.setSignalingStatus('connected');
      } catch (err) {
        this.lobby.hideConnecting();
        console.error('[Signaling] Failed to connect:', err);
        alert('No se pudo conectar al servidor de señalización.');
        return;
      }
    }

    // Start the 10-second join timeout — if handshake doesn't complete, abort
    this.clearJoinTimeout();
    this.joinTimeoutId = setTimeout(() => {
      this.joinTimeoutId = null;
      console.warn('[Client] Join handshake timed out after 10 seconds');
      this.lobby?.showConnecting('Tiempo de espera agotado al conectar con el anfitrión. Regresando al lobby...');
      // Clean up partial connection state
      if (this.hostPeer) {
        this.hostPeer.close();
        this.hostPeer = null;
      }
      this.currentRoomId = '';
      this.mode = 'practice';
      setTimeout(() => {
        this.lobby?.hideConnecting();
        this.uiStateMachine?.transitionTo('STATE_LOBBY');
        this.signaling.requestRoomList();
      }, 2000);
    }, GameApp.JOIN_TIMEOUT_MS);

    this.signaling.joinRoom(roomId, password, this.localPlayer.name);
  }

  private clearJoinTimeout(): void {
    if (this.joinTimeoutId !== null) {
      clearTimeout(this.joinTimeoutId);
      this.joinTimeoutId = null;
    }
  }

  public leaveCurrentRoom(): void {
    // Cancel any pending join timeout
    this.clearJoinTimeout();

    // Notificar al signaling server que abandonamos la sala
    if (this.currentRoomId) {
      this.signaling.leaveRoom(this.currentRoomId);
    }

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
    this.resetClientPrediction();

    // Ocultar menú in-game y menú contextual
    this.teamSelect.close(true);
    this.closeContextMenu();

    // Leave button cleanup not needed — it's inside the menu that gets hidden
    if (this.roomNameBadge) this.roomNameBadge.textContent = 'Lobby';
    this.updateAdminPanelVisibility();

    this.stopRenderLoop();
    this.canvasRenderer.clear();
    this.lobby?.hideConnecting();
    this.uiStateMachine.transitionTo('STATE_LOBBY');
    this.signaling.requestRoomList();
    this.chat.addMessage({ author: 'Sistema', text: 'Has salido de la sala.', team: 'sys' });
  }

  private setupEngineCallbacks(engine: GameEngine): void {
    engine.onGoal = (_scoringTeam, _redScore, _blueScore) => {
      this.audioManager.playGoalWhistle();
      this.broadcastMatchStateSync();
      this.broadcastSnapshot();
    };

    engine.onKick = () => {
      this.audioManager.playKick();
    };

    engine.onPostHit = () => {
      this.audioManager.playPostHit();
    };

    engine.onMatchEnd = (winner) => {
      this.audioManager.playGoalWhistle();
      const outcomeText = winner ? `¡Victoria del Equipo ${winner === 'red' ? 'Rojo' : 'Azul'}!` : '¡Empate!';
      this.enforceMenuState(MatchPhase.STOPPED, outcomeText);
      this.broadcastMatchStateSync();
      this.broadcastSnapshot();
      this.updateAdminControlsUI();
    };

    engine.onStateChange = (state) => {
      this.enforceMenuState(state);
      if (state === MatchPhase.COUNTDOWN) {
        this.audioManager.playCountdown(false);
      } else if (state === MatchPhase.PLAYING) {
        this.audioManager.playCountdown(true);
      } else if (state === MatchPhase.MATCH_ENDED) {
        this.audioManager.playGoalWhistle();
        this.broadcastMatchStateSync();
      } else if (state === MatchPhase.PAUSED) {
        this.broadcastMatchStateSync();
      }
      this.broadcastSnapshot();
      this.updateAdminControlsUI();
    };
  }

  private async handlePeerJoinedAsHost(peerId: string, initialNick?: string): Promise<void> {
    const peer = new PeerConnection(peerId, true);
    this.peers.set(peerId, peer);

    peer.onIceCandidate = (candidate) => {
      this.signaling.sendIceCandidate(peerId, candidate);
    };

    peer.onDataChannelOpen = () => {
      // Don't send initial_state yet — wait for peer_handshake from client
      // This ensures the client is ready to receive
    };

    peer.onConnected = () => {
      console.log(`[Host] Conexión P2P establecida con ${peerId}`);
    };

    peer.onDisconnected = () => {
      console.log(`[Host] Conexión P2P perdida con ${peerId}`);
      this.handlePeerLeft(peerId);
    };

    peer.onUnreliableMessage = (data: ArrayBuffer) => {
      try {
        const input = InputPacket.decode(data);
        if (input && this.engine) {
          const p = this.engine.players.get(peerId);
          if (p) {
            p.inputMask = input.inputMask;
          }
        }
      } catch (err) {
        console.warn('[Host] Error al decodificar paquete de input:', err);
      }
    };

    peer.onReliableMessage = (data: string) => {
      try {
        const msg = JSON.parse(data);
        if (msg.type === 'chat') {
          if (msg.team === 'sys') {
            this.chat.addSystemMessage(msg.text);
          } else {
            this.chat.addMessage({ author: msg.author, text: msg.text, team: msg.team });
          }
          this.broadcastReliable(data, peerId);
        } else if (msg.type === 'peer_handshake' || msg.type === 'CLIENT_HELLO') {
          // CLIENT_HELLO received — add player and respond with INITIAL_STATE
          const nick = msg.nickname || initialNick || `Guest_${peerId.substring(0, 4)}`;
          const avatar = msg.avatar || nick.substring(0, 2).toUpperCase();

          const newPlayer = new Player({
            id: peerId,
            name: nick,
            avatar,
            team: 'spec',
            isHost: false,
            isAdmin: false
          });

          if (this.engine) {
            this.engine.addPlayer(newPlayer);
            this.updateTeamLists();

            // Build and send initial_state packet
            const currentState = this.engine?.fsm.currentState ?? MatchPhase.STOPPED;
            const matchStatePayload: MatchStatePayload = {
              state: currentState,
              timeRemaining: this.engine.matchTimerSeconds ?? 0,
              redScore: this.engine.redScore ?? 0,
              blueScore: this.engine.blueScore ?? 0,
              countdown: this.engine.fsm.countdownSeconds ?? 0
            };

            const players = Array.from(this.engine.players.values()).map(p => ({
              id: p.id,
              name: p.name,
              avatar: p.avatar,
              team: p.team,
              isHost: p.isHost,
              isAdmin: p.isAdmin,
              discId: p.discId
            }));

            peer.sendReliable(JSON.stringify({
              type: 'INITIAL_STATE',
              yourPlayerId: peerId,
              players,
              config: this.roomConfig,
              matchState: matchStatePayload
            }));

            // Also sync all other clients about the new player
            this.syncPlayersWithClients();
            this.broadcastSystemChat(`${nick} se ha unido a la sala.`);
          }
        } else if (msg.type === 'change_team') {
          const requester = this.engine?.players.get(peerId);
          const isAdmin = requester?.isAdmin || false;
          if (!canChangeTeam(peerId, msg.playerId, Boolean(this.roomConfig.teamsLocked), isAdmin)) {
            // Rechazo silencioso
            return;
          }
          if (this.engine) {
            this.engine.setPlayerTeam(msg.playerId, msg.team);
            this.updateTeamLists();
            this.syncPlayersWithClients();
          }
        } else if (msg.type === 'set_admin') {
          const requester = this.engine?.players.get(peerId);
          const isTargetHost = msg.targetId === this.localPlayer.id ||
            Boolean(this.engine?.players.get(msg.targetId)?.isHost) ||
            Boolean(this.currentHostId && msg.targetId === this.currentHostId);
          // Reject if target is the host — host admin is immutable
          if (requester?.isAdmin && !isTargetHost) {
            this.setPlayerAdmin(msg.targetId, Boolean(msg.isAdmin));
          }
        } else if (msg.type === 'kick_player') {
          const requester = this.engine?.players.get(peerId);
          const isTargetHost = msg.targetId === this.localPlayer.id ||
            Boolean(this.engine?.players.get(msg.targetId)?.isHost) ||
            Boolean(this.currentHostId && msg.targetId === this.currentHostId);
          if (requester?.isAdmin && !isTargetHost) {
            this.kickPlayer(msg.targetId);
          }
        } else if (msg.type === 'ban_player') {
          const requester = this.engine?.players.get(peerId);
          const isTargetHost = msg.targetId === this.localPlayer.id ||
            Boolean(this.engine?.players.get(msg.targetId)?.isHost) ||
            Boolean(this.currentHostId && msg.targetId === this.currentHostId);
          if (requester?.isAdmin && !isTargetHost) {
            this.banPlayer(msg.targetId);
          }
        } else if (msg.type === 'toggle_pause') {
          const requester = this.engine?.players.get(peerId);
          if (requester?.isAdmin && this.engine) {
            this.engine.togglePause();
            this.updateAdminControlsUI();
            this.broadcastMatchStateSync();
          }
        } else if (msg.type === 'match_control') {
          const requester = this.engine?.players.get(peerId);
          if (requester?.isAdmin && this.engine) {
            if (msg.action === 'START') {
              this.engine.startMatch();
            } else if (msg.action === 'STOP') {
              this.engine.stopMatch();
            }
            this.updateAdminControlsUI();
            this.broadcastMatchStateSync();
          }
        } else if (msg.type === 'ROOM_SETTINGS_REQUEST') {
          const requester = this.engine?.players.get(peerId);
          if (!requester?.isAdmin && peerId !== this.currentHostId) return;

          const timeLimit = msg.timeLimit !== undefined ? msg.timeLimit : this.roomConfig.timeLimit;
          const goalLimit = msg.goalLimit !== undefined ? msg.goalLimit : (msg.scoreLimit !== undefined ? msg.scoreLimit : this.roomConfig.scoreLimit);
          const teamsLocked = msg.teamsLocked !== undefined ? msg.teamsLocked : this.roomConfig.teamsLocked;

          this.updateRoomConfig({
            timeLimit,
            scoreLimit: goalLimit,
            teamsLocked
          });
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
      // Send CLIENT_HELLO — the host will respond with INITIAL_STATE
      peer.sendReliable(JSON.stringify({
        type: 'CLIENT_HELLO',
        nickname: this.localPlayer.name,
        avatar: this.localPlayer.avatar
      }));
    };

    peer.onDisconnected = () => {
      console.log('[Client] Conexión P2P perdida con el Host');
      this.chat.addMessage({ author: 'Sistema', text: 'Conexión P2P con el Host perdida.', team: 'sys' });
      this.leaveCurrentRoom();
    };

    peer.onUnreliableMessage = (data: ArrayBuffer) => {
      try {
        const snap = SnapshotPacket.decode(data);
        if (snap) {
          this.jitterBuffer.push(snap);
          this.reconcileClientPrediction(snap);
        }
      } catch (err) {
        console.warn('[Client] Error al decodificar snapshot de red:', err);
      }
    };

    peer.onReliableMessage = (data: string) => {
      try {
        const msg = JSON.parse(data);
        if (msg.type === 'chat') {
          if (msg.team === 'sys') {
            this.chat.addSystemMessage(msg.text);
          } else {
            this.chat.addMessage({ author: msg.author, text: msg.text, team: msg.team });
          }
        } else if (msg.type === 'initial_state' || msg.type === 'INITIAL_STATE') {
          // INITIAL_STATE received — handshake complete!
          this.clearJoinTimeout();

          // Assign our authoritative player ID from the host
          this.localPlayer.id = msg.yourPlayerId;

          // Apply room config
          if (msg.config) {
            this.roomConfig = { ...this.roomConfig, ...msg.config };
          }

          // Process player list
          const self = msg.players.find((p: any) => p.id === this.localPlayer.id);
          if (self) {
            this.localPlayer.isAdmin = Boolean(self.isAdmin);
            this.localPlayer.team = self.team;
            if (self.discId !== undefined) {
              this.localPlayer.discId = self.discId;
            }
          }
          const remoteHostId = msg.players.find((p: any) => p.isHost)?.id;
          if (remoteHostId) {
            this.currentHostId = remoteHostId;
          }
          this.teamSelect.updateLists(msg.players, this.localPlayer.isAdmin, this.currentHostId || undefined);

          // Apply match state
          if (msg.matchState) {
            const ms: MatchStatePayload = msg.matchState;
            this.currentMatchState = ms.state;
            this.jitterBuffer.setMatchState(ms.state);
            this.hud.update(ms.redScore, ms.blueScore, ms.timeRemaining);
            this.teamSelect.updateMatchState(ms.state);
          }

          this.updateAdminControlsUI();
          this.chat.addSystemMessage(`Conectado a la sala: ${this.roomConfig.name}`);

          // NOW transition to in-game — we have all the data we need
          this.lobby?.hideConnecting();
          this.uiStateMachine?.transitionTo('STATE_IN_GAME');

        } else if (msg.type === 'team_sync') {
          const self = msg.players.find((p: any) => p.id === this.localPlayer.id || p.id === this.signaling.peerId);
          if (self) {
            this.localPlayer.id = self.id;
            this.localPlayer.isAdmin = Boolean(self.isAdmin);
            this.localPlayer.team = self.team;
            if (self.discId !== undefined) {
              this.localPlayer.discId = self.discId;
            }
          }
          const remoteHostId = msg.players.find((p: any) => p.isHost)?.id;
          if (remoteHostId) {
            this.currentHostId = remoteHostId;
          }
          this.teamSelect.updateLists(msg.players, this.localPlayer.isAdmin, this.currentHostId || undefined);
          this.updateAdminControlsUI();
        } else if (msg.type === 'MATCH_STATE_SYNC') {
          const p: MatchStatePayload = msg.payload;
          const phase = toMatchPhase(p.state);
          this.currentMatchState = phase;
          this.lastClientPhase = phase;
          this.jitterBuffer.setMatchState(phase);

          this.hud.update(p.redScore, p.blueScore, p.timeRemaining);

          let outcomeText: string | undefined = undefined;
          if (phase === MatchPhase.STOPPED) {
            if (p.banner?.subtext) {
              outcomeText = p.banner.subtext;
            } else if (p.redScore !== undefined && p.blueScore !== undefined) {
              const red = p.redScore;
              const blue = p.blueScore;
              if (red > blue) {
                outcomeText = '¡Victoria del Equipo Rojo!';
              } else if (blue > red) {
                outcomeText = '¡Victoria del Equipo Azul!';
              } else {
                outcomeText = '¡Empate!';
              }
            }
          }

          this.enforceMenuState(phase, outcomeText);
          this.updateAdminControlsUI();
        } else if (msg.type === 'set_game_state') {
          this.updateAdminControlsUI();
        } else if (msg.type === 'room_config_sync' || msg.type === 'ROOM_SETTINGS_SYNC') {
          const newTimeLimit = msg.timeLimit !== undefined ? msg.timeLimit : msg.config?.timeLimit;
          const newScoreLimit = msg.goalLimit !== undefined ? msg.goalLimit : (msg.scoreLimit !== undefined ? msg.scoreLimit : msg.config?.scoreLimit);
          const newTeamsLocked = msg.teamsLocked !== undefined ? msg.teamsLocked : msg.config?.teamsLocked;

          if (newTimeLimit !== undefined) this.roomConfig.timeLimit = newTimeLimit;
          if (newScoreLimit !== undefined) this.roomConfig.scoreLimit = newScoreLimit;
          if (newTeamsLocked !== undefined) this.roomConfig.teamsLocked = newTeamsLocked;
          if (msg.config) {
            this.roomConfig = { ...this.roomConfig, ...msg.config };
          }
          this.applyRoomConfigToEngine();
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
    const player = this.engine?.players.get(peerId);
    const playerName = player?.name;
    const wasKickedOrBanned = this.bannedPeers.has(peerId) || this.kickedPeers.has(peerId);

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
    if (playerName && !wasKickedOrBanned) {
      this.broadcastSystemChat(`${playerName} ha abandonado la sala.`);
    }
    this.kickedPeers.delete(peerId);
  }

  private handleTeamChange(playerId: string, team: TeamType): void {
    const isAdmin = this.localPlayer.isAdmin;

    if (!canChangeTeam(this.localPlayer.id, playerId, Boolean(this.roomConfig.teamsLocked), isAdmin)) {
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
      const players = Array.from(this.engine.players.values()).map(p => ({
        id: p.id,
        name: p.name,
        avatar: p.avatar,
        team: p.team,
        isHost: p.isHost,
        isAdmin: p.isAdmin,
        discId: p.discId
      }));
      this.broadcastReliable(JSON.stringify({
        type: 'team_sync',
        players
      }));
    }
  }

  private updateTeamLists(): void {
    if (this.mode === 'host' || this.mode === 'practice') {
      if (this.engine) {
        const hostId = this.currentHostId || Array.from(this.engine.players.values()).find(p => p.isHost)?.id || this.localPlayer.id;
        this.teamSelect.updateLists(Array.from(this.engine.players.values()), this.localPlayer.isAdmin, hostId);
      }
    }
  }

  // --- Moderation & Admin actions ---
  public transferPlayer(playerId: string, newTeam: TeamType): void {
    this.handleTeamChange(playerId, newTeam);
  }

  public togglePlayerAdmin(playerId: string): void {
    const isTargetHost = Boolean(
      (this.currentHostId && playerId === this.currentHostId) ||
      (this.selectedPlayerForAction?.isHost && this.selectedPlayerForAction.id === playerId) ||
      (playerId === this.localPlayer.id && (this.mode === 'host' || this.localPlayer.isHost))
    );

    // Host admin is immutable — cannot toggle under any circumstance
    if (isTargetHost) {
      console.warn('[GameApp] Cannot toggle admin for room host.');
      return;
    }

    if (this.mode === 'host' && this.engine) {
      const p = this.engine.players.get(playerId);
      if (p && !p.isHost && p.id !== this.localPlayer.id) {
        this.setPlayerAdmin(playerId, !p.isAdmin);
      }
    } else if (this.mode === 'client' && this.hostPeer && this.localPlayer.isAdmin) {
      if (this.selectedPlayerForAction?.isHost || (this.currentHostId && playerId === this.currentHostId)) return;
      const targetIsAdmin = Boolean(this.selectedPlayerForAction?.isAdmin);
      this.hostPeer.sendReliable(JSON.stringify({
        type: 'set_admin',
        targetId: playerId,
        isAdmin: !targetIsAdmin
      }));
    }
  }

  public setPlayerAdmin(playerId: string, isAdmin: boolean): void {
    if (this.mode === 'host' && this.engine) {
      const p = this.engine.players.get(playerId);
      if (!p) return;
      // Host admin is immutable — host cannot lose admin privileges
      const isHostPlayer = Boolean(
        p.isHost ||
        p.id === this.localPlayer.id ||
        (this.currentHostId && p.id === this.currentHostId)
      );
      if (isHostPlayer && !isAdmin) {
        console.warn('[GameApp] Cannot revoke admin privileges from the host.');
        return;
      }
      p.isAdmin = isAdmin;
      this.updateTeamLists();
      this.syncPlayersWithClients();
      const actionMsg = p.isAdmin ? `${p.name} ahora es Administrador.` : `${p.name} ya no es Administrador.`;
      this.chat.addMessage({ author: 'Admin', text: actionMsg, team: 'sys' });
      this.broadcastReliable(JSON.stringify({
        type: 'chat',
        author: 'Admin',
        text: actionMsg,
        team: 'sys'
      }));
    }
  }

  public promotePlayerToAdmin(playerId: string): void {
    this.setPlayerAdmin(playerId, true);
  }

  public kickPlayer(playerId: string): void {
    const isHostPlayer = playerId === this.localPlayer.id || (this.currentHostId && playerId === this.currentHostId);
    if (isHostPlayer) {
      console.warn('[GameApp] Cannot kick the host player.');
      return;
    }
    if (this.mode === 'host') {
      const p = this.engine?.players.get(playerId);
      const nick = p?.name || 'Un jugador';
      const peer = this.peers.get(playerId);
      if (peer) {
        this.kickedPeers.add(playerId);
        peer.sendReliable(JSON.stringify({ type: 'kicked' }));
        setTimeout(() => {
          this.handlePeerLeft(playerId);
        }, 100);
        this.broadcastSystemChat(`${nick} fue expulsado de la sala por un administrador.`);
      }
    } else if (this.mode === 'client' && this.hostPeer && this.localPlayer.isAdmin) {
      this.hostPeer.sendReliable(JSON.stringify({
        type: 'kick_player',
        targetId: playerId
      }));
    }
  }

  public banPlayer(playerId: string): void {
    const isHostPlayer = playerId === this.localPlayer.id || (this.currentHostId && playerId === this.currentHostId);
    if (isHostPlayer) {
      console.warn('[GameApp] Cannot ban the host player.');
      return;
    }
    if (this.mode === 'host') {
      this.bannedPeers.add(playerId);
      const p = this.engine?.players.get(playerId);
      const nick = p?.name || 'Un jugador';
      const peer = this.peers.get(playerId);
      if (peer) {
        peer.sendReliable(JSON.stringify({ type: 'banned' }));
        setTimeout(() => {
          this.handlePeerLeft(playerId);
        }, 100);
        this.broadcastSystemChat(`${nick} fue baneado de la sala por un administrador.`);
      }
    } else if (this.mode === 'client' && this.hostPeer && this.localPlayer.isAdmin) {
      this.hostPeer.sendReliable(JSON.stringify({
        type: 'ban_player',
        targetId: playerId
      }));
    }
  }

  public updateRoomConfig(newConfig: Partial<RoomConfig>): void {
    if (this.mode === 'host' || this.mode === 'practice') {
      this.roomConfig = { ...this.roomConfig, ...newConfig };
      this.applyRoomConfigToEngine();
      this.updateAdminControlsUI();

      if (this.mode === 'host') {
        this.signaling.updateRoomConfig(this.roomConfig);
        const syncPayload = JSON.stringify({
          type: 'ROOM_SETTINGS_SYNC',
          timeLimit: this.roomConfig.timeLimit,
          goalLimit: this.roomConfig.scoreLimit,
          scoreLimit: this.roomConfig.scoreLimit,
          teamsLocked: this.roomConfig.teamsLocked
        });
        this.broadcastReliable(syncPayload);
        this.broadcastReliable(JSON.stringify({
          type: 'room_config_sync',
          config: this.roomConfig
        }));
      }
    } else if (this.mode === 'client' && this.hostPeer) {
      if (!this.localPlayer.isAdmin && !this.localPlayer.isHost) return;
      const timeLimit = newConfig.timeLimit !== undefined ? newConfig.timeLimit : this.roomConfig.timeLimit;
      const goalLimit = newConfig.scoreLimit !== undefined ? newConfig.scoreLimit : this.roomConfig.scoreLimit;
      const teamsLocked = newConfig.teamsLocked !== undefined ? newConfig.teamsLocked : this.roomConfig.teamsLocked;

      this.hostPeer.sendReliable(JSON.stringify({
        type: 'ROOM_SETTINGS_REQUEST',
        timeLimit,
        goalLimit,
        scoreLimit: goalLimit,
        teamsLocked
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
    const isAdmin = Boolean(this.localPlayer.isAdmin || this.localPlayer.isHost);
    const currentPhase = this.engine ? this.engine.fsm.currentState : (typeof this.currentMatchState === 'number' ? this.currentMatchState : toMatchPhase(this.currentMatchState));

    if (this.btnStartStop) {
      this.btnStartStop.disabled = !isAdmin;
      if (currentPhase === MatchPhase.STOPPED) {
        this.btnStartStop.textContent = '▶ Iniciar Partido';
        this.btnStartStop.className = 'btn btn-primary';
      } else {
        this.btnStartStop.textContent = '⏹ Detener Partido';
        this.btnStartStop.className = 'btn btn-danger';
      }
    }

    if (this.btnPauseResume) {
      this.btnPauseResume.disabled = !isAdmin || currentPhase === MatchPhase.STOPPED;
      if (currentPhase === MatchPhase.PAUSED) {
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

    if (this.selectTimeLimit) {
      this.selectTimeLimit.disabled = !isAdmin;
      this.selectTimeLimit.value = this.roomConfig.timeLimit.toString();
    }

    if (this.selectScoreLimit) {
      this.selectScoreLimit.disabled = !isAdmin;
      this.selectScoreLimit.value = this.roomConfig.scoreLimit.toString();
    }
  }

  public broadcastMatchStateSync(): void {
    if (this.mode !== 'host' && this.mode !== 'practice') return;
    const currentState = this.engine ? this.engine.fsm.currentState : this.currentMatchState;
    const timeRemaining = this.engine?.matchTimerSeconds ?? 0;
    const redScore = this.engine?.redScore ?? 0;
    const blueScore = this.engine?.blueScore ?? 0;
    const countdown = this.engine?.fsm.countdownSeconds ?? 0;

    const payload: MatchStatePayload = {
      state: currentState,
      timeRemaining,
      redScore,
      blueScore,
      countdown
    };

    if (this.mode === 'host') {
      this.broadcastReliable(JSON.stringify({
        type: 'MATCH_STATE_SYNC',
        payload
      }));
    }
  }

  public requestTogglePause(): void {
    if (!this.localPlayer.isAdmin) return;
    if (this.mode === 'host' || this.mode === 'practice') {
      if (this.engine) {
        this.engine.togglePause();
        this.updateAdminControlsUI();
        this.broadcastMatchStateSync();
      }
    } else if (this.mode === 'client' && this.hostPeer) {
      this.hostPeer.sendReliable(JSON.stringify({
        type: 'toggle_pause'
      }));
    }
  }

  public getAuthoritativeMatchState(): MatchState {
    if (this.mode === 'client') {
      return this.currentMatchState;
    }
    return this.engine ? this.engine.fsm.currentState : this.currentMatchState;
  }

  public enforceMenuState(state: MatchPhase | MatchState | string, outcomeText?: string): void {
    const phase = typeof state === 'number' ? state : toMatchPhase(state);
    if (this.uiStateMachine.getState() !== 'STATE_IN_GAME') {
      this.teamSelect.close(true);
      return;
    }
    this.teamSelect.updateMatchState(phase, outcomeText);
    this.updateAdminControlsUI();
  }

  private setupKeybindsModal(): void {
    const modal = document.getElementById('settingsModal');
    const toggleBtn = document.getElementById('btn-settings-toggle');
    const closeBtn = document.getElementById('btnCloseSettings');
    const saveBtn = document.getElementById('btnSaveKeybinds');
    const resetBtn = document.getElementById('btnResetKeybinds');
    const listContainer = document.getElementById('keybindsList');

    if (!modal || !listContainer) return;

    const actionLabels: Record<keyof KeyBinds, string> = {
      up: 'Arriba',
      down: 'Abajo',
      left: 'Izquierda',
      right: 'Derecha',
      kick: 'Chutar',
      menu: 'Menú / Escapar',
      pause: 'Pausar (Admin)',
      chat: 'Enfocar Chat'
    };

    let recordingAction: keyof KeyBinds | null = null;
    let recordingBtn: HTMLButtonElement | null = null;

    const renderKeybinds = () => {
      listContainer.innerHTML = '';
      const binds = this.inputManager.keyBinds;

      for (const [actionKey, label] of Object.entries(actionLabels) as [keyof KeyBinds, string][]) {
        const row = document.createElement('div');
        row.className = 'keybind-row';

        const labelEl = document.createElement('span');
        labelEl.className = 'keybind-label';
        labelEl.textContent = label;

        const btn = document.createElement('button');
        btn.className = 'keybind-btn';
        btn.textContent = binds[actionKey].join(' / ') || 'Ninguna';
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (recordingBtn) {
            recordingBtn.classList.remove('recording');
            recordingBtn.textContent = binds[recordingAction!].join(' / ') || 'Ninguna';
          }
          recordingAction = actionKey;
          recordingBtn = btn;
          btn.classList.add('recording');
          btn.textContent = 'Presiona tecla...';
        });

        row.appendChild(labelEl);
        row.appendChild(btn);
        listContainer.appendChild(row);
      }
    };

    window.addEventListener('keydown', (e) => {
      if (!recordingAction || !recordingBtn) return;
      e.preventDefault();
      e.stopPropagation();

      const newBinds = { ...this.inputManager.keyBinds };
      newBinds[recordingAction] = [e.code];
      this.inputManager.saveKeyBinds(newBinds);

      recordingBtn.classList.remove('recording');
      recordingAction = null;
      recordingBtn = null;
      renderKeybinds();
    }, true);

    const openModal = () => {
      renderKeybinds();
      modal.classList.remove('u-hidden');
      modal.classList.remove('ui-screen-hidden');
      modal.style.display = 'flex';
      modal.style.zIndex = '10001';
      modal.style.pointerEvents = 'auto';
    };

    const closeModal = () => {
      modal.style.display = 'none';
      modal.classList.add('u-hidden');
      if (recordingBtn) {
        recordingBtn.classList.remove('recording');
        recordingAction = null;
        recordingBtn = null;
      }
    };

    toggleBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      openModal();
    });

    this.teamSelect.onOpenKeybinds = () => {
      openModal();
    };

    closeBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      closeModal();
    });

    saveBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      closeModal();
    });

    resetBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.inputManager.resetToDefaultKeyBinds();
      renderKeybinds();
    });
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

  public broadcastSystemChat(text: string): void {
    this.chat.addSystemMessage(text);
    const payload = JSON.stringify({ type: 'chat', author: 'Sistema', text, team: 'sys' });

    if (this.mode === 'host') {
      this.broadcastReliable(payload);
    } else if (this.mode === 'client' && this.hostPeer) {
      this.hostPeer.sendReliable(payload);
    }
  }

  /**
   * Transmisión ininterrumpida de snapshots a 60 Hz para todos los peers conectados.
   */
  private broadcastSnapshot(): void {
    if (this.mode !== 'host' || !this.engine || this.peers.size === 0) return;
    const snapshot = this.engine.getSnapshot();
    const buffer = SnapshotPacket.encode(snapshot);
    for (const peer of this.peers.values()) {
      peer.sendUnreliable(buffer);
    }
  }

  /**
   * Resetea el estado de predicción cinemática local del cliente.
   */
  private resetClientPrediction(): void {
    this.hasPredictedPos = false;
    this.predictedPos.x = 0;
    this.predictedPos.y = 0;
    this.predictedVel.x = 0;
    this.predictedVel.y = 0;
  }

  /**
   * Predicción cinemática inmediata a 60 Hz para el jugador local en cliente (cero input lag).
   * p_local(t + dt) = p_local(t) + v_local * dt
   */
  private stepClientPrediction(mask: number): void {
    const isSimulationActive = this.currentMatchState === MatchPhase.PLAYING ||
                               this.currentMatchState === MatchPhase.GOAL_CELEBRATION;
    if (!isSimulationActive || !this.hasPredictedPos || this.localPlayer.team === 'spec') {
      return;
    }

    const accel = 7.5;
    let dirX = 0;
    let dirY = 0;
    if (mask & INPUT_UP) dirY -= 1;
    if (mask & INPUT_DOWN) dirY += 1;
    if (mask & INPUT_LEFT) dirX -= 1;
    if (mask & INPUT_RIGHT) dirX += 1;

    if (dirX !== 0 || dirY !== 0) {
      const len = Math.hypot(dirX, dirY);
      this.predictedVel.x += (dirX / len) * accel;
      this.predictedVel.y += (dirY / len) * accel;
    }

    // Integración cinemática inmediata (dt = 1/60)
    this.predictedPos.x += this.predictedVel.x * (1 / 60);
    this.predictedPos.y += this.predictedVel.y * (1 / 60);

    // Amortiguación de fricción del disco (damping = 0.96)
    this.predictedVel.x *= 0.96;
    this.predictedVel.y *= 0.96;

    // Confinamiento en los límites del estadio (740x400, radio del disco = 15)
    const minX = -370 + 15;
    const maxX = 370 - 15;
    const minY = -200 + 15;
    const maxY = 200 - 15;

    if (this.predictedPos.x < minX) {
      this.predictedPos.x = minX;
      if (this.predictedVel.x < 0) this.predictedVel.x = 0;
    } else if (this.predictedPos.x > maxX) {
      this.predictedPos.x = maxX;
      if (this.predictedVel.x > 0) this.predictedVel.x = 0;
    }

    if (this.predictedPos.y < minY) {
      this.predictedPos.y = minY;
      if (this.predictedVel.y < 0) this.predictedVel.y = 0;
    } else if (this.predictedPos.y > maxY) {
      this.predictedPos.y = maxY;
      if (this.predictedVel.y > 0) this.predictedVel.y = 0;
    }
  }

  /**
   * Reconciliación suave (soft-snap) del disco local con el snapshot autoritativo del Host.
   */
  private reconcileClientPrediction(snap: GameSnapshot): void {
    if (this.mode !== 'client' || this.localPlayer.team === 'spec') return;

    let authDisc: DiscSnapshot | undefined;
    if (this.localPlayer.discId !== null) {
      authDisc = snap.discs.find(d => d.id === this.localPlayer.discId);
    }
    if (!authDisc) {
      const teamNum = this.localPlayer.team === 'red' ? 1 : 2;
      const candidates = snap.discs.filter(d => d.team === teamNum && d.avatar === this.localPlayer.avatar);
      if (candidates.length === 1) {
        this.localPlayer.discId = candidates[0].id;
        authDisc = candidates[0];
      }
    }

    if (!authDisc) return;

    const isSimulationActive = snap.matchPhase === MatchPhase.PLAYING ||
                               snap.matchPhase === MatchPhase.GOAL_CELEBRATION;

    // Si aún no se ha inicializado o la física no está activa (PAUSED, STOPPED, COUNTDOWN):
    // Apagar la integración cinemática y sincronizar directamente la posición autoritativa
    if (!this.hasPredictedPos || !isSimulationActive) {
      this.predictedPos.x = authDisc.x;
      this.predictedPos.y = authDisc.y;
      this.predictedVel.x = authDisc.vx;
      this.predictedVel.y = authDisc.vy;
      this.hasPredictedPos = true;
      return;
    }

    // Reconciliación cinemática con umbral de tolerancia epsilon = 2.0 px
    const dx = authDisc.x - this.predictedPos.x;
    const dy = authDisc.y - this.predictedPos.y;
    const distSq = dx * dx + dy * dy;

    if (distSq > 40 * 40) {
      // Discrepancia mayor (teletransporte / saque inicial tras gol): hard snap
      this.predictedPos.x = authDisc.x;
      this.predictedPos.y = authDisc.y;
      this.predictedVel.x = authDisc.vx;
      this.predictedVel.y = authDisc.vy;
    } else if (distSq > 2.0 * 2.0) {
      // Soft snap: corrección suave e interpolada (factor 0.25)
      this.predictedPos.x += dx * 0.25;
      this.predictedPos.y += dy * 0.25;
      this.predictedVel.x = this.predictedVel.x * 0.75 + authDisc.vx * 0.25;
      this.predictedVel.y = this.predictedVel.y * 0.75 + authDisc.vy * 0.25;
    }
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

        // Si es Host, transmitir snapshot binario continuo ininterrumpidamente a 60 Hz
        this.broadcastSnapshot();
      }
    } else if (this.mode === 'client') {
      this.clientInputSequence++;
      const mask = this.inputManager.getMask();
      if (this.hostPeer) {
        const inputBuf = InputPacket.encode({
          sequence: this.clientInputSequence,
          inputMask: mask,
          clientTimestamp: Math.round(performance.now()) & 0xffff
        });
        this.hostPeer.sendUnreliable(inputBuf);
      }

      // Predicción cinemática local a 60 Hz para el disco asignado
      this.stepClientPrediction(mask);
    }
  }

  /**
   * Bucle de Render pasivo: se ejecuta a la tasa de refresco nativa mediante requestAnimationFrame.
   * Si la pestaña está oculta (document.hidden), omite el render pero NO afecta el tick de física.
   */
  private startRenderLoop(): void {
    if (this.renderLoopId !== null) return;

    const loop = (now: number) => {
      if (!this.isRunning) {
        this.renderLoopId = null;
        return;
      }

      if (this.uiStateMachine?.getState() !== 'STATE_IN_GAME') {
        this.renderLoopId = null;
        return;
      }

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
          localDiscId = this.localPlayer.discId;

          // Si el cliente tiene predicción activa, sobreescribir la cinemática del disco local
          if (activeSnapshot && this.hasPredictedPos && localDiscId !== null) {
            const myDisc = activeSnapshot.discs.find(d => d.id === localDiscId);
            if (myDisc) {
              const currentPhase = activeSnapshot.matchPhase !== undefined
                ? activeSnapshot.matchPhase
                : toMatchPhase(activeSnapshot.matchState);
              const isSimulationActive = currentPhase === MatchPhase.PLAYING ||
                                         currentPhase === MatchPhase.GOAL_CELEBRATION;

              if (isSimulationActive) {
                myDisc.x = this.predictedPos.x;
                myDisc.y = this.predictedPos.y;
                myDisc.vx = this.predictedVel.x;
                myDisc.vy = this.predictedVel.y;
                myDisc.kicking = (this.inputManager.getMask() & INPUT_KICK) !== 0;
              }
            }
          }
        }

        if (activeSnapshot) {
          this.canvasRenderer.render(activeSnapshot, localDiscId);
          this.hud.update(
            activeSnapshot.scoreRed ?? activeSnapshot.redScore,
            activeSnapshot.scoreBlue ?? activeSnapshot.blueScore,
            activeSnapshot.timerSeconds ?? activeSnapshot.matchTimerSeconds
          );

          // Sincronización reactiva autoritativa de fases en cliente
          if (this.mode === 'client') {
            const currentPhase = activeSnapshot.matchPhase !== undefined
              ? activeSnapshot.matchPhase
              : toMatchPhase(activeSnapshot.matchState);

            if (this.lastClientPhase !== currentPhase) {
              this.lastClientPhase = currentPhase;
              this.currentMatchState = currentPhase;
              this.jitterBuffer.setMatchState(currentPhase);

              if (currentPhase === MatchPhase.GOAL_CELEBRATION) {
                this.audioManager.playGoalWhistle();
              } else if (currentPhase === MatchPhase.COUNTDOWN) {
                this.audioManager.playCountdown(false);
              } else if (currentPhase === MatchPhase.PLAYING) {
                this.audioManager.playCountdown(true);
              } else if (currentPhase === MatchPhase.MATCH_ENDED) {
                this.audioManager.playGoalWhistle();
              }

              let outcomeText: string | undefined = undefined;
              if (currentPhase === MatchPhase.STOPPED) {
                const red = activeSnapshot.scoreRed ?? activeSnapshot.redScore;
                const blue = activeSnapshot.scoreBlue ?? activeSnapshot.blueScore;
                if (red > blue) {
                  outcomeText = '¡Victoria del Equipo Rojo!';
                } else if (blue > red) {
                  outcomeText = '¡Victoria del Equipo Azul!';
                } else {
                  outcomeText = '¡Empate!';
                }
              }
              this.enforceMenuState(currentPhase, outcomeText);
              this.updateAdminControlsUI();
            }
          }
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

      this.renderLoopId = requestAnimationFrame(loop);
    };

    this.renderLoopId = requestAnimationFrame(loop);
  }

  private stopRenderLoop(): void {
    if (this.renderLoopId !== null) {
      cancelAnimationFrame(this.renderLoopId);
      this.renderLoopId = null;
    }
  }
}
