import { InputManager, KeyBinds } from '../../client/InputManager';
import type { AudioManager } from '../../client/AudioManager';
import type { CanvasRenderer } from '../../render/CanvasRenderer';

export interface KeybindRowConfig {
  key: keyof KeyBinds;
  label: string;
}

export const ACTIVE_KEYBIND_ROWS: KeybindRowConfig[] = [
  { key: 'up', label: 'Arriba / Adelante (W)' },
  { key: 'down', label: 'Abajo / Atrás (S)' },
  { key: 'left', label: 'Izquierda (A)' },
  { key: 'right', label: 'Derecha (D)' },
  { key: 'kick', label: 'Patear / Chutar (Espacio)' },
  { key: 'turbo', label: 'Turbo / Sprint (Shift)' },
  { key: 'dash', label: 'Dash / Impulso Rápido (Flecha Arriba)' },
  { key: 'curveLeft', label: 'Comba / Curva Izquierda (Flecha Izq)' },
  { key: 'curveRight', label: 'Comba / Curva Derecha (Flecha Der)' }
];

export interface AppSettings {
  // Sonidos
  soundChat: boolean;
  soundPostHit: boolean;
  soundKick: boolean;
  soundGoal: boolean;
  soundWhistle: boolean;
  masterVolume: number;
  isMuted: boolean;

  // Video
  cameraZoom: number; // 0.75 a 1.50
  chatBgOpacity: number; // 0.1 a 1.0 (10% a 100%)
  ballTrailEnabled: boolean;
  playerGlowEnabled: boolean;
  netDeformationEnabled: boolean;
  offscreenIndicatorsEnabled: boolean;
  goalShakeEnabled: boolean;

  // Minimapa / Radar
  minimapEnabled: boolean;
  minimapOpacity: number; // 0.20 a 1.00 (20% a 100%)
  minimapSize: number; // 160 | 200 | 240
  minimapCameraFrustum: boolean;
}

export const SETTINGS_STORAGE_KEY = 'haxball_settings_v1';

export const DEFAULT_SETTINGS: AppSettings = {
  soundChat: true,
  soundPostHit: true,
  soundKick: true,
  soundGoal: true,
  soundWhistle: true,
  masterVolume: 0.5,
  isMuted: false,

  cameraZoom: 1.0,
  chatBgOpacity: 0.85,
  ballTrailEnabled: true,
  playerGlowEnabled: true,
  netDeformationEnabled: true,
  offscreenIndicatorsEnabled: true,
  goalShakeEnabled: true,

  minimapEnabled: true,
  minimapOpacity: 0.6,
  minimapSize: 200,
  minimapCameraFrustum: true
};

export class SettingsModal {
  private modalEl: HTMLElement | null = null;
  private closeBtn: HTMLElement | null = null;
  private saveBtn: HTMLElement | null = null;
  private resetBtn: HTMLElement | null = null;
  private listContainer: HTMLElement | null = null;

  public inputManager: InputManager;
  public audioManager?: AudioManager | undefined;
  public canvasRenderer?: CanvasRenderer | undefined;

  public settings: AppSettings;
  private activeTab: 'controls' | 'sounds' | 'video' = 'controls';

  private recordingAction: keyof KeyBinds | null = null;
  private recordingBtn: HTMLButtonElement | null = null;
  private keydownListener: (e: KeyboardEvent) => void;

