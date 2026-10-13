import { animate } from 'motion';
import { StadiumSelectModal } from './StadiumSelectModal';
import { StadiumRegistry, StadiumPreset } from '../../core/stadiums/StadiumRegistry';
import { toggleTheme } from '../stores/gameStore';

export interface CreateRoomModalConfig {
  name: string;
  maxPlayers: number;
  timeLimit: number;
  scoreLimit: number;
  isPrivate: boolean;
  password?: string;
  stadiumId?: string;
  teamsLocked?: boolean;
  isPublic?: boolean;
}

export interface CreateRoomModalEvents {
  onSubmit: (config: CreateRoomModalConfig) => void;
  onClose?: () => void;
}

export class CreateRoomModal {
  private overlayEl: HTMLElement | null = null;
  private cardEl: HTMLElement | null = null;
  private backBtn: HTMLButtonElement | null = null;
  private themeBtn: HTMLButtonElement | null = null;
  private submitBtn: HTMLButtonElement | null = null;

  // Form fields
  private roomNameInput: HTMLInputElement | null = null;
  private maxPlayersInput: HTMLInputElement | null = null;
  private maxPlayersDisplay: HTMLElement | null = null;
  private decMaxPlayersBtn: HTMLButtonElement | null = null;
  private incMaxPlayersBtn: HTMLButtonElement | null = null;
  private isPrivateCheckbox: HTMLInputElement | null = null;
  private passwordContainer: HTMLElement | null = null;
  private passwordInput: HTMLInputElement | null = null;
  private isPublicCheckbox: HTMLInputElement | null = null;

  // Quick Rules
  private timeLimitSelect: HTMLSelectElement | null = null;
  private scoreLimitSelect: HTMLSelectElement | null = null;
  private lockTeamsBtn: HTMLButtonElement | null = null;
  private modifiersBtn: HTMLButtonElement | null = null;

  // Stadium Preview
  private stadiumCanvas: HTMLCanvasElement | null = null;
  private stadiumNameLabel: HTMLElement | null = null;
  private changeStadiumBtn: HTMLButtonElement | null = null;

  // State
  public selectedStadiumId: string = 'AF 3v3 Official';
  public maxPlayers: number = 6;
  public teamsLocked: boolean = false;
  public stadiumModal?: StadiumSelectModal;
  private events: CreateRoomModalEvents;

  constructor(events: CreateRoomModalEvents) {
    this.events = events;
    this.buildDOM();
    this.cacheElements();
    this.initStadiumModal();
    this.setupListeners();
    this.updateStadiumPreview();
    this.updateMaxPlayersDisplay();
  }

  private buildDOM(): void {
    if (typeof document === 'undefined') return;

    let overlay = document.getElementById('createRoomModal');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'createRoomModal';
      overlay.className = 'modal-overlay modal-backdrop u-hidden';
      overlay.style.display = 'none';
      document.body?.appendChild(overlay);
    }

    this.overlayEl = overlay;
    overlay.style.position = 'fixed';
    overlay.style.inset = '0';
    overlay.style.zIndex = '280';
    overlay.style.background = 'rgba(0, 0, 0, 0.75)';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';

