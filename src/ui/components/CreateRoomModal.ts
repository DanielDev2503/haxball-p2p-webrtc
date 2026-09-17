import { animate } from 'motion';
import { renderIcon, PlusSquare, Lock } from '../utils/icons';

export interface CreateRoomModalConfig {
  name: string;
  maxPlayers: number;
  timeLimit: number;
  scoreLimit: number;
  isPrivate: boolean;
  password?: string;
}

export interface CreateRoomModalEvents {
  onSubmit: (config: CreateRoomModalConfig) => void;
  onClose?: () => void;
}

export class CreateRoomModal {
  private overlayEl: HTMLElement | null = null;
  private cardEl: HTMLElement | null = null;
  private closeBtn: HTMLButtonElement | null = null;
  private cancelBtn: HTMLButtonElement | null = null;
  private submitBtn: HTMLButtonElement | null = null;

  private roomNameInput: HTMLInputElement | null = null;
  private maxPlayersInput: HTMLInputElement | null = null;
  private timeLimitSelect: HTMLSelectElement | null = null;
  private scoreLimitSelect: HTMLSelectElement | null = null;
  private isPrivateCheckbox: HTMLInputElement | null = null;
  private passwordContainer: HTMLElement | null = null;
  private passwordInput: HTMLInputElement | null = null;

  private events: CreateRoomModalEvents;

  constructor(events: CreateRoomModalEvents) {
    this.events = events;

    this.overlayEl = document.getElementById('createRoomModal');
    this.cardEl = document.getElementById('createRoomCard');
    this.closeBtn = document.getElementById('btnCloseCreateRoomModal') as HTMLButtonElement | null;
    this.cancelBtn = document.getElementById('btnCancelCreateRoom') as HTMLButtonElement | null;
    this.submitBtn = document.getElementById('btnCreateRoomSubmit') as HTMLButtonElement | null;

    this.roomNameInput = document.getElementById('newRoomNameInput') as HTMLInputElement | null;
    this.maxPlayersInput = document.getElementById('newRoomMaxPlayersInput') as HTMLInputElement | null;
    this.timeLimitSelect = document.getElementById('newRoomTimeLimitInput') as HTMLSelectElement | null;
    this.scoreLimitSelect = document.getElementById('newRoomScoreLimitInput') as HTMLSelectElement | null;
    this.isPrivateCheckbox = document.getElementById('newRoomIsPrivate') as HTMLInputElement | null;
    this.passwordContainer = document.getElementById('newRoomPasswordContainer');
    this.passwordInput = document.getElementById('newRoomPasswordInput') as HTMLInputElement | null;

    this.renderIcons();
    this.setupListeners();
  }

  private renderIcons(): void {
    const titleSlot = document.getElementById('createRoomModalIconSlot');
    if (titleSlot) {
      renderIcon(titleSlot, PlusSquare, { size: 22, color: '#0EA5E9' });
    }

    const lockSlot = document.getElementById('lockIconSlot');
    if (lockSlot) {
      renderIcon(lockSlot, Lock, { size: 16, color: '#0EA5E9' });
    }
  }

  private setupListeners(): void {
    this.closeBtn?.addEventListener('click', () => this.hide());
    this.cancelBtn?.addEventListener('click', () => this.hide());

    // Close when clicking directly on overlay background
    this.overlayEl?.addEventListener('click', (e) => {
      if (e.target === this.overlayEl) {
        this.hide();
      }
    });

    this.isPrivateCheckbox?.addEventListener('change', () => {
      if (!this.passwordContainer) return;
      const isPriv = !!this.isPrivateCheckbox?.checked;
      this.passwordContainer.style.display = isPriv ? 'block' : 'none';
      if (isPriv) {
        this.passwordInput?.focus();
      }
    });

    const handleSubmit = () => {
      const roomName = this.roomNameInput?.value.trim() || 'Estadio Aero';
      const maxPlayers = parseInt(this.maxPlayersInput?.value || '12', 10);
      const timeLimit = parseInt(this.timeLimitSelect?.value || '3', 10);
      const scoreLimit = parseInt(this.scoreLimitSelect?.value || '3', 10);
      const isPrivate = !!this.isPrivateCheckbox?.checked;
      const password = this.passwordInput?.value.trim() || '';

      if (isPrivate && !password) {
        alert('Debes ingresar una contraseña para la sala privada.');
        this.passwordInput?.focus();
        return;
      }

      const config: CreateRoomModalConfig = {
        name: roomName,
        maxPlayers: Math.max(2, Math.min(16, isNaN(maxPlayers) ? 12 : maxPlayers)),
        timeLimit: isNaN(timeLimit) ? 3 : timeLimit,
        scoreLimit: isNaN(scoreLimit) ? 3 : scoreLimit,
        isPrivate,
        password: isPrivate ? password : ''
      };

      this.hide();
      this.events.onSubmit(config);
    };

    this.submitBtn?.addEventListener('click', handleSubmit);

    // Enter key submits when focused inside inputs
    const handleKeydown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleSubmit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.hide();
      }
    };

    this.roomNameInput?.addEventListener('keydown', handleKeydown);
    this.maxPlayersInput?.addEventListener('keydown', handleKeydown);
    this.passwordInput?.addEventListener('keydown', handleKeydown);
  }

  public show(defaultRoomName: string = 'Estadio Aero'): void {
    if (!this.overlayEl) return;

    if (this.roomNameInput && !this.roomNameInput.value) {
      this.roomNameInput.value = defaultRoomName;
    }

    this.overlayEl.classList.remove('u-hidden');
    this.overlayEl.style.display = 'flex';

    if (this.cardEl) {
      try {
        animate(
          this.cardEl,
          { opacity: [0, 1], transform: ['translateY(16px) scale(0.95)', 'translateY(0px) scale(1)'] },
          { duration: 0.25, ease: [0.16, 1, 0.3, 1] }
        );
      } catch {
        // Fallback for test environments without full web animations
      }
    }

    setTimeout(() => {
      this.roomNameInput?.focus();
      this.roomNameInput?.select();
    }, 40);
  }

  public hide(): void {
    if (!this.overlayEl) return;
    this.overlayEl.classList.add('u-hidden');
    this.overlayEl.style.display = 'none';

    if (this.events.onClose) {
      this.events.onClose();
    }
  }

  public reset(): void {
    if (this.roomNameInput) this.roomNameInput.value = '';
    if (this.maxPlayersInput) this.maxPlayersInput.value = '12';
    if (this.timeLimitSelect) this.timeLimitSelect.value = '3';
    if (this.scoreLimitSelect) this.scoreLimitSelect.value = '3';
    if (this.isPrivateCheckbox) this.isPrivateCheckbox.checked = false;
    if (this.passwordContainer) this.passwordContainer.style.display = 'none';
    if (this.passwordInput) this.passwordInput.value = '';
  }
}
