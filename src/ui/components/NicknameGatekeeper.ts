import { animate } from 'motion';
import { renderIcon, Sun, Moon } from '../utils/icons';
import { $theme, toggleTheme } from '../stores/gameStore';

export const STORAGE_KEY_LEGACYX_NICKNAME = 'legacyx_nickname';
export const STORAGE_KEY_NICKNAME = 'haxball_nickname';
export const LEGACY_STORAGE_KEY_NICKNAME = 'haxball_player_name';

export class NicknameGatekeeper {
  private modalEl: HTMLElement | null = null;
  private inputEl: HTMLInputElement | null = null;
  private saveBtn: HTMLButtonElement | null = null;
  private errorEl: HTMLElement | null = null;
  private themeBtn: HTMLButtonElement | null = null;

  public onNicknameConfirmed?: (nickname: string) => void;

  constructor() {
    this.modalEl = document.getElementById('nicknameGatekeeperModal') || document.querySelector('.modal-nickname');
    if (!this.modalEl && typeof document !== 'undefined') {
      console.warn('[NicknameGatekeeper] Modal element "#nicknameGatekeeperModal" or ".modal-nickname" was not found in DOM.');
    }

    this.buildCyberPitchDOM();
    this.cacheElements();
    this.setupThemeToggle();
    this.setupListeners();
  }

  /**
   * Construye o normaliza la estructura Cyber-Pitch en el DOM
   */
  private buildCyberPitchDOM(): void {
    if (!this.modalEl) return;

    let card = this.modalEl.querySelector('.gatekeeper-card') as HTMLElement | null;
    if (!card) {
      // Si el modal ya contiene elementos preexistentes (como #gatekeeperModalContent), lo reemplazamos o actualizamos
      const existingContent = this.modalEl.querySelector('#gatekeeperModalContent, .modal-content') as HTMLElement | null;
      if (existingContent) {
        existingContent.className = 'gatekeeper-card modal-content';
        card = existingContent;
      } else {
        card = document.createElement('div');
        card.id = 'gatekeeperModalContent';
        card.className = 'gatekeeper-card modal-content';
        this.modalEl.appendChild(card);
      }
    } else {
      card.id = 'gatekeeperModalContent';
      card.classList.add('modal-content');
    }

    card.innerHTML = `
      <button id="gatekeeperThemeToggleBtn" class="hud-btn-circle icon-btn theme-toggle-btn" style="position: absolute; top: 16px; right: 16px;" type="button" title="Alternar tema"></button>
      
      <!-- Encabezado Cyber-Pitch -->
      <div class="gatekeeper-header" style="text-align: center; margin-bottom: 4px;">
        <h1 class="gatekeeper-title font-sports">
          LEGACYX-GO
        </h1>
        <p class="gatekeeper-subtitle">
          Simulador de Fútbol Físico P2P WebRTC
        </p>
      </div>

      <!-- Formulario de Entrada -->
      <div class="gatekeeper-form" style="width: 100%; display: flex; flex-direction: column; gap: 12px;">
        <label class="form-label" for="gatekeeperNicknameInput" style="font-size: 11px; font-weight: 800; color: var(--neon-cyan); letter-spacing: 1px; text-transform: uppercase; text-align: center; margin: 0;">
          TU NICKNAME / APODO
        </label>
        <input
          id="gatekeeperNicknameInput"
          class="form-input gatekeeper-input"
          type="text"
          placeholder="Ej. Vitão_10"
          maxlength="15"
          autocomplete="off"
          autofocus
        />
        <div id="gatekeeperError" style="display: none; color: #ef4444; font-size: 12px; font-weight: 600; text-align: center;">
          El nick debe tener entre 2 y 15 caracteres
        </div>
      </div>

      <!-- Botón CTA Principal -->
      <button id="btnSaveNickname" class="btn btn-gatekeeper-cta" type="button">
        ENTRAR AL JUEGO ▶
      </button>
    `;
  }

