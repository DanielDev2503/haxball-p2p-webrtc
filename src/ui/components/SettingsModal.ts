import { InputManager, KeyBinds } from '../../client/InputManager';
import type { AudioManager } from '../../client/AudioManager';
import type { CanvasRenderer } from '../../render/CanvasRenderer';
import { $theme, toggleTheme } from '../stores/gameStore';

export interface KeybindRowConfig {
  key: keyof KeyBinds;
  label: string;
}

export const ACTIVE_KEYBIND_ROWS: KeybindRowConfig[] = [
  { key: 'up', label: 'Arriba (W)' },
  { key: 'down', label: 'Abajo (S)' },
  { key: 'left', label: 'Izquierda (A)' },
  { key: 'right', label: 'Derecha (D)' },
  { key: 'kick', label: 'Patear / Tiro (Espacio / X)' },
  { key: 'turbo', label: 'Sprint / Turbo (Shift Izq)' },
  { key: 'dash', label: 'Dash Rápido (Flecha Arriba)' },
  { key: 'curveLeft', label: 'Curva Izquierda / Magnus (Flecha Izq)' },
  { key: 'curveRight', label: 'Curva Derecha / Magnus (Flecha Der)' }
];

export interface KitConfig {
  primary: string;
  secondary: string;
  pattern: 'solid' | 'stripes-v' | 'stripe-h' | 'halves';
}

export interface AppSettings {
  // 1. Audio
  soundChat: boolean;
  soundMentions: boolean;
  soundEmotes: boolean;
  soundPostHit: boolean;
  soundKick: boolean;
  soundGoal: boolean;
  soundWhistle: boolean;
  masterVolume: number;
  isMuted: boolean;

  // 2. Video y Gráficos
  cameraZoom: number; // 0.75 a 1.50
  chatBgOpacity: number; // 0.1 a 1.0 (10% a 100%)
  visualExtrapolation: number; // 0 a 250 ms
  ballSkin: 'classic' | 'retro' | 'neon';
  ballTrailEnabled: boolean;
  playerGlowEnabled: boolean;
  netDeformationEnabled: boolean;
  offscreenIndicatorsEnabled: boolean;
  goalShakeEnabled: boolean;
  floatingScoresEnabled: boolean;
  shotFireEnabled: boolean;

  // Minimapa / Radar
  minimapEnabled: boolean;
  minimapOpacity: number; // 0.20 a 1.00 (20% a 100%)
  minimapSize: number; // 160 | 200 | 240
  minimapCameraFrustum: boolean;

  // 3. Equipaciones (Kits de Capitán)
  kitHome: KitConfig;
  kitAway: KitConfig;

  // 4. Club & Avatar
  clubName: string;
  clubTag: string;
  avatar: string;
  emoteShortcuts: Record<string, string>;
}

export const SETTINGS_STORAGE_KEY = 'haxball_settings_v1';

export const DEFAULT_SETTINGS: AppSettings = {
  soundChat: true,
  soundMentions: true,
  soundEmotes: true,
  soundPostHit: true,
  soundKick: true,
  soundGoal: true,
  soundWhistle: true,
  masterVolume: 0.5,
  isMuted: false,

  cameraZoom: 1.0,
  chatBgOpacity: 0.85,
  visualExtrapolation: 50,
  ballSkin: 'classic',
  ballTrailEnabled: true,
  playerGlowEnabled: true,
  netDeformationEnabled: true,
  offscreenIndicatorsEnabled: true,
  goalShakeEnabled: true,
  floatingScoresEnabled: true,
  shotFireEnabled: true,

  minimapEnabled: true,
  minimapOpacity: 0.6,
  minimapSize: 200,
  minimapCameraFrustum: true,

  kitHome: {
    primary: '#ef4444',
    secondary: '#ffffff',
    pattern: 'solid'
  },
  kitAway: {
    primary: '#3b82f6',
    secondary: '#ffffff',
    pattern: 'stripes-v'
  },

  clubName: 'Legacy FC',
  clubTag: 'LEG',
  avatar: '10',
  emoteShortcuts: {
    ':gol:': '⚽',
    ':fuego:': '🔥',
    ':gg:': '🤝',
    ':100:': '💯'
  }
};

export class SettingsModal {
  public modalEl: HTMLElement | null = null;
  public cardEl: HTMLElement | null = null;
  public backBtn: HTMLButtonElement | null = null;
  public themeBtn: HTMLButtonElement | null = null;
  public closeBtn: HTMLElement | null = null;
  public resetBtn: HTMLElement | null = null;
  public listContainer: HTMLElement | null = null;

  public inputManager: InputManager;
  public audioManager?: AudioManager | undefined;
  public canvasRenderer?: CanvasRenderer | undefined;

  public settings: AppSettings;
  public activeTab: 'controls' | 'audio' | 'video' | 'kits' | 'club' = 'controls';
  public activeKitSubtab: 'home' | 'away' = 'home';

  private recordingAction: keyof KeyBinds | null = null;
  private recordingBtn: HTMLButtonElement | null = null;
  private keydownListener: (e: KeyboardEvent) => void;
  private unsubs: Array<() => void> = [];

  constructor(
    inputManager: InputManager,
    audioManager?: AudioManager | undefined,
    canvasRenderer?: CanvasRenderer | undefined
  ) {
    this.inputManager = inputManager;
    this.audioManager = audioManager;
    this.canvasRenderer = canvasRenderer;
    this.settings = this.loadSettings();

    this.keydownListener = (e: KeyboardEvent) => {
      if (!this.recordingAction || !this.recordingBtn) return;
      e.preventDefault();
      e.stopPropagation();

      const newBinds = { ...this.inputManager.keyBinds };
      newBinds[this.recordingAction] = [e.code];
      this.inputManager.saveKeyBinds(newBinds);

      this.recordingBtn.classList.remove('recording');
      this.recordingAction = null;
      this.recordingBtn = null;
      this.renderKeybinds();
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this.keydownListener, true);
    }

    this.applySettings();
    this.buildModalDOM();

