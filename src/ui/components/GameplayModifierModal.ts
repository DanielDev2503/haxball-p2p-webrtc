import {
  GameplayConfig,
  GAMEPLAY_CONFIG_LIMITS,
  DEFAULT_GAMEPLAY_CONFIG,
  sanitizeGameplayConfig
} from '../../core/game/GameConfig';
import { toggleTheme } from '../stores/gameStore';

type NumericConfigKey = keyof typeof GAMEPLAY_CONFIG_LIMITS;

export class GameplayModifierModal {
  public modalEl: HTMLElement | null = null;
  public cardEl: HTMLElement | null = null;
  public backBtn: HTMLButtonElement | null = null;
  public themeBtn: HTMLButtonElement | null = null;
  public applyBtn: HTMLButtonElement | null = null;
  public resetBtn: HTMLButtonElement | null = null;

  public activeCategory: 'player' | 'ball' | 'mechanics' = 'player';
  private currentConfig: GameplayConfig;
  private onChangeCallback: (config: GameplayConfig) => void;
  private isHostCheck: () => boolean;
  private isMatchInProgressCheck: () => boolean;

  private valueDisplays: Map<NumericConfigKey, HTMLElement> = new Map();
  private sliderInputs: Map<NumericConfigKey, HTMLInputElement> = new Map();
  private toggleInputs: Map<'turboEnabled' | 'dashEnabled' | 'magnusEnabled', HTMLInputElement> = new Map();

  constructor(
    initialConfig: GameplayConfig,
    onChange: (config: GameplayConfig) => void,
    isHost: () => boolean,
    isMatchInProgress: () => boolean = () => false
  ) {
    this.currentConfig = { ...initialConfig };
    this.onChangeCallback = onChange;
    this.isHostCheck = isHost;
    this.isMatchInProgressCheck = isMatchInProgress;
    this.buildDOM();
  }

