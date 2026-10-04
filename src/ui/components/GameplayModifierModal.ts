import {
  GameplayConfig,
  GAMEPLAY_CONFIG_LIMITS,
  DEFAULT_GAMEPLAY_CONFIG,
  sanitizeGameplayConfig
} from '../../core/game/GameConfig';

type NumericConfigKey = keyof typeof GAMEPLAY_CONFIG_LIMITS;

export class GameplayModifierModal {
  private modalEl: HTMLElement | null = null;
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

    const overlay = document.createElement('div');
    overlay.id = 'gameplay-modifiers-modal';
    overlay.className = 'ingame-menu-overlay hidden';
    overlay.style.zIndex = '9999';

    const card = document.createElement('div');
    card.className = 'menu-modal-card custom-scrollbar max-h-[65vh] overflow-y-auto p-4 md:p-5 rounded-2xl w-full max-w-lg md:max-w-2xl';
    card.style.maxWidth = '780px';
    card.style.width = '95vw';
    card.style.maxHeight = '65vh';
    card.style.overflowY = 'auto';
    card.style.marginBottom = '80px'; // Previene colisión vertical con el chat inferior

    // Header
    const header = document.createElement('div');
    header.className = 'menu-header';
    header.innerHTML = `
      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="font-size: 1.3rem;">⚡</span>
        <h3>MODIFICADORES DE FÍSICAS (HOST)</h3>
      </div>
      <button class="icon-btn-close" id="btn-close-modifiers-modal" title="Cerrar">✕</button>
    `;

    // Content: Grid balanceado de dos columnas en desktop
    const content = document.createElement('div');
    content.className = 'modifiers-grid-container grid grid-cols-1 md:grid-cols-2 gap-4';
    content.style.marginTop = '10px';

    // Sección de Toggles para Mecánicas Avanzadas (Turbo, Dash, Magnus)
    const togglesRow = document.createElement('div');
    togglesRow.className = 'col-span-1 md:col-span-2 p-3 rounded-xl flex flex-wrap gap-4 items-center justify-around';
    togglesRow.style.background = 'rgba(255, 255, 255, 0.04)';
    togglesRow.style.border = '1px solid var(--aero-border, rgba(255, 255, 255, 0.1))';

    const toggleDefs: Array<{ key: 'turboEnabled' | 'dashEnabled' | 'magnusEnabled'; label: string; icon: string }> = [
      { key: 'turboEnabled', label: 'Habilitar Turbo', icon: '⚡' },
      { key: 'dashEnabled', label: 'Habilitar Dash', icon: '💨' },
      { key: 'magnusEnabled', label: 'Habilitar Magnus', icon: '🌀' }
    ];

    for (const tDef of toggleDefs) {
      const toggleWrap = document.createElement('label');
      toggleWrap.style.display = 'inline-flex';
      toggleWrap.style.alignItems = 'center';
      toggleWrap.style.gap = '8px';
      toggleWrap.style.cursor = 'pointer';
      toggleWrap.style.userSelect = 'none';

      const chk = document.createElement('input');
      chk.type = 'checkbox';
      chk.checked = this.currentConfig[tDef.key] !== false;
      chk.style.accentColor = 'var(--aero-sky-500, #38bdf8)';
      chk.style.width = '16px';
      chk.style.height = '16px';
      chk.style.cursor = 'pointer';

      chk.addEventListener('change', () => {
        if (!this.isHostCheck()) return;
        if (this.isMatchInProgressCheck()) {
          alert('Los modificadores de físicas solo se pueden ajustar antes de empezar una partida.');
          this.updateUI();
          return;
        }
        this.currentConfig[tDef.key] = chk.checked;
        this.notifyChange();
      });

      this.toggleInputs.set(tDef.key, chk);

      const span = document.createElement('span');
      span.style.fontSize = '0.88rem';
      span.style.fontWeight = '600';
      span.textContent = `${tDef.icon} ${tDef.label}`;

      toggleWrap.appendChild(chk);
      toggleWrap.appendChild(span);
      togglesRow.appendChild(toggleWrap);
    }
    content.appendChild(togglesRow);

    const keys = Object.keys(GAMEPLAY_CONFIG_LIMITS) as NumericConfigKey[];