    overlay.innerHTML = `
      <!-- Top-Left exterior: Botón < Volver -->
      <button class="modal-nav-back-btn" id="btnCreateRoomBack" type="button" title="Volver al Lobby">
        &lt; Volver
      </button>

      <!-- Top-Right exterior: Selector de tema [ ☼ / ☾ ] -->
      <button class="modal-nav-theme-btn" id="btnCreateRoomThemeToggle" type="button" title="Alternar Modo Claro / Oscuro">
        ☼ / ☾
      </button>

      <!-- Tarjeta Central de Creación (.create-room-card) -->
      <div class="create-room-card modal-container cyber-scrollbar" id="createRoomCard">
        <!-- Encabezado interior de la tarjeta -->
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(0, 229, 255, 0.2); padding-bottom: 10px;">
          <h2 style="margin: 0; font-size: 16px; font-weight: 800; color: var(--neon-cyan); letter-spacing: 0.5px; display: flex; align-items: center; gap: 8px;">
            <span>CREAR SALA</span>
            <span style="font-size: 13px; color: var(--text-secondary); font-weight: 500;">(Host P2P WebRTC)</span>
          </h2>
          <span style="font-size: 11px; font-weight: 700; color: #2ecc71; background: rgba(46, 204, 113, 0.15); border: 1px solid #2ecc71; border-radius: 4px; padding: 2px 8px;">
            OFICIAL
          </span>
        </div>

        <!-- 1. Sección Superior: Parámetros Básicos de Sala (Grid 2 Columnas) -->
        <div class="create-room-params-grid">
          <!-- Campo 1: Nombre de la Sala -->
          <div style="display: flex; flex-direction: column; gap: 5px;">
            <label class="form-label" for="newRoomNameInput" style="font-size: 11px; font-weight: 700; color: var(--text-secondary);">
              Nombre de la Sala
            </label>
            <input
              id="newRoomNameInput"
              class="form-input"
              type="text"
              placeholder="Sala de Player"
              maxlength="30"
              style="height: 38px; background: rgba(18, 26, 41, 0.85); border: 1px solid var(--border-cyan); border-radius: 6px; color: #fff; padding: 0 10px; font-size: 13px;"
            />
          </div>

          <!-- Campo 2: Capacidad Máxima de Jugadores (Stepper horizontal [-] 6 [+], rango 2-20) -->
          <div style="display: flex; flex-direction: column; gap: 5px;">
            <label class="form-label" style="font-size: 11px; font-weight: 700; color: var(--text-secondary);">
              Capacidad Máxima de Jugadores (2 - 20)
            </label>
            <div style="display: flex; align-items: center; gap: 10px; height: 38px;">
              <button
                id="btnDecMaxPlayersCreate"
                type="button"
                style="width: 36px; height: 38px; background: rgba(0, 229, 255, 0.15); border: 1px solid var(--border-cyan); border-radius: 6px; color: #fff; font-weight: 800; font-size: 16px; cursor: pointer;"
              >
                -
              </button>
              <div
                id="createRoomMaxPlayersDisplay"
                style="flex: 1; height: 38px; background: rgba(18, 26, 41, 0.85); border: 1px solid var(--border-cyan); border-radius: 6px; color: var(--neon-cyan); font-weight: 800; font-size: 15px; display: flex; align-items: center; justify-content: center; font-family: var(--font-mono);"
              >
                ${this.maxPlayers}
              </div>
              <button
                id="btnIncMaxPlayersCreate"
                type="button"
                style="width: 36px; height: 38px; background: rgba(0, 229, 255, 0.15); border: 1px solid var(--border-cyan); border-radius: 6px; color: #fff; font-weight: 800; font-size: 16px; cursor: pointer;"
              >
                +
              </button>
              <input type="hidden" id="newRoomMaxPlayersInput" value="${this.maxPlayers}" />
            </div>
          </div>

          <!-- Campo 3: Toggle de Protección por Clave + input protegido -->
          <div style="display: flex; flex-direction: column; gap: 6px;">
            <label style="display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text-secondary); cursor: pointer; font-weight: 600;">
              <input type="checkbox" id="newRoomIsPrivate" />
              <span>🔒 Proteger con contraseña</span>
            </label>
            <div id="newRoomPasswordContainer" style="display: none;">
              <input
                id="newRoomPasswordInput"
                class="form-input"
                type="password"
                placeholder="Ingresa clave de acceso"
                style="height: 34px; background: rgba(18, 26, 41, 0.85); border: 1px solid var(--border-cyan); border-radius: 6px; color: #fff; padding: 0 10px; font-size: 12px; width: 100%; box-sizing: border-box;"
              />
            </div>
          </div>

          <!-- Campo 4: Toggle de Visibilidad Pública -->
          <div style="display: flex; align-items: center;">
            <label style="display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text-secondary); cursor: pointer; font-weight: 600;">
              <input type="checkbox" id="newRoomIsPublic" checked />
              <span>Mostrar en explorador de salas</span>
            </label>
          </div>
        </div>

        <!-- 2. Sección Intermedia: Reglas Rápidas y Selector de Estadio -->
        <div style="display: flex; flex-direction: column; gap: 12px; border-top: 1px solid rgba(0, 229, 255, 0.15); padding-top: 14px;">
          <!-- Fila de 4 Botones de Reglas (Directamente encima del preview del estadio) -->
          <div class="rules-quick-grid">
            <!-- 1. Dropdown Límite de Tiempo -->
            <div style="display: flex; flex-direction: column; gap: 4px;">
              <label class="form-label" style="font-size: 11px; font-weight: 700; color: var(--text-secondary);">⏱ Tiempo</label>
              <select id="newRoomTimeLimitInput" class="form-input cyber-select" style="height: 34px; background: rgba(15, 23, 42, 0.7); border: 1px solid var(--border-cyan); border-radius: 6px; color: #fff; padding: 4px 8px; font-size: 12px;">
                <option value="0">Sin límite</option>
                <option value="3" selected>3m</option>
                <option value="5">5m</option>
                <option value="7">7m</option>
                <option value="10">10m</option>
              </select>
            </div>

            <!-- 2. Dropdown Límite de Goles -->
            <div style="display: flex; flex-direction: column; gap: 4px;">
              <label class="form-label" style="font-size: 11px; font-weight: 700; color: var(--text-secondary);">⚽ Goles</label>
              <select id="newRoomScoreLimitInput" class="form-input cyber-select" style="height: 34px; background: rgba(15, 23, 42, 0.7); border: 1px solid var(--border-cyan); border-radius: 6px; color: #fff; padding: 4px 8px; font-size: 12px;">
                <option value="0">Sin límite</option>
                <option value="1">1</option>
                <option value="3" selected>3</option>
                <option value="5">5</option>
                <option value="10">10</option>
              </select>
            </div>

            <!-- 3. Conmutador Equipos Libres / Bloqueados -->
            <div style="display: flex; flex-direction: column; gap: 4px;">
              <label class="form-label" style="font-size: 11px; font-weight: 700; color: var(--text-secondary);">Equipos</label>
              <button id="btnCreateRoomLockTeams" type="button" class="btn btn-secondary btn-xs" style="height: 34px; background: rgba(15, 23, 42, 0.7); border: 1px solid var(--border-cyan); border-radius: 6px; color: var(--neon-cyan); font-weight: 600; font-size: 11px; cursor: pointer;">
                🔓 Equipos Libres
              </button>
            </div>

            <!-- 4. Botón Modifiers -->
            <div style="display: flex; flex-direction: column; gap: 4px;">
              <label class="form-label" style="font-size: 11px; font-weight: 700; color: var(--text-secondary);">Físicas</label>
              <button id="btnCreateRoomModifiers" type="button" class="btn btn-secondary btn-xs" style="height: 34px; background: rgba(15, 23, 42, 0.7); border: 1px solid var(--border-cyan); border-radius: 6px; color: #f1c40f; font-weight: 700; font-size: 11px; cursor: pointer;" title="Abrir modificadores de físicas">
                ⚡ Modifiers
              </button>
            </div>
          </div>

          <!-- Selector y Preview de Estadio -->
          <div style="display: flex; flex-direction: column; gap: 8px;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span id="createRoomStadiumName" style="font-size: 12px; font-weight: 700; color: #f0f8ff;">
                Estadio: AF 3v3 Official by Vitão
              </span>
              <button id="btnChangeStadiumInCreate" type="button" class="btn btn-secondary btn-xs" style="padding: 5px 12px; font-size: 11px; font-weight: 700; border: 1px solid var(--border-cyan); color: var(--neon-cyan); background: rgba(0, 229, 255, 0.1); border-radius: 6px; cursor: pointer;">
                Cambiar Estadio 🏟
              </button>
            </div>

            <!-- Banner con Canvas 2D cenital (proporción 2:1, altura 160px) -->
            <div class="stadium-preview-banner">
              <canvas id="createRoomStadiumCanvas" width="320" height="160"></canvas>
              <span style="position: absolute; top: 8px; left: 10px; font-size: 10px; font-weight: 800; color: var(--neon-cyan); background: rgba(10, 16, 26, 0.85); border: 1px solid var(--border-cyan); border-radius: 4px; padding: 2px 6px;">
                PREVIEW 2D CENITAL
              </span>
            </div>
          </div>
        </div>

        <!-- 3. Sección Inferior: Botón CTA de Creación -->
        <div style="margin-top: 4px;">
          <button id="btnCreateRoomSubmit" class="btn btn-create-room-cta" type="button">
            CREAR SALA Y ENTRAR AL CAMPO ▶
          </button>
        </div>
      </div>
    `;
  }

  private cacheElements(): void {
    if (!this.overlayEl) return;
    this.cardEl = this.overlayEl.querySelector('#createRoomCard');
    this.backBtn = this.overlayEl.querySelector('#btnCreateRoomBack') as HTMLButtonElement | null;
    this.themeBtn = this.overlayEl.querySelector('#btnCreateRoomThemeToggle') as HTMLButtonElement | null;
    this.submitBtn = this.overlayEl.querySelector('#btnCreateRoomSubmit') as HTMLButtonElement | null;

    this.roomNameInput = this.overlayEl.querySelector('#newRoomNameInput') as HTMLInputElement | null;
    this.maxPlayersInput = this.overlayEl.querySelector('#newRoomMaxPlayersInput') as HTMLInputElement | null;
    this.maxPlayersDisplay = this.overlayEl.querySelector('#createRoomMaxPlayersDisplay');
    this.decMaxPlayersBtn = this.overlayEl.querySelector('#btnDecMaxPlayersCreate') as HTMLButtonElement | null;
    this.incMaxPlayersBtn = this.overlayEl.querySelector('#btnIncMaxPlayersCreate') as HTMLButtonElement | null;
    this.isPrivateCheckbox = this.overlayEl.querySelector('#newRoomIsPrivate') as HTMLInputElement | null;
    this.passwordContainer = this.overlayEl.querySelector('#newRoomPasswordContainer');
    this.passwordInput = this.overlayEl.querySelector('#newRoomPasswordInput') as HTMLInputElement | null;
    this.isPublicCheckbox = this.overlayEl.querySelector('#newRoomIsPublic') as HTMLInputElement | null;

    this.timeLimitSelect = this.overlayEl.querySelector('#newRoomTimeLimitInput') as HTMLSelectElement | null;
    this.scoreLimitSelect = this.overlayEl.querySelector('#newRoomScoreLimitInput') as HTMLSelectElement | null;
    this.lockTeamsBtn = this.overlayEl.querySelector('#btnCreateRoomLockTeams') as HTMLButtonElement | null;
    this.modifiersBtn = this.overlayEl.querySelector('#btnCreateRoomModifiers') as HTMLButtonElement | null;

    this.stadiumCanvas = this.overlayEl.querySelector('#createRoomStadiumCanvas') as HTMLCanvasElement | null;
    this.stadiumNameLabel = this.overlayEl.querySelector('#createRoomStadiumName');
    this.changeStadiumBtn = this.overlayEl.querySelector('#btnChangeStadiumInCreate') as HTMLButtonElement | null;
  }

  private initStadiumModal(): void {
    this.stadiumModal = new StadiumSelectModal({
      onSelect: (stadiumId: string) => {
        this.setStadium(stadiumId);
      }
    });
  }

  public setStadium(stadiumId: string): void {
    this.selectedStadiumId = stadiumId;
    this.updateStadiumPreview();
  }

  public updateStadiumPreview(): void {
    const preset: StadiumPreset = StadiumRegistry[this.selectedStadiumId] || StadiumRegistry['AF 3v3 Official'];
    if (!preset) return;

    if (this.stadiumNameLabel) {
      this.stadiumNameLabel.textContent = `Estadio: ${preset.name}`;
    }

    if (this.stadiumCanvas && typeof this.stadiumCanvas.getContext === 'function') {
      const ctx = this.stadiumCanvas.getContext('2d');
      if (ctx) {
        this.drawPitchPreview(ctx, this.stadiumCanvas.width, this.stadiumCanvas.height, preset);
      }
    }
  }

  private drawPitchPreview(ctx: CanvasRenderingContext2D, width: number, height: number, preset: StadiumPreset): void {
    ctx.clearRect(0, 0, width, height);

    // Fondo césped
    ctx.fillStyle = preset.bgColor || '#0d281e';
    ctx.fillRect(0, 0, width, height);

    const padX = 24;
    const padY = 16;
    const pitchW = width - padX * 2;
    const pitchH = height - padY * 2;

    // Patrón de rayas
    ctx.fillStyle = 'rgba(255, 255, 255, 0.03)';
    const stripes = 6;
    const stripeW = pitchW / stripes;
    for (let i = 0; i < stripes; i += 2) {
      ctx.fillRect(padX + i * stripeW, padY, stripeW, pitchH);
    }

    // Líneas del campo
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.6)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(padX, padY, pitchW, pitchH);

    // Línea de medio campo
    const midX = padX + pitchW / 2;
    ctx.beginPath();
    ctx.moveTo(midX, padY);
    ctx.lineTo(midX, padY + pitchH);
    ctx.stroke();

    // Círculo central
    ctx.beginPath();
    ctx.arc(midX, padY + pitchH / 2, pitchH * 0.22, 0, Math.PI * 2);
    ctx.stroke();

    // Punto central
    ctx.fillStyle = 'rgba(0, 229, 255, 0.8)';
    ctx.beginPath();
    ctx.arc(midX, padY + pitchH / 2, 2.5, 0, Math.PI * 2);
    ctx.fill();

    // Arcos
    const goalH = Math.min(pitchH * 0.45, 50);
    const goalTop = padY + (pitchH - goalH) / 2;
    const goalDepth = 12;

    // Arco izquierdo (Rojo)
    ctx.fillStyle = 'rgba(239, 68, 68, 0.25)';
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 1.5;
    ctx.fillRect(padX - goalDepth, goalTop, goalDepth, goalH);
    ctx.strokeRect(padX - goalDepth, goalTop, goalDepth, goalH);

    // Arco derecho (Azul)
    ctx.fillStyle = 'rgba(59, 130, 246, 0.25)';
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 1.5;
    ctx.fillRect(padX + pitchW, goalTop, goalDepth, goalH);
    ctx.strokeRect(padX + pitchW, goalTop, goalDepth, goalH);
  }

  private setupListeners(): void {
    // Top-Left exterior: < Volver
    this.backBtn?.addEventListener('click', (e) => {
      e?.stopPropagation?.();
      this.hide();
    });

    // Top-Right exterior: [ ☼ / ☾ ]
    this.themeBtn?.addEventListener('click', (e) => {
      e?.stopPropagation?.();
      toggleTheme();
    });

    // Click en fondo para cerrar
    this.overlayEl?.addEventListener('click', (e) => {
      if (e.target === this.overlayEl) {
        this.hide();
      }
    });

    // Stepper máx jugadores
    this.decMaxPlayersBtn?.addEventListener('click', () => {
      if (this.maxPlayers > 2) {
        this.maxPlayers--;
        this.updateMaxPlayersDisplay();
      }
    });

    this.incMaxPlayersBtn?.addEventListener('click', () => {
      if (this.maxPlayers < 20) {
        this.maxPlayers++;
        this.updateMaxPlayersDisplay();
      }
    });

    // Toggle contraseña
    this.isPrivateCheckbox?.addEventListener('change', () => {
      if (!this.passwordContainer) return;
      const isPriv = !!this.isPrivateCheckbox?.checked;
      this.passwordContainer.style.display = isPriv ? 'block' : 'none';
      if (isPriv) {
        this.passwordInput?.focus();
      }
    });

    // Conmutador Equipos Libres / Bloqueados
    this.lockTeamsBtn?.addEventListener('click', () => {
      this.teamsLocked = !this.teamsLocked;
      if (this.lockTeamsBtn) {
        this.lockTeamsBtn.textContent = this.teamsLocked ? '🔒 Equipos Bloqueados' : '🔓 Equipos Libres';
        this.lockTeamsBtn.style.color = this.teamsLocked ? '#f87171' : 'var(--neon-cyan)';
      }
    });

    // Botón Modifiers
    this.modifiersBtn?.addEventListener('click', () => {
      const modModal = document.getElementById('physicsModifierModal');
      if (modModal) {
        modModal.classList.remove('u-hidden');
        modModal.style.display = 'flex';
      }
    });

    // Botón Cambiar Estadio 🏟
    this.changeStadiumBtn?.addEventListener('click', () => {
      this.stadiumModal?.show();
    });

    // Envío del formulario CTA
    const handleSubmit = () => {
      const roomName = this.roomNameInput?.value.trim() || 'Sala Oficial';
      const timeLimit = parseInt(this.timeLimitSelect?.value || '3', 10);
      const scoreLimit = parseInt(this.scoreLimitSelect?.value || '3', 10);
      const isPrivate = !!this.isPrivateCheckbox?.checked;
      const password = this.passwordInput?.value.trim() || '';
      const isPublic = this.isPublicCheckbox ? !!this.isPublicCheckbox.checked : true;

      if (isPrivate && !password) {
        alert('Debes ingresar una contraseña para la sala privada.');
        this.passwordInput?.focus();
        return;
      }

      const config: CreateRoomModalConfig = {
        name: roomName,
        maxPlayers: this.maxPlayers,
        timeLimit: isNaN(timeLimit) ? 3 : timeLimit,
        scoreLimit: isNaN(scoreLimit) ? 3 : scoreLimit,
        isPrivate,
        password: isPrivate ? password : '',
        stadiumId: this.selectedStadiumId,
        teamsLocked: this.teamsLocked,
        isPublic
      };

      this.hide();
      this.events.onSubmit(config);
    };

    this.submitBtn?.addEventListener('click', (e) => {
      e?.preventDefault?.();
      e?.stopPropagation?.();
      handleSubmit();
    });

    // Tecla Enter para enviar
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
    this.passwordInput?.addEventListener('keydown', handleKeydown);
  }

  private updateMaxPlayersDisplay(): void {
    if (this.maxPlayersDisplay) {
      this.maxPlayersDisplay.textContent = this.maxPlayers.toString();
    }
    if (this.maxPlayersInput) {
      this.maxPlayersInput.value = this.maxPlayers.toString();
    }
  }

  public show(defaultRoomName: string = 'Sala Oficial'): void {
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
        // Fallback para entornos de test
      }
    }

    this.updateStadiumPreview();

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
    this.maxPlayers = 6;
    this.updateMaxPlayersDisplay();
    if (this.timeLimitSelect) this.timeLimitSelect.value = '3';
    if (this.scoreLimitSelect) this.scoreLimitSelect.value = '3';
    if (this.isPrivateCheckbox) this.isPrivateCheckbox.checked = false;
    if (this.passwordContainer) this.passwordContainer.style.display = 'none';
    if (this.passwordInput) this.passwordInput.value = '';
    if (this.isPublicCheckbox) this.isPublicCheckbox.checked = true;
    this.teamsLocked = false;
    if (this.lockTeamsBtn) {
      this.lockTeamsBtn.textContent = '🔓 Equipos Libres';
      this.lockTeamsBtn.style.color = 'var(--neon-cyan)';
    }
    this.selectedStadiumId = 'AF 3v3 Official';
    this.updateStadiumPreview();
  }
}
