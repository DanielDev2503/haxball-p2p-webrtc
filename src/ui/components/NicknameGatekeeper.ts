import { animate } from 'motion';
import { renderIcon, User } from '../utils/icons';

export const STORAGE_KEY_NICKNAME = 'haxball_nickname';
export const LEGACY_STORAGE_KEY_NICKNAME = 'haxball_player_name';

export class NicknameGatekeeper {
  private modalEl: HTMLElement | null = null;
  private inputEl: HTMLInputElement | null = null;
  private saveBtn: HTMLButtonElement | null = null;
  private errorEl: HTMLElement | null = null;
  private avatarEl: HTMLElement | null = null;

  public onNicknameConfirmed?: (nickname: string) => void;

  constructor() {
    this.modalEl = document.getElementById('nicknameGatekeeperModal') || document.querySelector('.modal-nickname');
    if (!this.modalEl) {
      console.warn('[NicknameGatekeeper] Modal element "#nicknameGatekeeperModal" or ".modal-nickname" was not found in DOM.');
    }

    this.inputEl = document.getElementById('gatekeeperNicknameInput') as HTMLInputElement | null;
    if (!this.inputEl) {
      console.warn('[NicknameGatekeeper] Input element "#gatekeeperNicknameInput" was not found in DOM.');
    }

    this.saveBtn = document.getElementById('btnSaveNickname') as HTMLButtonElement | null;
    if (!this.saveBtn) {
      console.warn('[NicknameGatekeeper] Button element "#btnSaveNickname" was not found in DOM.');
    }

    this.errorEl = document.getElementById('gatekeeperError');
    if (!this.errorEl) {
      console.warn('[NicknameGatekeeper] Error element "#gatekeeperError" was not found in DOM.');
    }

    this.avatarEl = document.getElementById('gatekeeperAvatar');

    this.renderAvatar();
    this.setupListeners();
  }

  private renderAvatar(): void {
    if (this.avatarEl) {
      renderIcon(this.avatarEl, User, { size: 36, color: '#0284C7' });
    }
  }

  public checkOrPrompt(): string | null {
    const saved = NicknameGatekeeper.getSavedNickname();
    if (saved && saved.length >= 2 && saved.length <= 15) {
      this.hide();
      return saved;
    }
    this.show();
    return null;
  }

  private setupListeners(): void {
    const handleSubmit = () => {
      const val = this.inputEl?.value.trim() || '';
      if (val.length < 2 || val.length > 15) {
        if (this.errorEl) {
          this.errorEl.textContent = 'El nickname debe tener entre 2 y 15 caracteres válidos.';
          this.errorEl.style.display = 'block';
        }
        this.inputEl?.focus();
        return;
      }

      if (this.errorEl) {
        this.errorEl.style.display = 'none';
      }

      localStorage.setItem(STORAGE_KEY_NICKNAME, val);
      localStorage.setItem(LEGACY_STORAGE_KEY_NICKNAME, val);
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

      const card = this.modalEl.querySelector('.modal-content') as HTMLElement | null;
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
    const saved = localStorage.getItem(STORAGE_KEY_NICKNAME)?.trim() ||
                  localStorage.getItem(LEGACY_STORAGE_KEY_NICKNAME)?.trim();
    if (saved && saved.length >= 2 && saved.length <= 15) {
      return saved;
    }
    return '';
  }
}