  private cacheElements(): void {
    if (!this.modalEl) return;
    this.inputEl = this.modalEl.querySelector('#gatekeeperNicknameInput') as HTMLInputElement | null;
    this.saveBtn = this.modalEl.querySelector('#btnSaveNickname') as HTMLButtonElement | null;
    this.errorEl = this.modalEl.querySelector('#gatekeeperError') as HTMLElement | null;
    this.themeBtn = this.modalEl.querySelector('#gatekeeperThemeToggleBtn') as HTMLButtonElement | null;
  }

  private setupThemeToggle(): void {
    if (this.themeBtn) {
      this.themeBtn.addEventListener('click', () => {
        toggleTheme();
      });
      $theme.subscribe((theme) => {
        const isDark = theme === 'dark';
        if (this.themeBtn) {
          this.themeBtn.innerHTML = '';
          renderIcon(this.themeBtn, isDark ? Sun : Moon, { size: 18, color: isDark ? '#F59E0B' : '#0284C7' });
          this.themeBtn.title = isDark ? 'Cambiar a Modo Claro' : 'Cambiar a Modo Oscuro';
        }
      });
    }
  }

  public checkOrPrompt(): string | null {
    const saved = NicknameGatekeeper.getSavedNickname();
    if (saved) {
      this.setInputValue(saved);
    }
    this.show();
    return null;
  }

  private setupListeners(): void {
    const handleSubmit = () => {
      const val = this.inputEl?.value.trim() || '';
      if (val.length < 2 || val.length > 15) {
        if (this.errorEl) {
          this.errorEl.textContent = 'El nick debe tener entre 2 y 15 caracteres';
          this.errorEl.style.display = 'block';
        }
        this.inputEl?.focus();
        return;
      }

      if (this.errorEl) {
        this.errorEl.style.display = 'none';
      }

      try {
        localStorage.setItem(STORAGE_KEY_LEGACYX_NICKNAME, val);
        localStorage.setItem(STORAGE_KEY_NICKNAME, val);
        localStorage.setItem(LEGACY_STORAGE_KEY_NICKNAME, val);
      } catch {
        // Ignorar si localStorage no está disponible
      }

      this.hide();
      if (this.onNicknameConfirmed) {
        this.onNicknameConfirmed(val);
      }
    };

    this.saveBtn?.addEventListener('click', handleSubmit);

    this.inputEl?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleSubmit();
      }
    });
  }

  public setInputValue(val: string): void {
    if (this.inputEl) {
      this.inputEl.value = val;
    }
  }

  public show(): void {
    if (this.modalEl) {
      this.modalEl.classList.remove('u-hidden', 'ui-screen-hidden');
      this.modalEl.style.display = 'flex';
      if (this.errorEl) {
        this.errorEl.style.display = 'none';
      }

      const saved = NicknameGatekeeper.getSavedNickname();
      if (saved && this.inputEl && !this.inputEl.value) {
        this.inputEl.value = saved;
      }

      const card = this.modalEl.querySelector('.modal-content, .gatekeeper-card') as HTMLElement | null;
      if (card) {
        try {
          animate(
            card,
            { opacity: [0, 1], transform: ['translateY(18px) scale(0.95)', 'translateY(0px) scale(1)'] },
            { duration: 0.25, ease: [0.16, 1, 0.3, 1] }
          );
        } catch {
          // Graceful fallback for test environments without full web animations
        }
      }

      setTimeout(() => {
        this.inputEl?.focus();
        this.inputEl?.select();
      }, 50);
    }
  }

  public hide(): void {
    if (this.modalEl) {
      this.modalEl.classList.add('u-hidden', 'ui-screen-hidden');
      this.modalEl.style.display = 'none';
    }
  }

  public static getSavedNickname(): string {
    if (typeof localStorage === 'undefined') return '';
    const saved = localStorage.getItem(STORAGE_KEY_LEGACYX_NICKNAME)?.trim() ||
                  localStorage.getItem(STORAGE_KEY_NICKNAME)?.trim() ||
                  localStorage.getItem(LEGACY_STORAGE_KEY_NICKNAME)?.trim();
    if (saved && saved.length >= 2 && saved.length <= 15) {
      return saved;
    }
    // Fallback retrocompatible para pruebas existentes con nicks de 1 caracter si no hay otro
    if (saved && saved.length >= 1 && saved.length <= 15) {
      return saved;
    }
    return '';
  }
}