    this.unsubs.push(
      $theme.subscribe((t) => {
        if (this.themeBtn) {
          this.themeBtn.textContent = t === 'dark' ? '☼' : '☾';
        }
      })
    );
  }

  public setAudioManager(audioManager: AudioManager): void {
    this.audioManager = audioManager;
    this.applySettings();
  }

  public setCanvasRenderer(canvasRenderer: CanvasRenderer): void {
    this.canvasRenderer = canvasRenderer;
    this.applySettings();
  }

  public loadSettings(): AppSettings {
    if (typeof localStorage === 'undefined') return { ...DEFAULT_SETTINGS };
    let loaded: AppSettings = { ...DEFAULT_SETTINGS };
    try {
      let data = localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (!data) {
        data = localStorage.getItem('haxball_settings_v1') || localStorage.getItem('haxball_settings');
      }
      if (data) {
        const parsed = JSON.parse(data);
        loaded = {
          ...DEFAULT_SETTINGS,
          ...parsed,
          kitHome: { ...DEFAULT_SETTINGS.kitHome, ...(parsed.kitHome || {}) },
          kitAway: { ...DEFAULT_SETTINGS.kitAway, ...(parsed.kitAway || {}) },
          emoteShortcuts: { ...DEFAULT_SETTINGS.emoteShortcuts, ...(parsed.emoteShortcuts || {}) }
        };
      }
      const savedSkin = localStorage.getItem('haxball_ball_skin');
      if (savedSkin === 'classic' || savedSkin === 'retro' || savedSkin === 'neon') {
        loaded.ballSkin = savedSkin;
      }
    } catch {
      // Fallback
    }
    return loaded;
  }

  public saveSettings(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(this.settings));
      localStorage.setItem('haxball_ball_skin', this.settings.ballSkin);
    } catch {
      // Ignore
    }
    this.applySettings();
  }

  public applySettings(): void {
    // 1. Audio
    if (this.audioManager) {
      this.audioManager.chatSoundEnabled = this.settings.soundChat;
      this.audioManager.postHitSoundEnabled = this.settings.soundPostHit;
      this.audioManager.kickSoundEnabled = this.settings.soundKick;
      this.audioManager.goalSoundEnabled = this.settings.soundGoal;
      this.audioManager.whistleSoundEnabled = this.settings.soundWhistle;
      this.audioManager.volume = this.settings.masterVolume;
      this.audioManager.isMuted = this.settings.isMuted;
    }

    // 2. Video / Canvas
    if (this.canvasRenderer) {
      if (this.canvasRenderer.camera) {
        this.canvasRenderer.camera.zoom = this.settings.cameraZoom;
      }
      if (this.canvasRenderer.discRenderer) {
        this.canvasRenderer.discRenderer.ballTrailEnabled = this.settings.ballTrailEnabled;
        this.canvasRenderer.discRenderer.playerGlowEnabled = this.settings.playerGlowEnabled;
        this.canvasRenderer.discRenderer.ballSkin = this.settings.ballSkin;
      }
      this.canvasRenderer.netDeformationEnabled = this.settings.netDeformationEnabled;
      this.canvasRenderer.offscreenIndicatorsEnabled = this.settings.offscreenIndicatorsEnabled;
      this.canvasRenderer.goalShakeEnabled = this.settings.goalShakeEnabled;

      // Minimapa
      this.canvasRenderer.minimapEnabled = this.settings.minimapEnabled;
      this.canvasRenderer.minimapOpacity = this.settings.minimapOpacity;
      this.canvasRenderer.minimapSize = this.settings.minimapSize;
      this.canvasRenderer.minimapCameraFrustum = this.settings.minimapCameraFrustum;
      if (this.canvasRenderer.minimapRenderer) {
        this.canvasRenderer.minimapRenderer.setSettings({
          minimapEnabled: this.settings.minimapEnabled,
          minimapOpacity: this.settings.minimapOpacity,
          minimapSize: this.settings.minimapSize,
          minimapCameraFrustum: this.settings.minimapCameraFrustum
        });
      }
    }

    // 3. CSS Variables
    if (typeof document !== 'undefined' && document.documentElement?.style && typeof document.documentElement.style.setProperty === 'function') {
      document.documentElement.style.setProperty('--chat-bg-opacity', this.settings.chatBgOpacity.toString());
    }
  }

  private buildModalDOM(): void {
    if (typeof document === 'undefined') return;

    let overlay = document.getElementById('settingsModal');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'settingsModal';
      overlay.className = 'modal-overlay modal-backdrop ingame-menu-overlay u-hidden';
      document.body?.appendChild(overlay);
    }

    overlay.style.position = 'fixed';
    overlay.style.inset = '0';
    overlay.style.zIndex = '10001';
    overlay.style.display = 'none';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.background = 'rgba(0, 0, 0, 0.7)';
    this.modalEl = overlay;

    overlay.innerHTML = `
      <!-- Botón exterior de navegación "< Volver" (Top-Left) -->
      <button class="modal-nav-back-btn" id="btnSettingsBack" type="button" title="Volver">
        &lt; Volver
      </button>

      <!-- Botón exterior de tema "[ ☼ / ☾ ]" (Top-Right) -->
      <button class="modal-nav-theme-btn" id="btnSettingsThemeToggle" type="button" title="Alternar Modo Claro / Oscuro">
        ☼ / ☾
      </button>

      <!-- Chasis Central de 2 Columnas -->
      <div id="settingsModalCard" class="settings-modal-card">
        <!-- Sidebar Vertical Izquierdo (220px) -->
        <aside class="modal-sidebar-left" style="width: 220px;">
          <div style="padding: 0 18px 14px 18px; border-bottom: 1px solid rgba(0, 229, 255, 0.2);">
            <h2 style="margin: 0; font-size: 14px; font-weight: 800; color: var(--neon-cyan); letter-spacing: 0.5px; display: flex; align-items: center; gap: 8px;">
              <span>CONFIGURACIÓN</span> <span>⚙</span>
            </h2>
          </div>

          <nav style="display: flex; flex-direction: column; gap: 4px; margin-top: 12px; flex: 1;">
            <button class="modal-sidebar-nav-btn active" data-tab="controls" type="button">
              <span>🎮</span> <span>Controles</span>
            </button>
            <button class="modal-sidebar-nav-btn" data-tab="audio" type="button">
              <span>🔊</span> <span>Audio</span>
            </button>
            <button class="modal-sidebar-nav-btn" data-tab="video" type="button">
              <span>🖥️</span> <span>Video y Gráficos</span>
            </button>
            <button class="modal-sidebar-nav-btn" data-tab="kits" type="button">
              <span>👕</span> <span>Equipaciones</span>
            </button>
            <button class="modal-sidebar-nav-btn" data-tab="club" type="button">
              <span>🛡️</span> <span>Club & Avatar</span>
            </button>
          </nav>

          <div style="padding: 12px 16px; border-top: 1px solid rgba(0, 229, 255, 0.15); margin-top: auto;">
            <button id="btnResetSettings" class="btn btn-secondary btn-xs" style="width: 100%; font-size: 11px; padding: 6px;" type="button">
              Restablecer por defecto
            </button>
          </div>
        </aside>

        <!-- Panel Derecho de Contenido Activo -->
        <main class="settings-content-right cyber-scrollbar" style="flex: 1; overflow-y: auto !important; max-height: 100%; padding: 22px 26px; box-sizing: border-box; display: flex; flex-direction: column;">
          
          <!-- Pestaña 1: Controles -->
          <div id="panelTabControls" class="tab-panel active" style="display: flex; flex-direction: column; gap: 14px;">
            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(0, 229, 255, 0.15); padding-bottom: 8px;">
              <h3 style="margin: 0; font-size: 15px; font-weight: 700; color: #fff;">Mapeo de Teclas y Controles</h3>
              <span style="font-size: 11px; color: var(--text-secondary);">Haz clic en un badge y presiona la tecla</span>
            </div>
            <div id="settingsKeybindsList" style="display: flex; flex-direction: column; gap: 8px;"></div>
          </div>

          <!-- Pestaña 2: Audio -->
          <div id="panelTabAudio" class="tab-panel" style="display: none; flex-direction: column; gap: 16px;">
            <div style="border-bottom: 1px solid rgba(0, 229, 255, 0.15); padding-bottom: 8px;">
              <h3 style="margin: 0; font-size: 15px; font-weight: 700; color: #fff;">Ajustes de Sonido y Volumen</h3>
            </div>

            <!-- Volumen Maestro -->
            <div style="background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(0, 229, 255, 0.2); border-radius: 8px; padding: 14px; display: flex; flex-direction: column; gap: 8px;">
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <span style="font-size: 13px; font-weight: 700; color: #fff;">Volumen Maestro</span>
                <span id="txtSettingsMasterVolume" style="font-size: 13px; font-weight: 800; color: var(--neon-cyan);">${Math.round(this.settings.masterVolume * 100)}%</span>
              </div>
              <input type="range" id="rngSettingsMasterVolume" min="0" max="1" step="0.05" value="${this.settings.masterVolume}" style="width: 100%; cursor: pointer;" />
            </div>

            <!-- Toggles de Audio -->
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
              <label style="display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; background: rgba(15, 23, 42, 0.5); border: 1px solid rgba(0, 229, 255, 0.15); border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer;">
                <span>💬 Sonido de Chat General</span>
                <input type="checkbox" id="chkAudioChat" ${this.settings.soundChat ? 'checked' : ''} />
              </label>
              <label style="display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; background: rgba(15, 23, 42, 0.5); border: 1px solid rgba(0, 229, 255, 0.15); border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer;">
                <span>🔔 Alerta Menciones (@)</span>
                <input type="checkbox" id="chkAudioMentions" ${this.settings.soundMentions ? 'checked' : ''} />
              </label>
              <label style="display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; background: rgba(15, 23, 42, 0.5); border: 1px solid rgba(0, 229, 255, 0.15); border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer;">
                <span>🙂 Sonido de Emotes en Cancha</span>
                <input type="checkbox" id="chkAudioEmotes" ${this.settings.soundEmotes ? 'checked' : ''} />
              </label>
              <label style="display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; background: rgba(15, 23, 42, 0.5); border: 1px solid rgba(0, 229, 255, 0.15); border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer;">
                <span>🥅 Impacto Postes y Travesaños</span>
                <input type="checkbox" id="chkAudioPostHit" ${this.settings.soundPostHit ? 'checked' : ''} />
              </label>
              <label style="display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; background: rgba(15, 23, 42, 0.5); border: 1px solid rgba(0, 229, 255, 0.15); border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer;">
                <span>⚽ Patada / Golpe de Balón</span>
                <input type="checkbox" id="chkAudioKick" ${this.settings.soundKick ? 'checked' : ''} />
              </label>
              <label style="display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; background: rgba(15, 23, 42, 0.5); border: 1px solid rgba(0, 229, 255, 0.15); border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer;">
                <span>📢 Pitido de Silbato</span>
                <input type="checkbox" id="chkAudioWhistle" ${this.settings.soundWhistle ? 'checked' : ''} />
              </label>
              <label style="display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; background: rgba(15, 23, 42, 0.5); border: 1px solid rgba(0, 229, 255, 0.15); border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer; grid-column: span 2;">
                <span>🎉 Sirena de Gol y Celebración</span>
                <input type="checkbox" id="chkAudioGoal" ${this.settings.soundGoal ? 'checked' : ''} />
              </label>
            </div>
          </div>

          <!-- Pestaña 3: Video y Gráficos -->
          <div id="panelTabVideo" class="tab-panel" style="display: none; flex-direction: column; gap: 16px;">
            <div style="border-bottom: 1px solid rgba(0, 229, 255, 0.15); padding-bottom: 8px;">
              <h3 style="margin: 0; font-size: 15px; font-weight: 700; color: #fff;">Video, Cámara y Gráficos</h3>
            </div>

            <!-- Sliders de Cámara y Red -->
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
              <div style="background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(0, 229, 255, 0.2); border-radius: 8px; padding: 12px;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
                  <span style="font-size: 12px; font-weight: 700;">Zoom Cámara Principal</span>
                  <span id="txtSettingsCameraZoom" style="font-size: 12px; font-weight: 800; color: var(--neon-cyan);">${this.settings.cameraZoom.toFixed(2)}x</span>
                </div>
                <input type="range" id="rngSettingsCameraZoom" min="0.75" max="1.50" step="0.05" value="${this.settings.cameraZoom}" style="width: 100%;" />
              </div>

              <div style="background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(0, 229, 255, 0.2); border-radius: 8px; padding: 12px;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
                  <span style="font-size: 12px; font-weight: 700;">Opacidad del Chat</span>
                  <span id="txtSettingsChatOpacity" style="font-size: 12px; font-weight: 800; color: var(--neon-cyan);">${Math.round(this.settings.chatBgOpacity * 100)}%</span>
                </div>
                <input type="range" id="rngSettingsChatOpacity" min="0.10" max="1.00" step="0.05" value="${this.settings.chatBgOpacity}" style="width: 100%;" />
              </div>

              <div style="background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(0, 229, 255, 0.2); border-radius: 8px; padding: 12px; grid-column: span 2;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
                  <span style="font-size: 12px; font-weight: 700;">Extrapolación Visual Local</span>
                  <span id="txtSettingsExtrapolation" style="font-size: 12px; font-weight: 800; color: var(--neon-cyan);">${this.settings.visualExtrapolation} ms</span>
                </div>
                <input type="range" id="rngSettingsExtrapolation" min="0" max="250" step="10" value="${this.settings.visualExtrapolation}" style="width: 100%;" />
              </div>
            </div>

            <!-- Selector 3D de Skin del Balón -->
            <div>
              <span style="font-size: 12px; font-weight: 700; color: #fff; margin-bottom: 8px; display: block;">Diseño del Balón</span>
              <div style="display: flex; gap: 10px;">
                <div class="ball-skin-card ${this.settings.ballSkin === 'classic' ? 'active' : ''}" data-skin="classic">
                  <span style="font-size: 20px;">⚽</span>
                  <span style="font-size: 12px; font-weight: 700;">Clásico</span>
                  <span style="font-size: 10px; color: var(--text-secondary);">Hexágonos B/N</span>
                </div>
                <div class="ball-skin-card ${this.settings.ballSkin === 'retro' ? 'active' : ''}" data-skin="retro">
                  <span style="font-size: 20px;">🏉</span>
                  <span style="font-size: 12px; font-weight: 700;">Retro</span>
                  <span style="font-size: 10px; color: var(--text-secondary);">Cuero Marrón</span>
                </div>
                <div class="ball-skin-card ${this.settings.ballSkin === 'neon' ? 'active' : ''}" data-skin="neon">
                  <span style="font-size: 20px;">⚡</span>
                  <span style="font-size: 12px; font-weight: 700;">Neón</span>
                  <span style="font-size: 10px; color: var(--text-secondary);">Flúor Cian</span>
                </div>
              </div>
            </div>

            <!-- Toggles Gráficos -->
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
              <label style="display: flex; justify-content: space-between; align-items: center; padding: 8px 10px; background: rgba(15, 23, 42, 0.5); border: 1px solid rgba(0, 229, 255, 0.15); border-radius: 6px; font-size: 11px; font-weight: 600; cursor: pointer;">
                <span>🗺️ Radar / Minimapa</span>
                <input type="checkbox" id="chkVideoMinimap" ${this.settings.minimapEnabled ? 'checked' : ''} />
              </label>
              <label style="display: flex; justify-content: space-between; align-items: center; padding: 8px 10px; background: rgba(15, 23, 42, 0.5); border: 1px solid rgba(0, 229, 255, 0.15); border-radius: 6px; font-size: 11px; font-weight: 600; cursor: pointer;">
                <span>📐 Frustum de Cámara en Radar</span>
                <input type="checkbox" id="chkVideoFrustum" ${this.settings.minimapCameraFrustum ? 'checked' : ''} />
              </label>
              <label style="display: flex; justify-content: space-between; align-items: center; padding: 8px 10px; background: rgba(15, 23, 42, 0.5); border: 1px solid rgba(0, 229, 255, 0.15); border-radius: 6px; font-size: 11px; font-weight: 600; cursor: pointer;">
                <span>🔢 Textos Flotantes (+20, +100)</span>
                <input type="checkbox" id="chkVideoFloatingScores" ${this.settings.floatingScoresEnabled ? 'checked' : ''} />
              </label>
              <label style="display: flex; justify-content: space-between; align-items: center; padding: 8px 10px; background: rgba(15, 23, 42, 0.5); border: 1px solid rgba(0, 229, 255, 0.15); border-radius: 6px; font-size: 11px; font-weight: 600; cursor: pointer;">
                <span>🌀 Estela Cian de Magnus</span>
                <input type="checkbox" id="chkVideoBallTrail" ${this.settings.ballTrailEnabled ? 'checked' : ''} />
              </label>
              <label style="display: flex; justify-content: space-between; align-items: center; padding: 8px 10px; background: rgba(15, 23, 42, 0.5); border: 1px solid rgba(0, 229, 255, 0.15); border-radius: 6px; font-size: 11px; font-weight: 600; cursor: pointer; grid-column: span 2;">
                <span>🔥 Fuego en Tiro Potente (&gt;950 px/s)</span>
                <input type="checkbox" id="chkVideoShotFire" ${this.settings.shotFireEnabled ? 'checked' : ''} />
              </label>
            </div>
          </div>

          <!-- Pestaña 4: Equipaciones (Kits de Capitán) -->
          <div id="panelTabKits" class="tab-panel" style="display: none; flex-direction: column; gap: 16px;">
            <div style="border-bottom: 1px solid rgba(0, 229, 255, 0.15); padding-bottom: 8px; display: flex; justify-content: space-between; align-items: center;">
              <h3 style="margin: 0; font-size: 15px; font-weight: 700; color: #fff;">Equipaciones y Kits de Capitán</h3>
              <div style="display: flex; gap: 6px;">
                <button id="btnKitSubtabHome" class="btn btn-xs ${this.activeKitSubtab === 'home' ? 'btn-primary' : 'btn-secondary'}" type="button">
                  🏠 Equipación Local
                </button>
                <button id="btnKitSubtabAway" class="btn btn-xs ${this.activeKitSubtab === 'away' ? 'btn-primary' : 'btn-secondary'}" type="button">
                  ✈️ Equipación Visitante
                </button>
              </div>
            </div>

            <div style="display: flex; gap: 24px; align-items: center; background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(0, 229, 255, 0.2); border-radius: 8px; padding: 18px;">
              <!-- Preview en tiempo real (64px) -->
              <div style="display: flex; flex-direction: column; align-items: center; gap: 6px;">
                <canvas id="kitPreviewCanvas" width="64" height="64" style="border-radius: 50%; box-shadow: 0 0 16px rgba(0, 229, 255, 0.35);"></canvas>
                <span style="font-size: 10px; font-weight: 700; color: #ffd700;">CAPITÁN "C"</span>
              </div>

              <!-- Controles de Color y Patrón -->
              <div style="flex: 1; display: flex; flex-direction: column; gap: 10px;">
                <div style="display: flex; gap: 12px;">
                  <div style="flex: 1;">
                    <label style="font-size: 11px; color: var(--text-secondary); display: block; margin-bottom: 4px;">Color Primario</label>
                    <input type="color" id="inputKitPrimaryColor" value="${this.settings.kitHome.primary}" style="width: 100%; height: 32px; background: transparent; border: 1px solid var(--border-cyan); border-radius: 6px; cursor: pointer;" />
                  </div>
                  <div style="flex: 1;">
                    <label style="font-size: 11px; color: var(--text-secondary); display: block; margin-bottom: 4px;">Color Secundario</label>
                    <input type="color" id="inputKitSecondaryColor" value="${this.settings.kitHome.secondary}" style="width: 100%; height: 32px; background: transparent; border: 1px solid var(--border-cyan); border-radius: 6px; cursor: pointer;" />
                  </div>
                </div>

                <div>
                  <label style="font-size: 11px; color: var(--text-secondary); display: block; margin-bottom: 4px;">Patrón del Disco</label>
                  <select id="selectKitPattern" style="width: 100%; padding: 6px 10px; background: rgba(10, 16, 26, 0.9); border: 1px solid var(--border-cyan); border-radius: 6px; color: #fff; font-size: 12px;">
                    <option value="solid">Liso</option>
                    <option value="stripes-v">Franjas Verticales</option>
                    <option value="stripe-h">Franja Horizontal</option>
                    <option value="halves">Mitades</option>
                  </select>
                </div>
              </div>
            </div>
          </div>

          <!-- Pestaña 5: Club & Avatar -->
          <div id="panelTabClub" class="tab-panel" style="display: none; flex-direction: column; gap: 16px;">
            <div style="border-bottom: 1px solid rgba(0, 229, 255, 0.15); padding-bottom: 8px;">
              <h3 style="margin: 0; font-size: 15px; font-weight: 700; color: #fff;">Identidad de Club & Avatar</h3>
            </div>

            <!-- Club Info -->
            <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 12px;">
              <div>
                <label style="font-size: 11px; color: var(--text-secondary); display: block; margin-bottom: 4px;">Nombre del Club (Máx 20 caracteres)</label>
                <input type="text" id="inputSettingsClubName" maxlength="20" value="${this.settings.clubName}" style="width: 100%; padding: 8px 10px; background: rgba(15, 23, 42, 0.7); border: 1px solid var(--border-cyan); border-radius: 6px; color: #fff; font-size: 13px;" />
              </div>
              <div>
                <label style="font-size: 11px; color: var(--text-secondary); display: block; margin-bottom: 4px;">Acrónimo Marcador (Máx 4)</label>
                <input type="text" id="inputSettingsClubTag" maxlength="4" value="${this.settings.clubTag}" style="width: 100%; padding: 8px 10px; background: rgba(15, 23, 42, 0.7); border: 1px solid var(--border-cyan); border-radius: 6px; color: #fff; font-size: 13px; text-transform: uppercase;" />
              </div>
            </div>

            <!-- Avatar -->
            <div style="background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(0, 229, 255, 0.2); border-radius: 8px; padding: 12px; display: flex; justify-content: space-between; align-items: center;">
              <div>
                <span style="font-size: 13px; font-weight: 700; display: block;">Avatar de Disco</span>
                <span style="font-size: 11px; color: var(--text-secondary);">2 caracteres alfanuméricos o 1 emoji en el centro</span>
              </div>
              <input type="text" id="inputSettingsAvatar" maxlength="2" value="${this.settings.avatar}" style="width: 60px; text-align: center; padding: 6px; background: rgba(10, 16, 26, 0.9); border: 1px solid var(--border-cyan); border-radius: 6px; color: #00e5ff; font-size: 16px; font-weight: 800;" />
            </div>

            <!-- Comandos de Emotes -->
            <div>
              <span style="font-size: 12px; font-weight: 700; color: #fff; margin-bottom: 8px; display: block;">Atajos de Emotes en Chat</span>
              <div style="background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(0, 229, 255, 0.2); border-radius: 8px; overflow: hidden;">
                <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
                  <thead>
                    <tr style="background: rgba(0, 229, 255, 0.1); border-bottom: 1px solid rgba(0, 229, 255, 0.2);">
                      <th style="padding: 8px 12px; text-align: left; color: var(--neon-cyan);">Comando Chat</th>
                      <th style="padding: 8px 12px; text-align: left; color: var(--neon-cyan);">Emoji Traducido</th>
                    </tr>
                  </thead>
                  <tbody id="emoteShortcutsTbody">
                    <tr style="border-bottom: 1px solid rgba(0, 229, 255, 0.08);">
                      <td style="padding: 6px 12px; font-family: monospace;">:gol:</td>
                      <td style="padding: 6px 12px;">⚽</td>
                    </tr>
                    <tr style="border-bottom: 1px solid rgba(0, 229, 255, 0.08);">
                      <td style="padding: 6px 12px; font-family: monospace;">:fuego:</td>
                      <td style="padding: 6px 12px;">🔥</td>
                    </tr>
                    <tr style="border-bottom: 1px solid rgba(0, 229, 255, 0.08);">
                      <td style="padding: 6px 12px; font-family: monospace;">:gg:</td>
                      <td style="padding: 6px 12px;">🤝</td>
                    </tr>
                    <tr>
                      <td style="padding: 6px 12px; font-family: monospace;">:100:</td>
                      <td style="padding: 6px 12px;">💯</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>

        </main>
      </div>
    `;

    this.cardEl = overlay.querySelector('.settings-modal-card');
    this.backBtn = overlay.querySelector('#btnSettingsBack');
    this.themeBtn = overlay.querySelector('#btnSettingsThemeToggle');
    this.resetBtn = overlay.querySelector('#btnResetSettings');
    this.listContainer = overlay.querySelector('#settingsKeybindsList');

    this.setupListeners();
    this.renderKeybinds();
    this.renderKitPreview();
  }

  private setupListeners(): void {
    if (!this.modalEl) return;

    // 1. Botón exterior < Volver
    this.backBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.close();
    });

    // 2. Botón exterior [ ☼ / ☾ ]
    this.themeBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleTheme();
    });

    // Cerrar al hacer click fuera de la tarjeta
    this.modalEl.addEventListener('click', (e) => {
      if (e.target === this.modalEl) {
        this.close();
      }
    });

    // 3. Navegación de pestañas en Sidebar
    const navBtns = typeof this.modalEl.querySelectorAll === 'function' ? this.modalEl.querySelectorAll<HTMLButtonElement>('.modal-sidebar-nav-btn') : [];
    navBtns.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const tab = btn.getAttribute('data-tab') as any;
        if (tab) {
          this.switchTab(tab);
        }
      });
    });

    // 4. Botón Restablecer por defecto
    this.resetBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.activeTab === 'controls') {
        this.inputManager.resetToDefaultKeyBinds();
        this.renderKeybinds();
      } else {
        this.settings = { ...DEFAULT_SETTINGS };
        this.saveSettings();
        this.syncInputsWithSettings();
        this.renderKitPreview();
      }
    });

    // 5. Inputs de Audio
    const rngVol = this.modalEl.querySelector('#rngSettingsMasterVolume') as HTMLInputElement | null;
    const txtVol = this.modalEl.querySelector('#txtSettingsMasterVolume');
    rngVol?.addEventListener('input', () => {
      const val = parseFloat(rngVol.value);
      this.settings.masterVolume = val;
      if (txtVol) txtVol.textContent = `${Math.round(val * 100)}%`;
      this.saveSettings();
    });

    const bindCheck = (id: string, prop: keyof AppSettings) => {
      const chk = this.modalEl?.querySelector(`#${id}`) as HTMLInputElement | null;
      chk?.addEventListener('change', () => {
        (this.settings as any)[prop] = chk.checked;
        this.saveSettings();
      });
    };

    bindCheck('chkAudioChat', 'soundChat');
    bindCheck('chkAudioMentions', 'soundMentions');
    bindCheck('chkAudioEmotes', 'soundEmotes');
    bindCheck('chkAudioPostHit', 'soundPostHit');
    bindCheck('chkAudioKick', 'soundKick');
    bindCheck('chkAudioWhistle', 'soundWhistle');
    bindCheck('chkAudioGoal', 'soundGoal');

    // 6. Inputs de Video
    const rngZoom = this.modalEl.querySelector('#rngSettingsCameraZoom') as HTMLInputElement | null;
    const txtZoom = this.modalEl.querySelector('#txtSettingsCameraZoom');
    rngZoom?.addEventListener('input', () => {
      const val = parseFloat(rngZoom.value);
      this.settings.cameraZoom = val;
      if (txtZoom) txtZoom.textContent = `${val.toFixed(2)}x`;
      this.saveSettings();
    });

    const rngOpacity = this.modalEl.querySelector('#rngSettingsChatOpacity') as HTMLInputElement | null;
    const txtOpacity = this.modalEl.querySelector('#txtSettingsChatOpacity');
    rngOpacity?.addEventListener('input', () => {
      const val = parseFloat(rngOpacity.value);
      this.settings.chatBgOpacity = val;
      if (txtOpacity) txtOpacity.textContent = `${Math.round(val * 100)}%`;
      this.saveSettings();
    });

    const rngExtrap = this.modalEl.querySelector('#rngSettingsExtrapolation') as HTMLInputElement | null;
    const txtExtrap = this.modalEl.querySelector('#txtSettingsExtrapolation');
    rngExtrap?.addEventListener('input', () => {
      const val = parseInt(rngExtrap.value, 10);
      this.settings.visualExtrapolation = val;
      if (txtExtrap) txtExtrap.textContent = `${val} ms`;
      this.saveSettings();
    });

    bindCheck('chkVideoMinimap', 'minimapEnabled');
    bindCheck('chkVideoFrustum', 'minimapCameraFrustum');
    bindCheck('chkVideoFloatingScores', 'floatingScoresEnabled');
    bindCheck('chkVideoBallTrail', 'ballTrailEnabled');
    bindCheck('chkVideoShotFire', 'shotFireEnabled');

    // Tarjetas de skin
    const skinCards = typeof this.modalEl.querySelectorAll === 'function' ? this.modalEl.querySelectorAll<HTMLElement>('.ball-skin-card') : [];
    skinCards.forEach((card) => {
      card.addEventListener('click', (e) => {
        e.stopPropagation();
        const skin = card.getAttribute('data-skin') as any;
        if (skin) {
          this.settings.ballSkin = skin;
          skinCards.forEach(c => c.classList.remove('active'));
          card.classList.add('active');
          this.saveSettings();
        }
      });
    });

    // 7. Equipaciones (Kits)
    const btnHome = this.modalEl.querySelector('#btnKitSubtabHome');
    const btnAway = this.modalEl.querySelector('#btnKitSubtabAway');
    btnHome?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.activeKitSubtab = 'home';
      btnHome.className = 'btn btn-xs btn-primary';
      if (btnAway) btnAway.className = 'btn btn-xs btn-secondary';
      this.syncKitInputs();
      this.renderKitPreview();
    });
    btnAway?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.activeKitSubtab = 'away';
      btnAway.className = 'btn btn-xs btn-primary';
      if (btnHome) btnHome.className = 'btn btn-xs btn-secondary';
      this.syncKitInputs();
      this.renderKitPreview();
    });

    const primaryColorInput = this.modalEl.querySelector('#inputKitPrimaryColor') as HTMLInputElement | null;
    const secondaryColorInput = this.modalEl.querySelector('#inputKitSecondaryColor') as HTMLInputElement | null;
    const patternSelect = this.modalEl.querySelector('#selectKitPattern') as HTMLSelectElement | null;

    primaryColorInput?.addEventListener('input', () => {
      const currentKit = this.activeKitSubtab === 'home' ? this.settings.kitHome : this.settings.kitAway;
      currentKit.primary = primaryColorInput.value;
      this.saveSettings();
      this.renderKitPreview();
    });

    secondaryColorInput?.addEventListener('input', () => {
      const currentKit = this.activeKitSubtab === 'home' ? this.settings.kitHome : this.settings.kitAway;
      currentKit.secondary = secondaryColorInput.value;
      this.saveSettings();
      this.renderKitPreview();
    });

    patternSelect?.addEventListener('change', () => {
      const currentKit = this.activeKitSubtab === 'home' ? this.settings.kitHome : this.settings.kitAway;
      currentKit.pattern = patternSelect.value as any;
      this.saveSettings();
      this.renderKitPreview();
    });

    // 8. Club & Avatar
    const clubNameInput = this.modalEl.querySelector('#inputSettingsClubName') as HTMLInputElement | null;
    const clubTagInput = this.modalEl.querySelector('#inputSettingsClubTag') as HTMLInputElement | null;
    const avatarInput = this.modalEl.querySelector('#inputSettingsAvatar') as HTMLInputElement | null;

    clubNameInput?.addEventListener('change', () => {
      this.settings.clubName = clubNameInput.value.trim() || 'Legacy FC';
      this.saveSettings();
    });
    clubTagInput?.addEventListener('change', () => {
      this.settings.clubTag = clubTagInput.value.trim().toUpperCase() || 'LEG';
      this.saveSettings();
    });
    avatarInput?.addEventListener('input', () => {
      this.settings.avatar = avatarInput.value.trim() || '10';
      this.saveSettings();
    });
  }

  public switchTab(tabName: 'controls' | 'audio' | 'video' | 'kits' | 'club'): void {
    this.activeTab = tabName;
    if (!this.modalEl) return;

    // Alternar clase activa en botones del sidebar
    const navBtns = typeof this.modalEl.querySelectorAll === 'function' ? this.modalEl.querySelectorAll('.modal-sidebar-nav-btn') : [];
    navBtns.forEach((btn) => {
      const t = btn.getAttribute('data-tab');
      if (t === tabName) btn.classList.add('active');
      else btn.classList.remove('active');
    });

    // Alternar visibilidad de paneles
    const panels = {
      controls: this.modalEl.querySelector('#panelTabControls') as HTMLElement | null,
      audio: this.modalEl.querySelector('#panelTabAudio') as HTMLElement | null,
      video: this.modalEl.querySelector('#panelTabVideo') as HTMLElement | null,
      kits: this.modalEl.querySelector('#panelTabKits') as HTMLElement | null,
      club: this.modalEl.querySelector('#panelTabClub') as HTMLElement | null
    };

    Object.entries(panels).forEach(([key, panel]) => {
      if (!panel) return;
      if (key === tabName) {
        panel.style.display = 'flex';
        panel.classList.add('active');
      } else {
        panel.style.display = 'none';
        panel.classList.remove('active');
      }
    });

    if (tabName === 'controls') {
      this.renderKeybinds();
    } else if (tabName === 'kits') {
      this.syncKitInputs();
      this.renderKitPreview();
    }
  }

  private syncKitInputs(): void {
    if (!this.modalEl) return;
    const currentKit = this.activeKitSubtab === 'home' ? this.settings.kitHome : this.settings.kitAway;
    const primaryInput = this.modalEl.querySelector('#inputKitPrimaryColor') as HTMLInputElement | null;
    const secondaryInput = this.modalEl.querySelector('#inputKitSecondaryColor') as HTMLInputElement | null;
    const patternSelect = this.modalEl.querySelector('#selectKitPattern') as HTMLSelectElement | null;

    if (primaryInput) primaryInput.value = currentKit.primary;
    if (secondaryInput) secondaryInput.value = currentKit.secondary;
    if (patternSelect) patternSelect.value = currentKit.pattern;
  }

  private renderKitPreview(): void {
    if (typeof document === 'undefined') return;
    const canvas = this.modalEl?.querySelector('#kitPreviewCanvas') as HTMLCanvasElement | null;
    if (!canvas) return;
    const ctx = canvas.getContext?.('2d');
    if (!ctx) return;

    const kit = this.activeKitSubtab === 'home' ? this.settings.kitHome : this.settings.kitAway;
    const w = canvas.width;
    const h = canvas.height;
    const r = w / 2 - 4;

    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, r, 0, Math.PI * 2);
    ctx.clip();

    // Fondo primario
    ctx.fillStyle = kit.primary;
    ctx.fillRect(0, 0, w, h);

    // Patrón
    if (kit.pattern === 'stripes-v') {
      ctx.fillStyle = kit.secondary;
      ctx.fillRect(w / 4, 0, w / 4, h);
      ctx.fillRect((3 * w) / 4, 0, w / 4, h);
    } else if (kit.pattern === 'stripe-h') {
      ctx.fillStyle = kit.secondary;
      ctx.fillRect(0, h / 3, w, h / 3);
    } else if (kit.pattern === 'halves') {
      ctx.fillStyle = kit.secondary;
      ctx.fillRect(w / 2, 0, w / 2, h);
    }

    ctx.restore();

    // Borde exterior
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, r, 0, Math.PI * 2);
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();

    // Distintivo "C" de Capitán
    ctx.fillStyle = '#ffd700';
    ctx.font = 'bold 20px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('C', w / 2, h / 2);
  }

  public syncInputsWithSettings(): void {
    if (!this.modalEl) return;
    const rngVol = this.modalEl.querySelector('#rngSettingsMasterVolume') as HTMLInputElement | null;
    const txtVol = this.modalEl.querySelector('#txtSettingsMasterVolume');
    if (rngVol) rngVol.value = this.settings.masterVolume.toString();
    if (txtVol) txtVol.textContent = `${Math.round(this.settings.masterVolume * 100)}%`;

    const setChecked = (id: string, val: boolean) => {
      const chk = this.modalEl?.querySelector(`#${id}`) as HTMLInputElement | null;
      if (chk) chk.checked = val;
    };

    setChecked('chkAudioChat', this.settings.soundChat);
    setChecked('chkAudioMentions', this.settings.soundMentions);
    setChecked('chkAudioEmotes', this.settings.soundEmotes);
    setChecked('chkAudioPostHit', this.settings.soundPostHit);
    setChecked('chkAudioKick', this.settings.soundKick);
    setChecked('chkAudioWhistle', this.settings.soundWhistle);
    setChecked('chkAudioGoal', this.settings.soundGoal);

    const rngZoom = this.modalEl.querySelector('#rngSettingsCameraZoom') as HTMLInputElement | null;
    const txtZoom = this.modalEl.querySelector('#txtSettingsCameraZoom');
    if (rngZoom) rngZoom.value = this.settings.cameraZoom.toString();
    if (txtZoom) txtZoom.textContent = `${this.settings.cameraZoom.toFixed(2)}x`;

    const rngOpacity = this.modalEl.querySelector('#rngSettingsChatOpacity') as HTMLInputElement | null;
    const txtOpacity = this.modalEl.querySelector('#txtSettingsChatOpacity');
    if (rngOpacity) rngOpacity.value = this.settings.chatBgOpacity.toString();
    if (txtOpacity) txtOpacity.textContent = `${Math.round(this.settings.chatBgOpacity * 100)}%`;

    const rngExtrap = this.modalEl.querySelector('#rngSettingsExtrapolation') as HTMLInputElement | null;
    const txtExtrap = this.modalEl.querySelector('#txtSettingsExtrapolation');
    if (rngExtrap) rngExtrap.value = this.settings.visualExtrapolation.toString();
    if (txtExtrap) txtExtrap.textContent = `${this.settings.visualExtrapolation} ms`;

    setChecked('chkVideoMinimap', this.settings.minimapEnabled);
    setChecked('chkVideoFrustum', this.settings.minimapCameraFrustum);
    setChecked('chkVideoFloatingScores', this.settings.floatingScoresEnabled);
    setChecked('chkVideoBallTrail', this.settings.ballTrailEnabled);
    setChecked('chkVideoShotFire', this.settings.shotFireEnabled);

    this.syncKitInputs();
    this.renderKitPreview();
  }

  public renderKeybinds(): void {
    if (!this.listContainer) {
      this.listContainer = this.modalEl?.querySelector('#settingsKeybindsList') as HTMLElement | null;
    }
    if (!this.listContainer) return;
    this.listContainer.innerHTML = '';
    const binds = this.inputManager.keyBinds;

    for (const { key, label } of ACTIVE_KEYBIND_ROWS) {
      const row = document.createElement('div');
      row.className = 'keybind-row';
      row.style.display = 'flex';
      row.style.justifyContent = 'space-between';
      row.style.alignItems = 'center';
      row.style.padding = '8px 12px';
      row.style.background = 'rgba(15, 23, 42, 0.6)';
      row.style.borderRadius = '6px';
      row.style.border = '1px solid rgba(0, 229, 255, 0.15)';

      const labelEl = document.createElement('span');
      labelEl.className = 'keybind-label';
      labelEl.style.fontSize = '12px';
      labelEl.style.fontWeight = '700';
      labelEl.style.color = '#e2e8f0';
      labelEl.textContent = label;

      const btn = document.createElement('button');
      btn.className = 'keybind-badge';
      btn.type = 'button';
      const boundKeys = binds[key] || [];
      btn.textContent = boundKeys.join(' / ') || 'Ninguna';

      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.recordingBtn) {
          this.recordingBtn.classList.remove('recording');
          const prevKey = binds[this.recordingAction!] || [];
          this.recordingBtn.textContent = prevKey.join(' / ') || 'Ninguna';
        }
        this.recordingAction = key;
        this.recordingBtn = btn;
        btn.classList.add('recording');
        btn.textContent = 'Presiona tecla...';
      });

      row.appendChild(labelEl);
      row.appendChild(btn);
      this.listContainer.appendChild(row);
    }
  }

  public render(): void {
    this.renderKeybinds();
    this.syncInputsWithSettings();
  }

  public open(): void {
    this.show();
  }

  public show(): void {
    this.render();
    if (this.modalEl) {
      this.modalEl.classList.remove('u-hidden', 'ui-screen-hidden');
      this.modalEl.style.display = 'flex';
      this.modalEl.style.zIndex = '10001';
      this.modalEl.style.pointerEvents = 'auto';
    }
  }

  public close(): void {
    this.hide();
  }

  public hide(): void {
    if (this.modalEl) {
      this.modalEl.style.display = 'none';
      this.modalEl.classList.add('u-hidden');
    }
    if (this.recordingBtn) {
      this.recordingBtn.classList.remove('recording');
      this.recordingAction = null;
      this.recordingBtn = null;
    }
  }

  public destroy(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.keydownListener, true);
    }
    this.unsubs.forEach(unsub => unsub());
    this.unsubs = [];
  }
}

/**
 * Wrapper de compatibilidad hacia atrás para tests o llamadas legadas
 */
export class KeybindModal extends SettingsModal {
  constructor(inputManager: InputManager) {
    super(inputManager);
  }
}