  private buildDOM(): void {
    if (typeof document === 'undefined') return;

    let overlay = document.getElementById('gameplay-modifiers-modal');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'gameplay-modifiers-modal';
      overlay.className = 'ingame-menu-overlay modal-overlay modal-backdrop modifier-modal-overlay hidden';
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
      <button class="modal-nav-back-btn" id="btnModifiersBack" type="button" title="Volver">
        &lt; Volver
      </button>

      <!-- Botón exterior de alternador de tema "[ ☼ / ☾ ]" (Top-Right) -->
      <button class="modal-nav-theme-btn" id="btnModifiersThemeToggle" type="button" title="Alternar Modo Claro / Oscuro">
        ☼ / ☾
      </button>

      <!-- Chasis Central de 2 Columnas -->
      <div id="modifierModalCard" class="modifier-modal-card">
        <!-- Sidebar Vertical Izquierdo (230px) -->
        <aside class="modal-sidebar-left" style="width: 230px;">
          <div style="padding: 0 18px 14px 18px; border-bottom: 1px solid rgba(0, 229, 255, 0.2);">
            <h2 style="margin: 0; font-size: 14px; font-weight: 800; color: var(--neon-cyan); letter-spacing: 0.5px; display: flex; align-items: center; gap: 8px;">
              <span>MODIFICADORES</span> <span>⚡</span>
            </h2>
          </div>

          <nav style="display: flex; flex-direction: column; gap: 4px; margin-top: 12px; flex: 1;">
            <button class="modal-sidebar-nav-btn active" data-cat="player" type="button">
              <span>🏃</span> <span>Físicas de Jugador</span>
            </button>
            <button class="modal-sidebar-nav-btn" data-cat="ball" type="button">
              <span>⚽</span> <span>Físicas de Balón</span>
            </button>
            <button class="modal-sidebar-nav-btn" data-cat="mechanics" type="button">
              <span>⚡</span> <span>Mecánicas y Habilidades</span>
            </button>
          </nav>

          <div style="padding: 12px 16px; border-top: 1px solid rgba(0, 229, 255, 0.15); margin-top: auto;">
            <button id="btn-reset-physics-defaults" class="btn btn-secondary btn-xs" style="width: 100%; font-size: 11px; padding: 6px;" type="button">
              Restablecer Valores por Defecto
            </button>
          </div>
        </aside>

        <!-- Panel Derecho de Controles -->
        <main class="modifier-content-right cyber-scrollbar" style="flex: 1; overflow-y: auto !important; max-height: 100%; padding: 22px 26px; box-sizing: border-box; display: flex; flex-direction: column;">
          
          <!-- Categoría 1: Físicas de Jugador (7 Controles) -->
          <div id="catPanelPlayer" class="cat-panel active" style="display: flex; flex-direction: column; gap: 14px;">
            <div style="border-bottom: 1px solid rgba(0, 229, 255, 0.15); padding-bottom: 8px;">
              <h3 style="margin: 0; font-size: 15px; font-weight: 700; color: #fff;">Físicas y Dinámica de Jugador</h3>
              <span style="font-size: 11px; color: var(--text-secondary);">Ajusta la velocidad, aceleración, dimensiones y respuesta del disco</span>
            </div>

            <div style="display: flex; flex-direction: column; gap: 10px;" id="playerControlsContainer"></div>
          </div>

          <!-- Categoría 2: Físicas de Balón (4 Controles) -->
          <div id="catPanelBall" class="cat-panel" style="display: none; flex-direction: column; gap: 14px;">
            <div style="border-bottom: 1px solid rgba(0, 229, 255, 0.15); padding-bottom: 8px;">
              <h3 style="margin: 0; font-size: 15px; font-weight: 700; color: #fff;">Físicas y Comportamiento del Balón</h3>
              <span style="font-size: 11px; color: var(--text-secondary);">Geometría, masa, restitución elástica y fricción de rodamiento</span>
            </div>

            <div style="display: flex; flex-direction: column; gap: 10px;" id="ballControlsContainer"></div>
          </div>

          <!-- Categoría 3: Mecánicas y Habilidades (8 Controles) -->
          <div id="catPanelMechanics" class="cat-panel" style="display: none; flex-direction: column; gap: 14px;">
            <div style="border-bottom: 1px solid rgba(0, 229, 255, 0.15); padding-bottom: 8px;">
              <h3 style="margin: 0; font-size: 15px; font-weight: 700; color: #fff;">Mecánicas Especiales y Habilidades</h3>
              <span style="font-size: 11px; color: var(--text-secondary);">Turbo, Dash, Efecto Magnus y gestión de estamina</span>
            </div>

            <!-- Toggles de Mecánicas -->
            <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(0, 229, 255, 0.2); border-radius: 8px; padding: 12px;">
              <label style="display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 700; cursor: pointer;">
                <input type="checkbox" id="chkToggleDash" ${this.currentConfig.dashEnabled !== false ? 'checked' : ''} style="width: 16px; height: 16px; accent-color: var(--neon-cyan);" />
                <span>💨 Habilitar Dash</span>
              </label>
              <label style="display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 700; cursor: pointer;">
                <input type="checkbox" id="chkToggleTurbo" ${this.currentConfig.turboEnabled !== false ? 'checked' : ''} style="width: 16px; height: 16px; accent-color: var(--neon-cyan);" />
                <span>⚡ Habilitar Turbo</span>
              </label>
              <label style="display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 700; cursor: pointer;">
                <input type="checkbox" id="chkToggleMagnus" ${this.currentConfig.magnusEnabled !== false ? 'checked' : ''} style="width: 16px; height: 16px; accent-color: var(--neon-cyan);" />
                <span>🌀 Efecto Magnus</span>
              </label>
            </div>

            <div style="display: flex; flex-direction: column; gap: 10px;" id="mechanicsControlsContainer"></div>
          </div>

          <!-- Pie del Panel de Modificadores (CTA de Sincronización) -->
          <div style="margin-top: auto; padding-top: 14px; border-top: 1px solid rgba(0, 229, 255, 0.2);">
            <button id="btnApplyModifiers" class="btn-cta-green" style="width: 100%; height: 44px;" type="button">
              <span>⚡</span> <span>APLICAR Y SINCRONIZAR MODIFICADORES</span>
            </button>
          </div>

        </main>
      </div>
    `;

    this.cardEl = overlay.querySelector('.modifier-modal-card');
    this.backBtn = overlay.querySelector('#btnModifiersBack');
    this.themeBtn = overlay.querySelector('#btnModifiersThemeToggle');
    this.applyBtn = overlay.querySelector('#btnApplyModifiers');
    this.resetBtn = overlay.querySelector('#btn-reset-physics-defaults');

    this.buildControls();
    this.setupListeners();
  }

  private buildControls(): void {
    if (!this.modalEl) return;

    const playerContainer = this.modalEl.querySelector('#playerControlsContainer');
    const ballContainer = this.modalEl.querySelector('#ballControlsContainer');
    const mechanicsContainer = this.modalEl.querySelector('#mechanicsControlsContainer');

    // 1. Categoría Jugador: 7 controles
    const playerKeys: NumericConfigKey[] = [
      'playerMaxSpeed',
      'playerAcceleration',
      'kickStrength',
      'kickMargin',
      'playerRadius',
      'playerMass',
      'playerFriction'
    ];

    // 2. Categoría Balón: 4 controles
    const ballKeys: NumericConfigKey[] = [
      'ballRadius',
      'ballRestitution',
      'ballMass',
      'ballFriction'
    ];

    // 3. Categoría Mecánicas: 5 numéricos
    const mechanicsKeys: NumericConfigKey[] = [
      'boostMultiplier',
      'dashDistance',
      'staminaRechargeRate',
      'magnusCurveStrength',
      'dashesPerFullBar'
    ];

    const renderSliderGroup = (key: NumericConfigKey, targetEl: Element | null, isStepper: boolean = false) => {
      if (!targetEl) return;
      const meta = GAMEPLAY_CONFIG_LIMITS[key];
      const val = this.currentConfig[key];

      const wrap = document.createElement('div');
      wrap.className = 'modifier-control-row';
      wrap.style.background = 'rgba(15, 23, 42, 0.55)';
      wrap.style.border = '1px solid rgba(0, 229, 255, 0.15)';
      wrap.style.borderRadius = '8px';
      wrap.style.padding = '10px 14px';
      wrap.style.display = 'flex';
      wrap.style.flexDirection = 'column';
      wrap.style.gap = '6px';

      const headerRow = document.createElement('div');
      headerRow.style.display = 'flex';
      headerRow.style.justifyContent = 'space-between';
      headerRow.style.alignItems = 'center';

      const label = document.createElement('span');
      label.style.fontSize = '12px';
      label.style.fontWeight = '700';
      label.style.color = '#fff';
      label.textContent = meta.label;

      const badge = document.createElement('span');
      badge.style.fontSize = '12px';
      badge.style.fontWeight = '800';
      badge.style.color = 'var(--neon-cyan)';
      badge.textContent = `${val}${meta.unit ? ' ' + meta.unit : ''}`;
      this.valueDisplays.set(key, badge);

      headerRow.appendChild(label);
      headerRow.appendChild(badge);
      wrap.appendChild(headerRow);

      if (isStepper) {
        // Stepper [-] val [+]
        const stepperRow = document.createElement('div');
        stepperRow.style.display = 'flex';
        stepperRow.style.alignItems = 'center';
        stepperRow.style.gap = '10px';

        const decBtn = document.createElement('button');
        decBtn.type = 'button';
        decBtn.className = 'btn btn-secondary btn-xs';
        decBtn.textContent = '-';
        decBtn.style.width = '28px';
        decBtn.style.height = '28px';

        const incBtn = document.createElement('button');
        incBtn.type = 'button';
        incBtn.className = 'btn btn-secondary btn-xs';
        incBtn.textContent = '+';
        incBtn.style.width = '28px';
        incBtn.style.height = '28px';

        const slider = document.createElement('input');
        slider.type = 'range';
        slider.min = meta.min.toString();
        slider.max = meta.max.toString();
        slider.step = meta.step.toString();
        slider.value = val.toString();
        slider.style.flex = '1';
        this.sliderInputs.set(key, slider);

        slider.addEventListener('input', () => {
          const num = parseFloat(slider.value);
          this.currentConfig[key] = num;
          badge.textContent = `${num}${meta.unit ? ' ' + meta.unit : ''}`;
        });

        decBtn.addEventListener('click', () => {
          const num = Math.max(meta.min, Math.round((this.currentConfig[key] - meta.step) * 100) / 100);
          this.currentConfig[key] = num;
          slider.value = num.toString();
          badge.textContent = `${num}${meta.unit ? ' ' + meta.unit : ''}`;
        });

        incBtn.addEventListener('click', () => {
          const num = Math.min(meta.max, Math.round((this.currentConfig[key] + meta.step) * 100) / 100);
          this.currentConfig[key] = num;
          slider.value = num.toString();
          badge.textContent = `${num}${meta.unit ? ' ' + meta.unit : ''}`;
        });

        stepperRow.appendChild(decBtn);
        stepperRow.appendChild(slider);
        stepperRow.appendChild(incBtn);
        wrap.appendChild(stepperRow);
      } else {
        // Slider normal
        const slider = document.createElement('input');
        slider.type = 'range';
        slider.min = meta.min.toString();
        slider.max = meta.max.toString();
        slider.step = meta.step.toString();
        slider.value = val.toString();
        slider.style.width = '100%';
        this.sliderInputs.set(key, slider);

        slider.addEventListener('input', () => {
          const num = parseFloat(slider.value);
          this.currentConfig[key] = num;
          badge.textContent = `${num}${meta.unit ? ' ' + meta.unit : ''}`;
        });

        wrap.appendChild(slider);
      }

      targetEl.appendChild(wrap);
    };

    playerKeys.forEach(k => renderSliderGroup(k, playerContainer, k === 'playerRadius'));
    ballKeys.forEach(k => renderSliderGroup(k, ballContainer, k === 'ballRadius'));
    mechanicsKeys.forEach(k => renderSliderGroup(k, mechanicsContainer, k === 'dashesPerFullBar'));

    // Toggles de mecánicas
    const chkDash = this.modalEl.querySelector('#chkToggleDash') as HTMLInputElement | null;
    const chkTurbo = this.modalEl.querySelector('#chkToggleTurbo') as HTMLInputElement | null;
    const chkMagnus = this.modalEl.querySelector('#chkToggleMagnus') as HTMLInputElement | null;

    if (chkDash) {
      this.toggleInputs.set('dashEnabled', chkDash);
      chkDash.addEventListener('change', () => {
        this.currentConfig.dashEnabled = chkDash.checked;
      });
    }

    if (chkTurbo) {
      this.toggleInputs.set('turboEnabled', chkTurbo);
      chkTurbo.addEventListener('change', () => {
        this.currentConfig.turboEnabled = chkTurbo.checked;
      });
    }

    if (chkMagnus) {
      this.toggleInputs.set('magnusEnabled', chkMagnus);
      chkMagnus.addEventListener('change', () => {
        this.currentConfig.magnusEnabled = chkMagnus.checked;
      });
    }
  }

  private setupListeners(): void {
    if (!this.modalEl) return;

    // 1. Botón < Volver
    this.backBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.hide();
    });

    // 2. Botón [ ☼ / ☾ ]
    this.themeBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleTheme();
    });

    // Cerrar al click fuera
    this.modalEl.addEventListener('click', (e) => {
      if (e.target === this.modalEl) {
        this.hide();
      }
    });

    // 3. Navegación por categorías en Sidebar
    const navBtns = typeof this.modalEl.querySelectorAll === 'function' ? this.modalEl.querySelectorAll<HTMLButtonElement>('.modal-sidebar-nav-btn') : [];
    navBtns.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const cat = btn.getAttribute('data-cat') as any;
        if (cat) {
          this.switchCategory(cat);
        }
      });
    });

    // 4. Botón Restablecer valores por defecto
    this.resetBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.resetToDefaults();
    });

    // 5. Botón CTA Aplicar y Sincronizar
    this.applyBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.notifyChange();
      this.hide();
    });
  }

  public switchCategory(catName: 'player' | 'ball' | 'mechanics'): void {
    this.activeCategory = catName;
    if (!this.modalEl) return;

    // Actualizar botones de sidebar
    const navBtns = typeof this.modalEl.querySelectorAll === 'function' ? this.modalEl.querySelectorAll('.modal-sidebar-nav-btn') : [];
    navBtns.forEach((btn) => {
      const c = btn.getAttribute('data-cat');
      if (c === catName) btn.classList.add('active');
      else btn.classList.remove('active');
    });

    // Actualizar paneles
    const panels = {
      player: this.modalEl.querySelector('#catPanelPlayer') as HTMLElement | null,
      ball: this.modalEl.querySelector('#catPanelBall') as HTMLElement | null,
      mechanics: this.modalEl.querySelector('#catPanelMechanics') as HTMLElement | null
    };

    Object.entries(panels).forEach(([key, panel]) => {
      if (!panel) return;
      if (key === catName) {
        panel.style.display = 'flex';
        panel.classList.add('active');
      } else {
        panel.style.display = 'none';
        panel.classList.remove('active');
      }
    });
  }

  private notifyChange(): void {
    const sanitized = sanitizeGameplayConfig(this.currentConfig);
    this.currentConfig = sanitized;
    this.onChangeCallback(this.currentConfig);
  }

  public resetToDefaults(): void {
    this.currentConfig = { ...DEFAULT_GAMEPLAY_CONFIG };
    this.updateUI();
    this.notifyChange();
  }

  public setConfig(newConfig: Partial<GameplayConfig>): void {
    this.currentConfig = sanitizeGameplayConfig({ ...this.currentConfig, ...newConfig });
    this.updateUI();
  }

  public getConfig(): GameplayConfig {
    return { ...this.currentConfig };
  }

  public updateUI(): void {
    const isPlaying = this.isMatchInProgressCheck();
    const isHost = this.isHostCheck();
    const canEdit = isHost && !isPlaying;

    for (const [key, slider] of this.sliderInputs.entries()) {
      const val = this.currentConfig[key];
      slider.value = val.toString();
      slider.disabled = !canEdit;
      const meta = GAMEPLAY_CONFIG_LIMITS[key];
      const badge = this.valueDisplays.get(key);
      if (badge) {
        badge.textContent = `${val}${meta?.unit ? ' ' + meta.unit : ''}`;
      }
    }

    for (const [key, toggle] of this.toggleInputs.entries()) {
      toggle.checked = Boolean(this.currentConfig[key]);
      toggle.disabled = !canEdit;
    }

    if (this.resetBtn) {
      this.resetBtn.disabled = !canEdit;
    }
    if (this.applyBtn) {
      this.applyBtn.disabled = !canEdit;
    }
  }

  public updateMatchState(isMatchInProgress: boolean): void {
    const isHost = this.isHostCheck();
    const canEdit = isHost && !isMatchInProgress;
    for (const slider of this.sliderInputs.values()) {
      slider.disabled = !canEdit;
    }
    for (const toggle of this.toggleInputs.values()) {
      toggle.disabled = !canEdit;
    }
    if (this.resetBtn) {
      this.resetBtn.disabled = !canEdit;
    }
    if (this.applyBtn) {
      this.applyBtn.disabled = !canEdit;
    }
    if (isMatchInProgress && this.isOpen()) {
      this.hide();
    }
  }

  public open(): void {
    this.show();
  }

  public show(): void {
    if (!this.modalEl) return;
    if (!this.isHostCheck()) {
      alert('Solo el anfitrión (Host) tiene permisos para modificar las variables de física del motor.');
      return;
    }
    if (this.isMatchInProgressCheck()) {
      alert('Los modificadores de físicas solo se pueden ajustar antes de empezar una partida.');
      return;
    }
    this.updateUI();
    this.modalEl.classList.remove('hidden', 'u-hidden');
    this.modalEl.style.display = 'flex';
  }

  public close(): void {
    this.hide();
  }

  public hide(): void {
    if (!this.modalEl) return;
    this.modalEl.classList.add('hidden', 'u-hidden');
    this.modalEl.style.display = 'none';
  }

  public isOpen(): boolean {
    if (!this.modalEl) return false;
    return !this.modalEl.classList.contains('hidden') && this.modalEl.style.display !== 'none';
  }

  public destroy(): void {
    // Limpieza
  }
}
