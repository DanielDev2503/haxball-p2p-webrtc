import { animate } from 'motion';
import type { AudioManager } from '../../client/AudioManager';

export interface ChatMessage {
  author: string;
  text: string;
  team?: 'red' | 'blue' | 'spec' | 'sys';
}

export const CHAT_STORAGE_KEY = 'haxball_chat_height';
const DEFAULT_CHAT_HEIGHT = 130;
const MIN_CHAT_HEIGHT = 64;

export class ChatBox {
  private container: HTMLElement | null = null;
  private boxEl: HTMLElement | null = null;
  private resizeHandleEl: HTMLElement | null = null;
  public inputEl: HTMLInputElement | null = null;
  private formEl: HTMLFormElement | null = null;
  private preferredHeight: number = DEFAULT_CHAT_HEIGHT;
  private resizeObserver: ResizeObserver | null = null;

  public isTyping: boolean = false;
  public onTypingChange?: (isTyping: boolean) => void;
  public audioManager?: AudioManager;
  public onSendMessage?: (text: string) => void;
  public onHeightChange?: (height: number) => void;
  public onExtrapolationChange?: (ms: number) => void;
  public onExtrapolationChanged?: (ms: number) => void;
  public getExtrapolationMs?: () => number;

  constructor() {
    this.container = document.getElementById('chat-messages') || document.getElementById('chatMessages');
    if (!this.container) {
      console.warn('[ChatBox] Element "#chat-messages" was not found in DOM.');
    } else if (this.container.style) {
      this.container.style.userSelect = 'text';
      (this.container.style as any).webkitUserSelect = 'text';
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

    // Instrumentar ResizeObserver para exponer dinámicamente --chat-height
    this.setupResizeObserver();

    // Responsive listener para pantallas reducidas (< 650px)
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', () => {
        this.updateResponsiveHeight();
      });
    }

    const setTypingState = (typing: boolean) => {
      if (this.isTyping !== typing) {
        this.isTyping = typing;
        this.onTypingChange?.(typing);
      }
    };

    const submitMessage = () => {
      if (!this.inputEl) return;
      const text = this.inputEl.value.trim();
      if (text) {
        if (this.handleLocalCommand(text)) {
          // Comando resuelto localmente
        } else if (this.onSendMessage) {
          this.onSendMessage(text);
        }
      }
      this.inputEl.value = '';
      setTypingState(false);
      this.inputEl.blur(); // Desenfocar inmediatamente para devolver control de juego
    };

    this.formEl?.addEventListener('submit', (e) => {
      e.preventDefault();
      submitMessage();
    });

    this.inputEl?.addEventListener('focus', () => {
      setTypingState(true);
    });

    this.inputEl?.addEventListener('input', () => {
      setTypingState(true);
    });

    this.inputEl?.addEventListener('blur', () => {
      setTypingState(false);
    });

    this.inputEl?.addEventListener('keydown', (e) => {
      // Requerimiento 3: Soporte para Enter y NumpadEnter
      if (e.key === 'Enter' || e.code === 'Enter' || e.code === 'NumpadEnter') {
        e.preventDefault();
        e.stopPropagation();
        submitMessage();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (this.inputEl) {
          this.inputEl.value = '';
        }
        setTypingState(false);
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

      if ('pointerId' in e && this.resizeHandleEl && typeof this.resizeHandleEl.setPointerCapture === 'function') {
        try {
          this.resizeHandleEl.setPointerCapture(e.pointerId);
        } catch {
          // Ignore
        }
      }

      if (this.resizeHandleEl) {
        this.resizeHandleEl.classList.add('is-resizing');
      }
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'ns-resize';

      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('pointercancel', onPointerUp);
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

    const onPointerUp = (e?: MouseEvent | PointerEvent) => {
      if (!isDragging) return;
      isDragging = false;

      if (e && 'pointerId' in e && this.resizeHandleEl && typeof this.resizeHandleEl.releasePointerCapture === 'function') {
        try {
          this.resizeHandleEl.releasePointerCapture(e.pointerId);
        } catch {
          // Ignore
        }
      }

      if (this.resizeHandleEl) {
        this.resizeHandleEl.classList.remove('is-resizing');
      }
      document.body.style.userSelect = '';
      document.body.style.cursor = '';

      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      window.removeEventListener('mousemove', onPointerMove);
      window.removeEventListener('mouseup', onPointerUp);

      this.savePreferredHeight(this.preferredHeight);
      this.updateResponsiveHeight();
    };

    this.resizeHandleEl.addEventListener('pointerdown', onPointerDown);
    this.resizeHandleEl.addEventListener('pointercancel', onPointerUp);
    this.resizeHandleEl.addEventListener('mousedown', onPointerDown);
  }

  public applyHeight(heightPx: number): void {
    if (!this.boxEl) return;
    if (this.boxEl.style) {
      this.boxEl.style.maxHeight = '';
      this.boxEl.style.height = `${heightPx}px`;
    }
    if (typeof document !== 'undefined' && document.documentElement?.style?.setProperty) {
      document.documentElement.style.setProperty('--chat-height', `${heightPx}px`);
    }
    this.onHeightChange?.(heightPx);
  }

  private setupResizeObserver(): void {
    if (typeof ResizeObserver === 'undefined' || !this.boxEl) return;
    try {
      this.resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const h = Math.round(entry.contentRect.height || entry.target.getBoundingClientRect().height);
          if (h > 0 && typeof document !== 'undefined' && document.documentElement?.style?.setProperty) {
            document.documentElement.style.setProperty('--chat-height', `${h}px`);
          }
        }
      });
      this.resizeObserver.observe(this.boxEl);
    } catch {
      // Ignorar en entornos de pruebas
    }
  }

  public destroy(): void {
    if (this.resizeObserver && this.boxEl) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
  }

  /**
   * Invarianza Dimensional Estricta del Chat Box:
   * El chat mantiene estrictamente su altura configurada por el usuario en todo momento.
   * La apertura o cierre de menús jamás muta ni colapsa la altura del chat.
   */
  public adjustForMenu(_isOpen: boolean, _menuEl?: HTMLElement | null): void {
    // Invariante: no se modifica la altura ni max-height al interactuar con menús
  }

  private updateResponsiveHeight(): void {
    if (!this.boxEl) return;
    if (this.boxEl.style) {
      this.boxEl.style.maxHeight = '';
      this.boxEl.style.height = `${this.preferredHeight}px`;
    }
    if (typeof document !== 'undefined' && document.documentElement?.style?.setProperty) {
      document.documentElement.style.setProperty('--chat-height', `${this.preferredHeight}px`);
    }
    this.onHeightChange?.(this.preferredHeight);
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
    if (row.style) {
      row.style.userSelect = 'text';
      (row.style as any).webkitUserSelect = 'text';
    }
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

    try {
      this.audioManager?.playChatMessageSound();
    } catch {
      // Ignore audio synthesis errors
    }

    const row = document.createElement('div');
    row.className = `chat-msg ${msg.team ?? 'spec'}`;
    if (row.style) {
      row.style.userSelect = 'text';
      (row.style as any).webkitUserSelect = 'text';
    }

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

  public getHeight(): number {
    return this.preferredHeight;
  }

  public handleLocalCommand(text: string): boolean {
    const trimmed = text.trim();
    if (!trimmed.startsWith('/')) return false;

    const parts = trimmed.split(/\s+/);
    const cmd = parts[0].toLowerCase();

    if (cmd === '/extrapolation') {
      if (parts.length > 1) {
        const val = parseFloat(parts[1]);
        if (!isNaN(val) && val >= 0 && val <= 150) {
          const rounded = Math.round(val);
          if (typeof localStorage !== 'undefined') {
            try {
              localStorage.setItem('haxball_extrapolation', String(rounded));
            } catch {}
          }
          this.onExtrapolationChange?.(rounded);
          this.onExtrapolationChanged?.(rounded);
          this.addSystemMessage(`Extrapolation set to ${rounded} msec`);
        } else {
          this.addSystemMessage('Invalid extrapolation value. Use 0 - 150 msec.');
        }
      } else {
        const current = this.getCurrentExtrapolation();
        this.addSystemMessage(`Current extrapolation is ${current} msec`);
      }
      return true;
    }

    return false;
  }

  public getCurrentExtrapolation(): number {
    if (this.getExtrapolationMs) {
      return this.getExtrapolationMs();
    }
    if (typeof localStorage !== 'undefined') {
      try {
        const val = localStorage.getItem('haxball_extrapolation');
        if (val !== null) {
          const num = parseInt(val, 10);
          if (!isNaN(num)) return Math.max(0, Math.min(150, num));
        }
      } catch {}
    }
    return 0;
  }

  public printControlsGuide(): void {
    if (!this.container) return;
    const row = document.createElement('div');
    row.className = 'chat-msg chat-msg--system chat-msg--guide';
    if (row.style) {
      row.style.color = '#00E5FF';
      row.style.fontWeight = '600';
    }
    row.textContent = 'Controles: WASD (Moverse) | Espacio (Patear) | Shift (Turbo) | Flecha Arriba (Dash) | Flechas Izq/Der (Efecto)';
    this.container.appendChild(row);
    this.container.scrollTop = this.container.scrollHeight;
    this.animateRowEntry(row);
  }
}