  constructor(
    inputManager: InputManager,
    audioManager?: AudioManager | undefined,
    canvasRenderer?: CanvasRenderer | undefined
  ) {
    this.inputManager = inputManager;
    this.audioManager = audioManager;
    this.canvasRenderer = canvasRenderer;

    this.settings = this.loadSettings();

    if (typeof document !== 'undefined') {
      this.modalEl = document.getElementById('settingsModal');
      if (this.modalEl) {
        this.modalEl.classList.add('modal-backdrop', 'modal-overlay');
        const content = this.modalEl.querySelector('.modal-content') as HTMLElement | null;
        if (content) {
          content.classList.add('settings-modal', 'modal-container');
          content.style.maxHeight = 'calc(100vh - var(--chat-height, 180px) - 90px)';
          content.style.overflowY = 'auto';
          content.style.boxSizing = 'border-box';
        }
      }
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('chat:resize', (e: Event) => {
        const customEvent = e as CustomEvent<{ height: number }>;
        const h = customEvent?.detail?.height ?? 180;
        const content = this.modalEl?.querySelector('.settings-modal, .modal-content') as HTMLElement | null;
        if (content) {
          content.style.maxHeight = `calc(100vh - ${h}px - 90px)`;
        }
      });
    }

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
  }

  public setAudioManager(audioManager: AudioManager): void {
    this.audioManager = audioManager;
    this.applySettings();
  }

  public setCanvasRenderer(canvasRenderer: CanvasRenderer): void {
    this.canvasRenderer = canvasRenderer;
    this.applySettings();
  }

  private loadSettings(): AppSettings {
    if (typeof localStorage === 'undefined') return { ...DEFAULT_SETTINGS };
    try {
      let data = localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (!data) {
        data = localStorage.getItem('haxball_settings');
      }
      if (data) {
        return { ...DEFAULT_SETTINGS, ...JSON.parse(data) };
      }
    } catch {
      // Fallback
    }
    return { ...DEFAULT_SETTINGS };
  }

  public saveSettings(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(this.settings));
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

