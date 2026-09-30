import { InputManager, KeyBinds } from '../../client/InputManager';

export interface KeybindRowConfig {
  key: keyof KeyBinds;
  label: string;
}

export const ACTIVE_KEYBIND_ROWS: KeybindRowConfig[] = [
  { key: 'up', label: 'Arriba (Mover)' },
  { key: 'down', label: 'Abajo (Mover)' },
  { key: 'left', label: 'Izquierda (Mover)' },
  { key: 'right', label: 'Derecha (Mover)' },
  { key: 'kick', label: 'Patear / Chutar' },
  { key: 'turbo', label: 'Turbo / Sprint' },
  { key: 'dash', label: 'Dash / Salto Rápido' },
  { key: 'curveLeft', label: 'Efecto Izquierda (A)' },
  { key: 'curveRight', label: 'Efecto Derecha (D)' }
];

export class KeybindModal {
  private modalEl: HTMLElement | null = null;
  private closeBtn: HTMLElement | null = null;
  private saveBtn: HTMLElement | null = null;
  private resetBtn: HTMLElement | null = null;
  private listContainer: HTMLElement | null = null;
  private inputManager: InputManager;
  private recordingAction: keyof KeyBinds | null = null;
  private recordingBtn: HTMLButtonElement | null = null;
  private keydownListener: (e: KeyboardEvent) => void;

  constructor(inputManager: InputManager) {
    this.inputManager = inputManager;
    this.modalEl = document.getElementById('settingsModal');
    this.closeBtn = document.getElementById('btnCloseSettings');
    this.saveBtn = document.getElementById('btnSaveKeybinds');
    this.resetBtn = document.getElementById('btnResetKeybinds');
    this.listContainer = document.getElementById('keybindsList');

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
      this.render();
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this.keydownListener, true);
    }

    this.setupListeners();
  }

  private setupListeners(): void {
    this.closeBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.close();
    });

    this.saveBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.close();
    });

    this.resetBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.inputManager.resetToDefaultKeyBinds();
      this.render();
    });
  }

  public render(): void {
    if (!this.listContainer) return;
    this.listContainer.innerHTML = '';
    const binds = this.inputManager.keyBinds;

    for (const { key, label } of ACTIVE_KEYBIND_ROWS) {
      const row = document.createElement('div');
      row.className = 'keybind-row';

      const labelEl = document.createElement('span');
      labelEl.className = 'keybind-label';
      labelEl.textContent = label;

      const btn = document.createElement('button');
      btn.className = 'keybind-btn';
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
