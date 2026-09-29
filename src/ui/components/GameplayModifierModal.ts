import {
  GameplayConfig,
  GAMEPLAY_CONFIG_LIMITS,
  DEFAULT_GAMEPLAY_CONFIG,
  sanitizeGameplayConfig
} from '../../core/game/GameConfig';

export class GameplayModifierModal {
  private modalEl: HTMLElement | null = null;
  private currentConfig: GameplayConfig;
  private onChangeCallback: (config: GameplayConfig) => void;
  private isHostCheck: () => boolean;
  private valueDisplays: Map<keyof GameplayConfig, HTMLElement> = new Map();
  private sliderInputs: Map<keyof GameplayConfig, HTMLInputElement> = new Map();

  constructor(
    initialConfig: GameplayConfig,
    onChange: (config: GameplayConfig) => void,
    isHost: () => boolean
  ) {
    this.currentConfig = { ...initialConfig };
    this.onChangeCallback = onChange;
    this.isHostCheck = isHost;
    this.buildDOM();
  }

  private buildDOM(): void {
    if (typeof document === 'undefined') return;

    const overlay = document.createElement('div');
    overlay.id = 'gameplay-modifiers-modal';
    overlay.className = 'ingame-menu-overlay hidden';
    overlay.style.zIndex = '9999';

    const card = document.createElement('div');
    card.className = 'menu-modal-card';
    card.style.maxWidth = '680px';
    card.style.width = '95vw';
    card.style.maxHeight = '88vh';
    card.style.overflowY = 'auto';

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

    // Content: Grid de modificadores
    const content = document.createElement('div');
    content.style.display = 'flex';
    content.style.flexDirection = 'column';
    content.style.gap = '14px';
    content.style.marginTop = '8px';

    const keys = Object.keys(GAMEPLAY_CONFIG_LIMITS) as Array<keyof GameplayConfig>;

    for (const key of keys) {
      const meta = GAMEPLAY_CONFIG_LIMITS[key];
      const val = this.currentConfig[key];

      const row = document.createElement('div');
      row.style.background = 'rgba(240, 249, 255, 0.4)';
      row.style.border = '1px solid var(--aero-border)';
      row.style.borderRadius = '10px';
      row.style.padding = '10px 14px';
      row.style.display = 'flex';
      row.style.flexDirection = 'column';
      row.style.gap = '6px';

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
      codeBadge.style.fontSize = '0.72rem';
      codeBadge.style.color = 'var(--text-muted)';
      codeBadge.style.background = 'rgba(0,0,0,0.06)';
      codeBadge.style.padding = '2px 6px';
      codeBadge.style.borderRadius = '4px';
      codeBadge.style.fontFamily = 'monospace';
      codeBadge.textContent = key;

      labelWrap.appendChild(labelText);
      labelWrap.appendChild(codeBadge);

      const valBadge = document.createElement('span');
      valBadge.style.fontWeight = '700';
      valBadge.style.fontSize = '0.9rem';
      valBadge.style.color = 'var(--aero-sky-600)';
      valBadge.style.minWidth = '60px';
      valBadge.style.textAlign = 'right';
      valBadge.textContent = `${val}${meta.unit ? ' ' + meta.unit : ''}`;
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
        const parsed = parseFloat(slider.value);
        this.currentConfig[key] = parsed;
        valBadge.textContent = `${parsed}${meta.unit ? ' ' + meta.unit : ''}`;
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
    for (const [key, slider] of this.sliderInputs.entries()) {
      const val = this.currentConfig[key];
      slider.value = val.toString();
      const meta = GAMEPLAY_CONFIG_LIMITS[key];
      const badge = this.valueDisplays.get(key);
      if (badge) {
        badge.textContent = `${val}${meta?.unit ? ' ' + meta.unit : ''}`;
      }
    }
  }

  public show(): void {
    if (!this.modalEl) return;
    if (!this.isHostCheck()) {
      alert('Solo el anfitrión (Host) tiene permisos para modificar las variables de física del motor.');
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
