import { GameEngine } from '../core/game/GameEngine';
import { Player, TeamType, INPUT_UP, INPUT_DOWN, INPUT_LEFT, INPUT_RIGHT, INPUT_KICK, INPUT_TURBO, INPUT_DASH, INPUT_TYPING } from '../core/game/Player';
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
import { StatsMonitor } from '../ui/components/StatsMonitor';
import { SignalingClient, SignalingMessage } from '../net/signaling/SignalingClient';
import { PeerConnection, setDynamicIceServers } from '../net/transport/PeerConnection';
import { InputPacket, InputData } from '../net/protocol/InputPacket';
import { SnapshotPacket } from '../net/protocol/SnapshotPacket';
import { SOUND_POST_HIT, SOUND_KICK } from '../net/protocol/BinaryProtocol';
import { JitterBuffer } from '../net/transport/JitterBuffer';
import { PhysicsTicker } from '../core/physics/PhysicsTicker';
import { RoomConfig } from '../server/signalingServer';
import { MatchStatePayload } from '../net/protocol/ControlMessages';
import { UIStateMachine, UIState } from '../ui/UIStateMachine';
import { GameplayConfig, DEFAULT_GAMEPLAY_CONFIG } from '../core/game/GameConfig';
import { GameplayModifierModal } from '../ui/components/GameplayModifierModal';
import { SettingsModal, KeybindModal } from '../ui/components/SettingsModal';
import { $matchPhase, $gameConfig } from '../ui/stores/gameStore';
import { resolveGoalAndPitchBoundaries, resolvePredictivePlayerCollision, resolvePredictiveBallCollision } from '../core/physics/Collision';
import { StadiumRegistry } from '../core/stadiums/StadiumRegistry';

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
  private unsubs: Array<() => void> = [];

  public get matchPhase(): MatchPhase {
    return toMatchPhase(this.getAuthoritativeMatchState());
  }

  public get isHost(): boolean {
    return this.mode === 'host' || Boolean(this.localPlayer?.isHost);
  }

  public closeAllPeers(): void {
    for (const peer of this.peers.values()) {
      peer.close();
    }
    this.peers.clear();

    if (this.hostPeer) {
      this.hostPeer.close();
      this.hostPeer = null;
    }
  }

  public get network(): { sendReliable: (msg: any) => void; closeAllPeers: () => void } {
    return {
      sendReliable: (msg: any) => {
        const str = typeof msg === 'string' ? msg : JSON.stringify(msg);
        if (this.hostPeer) {
          this.hostPeer.sendReliable(str);
        } else if (this.peers.size > 0) {
          for (const peer of this.peers.values()) {
            peer.sendReliable(str);
          }
        }
      },
      closeAllPeers: () => {
        this.closeAllPeers();
      }
    };
  }
  public localPlayer: Player;
  public engine: GameEngine | null = null;
  public canvasRenderer: CanvasRenderer;
  public inputManager: InputManager;
  public audioManager: AudioManager;
  public hud: ScoreboardHUD;
  public chat: ChatBox;
  public statsMonitor: StatsMonitor;
  public teamSelect: TeamSelectModal;
  public lobby: RoomLobby;
  public gatekeeper: NicknameGatekeeper;
  public uiStateMachine: UIStateMachine;

  // Networking
  public signaling: SignalingClient;
  public get signalingClient(): SignalingClient {
    return this.signaling;
  }
  public peers: Map<string, PeerConnection> = new Map();
  public hostPeer: PeerConnection | null = null;
  public jitterBuffer: JitterBuffer;
  public clientInputSequence: number = 0;
  public bannedPeers: Set<string> = new Set();
  public kickedPeers: Set<string> = new Set();
  public currentRoomId: string = '';
  public currentHostId: string | null = null;
  public targetRoomId: string | null = null;
  public extrapolationMs: number = 0;

  // Replay buffer para reconciliación determinista de predicción local en No-Host
  public clientInputBuffer: Array<{
    tick: number;
    mask: number;
    curve: { x: number; y: number };
    isTurbo: boolean;
    triggerDash: boolean;
  }> = [];
  public clientTick: number = 0;

  // Predicción cinemática del jugador local (cero lag de controles, sin alocaciones GC en bucle caliente)
  private predictedPos: { x: number; y: number } = { x: 0, y: 0 };
  private predictedVel: { x: number; y: number } = { x: 0, y: 0 };
  private visualOffset: { x: number; y: number } = { x: 0, y: 0 };
  private hasPredictedPos: boolean = false;
  private currentKickoffActive: boolean = false;
  private currentKickoffMode: 'NEUTRAL' | 'TEAM_KICKOFF' = 'NEUTRAL';
  private currentKickoffPossessingTeam: 'red' | 'blue' | null = null;
  private clientStamina: number = 100;
  private clientIsDashing: boolean = false;
  private clientDashTicks: number = 0;
  private clientDashDir: { x: number; y: number } = { x: 0, y: 0 };
  private clientIsTurbo: boolean = false;
  private lastKnownPlayerCount: number = 0;

  // Handshake timeout: cancel if data channel opens within 15s
  private joinTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private joinResolver: ((success: boolean) => void) | null = null;
  private static readonly JOIN_TIMEOUT_MS = 15000;

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

  public gameplayConfig: GameplayConfig = { ...DEFAULT_GAMEPLAY_CONFIG };
  public modifierModal: GameplayModifierModal;
  public keybindModal: KeybindModal;
  public settingsModal: SettingsModal;
  private clientPrevDashState: boolean = false;
  private btnOpenPhysicsModifiers: HTMLButtonElement | null = null;

  // UI elements
  // btnLeaveRoom removed from HUD header — only #btn-leave-room inside the menu exists
  private btnPauseResume: HTMLButtonElement | null;
  private btnLockTeams: HTMLButtonElement | null;
  private selectTimeLimit: HTMLSelectElement | HTMLInputElement | null;
  private selectScoreLimit: HTMLSelectElement | HTMLInputElement | null;
  private selectStadiumSize: HTMLSelectElement | null = null;
  private contextMenu: HTMLElement | null;
  private menuPlayerName: HTMLElement | null;
  private roomNameBadge: HTMLElement | null;
  private lastAnnouncedStadiumId: string | null = null;

  // Zero-GC preallocated static buffers for 60Hz replication
  private static readonly clientInputBuf: ArrayBuffer = new ArrayBuffer(InputPacket.BYTE_LENGTH);
  private static readonly clientInputData: InputData = {
    sequence: 0,
    inputMask: 0,
    clientTimestamp: 0
  };
  private hostSnapshotBuffer: ArrayBuffer | null = null;

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
    this.chat.audioManager = this.audioManager;
    this.statsMonitor = new StatsMonitor();
    this.teamSelect = new TeamSelectModal();
    this.jitterBuffer = new JitterBuffer(33, 30, true);

    this.modifierModal = new GameplayModifierModal(
      this.gameplayConfig,
      (newConfig) => this.onGameplayConfigChanged(newConfig),
      () => Boolean(this.mode === 'host' || this.localPlayer.isHost),
      () => false
    );
    this.settingsModal = new SettingsModal(this.inputManager, this.audioManager);
    this.keybindModal = this.settingsModal;

    // Physics Engine por defecto
    this.engine = new GameEngine({
      scoreLimit: this.roomConfig.scoreLimit,
      timeLimitSeconds: this.roomConfig.timeLimit * 60
    }, this.gameplayConfig);
    this.setupEngineCallbacks(this.engine);

    const savedExtrap = typeof localStorage !== 'undefined'
      ? (localStorage.getItem('haxball_extrapolation_ms') ?? localStorage.getItem('haxball_extrapolation'))
      : null;
    this.extrapolationMs = savedExtrap !== null ? Math.max(0, Math.min(250, parseInt(savedExtrap, 10) || 0)) : 0;

    this.canvasRenderer = new CanvasRenderer(canvas, this.engine.stadium);
    this.canvasRenderer.setExtrapolation(this.extrapolationMs);
    this.canvasRenderer.setGoalNets(this.engine.world.goalNets);
    this.settingsModal.setCanvasRenderer(this.canvasRenderer);

    this.chat.gameApp = this;
    this.chat.onExtrapolationChange = (ms) => {
      this.setExtrapolation(ms);
    };
    this.chat.getExtrapolationMs = () => this.extrapolationMs;

    // Sincronizar el área de seguridad de oclusión inferior del chat con la cámara
    this.chat.onHeightChange = (height) => {
      this.canvasRenderer?.setChatHeight(height);
      this.canvasRenderer?.setChatSafeArea(height + 32);
    };

    // Bloquear clicks accidentales en el canvas cuando la ventana de menú central esté desplegada
    const blockMenuClicks = (e: MouseEvent | PointerEvent) => {
      if (this.teamSelect.isOpen()) {
        e.stopPropagation();
        e.preventDefault();
      }
    };
    canvas.addEventListener('click', blockMenuClicks);
    canvas.addEventListener('pointerdown', blockMenuClicks);
    canvas.addEventListener('mousedown', blockMenuClicks);

    // Botón de opciones en el HUD superior
    const topSettingsBtn = document.getElementById('top-settings-btn');
    if (topSettingsBtn) {
      topSettingsBtn.addEventListener('click', () => {
        this.keybindModal.open();
      });
    }

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
    this.btnPauseResume = document.getElementById('btn-pause-resume') as HTMLButtonElement | null;
    this.btnLockTeams = document.getElementById('btn-lock-teams') as HTMLButtonElement | null;
    this.selectTimeLimit = (document.getElementById('select-time-limit') || document.getElementById('time-limit')) as HTMLSelectElement | HTMLInputElement | null;
    this.selectScoreLimit = (document.getElementById('select-goal-limit') || document.getElementById('score-limit')) as HTMLSelectElement | HTMLInputElement | null;
    this.selectStadiumSize = (document.getElementById('select-stadium-size') || document.querySelector('.select-stadium-size')) as HTMLSelectElement | null;
    this.btnOpenPhysicsModifiers = document.getElementById('btn-open-physics-modifiers') as HTMLButtonElement | null;
    if (this.btnOpenPhysicsModifiers) {
      this.btnOpenPhysicsModifiers.addEventListener('click', () => {
        this.modifierModal.show();
      });
    }
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
        this.leaveRoom();
        this.lobby.hideConnecting();
      }
    });
    if (savedNick) {
      this.lobby.setNickname(savedNick);
    }

    // Deep linking (?room=...)
    if (typeof window !== 'undefined' && window.location) {
      const urlParams = new URLSearchParams(window.location.search);
      const roomParam = urlParams.get('room');
      if (roomParam) {
        this.targetRoomId = roomParam.trim();
      }
    }

    if (savedNick) {
      this.gatekeeper.setInputValue(savedNick);
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

      if (this.targetRoomId) {
        const target = this.targetRoomId;
        this.targetRoomId = null;
        this.joinRoom(target).catch((err) => {
          console.error('[DeepLink] Failed to auto-join room:', err);
          this.lobby.showToast('No se pudo conectar a la sala indicada por el enlace.', 'error');
          this.uiStateMachine.transitionTo('STATE_LOBBY');
        });
      } else {
        this.uiStateMachine.transitionTo('STATE_LOBBY');
      }
    };

    // UI State Machine: Paso 1 obligatorio exclusivo Nickname
    const initialUIState: UIState = 'STATE_NICKNAME';
    this.uiStateMachine = new UIStateMachine(initialUIState, {
      onStateChange: (newState, prevState) => this.handleUIStateChange(newState, prevState)
    });

    this.teamSelect.uiStateMachine = this.uiStateMachine;
    this.teamSelect.gameApp = this;
    this.teamSelect.localPlayer = this.localPlayer;
    this.inputManager.chatInput = this.chat.inputEl;
    this.inputManager.gameApp = this;
    this.inputManager.uiStateMachine = this.uiStateMachine;
    this.hud.gameApp = this;
    this.hud.uiStateMachine = this.uiStateMachine;

    this.unsubs.push(
      $matchPhase.subscribe((phase) => {
        if (this.uiStateMachine?.getState() !== 'STATE_IN_GAME') return;
        if (phase === MatchPhase.COUNTDOWN || phase === MatchPhase.PLAYING) {
          this.uiStateMachine.closeModal('teamSelect');
        } else if (phase === MatchPhase.STOPPED) {
          this.uiStateMachine.openModal('teamSelect');
        }
      })
    );

    this.setupUIEvents();
    const toggleSettingsBtn = document.getElementById('btn-settings-toggle');
    toggleSettingsBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.keybindModal.open();
    });
    this.teamSelect.onOpenKeybinds = () => {
      this.keybindModal.open();
    };
    this.handleUIStateChange(initialUIState, initialUIState);
    this.setupSignaling();

    // Notificación inmediata de desconexión ante cierre de ventana / recarga de pestaña
    const notifyDisconnection = () => {
      if (this.network && this.currentRoomId) {
        this.network.sendReliable({ type: 'PEER_DISCONNECT', reason: 'PAGE_UNLOAD' });
        this.network.closeAllPeers();
      }
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', notifyDisconnection);
      window.addEventListener('pagehide', notifyDisconnection);
    }
  }

  public setExtrapolation(ms: number): void {
    this.extrapolationMs = Math.max(0, Math.min(250, ms));
    this.canvasRenderer?.setExtrapolation(this.extrapolationMs);
  }

  private handleUIStateChange(newState: UIState, _prevState: UIState): void {
    if (newState === 'STATE_IN_GAME') {
      this.inputManager.setEnabled(true);
      this.physicsTicker.start();
      const matchState = this.getAuthoritativeMatchState();
      this.enforceMenuState(matchState);
      this.canvasRenderer.resize();
      this.startRenderLoop();
      this.chat.printControlsGuide();
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

    // Match Iniciar / Detener unificado
    this.teamSelect.onMatchToggle = () => {
      this.handleMatchToggle();
    };

    // Cambio de tamaño de estadio (Host / Admin)
    this.teamSelect.onMapChange = (stadiumId) => {
      this.requestMapChange(stadiumId);
    };

    // Sincronización dinámica de altura de chat para evitar solapamiento con el menú central
    this.teamSelect.onVisibilityChange = (isOpen) => {
      this.chat.adjustForMenu(isOpen, this.teamSelect.getElement());
    };

    // Copia rápida de enlace de sala
    this.teamSelect.onCopyLink = () => {
      this.chat.addSystemMessage('Enlace de la sala copiado al portapapeles.');
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
    let lastMenuToggleTime = 0;
    const toggleMenu = () => {
      const now = performance.now();
      if (now - lastMenuToggleTime < 150) return; // Debounce contra doble disparo por click simultáneo
      lastMenuToggleTime = now;

      if (this.uiStateMachine.getState() !== 'STATE_IN_GAME') return;
      const currentPhase = this.matchPhase;
      // Excepción: Durante STOPPED (partido no iniciado), el menú permanece abierto para todos y Escape no lo cierra
      if (currentPhase === MatchPhase.STOPPED) {
        return;
      }
      this.uiStateMachine.toggleModal('teamSelect', this.isHost, currentPhase);
      this.updateAdminControlsUI();
      this.updateTeamLists();
    };

    this.hud.onMenuToggle = toggleMenu;
    const menuToggleBtn = document.getElementById('btn-menu') || document.getElementById('menu-toggle-btn');
    if (menuToggleBtn && !menuToggleBtn.dataset?.listenerBound) {
      if (menuToggleBtn.dataset) menuToggleBtn.dataset.listenerBound = 'true';
      menuToggleBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleMenu();
      });
    }

    window.addEventListener('keydown', (e) => {
      // Si no estamos en STATE_IN_GAME, no procesar atajos de partido
      if (this.uiStateMachine.getState() !== 'STATE_IN_GAME') {
        return;
      }

      // Escape y tecla de menú gestionados centralizadamente por InputManager.ts

      // Tecla Enter o NumpadEnter para enfocar el chat sin movimiento residual
      if (e.key === 'Enter' || e.code === 'Enter' || e.code === 'NumpadEnter' || this.inputManager.isActionKey('chat', e.code)) {
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
        case 'ice_config': {
          if (msg.iceServers && Array.isArray(msg.iceServers)) {
            setDynamicIceServers(msg.iceServers);
          }
          break;
        }

        case 'room_created': {
          this.currentRoomId = msg.roomId || '';
          this.teamSelect.setRoomId(this.currentRoomId);
          if (msg.config) {
            this.roomConfig = { ...this.roomConfig, ...msg.config };
          }
          if (this.roomNameBadge) {
            this.roomNameBadge.textContent = `${this.roomConfig.name} [${this.currentRoomId}]`;
          }
          this.chat.clear();
          this.chat.addMessage({ author: 'Lobby', text: `Sala "${this.roomConfig.name}" creada. ID: ${this.currentRoomId}`, team: 'sys' });
          this.applyRoomConfigToEngine();
          this.updateAdminPanelVisibility();
          this.lobby?.hideConnecting();
          this.uiStateMachine?.transitionTo('STATE_IN_GAME');
          break;
        }

        case 'room_joined':
        case 'join_accepted': {
          // Client received room_joined from signaling — but do NOT transition to game yet.
          // Wait for P2P connection + initial_state handshake from host.
          this.currentRoomId = msg.roomId || '';
          this.teamSelect.setRoomId(this.currentRoomId);
          this.localPlayer.id = this.signaling.peerId;
          if (msg.config) {
            this.roomConfig = { ...this.roomConfig, ...msg.config };
          }
          if (this.roomNameBadge) {
            this.roomNameBadge.textContent = `${this.roomConfig.name} [${this.currentRoomId}]`;
          }
          this.updateAdminPanelVisibility();
          // Step 2: WebRTC negotiation & ICE Traversal
          this.lobby?.setConnectingStep(2, 'Negociando enlace P2P (ICE Traversal)...');
          break;
        }

        case 'room_list': {
          if (msg.rooms) {
            this.lobby?.setRoomList(msg.rooms);
          }
          break;
        }

        case 'join_request': {
          if (this.mode === 'host' && msg.peerId) {
            if (this.bannedPeers.has(msg.peerId)) {
              console.log(`[Host] Rechazando join_request de peer baneado: ${msg.peerId}`);
              this.signaling.sendJoinRejected(msg.peerId, 'Has sido baneado de esta sala.', 'BANNED');
              return;
            }
            this.signaling.sendJoinAccepted(msg.peerId);
            this.handlePeerJoinedAsHost(msg.peerId, msg.nickname);
          }
          break;
        }

        case 'peer_joined': {
          if (this.mode === 'host' && msg.peerId) {
            if (this.bannedPeers.has(msg.peerId)) {
              console.log(`[Host] Rechazando conexión de peer baneado: ${msg.peerId}`);
              this.signaling.sendJoinRejected(msg.peerId, 'Has sido baneado de esta sala.', 'BANNED');
              return;
            }
            this.signaling.sendJoinAccepted(msg.peerId);
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
          this.clearJoinTimeout();
          if (this.hostPeer) {
            this.hostPeer.close();
            this.hostPeer = null;
          }
          this.currentRoomId = '';
          this.mode = 'practice';
          this.lobby?.hideConnecting();
          console.warn('[Signaling Error]', msg);
          let errorText = msg.message || 'Ocurrió un error al unirse a la sala.';
          if (msg.code === 'INVALID_PASSWORD') {
            errorText = 'Contraseña incorrecta para esta sala privada.';
          } else if (msg.code === 'ROOM_FULL') {
            errorText = 'La sala ha alcanzado su límite máximo de jugadores.';
          } else if (msg.code === 'ROOM_NOT_FOUND') {
            errorText = 'La sala no existe o el Host se ha desconectado.';
          }
          this.lobby?.showToast(errorText, 'error');
          this.uiStateMachine?.transitionTo('STATE_LOBBY');
          this.signaling.requestRoomList();
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

    this.engine = new GameEngine({ scoreLimit: 0, timeLimitSeconds: 0 }, this.gameplayConfig);
    if (this.roomConfig.stadiumId) {
      this.engine.setStadium(this.roomConfig.stadiumId);
    }
    this.canvasRenderer.setStadium(this.engine.stadium);
    this.canvasRenderer.setGoalNets(this.engine.world.goalNets);
    this.setupEngineCallbacks(this.engine);
    this.engine.addPlayer(this.localPlayer);
    this.engine.startMatch();

    if (this.roomNameBadge) this.roomNameBadge.textContent = 'Modo Práctica';
    // Leave button is inside ingame-menu only
    this.updateAdminPanelVisibility();

    this.uiStateMachine.transitionTo('STATE_IN_GAME');
    this.chat.clear();
    this.chat.addMessage({ author: 'Sistema', text: '¡Modo de práctica activo! Usa WASD/Flechas para moverte y Espacio/X para patear.', team: 'sys' });
    this.updateTeamLists();
  }

  public async createRoom(config?: LobbyRoomConfig): Promise<void> {
    await this.signalingClient.iceConfigReady;
    const roomConfig: LobbyRoomConfig = config || {
      name: this.roomConfig.name,
      maxPlayers: this.roomConfig.maxPlayers,
      isPrivate: this.roomConfig.isPrivate,
      password: this.roomConfig.password,
      timeLimit: this.roomConfig.timeLimit,
      scoreLimit: this.roomConfig.scoreLimit,
      teamsLocked: this.roomConfig.teamsLocked
    };
    const nick = this.localPlayer.name || NicknameGatekeeper.getSavedNickname() || 'Player';
    return this.startAsHost(nick, roomConfig);
  }

  public async startAsHost(nickname: string, config: LobbyRoomConfig): Promise<void> {
    await this.signalingClient.iceConfigReady;
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
    }, this.gameplayConfig);
    if (this.roomConfig.stadiumId) {
      this.engine.setStadium(this.roomConfig.stadiumId);
    }
    this.canvasRenderer.setStadium(this.engine.stadium);
    this.canvasRenderer.setGoalNets(this.engine.world.goalNets);
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

    await this.signalingClient.iceConfigReady;
    this.signaling.createRoom(this.roomConfig, undefined, this.localPlayer.name);
    this.updateTeamLists();
  }

  public async startAsClient(nickname: string, roomId: string, password?: string): Promise<boolean> {
    await this.signalingClient.iceConfigReady;
    this.mode = 'client';
    this.canvasRenderer.setGoalNets(null);
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

    this.lobby.showConnecting('Conectando (P2P / Relay)...');
    this.lobby.setConnectingStep(1, 'Conectando con servidor de señalización...');

    if (!this.signaling.isConnected) {
      try {
        await this.signaling.connect();
        this.lobby.setSignalingStatus('connected');
      } catch (err) {
        this.lobby.hideConnecting();
        console.error('[Signaling] Failed to connect:', err);
        this.lobby.showToast('No se pudo conectar al servidor de señalización.', 'error');
        return false;
      }
    }

    await this.signalingClient.iceConfigReady;
    this.lobby.setConnectingStep(1, 'Solicitando unirse a la sala...');

    // Iniciar temporizador de unión resiliente (15 segundos)
    this.clearJoinTimeout();
    return new Promise<boolean>((resolve) => {
      this.joinResolver = resolve;
      this.joinTimeoutId = setTimeout(() => {
        this.joinTimeoutId = null;
        console.warn('[Client] Join handshake timed out after 15 seconds');
        this.leaveRoom();
        this.lobby?.showToast('Tiempo de espera agotado al conectar con el anfitrión.', 'error', 7000);
        if (this.joinResolver) {
          const res = this.joinResolver;
          this.joinResolver = null;
          res(false);
        }
      }, GameApp.JOIN_TIMEOUT_MS);

      this.signaling.joinRoom(roomId, password, this.localPlayer.name);
    });
  }

  public leaveRoom(): void {
    this.leaveCurrentRoom();
  }

  private clearJoinTimeout(): void {
    if (this.joinTimeoutId !== null) {
      clearTimeout(this.joinTimeoutId);
      this.joinTimeoutId = null;
    }
  }

  public leaveCurrentRoom(): void {
    // Cancelar cualquier temporizador de unión pendiente y resolver con false si aplicaba
    this.clearJoinTimeout();
    if (this.joinResolver) {
      const res = this.joinResolver;
      this.joinResolver = null;
      res(false);
    }

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
    this.chat.clear();
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
      this.canvasRenderer.triggerPostHitShake();
    };

    engine.onMatchEnd = (winner) => {
      this.audioManager.playGoalWhistle();
      let outcomeText = winner ? `¡Victoria del Equipo ${winner === 'red' ? 'Rojo' : 'Azul'}!` : '¡Empate!';
      if (engine.isGoldenGoal && winner) {
        outcomeText = `¡Gol de Oro! Victoria del Equipo ${winner === 'red' ? 'Rojo' : 'Azul'}`;
      }
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
      } else if (state === MatchPhase.VICTORY_CELEBRATION || state === MatchPhase.MATCH_ENDED) {
        this.audioManager.playGoalWhistle();
      }
      this.broadcastMatchStateSync();
      this.broadcastSnapshot();
      this.updateAdminControlsUI();
    };
  }

  private async handlePeerJoinedAsHost(peerId: string, initialNick?: string): Promise<void> {
    if (this.peers.has(peerId)) {
      console.warn(`[Host] Peer ${peerId} ya posee una conexión activa. Ignorando.`);
      return;
    }
    await this.signalingClient.iceConfigReady;
    const peer = new PeerConnection(peerId, true, { signalingClient: this.signaling });
    this.peers.set(peerId, peer);

    peer.onIceCandidate = (candidate) => {
      this.signaling.sendIceCandidate(peerId, candidate);
    };

    peer.onIceRestartOffer = (offer) => {
      this.signaling.sendOffer(peerId, offer);
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
            if (input.curveInput !== undefined) p.curveInput = input.curveInput;
            if (input.curveX !== undefined) p.curveX = input.curveX;
            if (input.curveY !== undefined) p.curveY = input.curveY;
            if (input.isTurbo !== undefined) p.isTurbo = input.isTurbo;
            if (input.triggerDash) p.triggerDash = true;
            p.isTyping = Boolean(input.isTyping || (input.inputMask & INPUT_TYPING));
          }
        }
      } catch (err) {
        console.warn('[Host] Error al decodificar paquete de input:', err);
      }
    };

    peer.onReliableMessage = (data: string) => {
      try {
        const msg = JSON.parse(data);
        if (msg.type === 'PEER_DISCONNECT') {
          console.log(`[Host] Peer ${peerId} cerró sesión voluntariamente (${msg.reason || 'PAGE_UNLOAD'})`);
          this.handlePeerLeft(peerId);
        } else if (msg.type === 'client_ready' || msg.type === 'CLIENT_READY') {
          peer.isReady = true;
          console.log(`[Host] Peer ${peerId} está listo para simulación (CLIENT_READY recibido)`);
        } else if (msg.type === 'chat') {
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
            this.audioManager.playPlayerJoinedSound();

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
              matchState: matchStatePayload,
              gameplayConfig: this.gameplayConfig,
              stadiumId: this.engine?.stadium.id || this.roomConfig.stadiumId || 'classic'
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
        } else if (msg.type === 'ADMIN_START_MATCH' || (msg.type === 'MATCH_CONTROL_REQUEST' && msg.action === 'START') || (msg.type === 'match_control' && msg.action === 'START')) {
          const requester = this.engine?.players.get(peerId);
          const isAuthorized = Boolean(requester?.isAdmin || requester?.isHost || peerId === this.currentHostId);
          if (isAuthorized && this.engine) {
            this.engine.startMatch();
            this.enforceMenuState(this.engine.fsm.currentState);
            this.updateAdminControlsUI();
            this.broadcastMatchStateSync();
            this.broadcastSnapshot();
          }
        } else if (msg.type === 'ADMIN_STOP_MATCH' || (msg.type === 'MATCH_CONTROL_REQUEST' && msg.action === 'STOP') || (msg.type === 'match_control' && msg.action === 'STOP')) {
          const requester = this.engine?.players.get(peerId);
          const isAuthorized = Boolean(requester?.isAdmin || requester?.isHost || peerId === this.currentHostId);
          if (isAuthorized && this.engine) {
            this.engine.stopMatch();
            this.jitterBuffer.clear();
            this.resetClientPrediction();
            this.hud.update(0, 0, 0);
            this.enforceMenuState(MatchPhase.STOPPED);
            this.teamSelect.open(true);
            this.broadcastMatchStoppedEvent();
            this.updateAdminControlsUI();
            this.broadcastMatchStateSync();
            this.broadcastSnapshot();
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
        } else if (msg.type === 'MAP_CHANGE_REQUEST') {
          const requester = this.engine?.players.get(peerId);
          if (!requester?.isAdmin && peerId !== this.currentHostId) return;
          const currentPhase = this.matchPhase;
          if (currentPhase !== MatchPhase.STOPPED) return;
          this.setMapStadium(msg.stadiumId, true);
        }
      } catch (e) {}
    };

    const offer = await peer.createOffer();
    this.signaling.sendOffer(peerId, offer);
  }

  private async handleSignalOffer(senderId: string, offer: RTCSessionDescriptionInit): Promise<void> {
    if (this.hostPeer && this.hostPeer.remotePeerId === senderId && this.hostPeer.pc.signalingState !== 'closed') {
      const answer = await this.hostPeer.handleOffer(offer);
      this.signaling.sendAnswer(senderId, answer);
      return;
    }

    await this.signalingClient.iceConfigReady;
    const peer = new PeerConnection(senderId, false, { signalingClient: this.signaling });
    this.hostPeer = peer;

    peer.onIceCandidate = (candidate) => {
      this.signaling.sendIceCandidate(senderId, candidate);
    };

    peer.onDataChannelOpen = () => {
      // Limpiar temporizador de unión y resolver promesa satisfactoriamente
      this.clearJoinTimeout();
      if (this.joinResolver) {
        const res = this.joinResolver;
        this.joinResolver = null;
        res(true);
      }
      this.lobby?.setConnectingStep(3, 'Sincronizando estado de la sala...');
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
          if (snap.matchPhase !== undefined) {
            const prevPhase = this.currentMatchState;
            this.currentMatchState = snap.matchPhase;
            $matchPhase.set(snap.matchPhase);
            if (prevPhase !== snap.matchPhase) {
              const isLocalHost = Boolean(this.mode === 'host' || this.localPlayer.isHost);
              this.teamSelect.updateMatchState(snap.matchPhase, undefined, this.localPlayer.isAdmin, isLocalHost);
              this.updateAdminControlsUI();
            }
          }
          if (snap.matchPhase === MatchPhase.STOPPED) {
            this.resetClientPrediction();
          }
          if (snap.soundMask) {
            if (snap.soundMask & SOUND_POST_HIT) {
              this.audioManager.playPostHit();
              this.canvasRenderer.triggerPostHitShake();
            }
            if (snap.soundMask & SOUND_KICK) {
              this.audioManager.playKick();
            }
          }
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
        if (msg.type === 'PEER_DISCONNECT') {
          console.log(`[Client] Host cerró la sala (${msg.reason || 'PAGE_UNLOAD'})`);
          this.chat.addMessage({ author: 'Sistema', text: 'El Host ha cerrado la sala.', team: 'sys' });
          this.leaveCurrentRoom();
        } else if (msg.type === 'chat') {
          if (msg.team === 'sys') {
            this.chat.addSystemMessage(msg.text);
          } else {
            this.chat.addMessage({ author: msg.author, text: msg.text, team: msg.team });
          }
        } else if (msg.type === 'initial_state' || msg.type === 'INITIAL_STATE') {
          // INITIAL_STATE received — handshake complete!
          this.clearJoinTimeout();
          this.chat.clear();

          // Assign our authoritative player ID from the host
          this.localPlayer.id = msg.yourPlayerId;

          // Apply room config
          if (msg.config) {
            this.roomConfig = { ...this.roomConfig, ...msg.config };
          }
          if (msg.stadiumId || msg.config?.stadiumId) {
            this.setMapStadium(msg.stadiumId || msg.config.stadiumId, false);
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
          const isLocalHost = Boolean(this.mode === 'host' || this.localPlayer.isHost);
          this.teamSelect.updateLists(msg.players, this.localPlayer.isAdmin, this.currentHostId || undefined, isLocalHost);

          // Apply match state
          if (msg.matchState) {
            const ms: MatchStatePayload = msg.matchState;
            const phase = toMatchPhase(ms.state);
            this.currentMatchState = phase;
            $matchPhase.set(phase);
            this.jitterBuffer.setMatchState(phase);
            this.hud.update(ms.redScore, ms.blueScore, ms.timeRemaining);
            this.teamSelect.updateMatchState(phase, undefined, this.localPlayer.isAdmin, isLocalHost);
          }

          if (msg.gameplayConfig) {
            this.gameplayConfig = { ...this.gameplayConfig, ...msg.gameplayConfig };
            $gameConfig.set(this.gameplayConfig);
            this.modifierModal.setConfig(this.gameplayConfig);
            this.canvasRenderer?.handleResize();
          }

          this.updateAdminControlsUI();
          this.chat.addSystemMessage(`Conectado a la sala: ${this.roomConfig.name}`);
          this.audioManager.playPlayerJoinedSound();

          // Notificar al host que el cliente está listo para recibir snapshots y simular
          peer.isReady = true;
          peer.sendReliable(JSON.stringify({
            type: 'CLIENT_READY'
          }));

          // NOW transition to in-game — we have all the data we need
          this.lobby?.hideConnecting();
          this.uiStateMachine?.transitionTo('STATE_IN_GAME');

        } else if (msg.type === 'GAME_CONFIG_SYNC') {
          if (msg.config) {
            this.gameplayConfig = { ...this.gameplayConfig, ...msg.config };
            $gameConfig.set(this.gameplayConfig);
            this.modifierModal.setConfig(this.gameplayConfig);
            this.canvasRenderer?.handleResize();
          }
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
          if (msg.players && msg.players.length > this.lastKnownPlayerCount) {
            this.audioManager.playPlayerJoinedSound();
          }
          this.lastKnownPlayerCount = msg.players ? msg.players.length : 0;
          const isLocalHost = Boolean(this.mode === 'host' || this.localPlayer.isHost);
          this.teamSelect.updateLists(msg.players, this.localPlayer.isAdmin, this.currentHostId || undefined, isLocalHost);
          this.updateAdminControlsUI();
        } else if (msg.type === 'MATCH_STOPPED_EVENT') {
          this.currentMatchState = MatchPhase.STOPPED;
          this.lastClientPhase = MatchPhase.STOPPED;
          this.jitterBuffer.clear();
          this.jitterBuffer.setMatchState(MatchPhase.STOPPED);
          this.resetClientPrediction();
          this.hud.update(0, 0, 0);
          this.enforceMenuState(MatchPhase.STOPPED);
          this.teamSelect.open(true);
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
            this.jitterBuffer.clear();
            this.resetClientPrediction();
            this.hud.update(0, 0, 0);
            this.teamSelect.open(true);
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
        } else if (msg.type === 'MAP_CHANGE_SYNC') {
          if (msg.stadiumId) {
            this.setMapStadium(msg.stadiumId, false);
          }
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
        const isLocalHost = Boolean(this.mode === 'host' || this.localPlayer.isHost);
        this.teamSelect.updateLists(Array.from(this.engine.players.values()), this.localPlayer.isAdmin, hostId, isLocalHost);
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

  private onGameplayConfigChanged(newConfig: GameplayConfig): void {
    this.gameplayConfig = newConfig;
    $gameConfig.set(newConfig);
    this.canvasRenderer?.handleResize();
    if (this.engine) {
      this.engine.setGameplayConfig(newConfig);
    }
    if (this.mode === 'host') {
      this.broadcastReliable(JSON.stringify({
        type: 'GAME_CONFIG_SYNC',
        config: newConfig
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
    const isHost = this.mode === 'host' || Boolean(this.localPlayer.isHost);
    const currentPhase = this.matchPhase;
    const isMatchStopped = currentPhase === MatchPhase.STOPPED;
    const canChangeStadium = isAdmin && isMatchStopped;

    this.teamSelect.setHost(isHost);
    this.teamSelect.updateMatchControlButton(currentPhase, isAdmin, isHost);
    this.teamSelect.updateStadiumControls(currentPhase, isAdmin, isHost);

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
      this.selectTimeLimit.disabled = !canChangeStadium;
      this.selectTimeLimit.value = this.roomConfig.timeLimit.toString();
    }

    if (this.selectScoreLimit) {
      this.selectScoreLimit.disabled = !canChangeStadium;
      this.selectScoreLimit.value = this.roomConfig.scoreLimit.toString();
    }

    if (this.selectStadiumSize) {
      this.selectStadiumSize.disabled = !canChangeStadium;
      if (this.roomConfig.stadiumId) {
        this.selectStadiumSize.value = this.roomConfig.stadiumId;
      }
    }

    const btnPickStadium = document.getElementById('btn-pick-stadium') as HTMLButtonElement | null;
    if (btnPickStadium) {
      if (!isHost && !isAdmin) {
        btnPickStadium.style.display = 'none';
        btnPickStadium.disabled = true;
      } else {
        btnPickStadium.style.display = '';
        btnPickStadium.disabled = !canChangeStadium;
        if (!isMatchStopped) {
          btnPickStadium.title = 'No se puede cambiar de estadio durante el partido';
          btnPickStadium.classList.add('opacity-50', 'cursor-not-allowed');
        } else {
          btnPickStadium.title = isAdmin ? 'Elegir estadio' : 'Solo los administradores pueden cambiar el estadio';
          btnPickStadium.classList.remove('opacity-50', 'cursor-not-allowed');
        }
      }
    }

    if (this.btnOpenPhysicsModifiers) {
      if (isHost) {
        this.btnOpenPhysicsModifiers.style.display = 'inline-flex';
        this.btnOpenPhysicsModifiers.disabled = !isMatchStopped;
        if (!isMatchStopped) {
          this.btnOpenPhysicsModifiers.title = 'Los modificadores de físicas solo se pueden ajustar antes de empezar la partida';
          this.btnOpenPhysicsModifiers.classList.add('opacity-50', 'cursor-not-allowed');
        } else {
          this.btnOpenPhysicsModifiers.title = 'Modificadores de Físicas';
          this.btnOpenPhysicsModifiers.classList.remove('opacity-50', 'cursor-not-allowed');
        }
      } else {
        this.btnOpenPhysicsModifiers.style.display = 'none';
        this.btnOpenPhysicsModifiers.disabled = true;
      }
    }

    this.modifierModal.updateMatchState(!isMatchStopped);
  }

  public requestMapChange(stadiumId: string): void {
    const isAdmin = Boolean(this.localPlayer.isAdmin || this.localPlayer.isHost);
    if (!isAdmin) return;

    const currentPhase = this.matchPhase;
    if (currentPhase !== MatchPhase.STOPPED) {
      this.chat.addSystemMessage('⚠️ El estadio solo se puede cambiar antes de empezar una partida.');
      return;
    }

    if (this.mode === 'host' || this.mode === 'practice') {
      this.setMapStadium(stadiumId, true);
    } else if (this.mode === 'client' && this.hostPeer) {
      this.hostPeer.sendReliable(JSON.stringify({
        type: 'MAP_CHANGE_REQUEST',
        stadiumId
      }));
    }
  }

  public setMapStadium(stadiumId: string, broadcast: boolean = false, force: boolean = false): void {
    if (!StadiumRegistry[stadiumId]) return;
    const currentPhase = this.matchPhase;
    if (broadcast && !force && currentPhase !== MatchPhase.STOPPED) {
      return;
    }
    this.roomConfig.stadiumId = stadiumId;
    if (this.engine) {
      this.engine.setStadium(stadiumId);
    }
    if (this.canvasRenderer && this.engine) {
      this.canvasRenderer.setStadium(this.engine.stadium);
      this.canvasRenderer.setGoalNets(this.mode === 'client' ? null : this.engine.world.goalNets);
    }
    this.teamSelect.setStadium(stadiumId);
    if (this.selectStadiumSize) {
      this.selectStadiumSize.value = stadiumId;
    }

    if (broadcast && (this.mode === 'host' || this.mode === 'practice')) {
      this.broadcastReliable(JSON.stringify({
        type: 'MAP_CHANGE_SYNC',
        stadiumId
      }));
      // Deduplicación estricta: emitir el mensaje en el chat una sola vez cuando se confirma el cambio
      if (this.lastAnnouncedStadiumId !== stadiumId) {
        this.lastAnnouncedStadiumId = stadiumId;
        const stadiumName = StadiumRegistry[stadiumId]?.name || stadiumId;
        this.broadcastSystemChat(`🏟 Estadio cambiado a: ${stadiumName}`);
      }
    }
  }

  public broadcastMatchStateSync(): void {
    if (this.mode !== 'host' && this.mode !== 'practice') return;
    const currentState = this.matchPhase;
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

  private isTogglingMatch: boolean = false;

  public handleMatchToggle(): void {
    if (this.isTogglingMatch) return;
    this.isTogglingMatch = true;
    setTimeout(() => {
      this.isTogglingMatch = false;
    }, 300);

    const isAuthorized = Boolean(this.localPlayer.isAdmin || this.localPlayer.isHost || this.mode === 'host');
    if (!isAuthorized) return;
    const currentPhase = this.matchPhase;
    const action = currentPhase === MatchPhase.STOPPED ? 'START' : 'STOP';

    if (action === 'STOP') {
      this.requestStopMatch();
      return;
    }

    if (this.modifierModal?.isOpen()) {
      this.modifierModal.hide();
    }

    if (this.mode === 'client' && this.hostPeer) {
      this.hostPeer.sendReliable(JSON.stringify({
        type: 'ADMIN_START_MATCH'
      }));
      // Feedback visual optimista instantáneo para admin no-host
      this.currentMatchState = MatchPhase.COUNTDOWN;
      $matchPhase.set(MatchPhase.COUNTDOWN);
      this.teamSelect.updateMatchState(MatchPhase.COUNTDOWN, undefined, Boolean(this.localPlayer.isAdmin || this.localPlayer.isHost), this.isHost);
      this.updateAdminControlsUI();
    } else if (this.engine) {
      this.engine.startMatch();
      this.enforceMenuState(this.engine.fsm.currentState);
      this.updateAdminControlsUI();
      this.broadcastMatchStateSync();
      this.broadcastSnapshot();
    }
  }

  public requestStopMatch(): void {
    const isAuthorized = Boolean(this.localPlayer.isAdmin || this.localPlayer.isHost || this.mode === 'host');
    if (!isAuthorized) return;

    if (this.mode === 'client' && this.hostPeer) {
      this.hostPeer.sendReliable(JSON.stringify({
        type: 'ADMIN_STOP_MATCH'
      }));
      // Feedback visual optimista instantáneo para admin no-host
      this.currentMatchState = MatchPhase.STOPPED;
      $matchPhase.set(MatchPhase.STOPPED);
      this.teamSelect.updateMatchState(MatchPhase.STOPPED, undefined, Boolean(this.localPlayer.isAdmin || this.localPlayer.isHost), this.isHost);
      this.updateAdminControlsUI();
    } else if (this.mode === 'host' || this.mode === 'practice') {
      if (this.engine) {
        this.engine.stopMatch();
        this.jitterBuffer.clear();
        this.resetClientPrediction();
        this.hud.update(0, 0, 0);
        this.enforceMenuState(MatchPhase.STOPPED);
        this.teamSelect.open(true);
        this.broadcastMatchStoppedEvent();
        this.broadcastMatchStateSync();
        this.broadcastSnapshot();
        this.updateAdminControlsUI();
      }
    }
  }

  public async joinRoom(roomId: string, password?: string): Promise<boolean> {
    await this.signalingClient.iceConfigReady;
    const nick = this.localPlayer.name || NicknameGatekeeper.getSavedNickname() || 'Player';
    return this.startAsClient(nick, roomId, password);
  }

  public broadcastMatchStoppedEvent(): void {
    if (this.mode === 'host') {
      this.broadcastReliable(JSON.stringify({
        type: 'MATCH_STOPPED_EVENT'
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
    $matchPhase.set(phase);
    if (this.uiStateMachine.getState() !== 'STATE_IN_GAME') {
      this.teamSelect.close(true);
      return;
    }
    const isHost = this.mode === 'host' || Boolean(this.localPlayer.isHost);
    this.teamSelect.setHost(isHost);
    const isAdmin = Boolean(this.localPlayer.isAdmin || this.localPlayer.isHost);
    this.teamSelect.updateMatchState(phase, outcomeText, isAdmin, isHost);
    this.updateAdminControlsUI();
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
   * Transmisión adaptativa de snapshots para todos los peers conectados:
   * - <= 3 jugadores: 60 Hz (cada 16.6 ms)
   * - >= 4 jugadores: 30 Hz (cada 33.3 ms) para optimizar CPU y ancho de banda TURN
   */
  private broadcastSnapshot(force: boolean = false): void {
    if (this.mode !== 'host' || !this.engine || this.peers.size === 0) return;
    if (!force && !this.engine.shouldBroadcastSnapshot(this.engine.tickCount)) return;
    const snapshot = this.engine.getSnapshot();
    const totalLength = SnapshotPacket.HEADER_LENGTH + snapshot.discs.length * SnapshotPacket.DISC_LENGTH;
    if (!this.hostSnapshotBuffer || this.hostSnapshotBuffer.byteLength !== totalLength) {
      this.hostSnapshotBuffer = new ArrayBuffer(totalLength);
    }
    const buffer = SnapshotPacket.encode(snapshot, this.hostSnapshotBuffer);
    for (const peer of this.peers.values()) {
      if (peer.isReady) {
        peer.sendUnreliable(buffer);
      }
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
    this.visualOffset.x = 0;
    this.visualOffset.y = 0;
    this.clientTick = 0;
    this.clientInputBuffer.length = 0;
  }

  /**
   * Predicción cinemática inmediata a 60 Hz para el jugador local en cliente (cero input lag).
   * p_local(t + dt) = p_local(t) + v_local * dt
   */
  private stepClientPrediction(mask: number, _curve?: { x: number; y: number }, isTurbo?: boolean, triggerDash?: boolean, _isReplay: boolean = false): void {
    const isSimulationActive = this.currentMatchState === MatchPhase.PLAYING ||
                               this.currentMatchState === MatchPhase.GOAL_CELEBRATION ||
                               this.currentMatchState === MatchPhase.VICTORY_CELEBRATION;
    if (!isSimulationActive || !this.hasPredictedPos || this.localPlayer.team === 'spec') {
      return;
    }

    const dt = 1 / 60;
    const accel = (this.gameplayConfig.playerAcceleration ?? 0.11) * 60;
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

    const vSpeed = Math.hypot(this.predictedVel.x, this.predictedVel.y);

    // Predicción de Dash en No-Host por flanco ascendente
    const isDashKeyDown = (mask & INPUT_DASH) !== 0;
    const wantsDash = Boolean(triggerDash) || (isDashKeyDown && !this.clientPrevDashState);

    if (wantsDash && !this.clientPrevDashState && this.clientStamina >= 50 && !this.clientIsDashing) {
      this.clientStamina = Math.max(0, this.clientStamina - 50);
      this.clientIsDashing = true;
      this.clientDashTicks = 4;
      if (vSpeed > 0.05) {
        this.clientDashDir.x = this.predictedVel.x / vSpeed;
        this.clientDashDir.y = this.predictedVel.y / vSpeed;
      } else if (hasMoveInput) {
        this.clientDashDir.x = uMoveX;
        this.clientDashDir.y = uMoveY;
      } else {
        this.clientDashDir.x = this.localPlayer.team === 'red' ? 1 : -1;
        this.clientDashDir.y = 0;
      }
    }
    this.clientPrevDashState = isDashKeyDown;

    if (this.clientIsDashing) {
      this.clientDashTicks--;
      const dashSpeed = (this.gameplayConfig.dashDistance / 4) * 60;
      this.predictedVel.x = this.clientDashDir.x * dashSpeed;
      this.predictedVel.y = this.clientDashDir.y * dashSpeed;
      if (this.clientDashTicks <= 0) {
        this.clientIsDashing = false;
      }
    } else {
      // Predicción de Turbo en No-Host: aceleración escalada y velocidad terminal
      const wantsTurbo = Boolean(isTurbo) || ((mask & INPUT_TURBO) !== 0);
      const baseSpeed = (this.gameplayConfig.playerMaxSpeed / 2.8) * 168.0;
      const kSpeedTurbo = this.gameplayConfig.boostMultiplier ?? 2.0;
      const maxTurboSpeed = baseSpeed * kSpeedTurbo;
      const kAccelTurbo = Math.max(2.8, kSpeedTurbo * 1.5);
      const turboAccel = accel * kAccelTurbo;

      if (wantsTurbo && hasMoveInput && this.clientStamina > 0) {
        this.clientIsTurbo = true;
        this.clientStamina = Math.max(0, this.clientStamina - 40 * dt);
        if (this.clientStamina <= 0) {
          this.clientIsTurbo = false;
        }

        this.predictedVel.x += uMoveX * turboAccel;
        this.predictedVel.y += uMoveY * turboAccel;

        const curSpeed = Math.hypot(this.predictedVel.x, this.predictedVel.y);
        if (curSpeed > maxTurboSpeed) {
          this.predictedVel.x = (this.predictedVel.x / curSpeed) * maxTurboSpeed;
          this.predictedVel.y = (this.predictedVel.y / curSpeed) * maxTurboSpeed;
        }
      } else {
        this.clientIsTurbo = false;
        if (hasMoveInput) {
          const curSpeed = Math.hypot(this.predictedVel.x, this.predictedVel.y);
          if (curSpeed < baseSpeed) {
            this.predictedVel.x += uMoveX * accel;
            this.predictedVel.y += uMoveY * accel;
            const postSpeed = Math.hypot(this.predictedVel.x, this.predictedVel.y);
            if (postSpeed > baseSpeed) {
              this.predictedVel.x = (this.predictedVel.x / postSpeed) * baseSpeed;
              this.predictedVel.y = (this.predictedVel.y / postSpeed) * baseSpeed;
            }
          }
        }
      }
    }

    // Regla de recarga dinámica: activa ssi no hay teclas de movimiento presionadas ni está en dash
    if (!hasMoveInput && !this.clientIsDashing) {
      const rechargeRate = this.gameplayConfig.staminaRechargeRate ?? 25;
      this.clientStamina = Math.min(100, this.clientStamina + rechargeRate * dt);
    }

    this.localPlayer.stamina = this.clientStamina;
    this.localPlayer.isDashing = this.clientIsDashing;
    this.localPlayer.isTurbo = this.clientIsTurbo;

    // Integración cinemática inmediata (dt = 1/60)
    this.predictedPos.x += this.predictedVel.x * (1 / 60);
    this.predictedPos.y += this.predictedVel.y * (1 / 60);

    // Amortiguación de fricción del disco (damping = 0.96)
    this.predictedVel.x *= 0.96;
    this.predictedVel.y *= 0.96;

    // 1. Geometría analítica real del estadio: libre circulación en porterías (X in [-635, 635], y = ±85)
    const stadium = this.canvasRenderer?.stadium || this.engine?.stadium;
    resolveGoalAndPitchBoundaries(
      this.predictedPos,
      this.predictedVel,
      15,
      {
        halfWidth: stadium ? stadium.halfWidth : 600,
        halfHeight: stadium ? stadium.halfHeight : 270,
        goalHalfHeight: stadium ? stadium.goalHalfHeight : 85,
        goalDepth: stadium ? stadium.goalDepth : 35,
        runOff: stadium ? stadium.runOff : 45
      }
    );

    // 2. Barreras de saque reglamentario en predicción local
    if (this.currentKickoffActive) {
      const r = 15;
      if (this.localPlayer.team === 'red') {
        if (this.predictedPos.x > -r) {
          this.predictedPos.x = -r;
          if (this.predictedVel.x > 0) this.predictedVel.x = 0;
        }
      } else if (this.localPlayer.team === 'blue') {
        if (this.predictedPos.x < r) {
          this.predictedPos.x = r;
          if (this.predictedVel.x < 0) this.predictedVel.x = 0;
        }
      }

      if (this.currentKickoffMode === 'TEAM_KICKOFF' && this.localPlayer.team !== this.currentKickoffPossessingTeam) {
        const limitR = 80 + r;
        const px = this.predictedPos.x;
        const py = this.predictedPos.y;
        const distSq = px * px + py * py;
        if (distSq < limitR * limitR) {
          const dist = Math.sqrt(distSq);
          if (dist > 1e-6) {
            const nx = px / dist;
            const ny = py / dist;
            this.predictedPos.x = nx * limitR;
            this.predictedPos.y = ny * limitR;
            const vDotN = this.predictedVel.x * nx + this.predictedVel.y * ny;
            if (vDotN < 0) {
              this.predictedVel.x -= vDotN * nx;
              this.predictedVel.y -= vDotN * ny;
            }
          }
        }
      }
    }

    // 3. Colisión Predictiva Círculo-Círculo (Anti-Clipping en No-Host)
    // Itera sobre todos los demás jugadores activos en el snapshot interpolado actual
    const currentSnap = this.jitterBuffer.getInterpolatedSnapshot(performance.now()) ||
      (this.jitterBuffer.buffer.length > 0 ? this.jitterBuffer.buffer[this.jitterBuffer.buffer.length - 1].snapshot : null);
    if (currentSnap && currentSnap.discs) {
      for (let i = 0; i < currentSnap.discs.length; i++) {
        const other = currentSnap.discs[i];
        if (other.id === this.localPlayer.discId) continue;
        if (other.team === 0) continue; // Solo contra otros jugadores

        resolvePredictivePlayerCollision(
          this.predictedPos,
          this.predictedVel,
          15,
          { x: other.x, y: other.y },
          { x: other.vx, y: other.vy },
          other.radius || 15
        );
      }

      // 4. Colisión Predictiva Jugador-Balón (Anti-Clipping en No-Host, cero GC)
      for (let i = 0; i < currentSnap.discs.length; i++) {
        const disc = currentSnap.discs[i];
        if (disc.team === 0) {
          resolvePredictiveBallCollision(
            this.predictedPos,
            this.predictedVel,
            15,
            disc,
            disc.radius || 10
          );
          break;
        }
      }
    }
  }

  /**
   * Reconciliación suave con replay buffer del disco local contra el snapshot autoritativo del Host.
   */
  private reconcileClientPrediction(snap: GameSnapshot): void {
    if (snap.matchPhase !== undefined) {
      if (this.currentMatchState !== snap.matchPhase) {
        this.currentMatchState = snap.matchPhase;
        const isLocalHost = Boolean(this.mode === 'host' || this.localPlayer.isHost);
        this.teamSelect.updateMatchState(snap.matchPhase, undefined, this.localPlayer.isAdmin, isLocalHost);
        this.updateAdminControlsUI();
      }
    }
    if (snap.kickoffActive !== undefined) {
      this.currentKickoffActive = snap.kickoffActive;
    }
    if (snap.kickoffMode !== undefined) {
      this.currentKickoffMode = snap.kickoffMode;
    }
    if (snap.possessingTeam !== undefined) {
      this.currentKickoffPossessingTeam = snap.possessingTeam;
    }

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
                               snap.matchPhase === MatchPhase.GOAL_CELEBRATION ||
                               snap.matchPhase === MatchPhase.VICTORY_CELEBRATION;

    // Si aún no se ha inicializado o la física no está activa (PAUSED, STOPPED, COUNTDOWN):
    // Apagar la integración cinemática y sincronizar directamente la posición autoritativa
    if (!this.hasPredictedPos || !isSimulationActive) {
      this.predictedPos.x = authDisc.x;
      this.predictedPos.y = authDisc.y;
      this.predictedVel.x = authDisc.vx;
      this.predictedVel.y = authDisc.vy;
      this.visualOffset.x = 0;
      this.visualOffset.y = 0;
      this.hasPredictedPos = true;
      this.clientTick = snap.tick;
      this.clientInputBuffer.length = 0;
      if (authDisc.stamina !== undefined) {
        this.clientStamina = authDisc.stamina;
        this.localPlayer.stamina = authDisc.stamina;
      }
      if (authDisc.isDashing !== undefined) {
        this.clientIsDashing = authDisc.isDashing;
        this.localPlayer.isDashing = authDisc.isDashing;
      }
      if (authDisc.isTurbo !== undefined) {
        this.clientIsTurbo = authDisc.isTurbo;
        this.localPlayer.isTurbo = authDisc.isTurbo;
      }
      return;
    }

    // 1. Descartar del búfer todos los inputs con tick <= snap.tick
    while (this.clientInputBuffer.length > 0 && this.clientInputBuffer[0].tick <= snap.tick) {
      this.clientInputBuffer.shift();
    }

    const ERROR_THRESHOLD_SQ = 0.25; // 0.5px al cuadrado
    const MAX_REPLAY_TICKS = 5;      // Jamás re-simular más de 5 ticks por frame
    const CATASTROPHIC_ERROR_SQ = 2500; // 50px al cuadrado

    const dx = this.predictedPos.x - authDisc.x;
    const dy = this.predictedPos.y - authDisc.y;
    const distSq = dx * dx + dy * dy;

    // A. Banda muerta de tolerancia (<= 0.5px): No hacer replay; conservar la posición predicha actual
    if (distSq <= ERROR_THRESHOLD_SQ) {
      if (authDisc.stamina !== undefined) {
        this.clientStamina = authDisc.stamina;
        this.localPlayer.stamina = authDisc.stamina;
      }
      if (authDisc.isDashing !== undefined) {
        this.clientIsDashing = authDisc.isDashing;
        this.localPlayer.isDashing = authDisc.isDashing;
      }
      if (authDisc.isTurbo !== undefined) {
        this.clientIsTurbo = authDisc.isTurbo;
        this.localPlayer.isTurbo = authDisc.isTurbo;
      }
      return;
    }

    // B. Error catastrófico (> 50px): Snap directo (teletransporte suave), vaciar entradas y omitir replay
    if (distSq > CATASTROPHIC_ERROR_SQ) {
      this.predictedPos.x = authDisc.x;
      this.predictedPos.y = authDisc.y;
      this.predictedVel.x = authDisc.vx;
      this.predictedVel.y = authDisc.vy;
      this.visualOffset.x = 0;
      this.visualOffset.y = 0;
      this.clientInputBuffer.length = 0;
      if (authDisc.stamina !== undefined) {
        this.clientStamina = authDisc.stamina;
        this.localPlayer.stamina = authDisc.stamina;
      }
      if (authDisc.isDashing !== undefined) {
        this.clientIsDashing = authDisc.isDashing;
        this.localPlayer.isDashing = authDisc.isDashing;
      }
      if (authDisc.isTurbo !== undefined) {
        this.clientIsTurbo = authDisc.isTurbo;
        this.localPlayer.isTurbo = authDisc.isTurbo;
      }
      return;
    }

    // C. Discrepancia intermedia: Guardar posición previa para calcular la discrepancia post-replay
    const prevPredictedX = this.predictedPos.x;
    const prevPredictedY = this.predictedPos.y;

    // 2. Asignar la posición y velocidad autoritativa del Host correspondientes al tick T_snap
    this.predictedPos.x = authDisc.x;
    this.predictedPos.y = authDisc.y;
    this.predictedVel.x = authDisc.vx;
    this.predictedVel.y = authDisc.vy;

    if (authDisc.stamina !== undefined) {
      this.clientStamina = authDisc.stamina;
      this.localPlayer.stamina = authDisc.stamina;
    }
    if (authDisc.isDashing !== undefined) {
      this.clientIsDashing = authDisc.isDashing;
      this.localPlayer.isDashing = authDisc.isDashing;
    }
    if (authDisc.isTurbo !== undefined) {
      this.clientIsTurbo = authDisc.isTurbo;
      this.localPlayer.isTurbo = authDisc.isTurbo;
    }

    // Acotar los inputs a los últimos MAX_REPLAY_TICKS para prevenir espiral de muerte
    if (this.clientInputBuffer.length > MAX_REPLAY_TICKS) {
      this.clientInputBuffer = this.clientInputBuffer.slice(-MAX_REPLAY_TICKS);
    }

    // 3. Re-simular localmente los inputs pendientes desde T_snap + 1 hasta T_current
    for (let i = 0; i < this.clientInputBuffer.length; i++) {
      const item = this.clientInputBuffer[i];
      this.stepClientPrediction(item.mask, item.curve, item.isTurbo, item.triggerDash, true);
    }

    // 4. Calcular el error residual post-replay: Delta_error = p_simulada - p_render
    const errX = prevPredictedX - this.predictedPos.x;
    const errY = prevPredictedY - this.predictedPos.y;
    const postDistSq = errX * errX + errY * errY;

    if (postDistSq > CATASTROPHIC_ERROR_SQ) {
      // Discrepancia post-replay masiva (ej. spawn, gol, reseteo): Hard-Snap inmediato
      this.visualOffset.x = 0;
      this.visualOffset.y = 0;
    } else if (postDistSq > ERROR_THRESHOLD_SQ) {
      // Absorber Delta_error en visualOffset y atenuarlo suavemente en el loop de render (visualOffset *= 0.82)
      this.visualOffset.x += errX;
      this.visualOffset.y += errY;
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
        let mask = this.inputManager.getMask();
        if (this.chat?.isTyping) {
          mask |= INPUT_TYPING;
        }
        inputs.set(this.localPlayer.id, mask);

        const curve = this.inputManager.getCurveVector();
        const curveInput = this.inputManager.getCurveInput();
        this.localPlayer.curveInput = curveInput;
        this.localPlayer.curveX = curve.x;
        this.localPlayer.curveY = curve.y;
        this.localPlayer.isTurbo = this.inputManager.isTurboActive();
        this.localPlayer.isTyping = this.chat?.isTyping ?? false;
        if (this.inputManager.consumeDashTrigger()) {
          this.localPlayer.triggerDash = true;
        }

        this.engine.tick(inputs);

        // Si es Host, transmitir snapshot binario continuo ininterrumpidamente a 60 Hz
        this.broadcastSnapshot();
      }
    } else if (this.mode === 'client') {
      this.clientTick++;
      this.clientInputSequence = this.clientTick;
      let mask = this.inputManager.getMask();
      if (this.chat?.isTyping) {
        mask |= INPUT_TYPING;
      }
      const curve = this.inputManager.getCurveVector();
      const curveInput = this.inputManager.getCurveInput();
      const isTurbo = this.inputManager.isTurboActive();
      const triggerDash = this.inputManager.consumeDashTrigger();

      this.clientInputBuffer.push({
        tick: this.clientTick,
        mask,
        curve: { x: curve.x, y: curve.y },
        isTurbo,
        triggerDash
      });
      if (this.clientInputBuffer.length > 180) {
        this.clientInputBuffer.shift();
      }

      if (this.hostPeer && this.hostPeer.isReady) {
        GameApp.clientInputData.sequence = this.clientInputSequence;
        GameApp.clientInputData.inputMask = mask;
        GameApp.clientInputData.clientTimestamp = Math.round(performance.now()) & 0xffff;
        GameApp.clientInputData.curveInput = curveInput;
        GameApp.clientInputData.curveX = curve.x;
        GameApp.clientInputData.curveY = curve.y;
        GameApp.clientInputData.isTurbo = isTurbo;
        GameApp.clientInputData.triggerDash = triggerDash;
        GameApp.clientInputData.isTyping = this.chat?.isTyping ?? false;

        const inputBuf = InputPacket.encode(GameApp.clientInputData, GameApp.clientInputBuf);
        this.hostPeer.sendUnreliable(inputBuf);
      }

      // Predicción cinemática local a 60 Hz para el disco asignado
      this.stepClientPrediction(mask, curve, isTurbo, triggerDash);
    }
  }

  /**
   * Bucle de Render pasivo: se ejecuta a la tasa de refresco nativa mediante requestAnimationFrame.
   * Si la pestaña está oculta (document.hidden), omite el render pero NO afecta el tick de física.
   */
  private startRenderLoop(): void {
    if (this.renderLoopId !== null) return;
    let lastFrameTime = performance.now();
    let lastPingCheck = 0;

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
                                         currentPhase === MatchPhase.GOAL_CELEBRATION ||
                                         currentPhase === MatchPhase.VICTORY_CELEBRATION;

              if (isSimulationActive) {
                // Decaimiento exponencial del offset visual hacia cero (60 Hz)
                this.visualOffset.x *= 0.82;
                this.visualOffset.y *= 0.82;
                if (Math.abs(this.visualOffset.x) < 0.05) this.visualOffset.x = 0;
                if (Math.abs(this.visualOffset.y) < 0.05) this.visualOffset.y = 0;

                // Renderiza el disco del jugador en p_render = p_predicted + visualOffset
                myDisc.x = this.predictedPos.x + this.visualOffset.x;
                myDisc.y = this.predictedPos.y + this.visualOffset.y;
                myDisc.vx = this.predictedVel.x;
                myDisc.vy = this.predictedVel.y;
                myDisc.kicking = (this.inputManager.getMask() & INPUT_KICK) !== 0;
                myDisc.stamina = this.clientStamina;
                myDisc.isDashing = this.clientIsDashing;
                myDisc.isTurbo = this.clientIsTurbo;
              }
            }
          }
        }

        if (activeSnapshot) {
          this.canvasRenderer.render(activeSnapshot, localDiscId);
          this.hud.update(
            activeSnapshot.scoreRed ?? activeSnapshot.redScore,
            activeSnapshot.scoreBlue ?? activeSnapshot.blueScore,
            activeSnapshot.timerSeconds ?? activeSnapshot.matchTimerSeconds,
            activeSnapshot.isGoldenGoal,
            activeSnapshot.matchPhase,
            activeSnapshot.targetTeam
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
              } else if (currentPhase === MatchPhase.VICTORY_CELEBRATION || currentPhase === MatchPhase.MATCH_ENDED) {
                this.audioManager.playGoalWhistle();
              }

              let outcomeText: string | undefined = undefined;
              if (currentPhase === MatchPhase.STOPPED) {
                const red = activeSnapshot.scoreRed ?? activeSnapshot.redScore;
                const blue = activeSnapshot.scoreBlue ?? activeSnapshot.blueScore;
                if (activeSnapshot.isGoldenGoal && red !== blue) {
                  outcomeText = red > blue ? '¡Gol de Oro! Victoria del Equipo Rojo' : '¡Gol de Oro! Victoria del Equipo Azul';
                } else if (red > blue) {
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

        const frameDelta = now - lastFrameTime;
        lastFrameTime = now;

        // Medición periódica de RTT / Ping vía WebRTC getStats()
        if (now - lastPingCheck >= 1000) {
          lastPingCheck = now;
          if (this.mode === 'client' && this.hostPeer) {
            this.hostPeer.measureRtt().then((rtt) => {
              if (rtt > 0) this.currentPing = rtt;
            }).catch(() => {});
          } else if (this.mode === 'host' && this.peers.size > 0) {
            let totalRtt = 0;
            let count = 0;
            this.peers.forEach((peer) => {
              const rtt = peer.getRtt();
              if (rtt > 0) {
                totalRtt += rtt;
                count++;
              }
            });
            if (count > 0) {
              this.currentPing = totalRtt / count;
            }
          } else {
            this.currentPing = 0;
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

        // Actualización a 60 Hz del widget de telemetría (Zero-GC) y conexión activa
        let activeConnectionType = 'Direct (STUN/P2P)';
        if (this.mode === 'client' && this.hostPeer) {
          activeConnectionType = this.hostPeer.connectionType;
        } else if (this.mode === 'host' && this.peers.size > 0) {
          const firstPeer = this.peers.values().next().value;
          if (firstPeer) {
            activeConnectionType = firstPeer.connectionType;
          }
        }
        this.statsMonitor.update(this.currentPing, this.currentFps, frameDelta, activeConnectionType);
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

  public destroy(): void {
    this.stopRenderLoop();
    this.physicsTicker.stop();
    for (const unsub of this.unsubs) {
      unsub();
    }
    this.unsubs = [];
  }
}