    for (const key of keys) {
      const meta = GAMEPLAY_CONFIG_LIMITS[key];
      const val = this.currentConfig[key];

      const row = document.createElement('div');
      row.className = 'modifier-row';
      row.style.borderRadius = '12px';
      row.style.padding = '12px 14px';
      row.style.display = 'flex';
      row.style.flexDirection = 'column';
      row.style.gap = '6px';
      row.style.minWidth = '0'; // Evita desbordamiento en el grid

      const topRow = document.createElement('div');
      topRow.style.display = 'flex';
      topRow.style.justifyContent = 'space-between';
      topRow.style.alignItems = 'center';

      const labelWrap = document.createElement('div');
      labelWrap.style.display = 'flex';
      labelWrap.style.alignItems = 'center';
      labelWrap.style.gap = '8px';

      const labelText = document.createElement('span');
      labelText.style.fontWeight = '600';
      labelText.style.fontSize = '0.9rem';
      labelText.textContent = meta.label;

      const codeBadge = document.createElement('span');
      codeBadge.className = 'modifier-code-badge';
      codeBadge.style.fontSize = '0.72rem';
      codeBadge.style.padding = '2px 6px';
      codeBadge.style.borderRadius = '4px';
      codeBadge.style.fontFamily = 'monospace';
      codeBadge.textContent = key;

      labelWrap.appendChild(labelText);
      labelWrap.appendChild(codeBadge);

      const formatVal = (k: keyof GameplayConfig, v: any) => {
        if (k === 'dashesPerFullBar') {
          return `${v} (${(100 / (Number(v) || 4)).toFixed(0)}% coste)`;
        }
        return `${v}${meta.unit ? ' ' + meta.unit : ''}`;
      };

      const valBadge = document.createElement('span');
      valBadge.className = 'modifier-val-badge';
      valBadge.style.fontWeight = '700';
      valBadge.style.fontSize = '0.9rem';
      valBadge.style.minWidth = '65px';
      valBadge.style.textAlign = 'right';
      valBadge.style.fontVariantNumeric = 'tabular-nums';
      valBadge.textContent = formatVal(key, val);
      this.valueDisplays.set(key, valBadge);

      topRow.appendChild(labelWrap);
      topRow.appendChild(valBadge);

      const sliderRow = document.createElement('div');
      sliderRow.style.display = 'flex';
      sliderRow.style.alignItems = 'center';
      sliderRow.style.gap = '10px';

      const minLabel = document.createElement('span');
      minLabel.style.fontSize = '0.72rem';
      minLabel.style.color = 'var(--text-muted)';
      minLabel.textContent = `${meta.min}`;

      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = meta.min.toString();
      slider.max = meta.max.toString();
      slider.step = meta.step.toString();
      slider.value = val.toString();
      slider.className = 'physics-slider';
      slider.style.flex = '1';
      slider.style.accentColor = 'var(--aero-sky-500)';
      slider.style.cursor = 'pointer';

      slider.addEventListener('input', () => {
        if (!this.isHostCheck()) return;
        if (this.isMatchInProgressCheck()) {
          alert('Los modificadores de físicas solo se pueden ajustar antes de empezar una partida.');
          this.updateUI();
          return;
        }
        const parsed = parseFloat(slider.value);
        this.currentConfig[key] = parsed;
        if (key === 'dashesPerFullBar') {
          valBadge.textContent = `${parsed} (${(100 / (parsed || 4)).toFixed(0)}% coste)`;
        } else {
          valBadge.textContent = `${parsed}${meta.unit ? ' ' + meta.unit : ''}`;
        }
        this.notifyChange();
      });

      this.sliderInputs.set(key, slider);

      const maxLabel = document.createElement('span');
      maxLabel.style.fontSize = '0.72rem';
      maxLabel.style.color = 'var(--text-muted)';
      maxLabel.textContent = `${meta.max}`;

      sliderRow.appendChild(minLabel);
      sliderRow.appendChild(slider);
      sliderRow.appendChild(maxLabel);

      const desc = document.createElement('div');
      desc.style.fontSize = '0.75rem';
      desc.style.color = 'var(--text-muted)';
      desc.textContent = meta.description;

      row.appendChild(topRow);
      row.appendChild(sliderRow);
      row.appendChild(desc);
      content.appendChild(row);
    }

    // Footer
    const footer = document.createElement('div');
    footer.style.display = 'flex';
    footer.style.justifyContent = 'space-between';
    footer.style.alignItems = 'center';
    footer.style.marginTop = '10px';
    footer.style.paddingTop = '12px';
    footer.style.borderTop = '1px solid var(--aero-border)';

    const resetBtn = document.createElement('button');
    resetBtn.id = 'btn-reset-physics-defaults';
    resetBtn.className = 'btn btn-secondary btn-sm';
    resetBtn.textContent = '↺ Restablecer Valores por Defecto';
    resetBtn.addEventListener('click', () => {
      if (!this.isHostCheck()) return;
      if (this.isMatchInProgressCheck()) {
        alert('Los modificadores de físicas solo se pueden ajustar antes de empezar una partida.');
        return;
      }
      this.resetToDefaults();
    });

    const closeBtn = document.createElement('button');
    closeBtn.className = 'btn btn-primary btn-sm';
    closeBtn.textContent = 'Guardar y Cerrar';
    closeBtn.addEventListener('click', () => this.hide());

    footer.appendChild(resetBtn);
    footer.appendChild(closeBtn);

    card.appendChild(header);
    card.appendChild(content);
    card.appendChild(footer);
    overlay.appendChild(card);

    header.querySelector('#btn-close-modifiers-modal')?.addEventListener('click', () => this.hide());

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        this.hide();
      }
    });

    document.body.appendChild(overlay);
    this.modalEl = overlay;
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
        if (key === 'dashesPerFullBar') {
          badge.textContent = `${val} (${(100 / (Number(val) || 4)).toFixed(0)}% coste)`;
        } else {
          badge.textContent = `${val}${meta?.unit ? ' ' + meta.unit : ''}`;
        }
      }
    }

    for (const [key, toggle] of this.toggleInputs.entries()) {
      toggle.checked = Boolean(this.currentConfig[key]);
      toggle.disabled = !canEdit;
    }

    const resetBtn = this.modalEl?.querySelector('#btn-reset-physics-defaults') as HTMLButtonElement | null;
    if (resetBtn) {
      resetBtn.disabled = !canEdit;
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
    const resetBtn = this.modalEl?.querySelector('#btn-reset-physics-defaults') as HTMLButtonElement | null;
    if (resetBtn) {
      resetBtn.disabled = !canEdit;
    }
    if (isMatchInProgress && this.isOpen()) {
      this.hide();
    }
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
    this.modalEl.classList.remove('hidden');
  }

  public hide(): void {
    if (!this.modalEl) return;
    this.modalEl.classList.add('hidden');
  }

  public isOpen(): boolean {
    return this.modalEl ? !this.modalEl.classList.contains('hidden') : false;
  }
}
