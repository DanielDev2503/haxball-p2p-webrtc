import { animate } from 'motion';

export interface ChatMessage {
  author: string;
  text: string;
  team?: 'red' | 'blue' | 'spec' | 'sys';
}

export const CHAT_STORAGE_KEY = 'haxball_chat_height';
const DEFAULT_CHAT_HEIGHT = 130;
const MIN_CHAT_HEIGHT = 45;

export class ChatBox {
  private container: HTMLElement | null = null;
  private boxEl: HTMLElement | null = null;
  private resizeHandleEl: HTMLElement | null = null;
  private inputEl: HTMLInputElement | null = null;
  private formEl: HTMLFormElement | null = null;
  private preferredHeight: number = DEFAULT_CHAT_HEIGHT;
  private isMenuOpen: boolean = false;
  private currentMenuEl: HTMLElement | null = null;

  public onSendMessage?: (text: string) => void;
  public onHeightChange?: (height: number) => void;

  constructor() {
    this.container = document.getElementById('chat-messages') || document.getElementById('chatMessages');
    if (!this.container) {
      console.warn('[ChatBox] Element "#chat-messages" was not found in DOM.');
    }

    this.boxEl = document.getElementById('chat-container') || (typeof document !== 'undefined' && typeof document.querySelector === 'function' ? (document.querySelector('.chat-box') as HTMLElement | null) : null);
    this.resizeHandleEl = document.getElementById('chat-resize-handle');

    this.inputEl = (document.getElementById('chat-input') || document.getElementById('chatInput')) as HTMLInputElement | null;
    if (!this.inputEl) {
      console.warn('[ChatBox] Element "#chat-input" was not found in DOM.');
    }

    this.formEl = (document.getElementById('chatForm') || document.getElementById('chat-form')) as HTMLFormElement | null;
    if (!this.formEl) {
      console.warn('[ChatBox] Element "#chatForm" was not found in DOM.');
    }

    // Cargar altura preferida persistida
    this.loadPreferredHeight();
    this.applyHeight(this.preferredHeight);

    // Inicializar tirador de arrastre superior (Drag Handle)
    this.setupResizeHandle();

    // Responsive listener para pantallas reducidas (< 650px)
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', () => {
        this.updateResponsiveHeight();
      });
    }

    const submitMessage = () => {
      if (!this.inputEl) return;
      const text = this.inputEl.value.trim();
      if (text && this.onSendMessage) {
        this.onSendMessage(text);
      }
      this.inputEl.value = '';
      this.inputEl.blur(); // Desenfocar inmediatamente para devolver control de juego
    };

    this.formEl?.addEventListener('submit', (e) => {
      e.preventDefault();
      submitMessage();
    });

    this.inputEl?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        submitMessage();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (this.inputEl) {
          this.inputEl.value = '';
        }
        this.blur();
      }
    });
  }

  private loadPreferredHeight(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      const saved = localStorage.getItem(CHAT_STORAGE_KEY);
      if (saved) {
        const parsed = parseInt(saved, 10);
        if (!isNaN(parsed) && parsed >= MIN_CHAT_HEIGHT) {
          this.preferredHeight = parsed;
        }
      }
    } catch {
      // Ignorar errores de acceso a almacenamiento en modo incógnito/sandbox
    }
  }

  private savePreferredHeight(height: number): void {
    this.preferredHeight = height;
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(CHAT_STORAGE_KEY, `${height}px`);
    } catch {
      // Ignorar errores de acceso a almacenamiento
    }
  }

  private setupResizeHandle(): void {
    if (!this.resizeHandleEl && this.boxEl) {
      this.resizeHandleEl = document.createElement('div');
      this.resizeHandleEl.id = 'chat-resize-handle';
      this.resizeHandleEl.className = 'chat-resize-handle';
      this.resizeHandleEl.title = 'Arrastra para redimensionar el chat';
      if (typeof this.boxEl.prepend === 'function') {
        this.boxEl.prepend(this.resizeHandleEl);
      } else if (this.boxEl.firstChild && typeof this.boxEl.insertBefore === 'function') {
        this.boxEl.insertBefore(this.resizeHandleEl, this.boxEl.firstChild);
      } else if (typeof this.boxEl.appendChild === 'function') {
        this.boxEl.appendChild(this.resizeHandleEl);
      }
    }

    if (!this.resizeHandleEl || !this.boxEl) return;

    let isDragging = false;
    let startY = 0;
    let startH = 0;

    const onPointerDown = (e: MouseEvent | PointerEvent) => {
      if (e.button !== 0) return; // Solo clic primario
      isDragging = true;
      startY = e.clientY;
      startH = this.boxEl?.getBoundingClientRect().height || this.preferredHeight;

      if (this.resizeHandleEl) {
        this.resizeHandleEl.classList.add('is-resizing');
      }
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'ns-resize';

      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('mousemove', onPointerMove);
      window.addEventListener('mouseup', onPointerUp);

      e.preventDefault();
    };

    const onPointerMove = (e: MouseEvent | PointerEvent) => {
      if (!isDragging || !this.boxEl) return;
      const deltaY = startY - e.clientY; // Arrastrar hacia arriba incrementa la altura
      const viewportH = typeof window !== 'undefined' ? window.innerHeight : 800;
      const maxH = Math.max(MIN_CHAT_HEIGHT, viewportH * 0.6);
      const newHeight = Math.max(MIN_CHAT_HEIGHT, Math.min(maxH, startH + deltaY));

      this.preferredHeight = newHeight;
      this.boxEl.style.height = `${newHeight}px`;
    };

    const onPointerUp = () => {
      if (!isDragging) return;
      isDragging = false;

      if (this.resizeHandleEl) {
        this.resizeHandleEl.classList.remove('is-resizing');
      }
      document.body.style.userSelect = '';
      document.body.style.cursor = '';

      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('mousemove', onPointerMove);
      window.removeEventListener('mouseup', onPointerUp);

      this.savePreferredHeight(this.preferredHeight);
      this.updateResponsiveHeight();
    };

    this.resizeHandleEl.addEventListener('pointerdown', onPointerDown);
    this.resizeHandleEl.addEventListener('mousedown', onPointerDown);
  }

  public applyHeight(heightPx: number): void {
    if (!this.boxEl) return;
    this.boxEl.style.height = `${heightPx}px`;
    this.onHeightChange?.(heightPx);
  }

  /**
   * Prevención Estricta de Solapamiento con el Menú Central:
   * chatMaxHeight = min(userPreferredHeight, viewportHeight - menuBottom - 16px)
   */
  public adjustForMenu(isOpen: boolean, menuEl?: HTMLElement | null): void {
    this.isMenuOpen = isOpen;
    if (menuEl) this.currentMenuEl = menuEl;

    this.updateResponsiveHeight();
  }

  private updateResponsiveHeight(): void {
    if (!this.boxEl) return;
    const viewportH = typeof window !== 'undefined' ? window.innerHeight : 800;

    // Edge case: Ventana < 650px colapsa el chat a un máximo de 3 líneas (~65px)
    if (viewportH < 650) {
      this.boxEl.style.height = '65px';
      this.boxEl.style.maxHeight = '65px';
      this.onHeightChange?.(65);
      return;
    }

    if (this.isMenuOpen) {
      const menu = this.currentMenuEl || (typeof document !== 'undefined' && typeof document.querySelector === 'function' ? (document.querySelector('.menu-modal-card') as HTMLElement | null) : null);
      let menuBottom = viewportH * 0.75;
      if (menu && typeof menu.getBoundingClientRect === 'function') {
        const rect = menu.getBoundingClientRect();
        if (rect.bottom > 0) {
          menuBottom = rect.bottom;
        }
      }

      // chatMaxHeight = min(userPreferredHeight, viewportHeight - menuBottom - 16px)
      const availableSpace = viewportH - menuBottom - 16;
      const chatMaxHeight = Math.max(MIN_CHAT_HEIGHT, Math.min(this.preferredHeight, availableSpace));

      this.boxEl.style.maxHeight = `${chatMaxHeight}px`;
      this.boxEl.style.height = `${chatMaxHeight}px`;
      this.onHeightChange?.(chatMaxHeight);
    } else {
      this.boxEl.style.maxHeight = '';
      this.boxEl.style.height = `${this.preferredHeight}px`;
      this.onHeightChange?.(this.preferredHeight);
    }
  }

  public focus(): void {
    if (this.inputEl) {
      this.inputEl.focus();
    }
  }

  public blur(): void {
    this.inputEl?.blur();
  }

  public clear(): void {
    if (this.container) {
      this.container.innerHTML = '';
    }
  }

  public isFocused(): boolean {
    return Boolean(this.inputEl && document.activeElement === this.inputEl);
  }

  private animateRowEntry(element: HTMLElement): void {
    try {
      if (typeof element?.animate === 'function') {
        animate(element, { opacity: [0, 1], y: [6, 0] }, { duration: 0.25 });
      }
    } catch {
      // Entornos de prueba sin Web Animations API continúan de forma segura
    }
  }

  public addSystemMessage(message: string): void {
    if (!this.container) return;

    const row = document.createElement('div');
    row.className = 'chat-msg chat-msg--system';
    row.textContent = message;

    this.container.appendChild(row);
    this.container.scrollTop = this.container.scrollHeight;

    this.animateRowEntry(row);
  }

  public addMessage(msg: ChatMessage): void {
    if (!this.container) return;

    if (msg.team === 'sys') {
      this.addSystemMessage(msg.text);
      return;
    }

    const row = document.createElement('div');
    row.className = `chat-msg ${msg.team ?? 'spec'}`;

    const authorSpan = document.createElement('span');
    authorSpan.className = 'author';
    authorSpan.textContent = `${msg.author}:`;
    row.appendChild(authorSpan);

    const textSpan = document.createElement('span');
    textSpan.textContent = ` ${msg.text}`;
    row.appendChild(textSpan);

    this.container.appendChild(row);
    this.container.scrollTop = this.container.scrollHeight;

    this.animateRowEntry(row);
  }
}