    // 3. Chat Opacity CSS Variable
    if (typeof document !== 'undefined') {
      document.documentElement.style.setProperty('--chat-bg-opacity', this.settings.chatBgOpacity.toString());
    }
  }

  private buildModalDOM(): void {
    if (!this.modalEl) return;

    let content = this.modalEl.querySelector('.modal-content') as HTMLElement | null;
    if (!content) {
      content = document.createElement('div');
      content.className = 'modal-content custom-scrollbar';
      this.modalEl.appendChild(content);
    }

    content.style.maxWidth = '520px';
    content.style.width = '95vw';

    content.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
        <h2 class="modal-title" style="margin: 0; font-size: 1.25rem; font-weight: 800; display: flex; align-items: center; gap: 8px;">
          <span>⚙️</span> Ajustes Generales
        </h2>
        <button id="btnCloseSettings" class="icon-btn-close">✕</button>
      </div>

      <!-- Tab Selector -->
      <div class="settings-tabs-bar" style="display: flex; gap: 6px; margin-bottom: 14px; border-bottom: 1.5px solid rgba(14, 165, 233, 0.2); padding-bottom: 8px;">
        <button id="tabBtnControls" class="btn btn-tab active" style="flex: 1; padding: 6px 10px; font-size: 0.82rem; font-weight: 700; border-radius: 8px; cursor: pointer;">
          🎮 Controles
        </button>
        <button id="tabBtnSounds" class="btn btn-tab" style="flex: 1; padding: 6px 10px; font-size: 0.82rem; font-weight: 700; border-radius: 8px; cursor: pointer;">
          🔊 Sonidos
        </button>
        <button id="tabBtnVideo" class="btn btn-tab" style="flex: 1; padding: 6px 10px; font-size: 0.82rem; font-weight: 700; border-radius: 8px; cursor: pointer;">
          🖥️ Video
        </button>
      </div>

      <!-- Tab 1: Controles -->
      <div id="tabPanelControls" class="settings-panel" style="display: flex; flex-direction: column; gap: 10px;">
        <p class="keybinds-instructions" style="font-size: 0.8rem; color: var(--text-secondary); margin: 0;">Haz clic en el botón de una acción y presiona la tecla que desees asignar.</p>
        <div id="keybindsList" class="keybinds-grid" style="max-height: 260px; overflow-y: auto; display: flex; flex-direction: column; gap: 6px;"></div>
      </div>

      <!-- Tab 2: Sonidos -->
      <div id="tabPanelSounds" class="settings-panel" style="display: none; flex-direction: column; gap: 12px;">
        <div style="display: flex; flex-direction: column; gap: 8px;">
          <label style="display: flex; justify-content: space-between; align-items: center; font-size: 0.85rem; font-weight: 600;">
            <span>💬 Sonidos de Chat</span>
            <input type="checkbox" id="chkSoundChat" class="settings-toggle" style="width: 18px; height: 18px; cursor: pointer;" />
          </label>
          <label style="display: flex; justify-content: space-between; align-items: center; font-size: 0.85rem; font-weight: 600;">
            <span>🥅 Impacto en Postes y Palos</span>
            <input type="checkbox" id="chkSoundPostHit" class="settings-toggle" style="width: 18px; height: 18px; cursor: pointer;" />
          </label>
          <label style="display: flex; justify-content: space-between; align-items: center; font-size: 0.85rem; font-weight: 600;">
            <span>⚽ Golpeo / Patada al Balón</span>
            <input type="checkbox" id="chkSoundKick" class="settings-toggle" style="width: 18px; height: 18px; cursor: pointer;" />
          </label>
          <label style="display: flex; justify-content: space-between; align-items: center; font-size: 0.85rem; font-weight: 600;">
            <span>🎉 Gol y Celebración</span>
            <input type="checkbox" id="chkSoundGoal" class="settings-toggle" style="width: 18px; height: 18px; cursor: pointer;" />
          </label>
          <label style="display: flex; justify-content: space-between; align-items: center; font-size: 0.85rem; font-weight: 600;">
            <span>📢 Silbato de Árbitro</span>
            <input type="checkbox" id="chkSoundWhistle" class="settings-toggle" style="width: 18px; height: 18px; cursor: pointer;" />
          </label>
          <label style="display: flex; justify-content: space-between; align-items: center; font-size: 0.85rem; font-weight: 600; border-top: 1px solid rgba(14, 165, 233, 0.15); padding-top: 6px;">
            <span>🔇 Silenciar Todo (Mute)</span>
            <input type="checkbox" id="chkSoundMuted" class="settings-toggle" style="width: 18px; height: 18px; cursor: pointer;" />
          </label>
          <div style="display: flex; flex-direction: column; gap: 4px; margin-top: 4px;">
            <div style="display: flex; justify-content: space-between; font-size: 0.82rem; font-weight: 700;">
              <span>Volumen Maestro</span>
              <span id="txtMasterVolume">50%</span>
            </div>
            <input type="range" id="rngMasterVolume" min="0" max="1" step="0.05" style="width: 100%; cursor: pointer;" />
          </div>
        </div>
      </div>

      <!-- Tab 3: Video -->
      <div id="tabPanelVideo" class="settings-panel" style="display: none; flex-direction: column; gap: 12px;">
        <div style="display: flex; flex-direction: column; gap: 8px;">
          <!-- Camera Zoom Slider -->
          <div style="display: flex; flex-direction: column; gap: 4px;">
            <div style="display: flex; justify-content: space-between; font-size: 0.82rem; font-weight: 700;">
              <span>🔍 Zoom de la Cámara</span>
              <span id="txtCameraZoom">1.00x</span>
            </div>
            <input type="range" id="rngCameraZoom" min="0.75" max="1.50" step="0.05" style="width: 100%; cursor: pointer;" />
            <span style="font-size: 0.72rem; color: var(--text-secondary);">Alejar (0.75x) / Acercar (1.50x)</span>
          </div>

          <!-- Chat Opacity Slider -->
          <div style="display: flex; flex-direction: column; gap: 4px; border-top: 1px solid rgba(14, 165, 233, 0.15); padding-top: 6px;">
            <div style="display: flex; justify-content: space-between; font-size: 0.82rem; font-weight: 700;">
              <span>💬 Opacidad del Fondo del Chat</span>
              <span id="txtChatOpacity">85%</span>
            </div>
            <input type="range" id="rngChatOpacity" min="0.10" max="1.00" step="0.05" style="width: 100%; cursor: pointer;" />
            <span style="font-size: 0.72rem; color: var(--text-secondary);">Translúcido (10%) a Opaco (100%)</span>
          </div>

          <!-- Visual Effect Toggles -->
          <div style="display: flex; flex-direction: column; gap: 6px; border-top: 1px solid rgba(14, 165, 233, 0.15); padding-top: 6px;">
            <div style="font-size: 0.82rem; font-weight: 700; margin-bottom: 2px;">Efectos Visuales</div>
            <label style="display: flex; justify-content: space-between; align-items: center; font-size: 0.82rem; font-weight: 600;">
              <span>🌀 Estela de Balón con Giro (Magnus)</span>
              <input type="checkbox" id="chkBallTrail" class="settings-toggle" style="width: 18px; height: 18px; cursor: pointer;" />
            </label>
            <label style="display: flex; justify-content: space-between; align-items: center; font-size: 0.82rem; font-weight: 600;">
              <span>✨ Resplandor / Aura de Jugadores</span>
              <input type="checkbox" id="chkPlayerGlow" class="settings-toggle" style="width: 18px; height: 18px; cursor: pointer;" />
            </label>
            <label style="display: flex; justify-content: space-between; align-items: center; font-size: 0.82rem; font-weight: 600;">
              <span>🥅 Deformación Física de Redes</span>
              <input type="checkbox" id="chkNetDeformation" class="settings-toggle" style="width: 18px; height: 18px; cursor: pointer;" />
            </label>
            <label style="display: flex; justify-content: space-between; align-items: center; font-size: 0.82rem; font-weight: 600;">
              <span>🧭 Indicadores Fuera de Pantalla</span>
              <input type="checkbox" id="chkOffscreenIndicators" class="settings-toggle" style="width: 18px; height: 18px; cursor: pointer;" />
            </label>
            <label style="display: flex; justify-content: space-between; align-items: center; font-size: 0.82rem; font-weight: 600;">
              <span>💥 Sacudida de Pantalla en Gol / Postes</span>
              <input type="checkbox" id="chkGoalShake" class="settings-toggle" style="width: 18px; height: 18px; cursor: pointer;" />
            </label>
          </div>

          <!-- Minimapa / Radar Section -->
          <div style="display: flex; flex-direction: column; gap: 6px; border-top: 1px solid rgba(14, 165, 233, 0.15); padding-top: 6px;">
            <div style="font-size: 0.82rem; font-weight: 700; margin-bottom: 2px; display: flex; align-items: center; gap: 6px;">
              <span>🗺️</span> Minimapa / Radar
            </div>
            <label style="display: flex; justify-content: space-between; align-items: center; font-size: 0.82rem; font-weight: 600;">
              <span>Activar Minimapa</span>
              <input type="checkbox" id="chkMinimapEnabled" class="settings-toggle" style="width: 18px; height: 18px; cursor: pointer;" />
            </label>
            <div style="display: flex; flex-direction: column; gap: 4px;">
              <div style="display: flex; justify-content: space-between; font-size: 0.82rem; font-weight: 700;">
                <span>Opacidad del Minimapa</span>
                <span id="txtMinimapOpacity">60%</span>
              </div>
              <input type="range" id="rngMinimapOpacity" min="0.20" max="1.00" step="0.05" style="width: 100%; cursor: pointer;" />
              <span style="font-size: 0.72rem; color: var(--text-secondary);">Translúcido (20%) a Opaco (100%)</span>
            </div>
            <div style="display: flex; flex-direction: column; gap: 4px;">
              <div style="display: flex; justify-content: space-between; font-size: 0.82rem; font-weight: 700;">
                <span>Tamaño del Minimapa</span>
                <span id="txtMinimapSize">Mediano (200px)</span>
              </div>
              <select id="selMinimapSize" class="settings-select" style="padding: 6px 10px; font-size: 0.82rem; border-radius: 8px; background: rgba(15, 23, 42, 0.85); color: #fff; border: 1.5px solid rgba(14, 165, 233, 0.3); cursor: pointer;">
                <option value="160">Pequeño (160px)</option>
                <option value="200">Mediano (200px)</option>
                <option value="240">Grande (240px)</option>
              </select>
            </div>
            <label style="display: flex; justify-content: space-between; align-items: center; font-size: 0.82rem; font-weight: 600;">
              <span>Mostrar visión de cámara</span>
              <input type="checkbox" id="chkMinimapCameraFrustum" class="settings-toggle" style="width: 18px; height: 18px; cursor: pointer;" />
            </label>
          </div>
        </div>
      </div>

      <div style="display: flex; justify-content: space-between; gap: 8px; margin-top: 14px; border-top: 1px solid rgba(14, 165, 233, 0.15); padding-top: 10px;">
        <button id="btnResetKeybinds" class="btn btn-secondary" style="flex: 1;">Restablecer Predeterminado</button>
        <button id="btnSaveKeybinds" class="btn btn-primary" style="flex: 1;">Listo</button>
      </div>
    `;

    this.closeBtn = document.getElementById('btnCloseSettings');
    this.saveBtn = document.getElementById('btnSaveKeybinds');
    this.resetBtn = document.getElementById('btnResetKeybinds');
    this.listContainer = document.getElementById('keybindsList');

    this.setupListeners();
  }

  private setupListeners(): void {
    this.closeBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.close();
    });

    this.saveBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.saveSettings();
      this.close();
    });

    this.resetBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.activeTab === 'controls') {
        this.inputManager.resetToDefaultKeyBinds();
        this.renderKeybinds();
      } else {
        this.settings = { ...DEFAULT_SETTINGS };
        this.saveSettings();
        this.syncInputsWithSettings();
      }
    });

    // Tab buttons
    const tabControls = document.getElementById('tabBtnControls');
    const tabSounds = document.getElementById('tabBtnSounds');
    const tabVideo = document.getElementById('tabBtnVideo');

    tabControls?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.switchTab('controls');
    });
    tabSounds?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.switchTab('sounds');
    });
    tabVideo?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.switchTab('video');
    });

    // Sound inputs
    const chkSoundChat = document.getElementById('chkSoundChat') as HTMLInputElement | null;
    const chkSoundPostHit = document.getElementById('chkSoundPostHit') as HTMLInputElement | null;
    const chkSoundKick = document.getElementById('chkSoundKick') as HTMLInputElement | null;
    const chkSoundGoal = document.getElementById('chkSoundGoal') as HTMLInputElement | null;
    const chkSoundWhistle = document.getElementById('chkSoundWhistle') as HTMLInputElement | null;
    const chkSoundMuted = document.getElementById('chkSoundMuted') as HTMLInputElement | null;
    const rngMasterVolume = document.getElementById('rngMasterVolume') as HTMLInputElement | null;
    const txtMasterVolume = document.getElementById('txtMasterVolume');

    chkSoundChat?.addEventListener('change', () => {
      this.settings.soundChat = chkSoundChat.checked;
      this.saveSettings();
    });
    chkSoundPostHit?.addEventListener('change', () => {
      this.settings.soundPostHit = chkSoundPostHit.checked;
      this.saveSettings();
    });
    chkSoundKick?.addEventListener('change', () => {
      this.settings.soundKick = chkSoundKick.checked;
      this.saveSettings();
    });
    chkSoundGoal?.addEventListener('change', () => {
      this.settings.soundGoal = chkSoundGoal.checked;
      this.saveSettings();
    });
    chkSoundWhistle?.addEventListener('change', () => {
      this.settings.soundWhistle = chkSoundWhistle.checked;
      this.saveSettings();
    });
    chkSoundMuted?.addEventListener('change', () => {
      this.settings.isMuted = chkSoundMuted.checked;
      this.saveSettings();
    });
    rngMasterVolume?.addEventListener('input', () => {
      const val = parseFloat(rngMasterVolume.value);
      this.settings.masterVolume = val;
      if (txtMasterVolume) txtMasterVolume.textContent = `${Math.round(val * 100)}%`;
      this.saveSettings();
    });

    // Video inputs
    const rngCameraZoom = document.getElementById('rngCameraZoom') as HTMLInputElement | null;
    const txtCameraZoom = document.getElementById('txtCameraZoom');
    const rngChatOpacity = document.getElementById('rngChatOpacity') as HTMLInputElement | null;
    const txtChatOpacity = document.getElementById('txtChatOpacity');
    const chkBallTrail = document.getElementById('chkBallTrail') as HTMLInputElement | null;
    const chkPlayerGlow = document.getElementById('chkPlayerGlow') as HTMLInputElement | null;
    const chkNetDeformation = document.getElementById('chkNetDeformation') as HTMLInputElement | null;
    const chkOffscreenIndicators = document.getElementById('chkOffscreenIndicators') as HTMLInputElement | null;
    const chkGoalShake = document.getElementById('chkGoalShake') as HTMLInputElement | null;

    rngCameraZoom?.addEventListener('input', () => {
      const val = parseFloat(rngCameraZoom.value);
      this.settings.cameraZoom = val;
      if (txtCameraZoom) txtCameraZoom.textContent = `${val.toFixed(2)}x`;
      this.saveSettings();
    });

    rngChatOpacity?.addEventListener('input', () => {
      const val = parseFloat(rngChatOpacity.value);
      this.settings.chatBgOpacity = val;
      if (txtChatOpacity) txtChatOpacity.textContent = `${Math.round(val * 100)}%`;
      this.saveSettings();
    });

    chkBallTrail?.addEventListener('change', () => {
      this.settings.ballTrailEnabled = chkBallTrail.checked;
      this.saveSettings();
    });
    chkPlayerGlow?.addEventListener('change', () => {
      this.settings.playerGlowEnabled = chkPlayerGlow.checked;
      this.saveSettings();
    });
    chkNetDeformation?.addEventListener('change', () => {
      this.settings.netDeformationEnabled = chkNetDeformation.checked;
      this.saveSettings();
    });
    chkOffscreenIndicators?.addEventListener('change', () => {
      this.settings.offscreenIndicatorsEnabled = chkOffscreenIndicators.checked;
      this.saveSettings();
    });
    chkGoalShake?.addEventListener('change', () => {
      this.settings.goalShakeEnabled = chkGoalShake.checked;
      this.saveSettings();
    });

    // Minimap inputs
    const chkMinimapEnabled = document.getElementById('chkMinimapEnabled') as HTMLInputElement | null;
    const rngMinimapOpacity = document.getElementById('rngMinimapOpacity') as HTMLInputElement | null;
    const txtMinimapOpacity = document.getElementById('txtMinimapOpacity');
    const selMinimapSize = document.getElementById('selMinimapSize') as HTMLSelectElement | null;
    const txtMinimapSize = document.getElementById('txtMinimapSize');
    const chkMinimapCameraFrustum = document.getElementById('chkMinimapCameraFrustum') as HTMLInputElement | null;

    chkMinimapEnabled?.addEventListener('change', () => {
      this.settings.minimapEnabled = chkMinimapEnabled.checked;
      this.saveSettings();
    });

    rngMinimapOpacity?.addEventListener('input', () => {
      const val = parseFloat(rngMinimapOpacity.value);
      this.settings.minimapOpacity = val;
      if (txtMinimapOpacity) txtMinimapOpacity.textContent = `${Math.round(val * 100)}%`;
      this.saveSettings();
    });

    selMinimapSize?.addEventListener('change', () => {
      const val = parseInt(selMinimapSize.value, 10) || 200;
      this.settings.minimapSize = val;
      const sizeLabel = val === 160 ? 'Pequeño (160px)' : (val === 240 ? 'Grande (240px)' : 'Mediano (200px)');
      if (txtMinimapSize) txtMinimapSize.textContent = sizeLabel;
      this.saveSettings();
    });

    chkMinimapCameraFrustum?.addEventListener('change', () => {
      this.settings.minimapCameraFrustum = chkMinimapCameraFrustum.checked;
      this.saveSettings();
    });
  }

  public switchTab(tab: 'controls' | 'sounds' | 'video'): void {
    this.activeTab = tab;

    const pControls = document.getElementById('tabPanelControls');
    const pSounds = document.getElementById('tabPanelSounds');
    const pVideo = document.getElementById('tabPanelVideo');

    const bControls = document.getElementById('tabBtnControls');
    const bSounds = document.getElementById('tabBtnSounds');
    const bVideo = document.getElementById('tabBtnVideo');

    if (pControls) pControls.style.display = tab === 'controls' ? 'flex' : 'none';
    if (pSounds) pSounds.style.display = tab === 'sounds' ? 'flex' : 'none';
    if (pVideo) pVideo.style.display = tab === 'video' ? 'flex' : 'none';

    bControls?.classList.toggle('active', tab === 'controls');
    bSounds?.classList.toggle('active', tab === 'sounds');
    bVideo?.classList.toggle('active', tab === 'video');

    if (tab === 'controls') {
      this.renderKeybinds();
    } else {
      this.syncInputsWithSettings();
    }
  }

  private syncInputsWithSettings(): void {
    const chkSoundChat = document.getElementById('chkSoundChat') as HTMLInputElement | null;
    const chkSoundPostHit = document.getElementById('chkSoundPostHit') as HTMLInputElement | null;
    const chkSoundKick = document.getElementById('chkSoundKick') as HTMLInputElement | null;
    const chkSoundGoal = document.getElementById('chkSoundGoal') as HTMLInputElement | null;
    const chkSoundWhistle = document.getElementById('chkSoundWhistle') as HTMLInputElement | null;
    const chkSoundMuted = document.getElementById('chkSoundMuted') as HTMLInputElement | null;
    const rngMasterVolume = document.getElementById('rngMasterVolume') as HTMLInputElement | null;
    const txtMasterVolume = document.getElementById('txtMasterVolume');

    if (chkSoundChat) chkSoundChat.checked = this.settings.soundChat;
    if (chkSoundPostHit) chkSoundPostHit.checked = this.settings.soundPostHit;
    if (chkSoundKick) chkSoundKick.checked = this.settings.soundKick;
    if (chkSoundGoal) chkSoundGoal.checked = this.settings.soundGoal;
    if (chkSoundWhistle) chkSoundWhistle.checked = this.settings.soundWhistle;
    if (chkSoundMuted) chkSoundMuted.checked = this.settings.isMuted;
    if (rngMasterVolume) rngMasterVolume.value = this.settings.masterVolume.toString();
    if (txtMasterVolume) txtMasterVolume.textContent = `${Math.round(this.settings.masterVolume * 100)}%`;

    const rngCameraZoom = document.getElementById('rngCameraZoom') as HTMLInputElement | null;
    const txtCameraZoom = document.getElementById('txtCameraZoom');
    const rngChatOpacity = document.getElementById('rngChatOpacity') as HTMLInputElement | null;
    const txtChatOpacity = document.getElementById('txtChatOpacity');
    const chkBallTrail = document.getElementById('chkBallTrail') as HTMLInputElement | null;
    const chkPlayerGlow = document.getElementById('chkPlayerGlow') as HTMLInputElement | null;
    const chkNetDeformation = document.getElementById('chkNetDeformation') as HTMLInputElement | null;
    const chkOffscreenIndicators = document.getElementById('chkOffscreenIndicators') as HTMLInputElement | null;
    const chkGoalShake = document.getElementById('chkGoalShake') as HTMLInputElement | null;

    if (rngCameraZoom) rngCameraZoom.value = this.settings.cameraZoom.toString();
    if (txtCameraZoom) txtCameraZoom.textContent = `${this.settings.cameraZoom.toFixed(2)}x`;
    if (rngChatOpacity) rngChatOpacity.value = this.settings.chatBgOpacity.toString();
    if (txtChatOpacity) txtChatOpacity.textContent = `${Math.round(this.settings.chatBgOpacity * 100)}%`;

    if (chkBallTrail) chkBallTrail.checked = this.settings.ballTrailEnabled;
    if (chkPlayerGlow) chkPlayerGlow.checked = this.settings.playerGlowEnabled;
    if (chkNetDeformation) chkNetDeformation.checked = this.settings.netDeformationEnabled;
    if (chkOffscreenIndicators) chkOffscreenIndicators.checked = this.settings.offscreenIndicatorsEnabled;
    if (chkGoalShake) chkGoalShake.checked = this.settings.goalShakeEnabled;

    // Minimap
    const chkMinimapEnabled = document.getElementById('chkMinimapEnabled') as HTMLInputElement | null;
    const rngMinimapOpacity = document.getElementById('rngMinimapOpacity') as HTMLInputElement | null;
    const txtMinimapOpacity = document.getElementById('txtMinimapOpacity');
    const selMinimapSize = document.getElementById('selMinimapSize') as HTMLSelectElement | null;
    const txtMinimapSize = document.getElementById('txtMinimapSize');
    const chkMinimapCameraFrustum = document.getElementById('chkMinimapCameraFrustum') as HTMLInputElement | null;

    if (chkMinimapEnabled) chkMinimapEnabled.checked = this.settings.minimapEnabled;
    if (rngMinimapOpacity) rngMinimapOpacity.value = this.settings.minimapOpacity.toString();
    if (txtMinimapOpacity) txtMinimapOpacity.textContent = `${Math.round(this.settings.minimapOpacity * 100)}%`;
    if (selMinimapSize) selMinimapSize.value = this.settings.minimapSize.toString();
    if (txtMinimapSize) {
      const sizeVal = this.settings.minimapSize;
      txtMinimapSize.textContent = sizeVal === 160 ? 'Pequeño (160px)' : (sizeVal === 240 ? 'Grande (240px)' : 'Mediano (200px)');
    }
    if (chkMinimapCameraFrustum) chkMinimapCameraFrustum.checked = this.settings.minimapCameraFrustum;
  }

  public renderKeybinds(): void {
    if (!this.listContainer) {
      this.listContainer = document.getElementById('keybindsList');
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
      row.style.padding = '4px 8px';
      row.style.background = 'rgba(240, 249, 255, 0.6)';
      row.style.borderRadius = '6px';
      row.style.border = '1px solid rgba(14, 165, 233, 0.15)';

      const labelEl = document.createElement('span');
      labelEl.className = 'keybind-label';
      labelEl.style.fontSize = '0.82rem';
      labelEl.style.fontWeight = '600';
      labelEl.textContent = label;

      const btn = document.createElement('button');
      btn.className = 'keybind-btn btn btn-secondary';
      btn.style.fontSize = '0.78rem';
      btn.style.padding = '3px 8px';
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
    this.render();
    if (this.modalEl) {
      this.modalEl.classList.remove('u-hidden');
      this.modalEl.classList.remove('ui-screen-hidden');
      this.modalEl.style.display = 'flex';
      this.modalEl.style.zIndex = '10001';
      this.modalEl.style.pointerEvents = 'auto';
    }
  }

  public close(): void {
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
  }
}

/**
 * Wrapper de compatibilidad hacia atrás para tests o código legado
 */
export class KeybindModal extends SettingsModal {
  constructor(inputManager: InputManager) {
    super(inputManager);
  }
}
