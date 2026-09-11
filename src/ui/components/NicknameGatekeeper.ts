export const STORAGE_KEY_NICKNAME = 'haxball_player_name';

export class NicknameGatekeeper {
  private modalEl: HTMLElement;
  private inputEl: HTMLInputElement;
  private saveBtn: HTMLButtonElement;
  private errorEl: HTMLElement | null;

  public onNicknameConfirmed?: (nickname: string) => void;

  constructor() {
    this.modalEl = document.getElementById('nicknameGatekeeperModal')!;
    this.inputEl = document.getElementById('gatekeeperNicknameInput') as HTMLInputElement;
    this.saveBtn = document.getElementById('btnSaveNickname') as HTMLButtonElement;
    this.errorEl = document.getElementById('gatekeeperError');

    this.setupListeners();
  }

  public checkOrPrompt(): string | null {
    const saved = localStorage.getItem(STORAGE_KEY_NICKNAME)?.trim();
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
      this.hide();
      if (this.onNicknameConfirmed) {
        this.onNicknameConfirmed(val);
      }
    };

    if (this.saveBtn) {
      this.saveBtn.addEventListener('click', handleSubmit);
    }

    if (this.inputEl) {
      this.inputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          handleSubmit();
        }
      });
    }
  }

  public show(): void {
    if (this.modalEl) {
      this.modalEl.style.display = 'flex';
      setTimeout(() => {
        if (this.inputEl) {
          this.inputEl.focus();
          this.inputEl.select();
        }
      }, 50);
    }
  }

  public hide(): void {
    if (this.modalEl) {
      this.modalEl.style.display = 'none';
    }
  }

  public static getSavedNickname(): string {
    const saved = localStorage.getItem(STORAGE_KEY_NICKNAME)?.trim();
    if (saved && saved.length >= 2 && saved.length <= 15) {
      return saved;
    }
    return '';
  }
}
