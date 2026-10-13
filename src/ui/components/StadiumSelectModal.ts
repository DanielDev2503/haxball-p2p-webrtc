import { StadiumRegistry, StadiumPreset } from '../../core/stadiums/StadiumRegistry';
import { toggleTheme, $roomConfig } from '../stores/gameStore';

export interface StadiumSelectEvents {
  onSelect?: (stadiumId: string) => void;
  onClose?: () => void;
}

export class StadiumSelectModal {
  public modalEl: HTMLElement | null = null;
  public cardEl: HTMLElement | null = null;
  public backBtn: HTMLButtonElement | null = null;
  public themeBtn: HTMLButtonElement | null = null;
  public confirmBtn: HTMLButtonElement | null = null;

  public selectedStadiumId: string = 'AF 3v3 Official';
  private events: StadiumSelectEvents;

  constructor(events: StadiumSelectEvents = {}) {
    this.events = events;
    this.buildDOM();
  }

  private buildDOM(): void {
    if (typeof document === 'undefined') return;

    let overlay = document.getElementById('stadiumPickerModal');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'stadiumPickerModal';
      overlay.className = 'modal-overlay modal-backdrop u-hidden';
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
      <button class="modal-nav-back-btn" id="btnStadiumBack" type="button" title="Volver">
        &lt; Volver
      </button>

      <!-- Botón exterior de alternador de tema "[ ☼ / ☾ ]" (Top-Right) -->
      <button class="modal-nav-theme-btn" id="btnStadiumThemeToggle" type="button" title="Alternar Modo Claro / Oscuro">
        ☼ / ☾
      </button>

      <!-- Chasis Central Asimétrico de 2 Columnas -->
      <div id="stadiumModalCard" class="stadium-modal-card">
        <!-- Columna Izquierda: Carrusel Vertical de Estadios (260px) -->
        <aside class="modal-sidebar-left" style="width: 260px; padding: 18px 14px;">
          <div style="border-bottom: 1px solid rgba(0, 229, 255, 0.2); padding-bottom: 12px; margin-bottom: 12px;">
            <h2 style="margin: 0; font-size: 14px; font-weight: 800; color: var(--neon-cyan); letter-spacing: 0.5px; display: flex; align-items: center; gap: 8px;">
              <span>ESTADIOS</span> <span>🏟</span>
            </h2>
            <span style="font-size: 11px; color: var(--text-secondary); margin-top: 2px; display: block;">Mapas oficiales y estándar</span>
          </div>

          <div id="stadiumCardsContainer" class="cyber-scrollbar" style="display: flex; flex-direction: column; gap: 8px; overflow-y: auto !important; overflow-x: hidden !important; max-height: 480px; flex: 1; padding-right: 4px;">
          </div>
        </aside>

        <!-- Columna Derecha: Vista Previa Superior y Datos Técnicos (~660px) -->
        <main style="flex: 1; display: flex; flex-direction: column; padding: 20px 24px; box-sizing: border-box; overflow: hidden; gap: 14px;">
          
          <!-- SECCIÓN SUPERIOR: Preview 2D Cenital Panorámico (250px) -->
          <div style="background: rgba(12, 40, 30, 0.85); border: 1.5px solid rgba(0, 229, 255, 0.3); border-radius: 10px; height: 250px; position: relative; overflow: hidden; display: flex; align-items: center; justify-content: center; box-shadow: inset 0 0 30px rgba(0, 0, 0, 0.8);">
            <canvas id="stadiumPanoramicCanvas" width="560" height="230" style="max-width: 100%; max-height: 100%; display: block;"></canvas>
            <span id="stadiumBadgeOverlay" style="position: absolute; top: 10px; left: 14px; font-size: 11px; font-weight: 800; color: var(--neon-cyan); background: rgba(10, 16, 26, 0.85); border: 1px solid var(--border-cyan); border-radius: 4px; padding: 3px 8px;">
              PREVIEW 2D CENITAL
            </span>
          </div>

          <!-- SECCIÓN INFERIOR: Metadatos Técnicos -->
          <div id="stadiumTechnicalMetadata" style="flex: 1; background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(0, 229, 255, 0.2); border-radius: 8px; padding: 14px 18px; display: flex; flex-direction: column; justify-content: space-around;">
            <div>
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <h3 id="metaStadiumTitle" style="margin: 0; font-size: 16px; font-weight: 800; color: #fff;">AF 3v3 Official</h3>
                <span id="metaStadiumFormat" style="font-size: 12px; font-weight: 700; color: #2ecc71; background: rgba(46, 204, 113, 0.15); border: 1px solid #2ecc71; border-radius: 4px; padding: 2px 8px;">3v3 Oficial</span>
              </div>
              <p id="metaStadiumDesc" style="margin: 4px 0 0 0; font-size: 12px; color: var(--text-secondary);">710x300 - Arcos 170 (Oficial Vitão ®)</p>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; border-top: 1px solid rgba(0, 229, 255, 0.12); padding-top: 10px;">
              <div>
                <span style="font-size: 11px; color: var(--text-secondary); display: block;">Dimensiones y Arcos</span>
                <span id="metaStadiumDimensions" style="font-size: 12px; font-weight: 700; color: #e2e8f0;">1200 x 540 px | Arcos: 170 px</span>
              </div>
              <div>
                <span style="font-size: 11px; color: var(--text-secondary); display: block;">Física y Rebote en Bandas</span>
                <span id="metaStadiumPhysics" style="font-size: 12px; font-weight: 700; color: #e2e8f0;">Rebote bCoef: 0.412 | Red: Elástica</span>
              </div>
            </div>
          </div>

          <!-- MÓDULO INFERIOR: Botón CTA -->
          <button id="btnConfirmStadiumSelect" class="btn-cta-green" style="width: 100%; height: 46px;" type="button">
            <span>🏟</span> <span>SELECCIONAR ESTADIO</span>
          </button>
        </main>
      </div>
    `;

    this.cardEl = overlay.querySelector('.stadium-modal-card');
    this.backBtn = overlay.querySelector('#btnStadiumBack');
    this.themeBtn = overlay.querySelector('#btnStadiumThemeToggle');
    this.confirmBtn = overlay.querySelector('#btnConfirmStadiumSelect');

    this.renderStadiumCards();
    this.setupListeners();
    this.updatePreviewAndMetadata();
  }

  private renderStadiumCards(): void {
    if (!this.modalEl) return;
    const container = this.modalEl.querySelector('#stadiumCardsContainer');
    if (!container) return;
    container.innerHTML = '';

    // Estadios primarios del sistema
    const mapList = [
      { id: 'AF 3v3 Official', label: 'AF 3v3 Official', sub: 'Estándar Competitivo', format: '3v3 Oficial' },
      { id: 'classic', label: 'Classic Field', sub: 'Haxball Clásico', format: '2v2 / 3v3' },
      { id: 'big', label: 'Big Stadium', sub: 'Cancha Grande', format: '4v4 / 5v5' },
      { id: 'small', label: 'Small Arena', sub: 'Espacio Reducido', format: '1v1 / 2v2' }
    ];

    // Incluir cualquier otro mapa que exista en StadiumRegistry
    for (const key of Object.keys(StadiumRegistry)) {
      if (!mapList.some(m => m.id === key) && key !== 'af3v3') {
        const p = StadiumRegistry[key];
        mapList.push({
          id: key,
          label: p.name,
          sub: p.description,
          format: `${p.width}x${p.height}`
        });
      }
    }

    mapList.forEach((map) => {
      const isSelected = map.id === this.selectedStadiumId;
      const card = document.createElement('div');
      card.className = `stadium-card-item stadium-option-btn ${isSelected ? 'active active-stadium' : ''}`;
      card.setAttribute('data-stadium', map.id);

      card.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 2px;">
          <span style="font-size: 12px; font-weight: 800; color: #fff;">${map.label}</span>
          <span style="font-size: 10px; color: var(--text-secondary);">${map.sub}</span>
        </div>
        <span class="stadium-check" style="font-size: 13px; font-weight: 800; color: ${isSelected ? 'var(--neon-cyan)' : 'transparent'};">✓</span>
      `;

      card.addEventListener('click', (e) => {
        e.stopPropagation();
        this.selectStadium(map.id);
      });

      container.appendChild(card);
    });
  }

  public selectStadium(stadiumId: string): void {
    this.selectedStadiumId = stadiumId;

    if (this.modalEl) {
      const cards = typeof this.modalEl.querySelectorAll === 'function' ? this.modalEl.querySelectorAll('.stadium-card-item') : [];
      cards.forEach((c) => {
        const id = c.getAttribute('data-stadium');
        const check = c.querySelector('.stadium-check') as HTMLElement | null;
        if (id === stadiumId) {
          c.classList.add('active', 'active-stadium');
          if (check) check.style.color = 'var(--neon-cyan)';
        } else {
          c.classList.remove('active', 'active-stadium');
          if (check) check.style.color = 'transparent';
        }
      });
    }

    this.updatePreviewAndMetadata();
  }

  private updatePreviewAndMetadata(): void {
    if (!this.modalEl) return;
    const preset = StadiumRegistry[this.selectedStadiumId] || StadiumRegistry['AF 3v3 Official'];
    if (!preset) return;

    // Actualizar metadatos
    const titleEl = this.modalEl.querySelector('#metaStadiumTitle');
    const descEl = this.modalEl.querySelector('#metaStadiumDesc');
    const formatEl = this.modalEl.querySelector('#metaStadiumFormat');
    const dimEl = this.modalEl.querySelector('#metaStadiumDimensions');
    const physEl = this.modalEl.querySelector('#metaStadiumPhysics');

    if (titleEl) titleEl.textContent = preset.name;
    if (descEl) descEl.textContent = preset.description || `${preset.width}x${preset.height} px`;
    if (formatEl) {
      if (this.selectedStadiumId === 'small') formatEl.textContent = '1v1 / 2v2 Reducido';
      else if (this.selectedStadiumId === 'big') formatEl.textContent = '4v4 / 5v5 Grande';
      else if (this.selectedStadiumId === 'classic') formatEl.textContent = '2v2 / 3v3 Clásico';
      else formatEl.textContent = '3v3 Competitivo Oficial';
    }
    if (dimEl) dimEl.textContent = `${preset.width} x ${preset.height} px | Arcos: ${preset.goalWidth || preset.goalSize} px`;
    if (physEl) {
      const bCoef = preset.ballPhysics?.bCoef ?? 0.5;
      physEl.textContent = `Rebote bCoef: ${bCoef} | Red: Elástica Amortiguada`;
    }

    // Dibujar Preview Cenital 2D
    const canvas = this.modalEl.querySelector('#stadiumPanoramicCanvas') as HTMLCanvasElement | null;
    if (canvas && typeof canvas.getContext === 'function') {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        this.drawPitchPreview(ctx, canvas.width, canvas.height, preset);
      }
    }
  }

  private drawPitchPreview(ctx: CanvasRenderingContext2D, width: number, height: number, preset: StadiumPreset): void {
    ctx.clearRect(0, 0, width, height);

    // Fondo césped
    ctx.fillStyle = preset.bgColor || '#0d281e';
    ctx.fillRect(0, 0, width, height);

    const padX = 40;
    const padY = 25;
    const pitchW = width - padX * 2;
    const pitchH = height - padY * 2;

    // Patrón de corte de césped
    ctx.fillStyle = 'rgba(255, 255, 255, 0.03)';
    const stripes = 8;
    const stripeW = pitchW / stripes;
    for (let i = 0; i < stripes; i += 2) {
      ctx.fillRect(padX + i * stripeW, padY, stripeW, pitchH);
    }

    // Líneas de cal del terreno
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.55)';
    ctx.lineWidth = 2;
    ctx.strokeRect(padX, padY, pitchW, pitchH);

    // Línea de medio campo
    ctx.beginPath();
    ctx.moveTo(width / 2, padY);
    ctx.lineTo(width / 2, height - padY);
    ctx.stroke();

    // Círculo central
    const centerRadius = (preset.kickOffRadius || 80) * 0.45;
    ctx.beginPath();
    ctx.arc(width / 2, height / 2, centerRadius, 0, Math.PI * 2);
    ctx.stroke();

    // Áreas de penalti / portería
    const areaW = pitchW * 0.16;
    const areaH = pitchH * 0.55;
    const areaY = height / 2 - areaH / 2;

    // Área izquierda
    ctx.strokeRect(padX, areaY, areaW, areaH);
    // Área derecha
    ctx.strokeRect(width - padX - areaW, areaY, areaW, areaH);

    // Arcos y redes
    const goalDepth = 16;
    const goalH = Math.min(pitchH * 0.42, (preset.goalSize || 170) * 0.35);
    const goalY = height / 2 - goalH / 2;

    // Red izquierda (roja sutil)
    ctx.fillStyle = 'rgba(239, 68, 68, 0.25)';
    ctx.fillRect(padX - goalDepth, goalY, goalDepth, goalH);
    ctx.strokeStyle = '#ef4444';
    ctx.strokeRect(padX - goalDepth, goalY, goalDepth, goalH);

    // Red derecha (azul sutil)
    ctx.fillStyle = 'rgba(59, 130, 246, 0.25)';
    ctx.fillRect(width - padX, goalY, goalDepth, goalH);
    ctx.strokeStyle = '#3b82f6';
    ctx.strokeRect(width - padX, goalY, goalDepth, goalH);

    // Spawn points de jugadores (o)
    const drawSpawn = (x: number, y: number, color: string) => {
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    };

    // Spawns RED (izquierda)
    drawSpawn(padX + pitchW * 0.22, height / 2 - 30, '#ef4444');
    drawSpawn(padX + pitchW * 0.22, height / 2 + 30, '#ef4444');
    drawSpawn(padX + pitchW * 0.12, height / 2, '#ef4444');

    // Spawns BLUE (derecha)
    drawSpawn(width - padX - pitchW * 0.22, height / 2 - 30, '#3b82f6');
    drawSpawn(width - padX - pitchW * 0.22, height / 2 + 30, '#3b82f6');
    drawSpawn(width - padX - pitchW * 0.12, height / 2, '#3b82f6');

    // Balón central
    ctx.beginPath();
    ctx.arc(width / 2, height / 2, 5, 0, Math.PI * 2);
    ctx.fillStyle = preset.ballPhysics?.color || '#FFA500';
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  private setupListeners(): void {
    if (!this.modalEl) return;

    // 1. Botón < Volver
    this.backBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.close();
    });

    // 2. Botón [ ☼ / ☾ ]
    this.themeBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleTheme();
    });

    // Click fuera de la tarjeta cierra el modal
    this.modalEl.addEventListener('click', (e) => {
      if (e.target === this.modalEl) {
        this.close();
      }
    });

    // 3. Botón CTA Confirmar Selección
    this.confirmBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.confirmSelection();
    });

    // Soporte para botón legado #btnCloseStadiumPicker si existe
    const legacyClose = document.getElementById('btnCloseStadiumPicker');
    legacyClose?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.close();
    });
  }

  public confirmSelection(): void {
    $roomConfig.set({ ...$roomConfig.get(), stadiumId: this.selectedStadiumId });

    // Actualizar nombre visible en el Lobby si está presente
    const stadiumDisplay = document.getElementById('currentStadiumName');
    if (stadiumDisplay) {
      const preset = StadiumRegistry[this.selectedStadiumId];
      stadiumDisplay.textContent = preset ? preset.name : this.selectedStadiumId;
    }

    if (this.events.onSelect) {
      this.events.onSelect(this.selectedStadiumId);
    }

    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent('stadium:change', { detail: { stadiumId: this.selectedStadiumId } }));
    }

    this.close();
  }

  public open(): void {
    this.show();
  }

  public show(): void {
    if (!this.modalEl) return;
    this.modalEl.classList.remove('u-hidden');
    this.modalEl.style.display = 'flex';
    this.updatePreviewAndMetadata();
  }

  public close(): void {
    this.hide();
  }

  public hide(): void {
    if (!this.modalEl) return;
    this.modalEl.classList.add('u-hidden');
    this.modalEl.style.display = 'none';
    this.events.onClose?.();
  }

  public isOpen(): boolean {
    if (!this.modalEl) return false;
    return !this.modalEl.classList.contains('u-hidden') && this.modalEl.style.display !== 'none';
  }
}
