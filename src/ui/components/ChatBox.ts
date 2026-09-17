import { animate } from 'motion';

export interface ChatMessage {
  author: string;
  text: string;
  team?: 'red' | 'blue' | 'spec' | 'sys';
}

export class ChatBox {
  private container: HTMLElement | null = null;
  private inputEl: HTMLInputElement | null = null;
  private formEl: HTMLFormElement | null = null;
  public onSendMessage?: (text: string) => void;

  constructor() {
    this.container = document.getElementById('chat-messages') || document.getElementById('chatMessages');
    if (!this.container) {
      console.warn('[ChatBox] Element "#chat-messages" was not found in DOM.');
    }

    this.inputEl = (document.getElementById('chat-input') || document.getElementById('chatInput')) as HTMLInputElement | null;
    if (!this.inputEl) {
      console.warn('[ChatBox] Element "#chat-input" was not found in DOM.');
    }

    this.formEl = (document.getElementById('chatForm') || document.getElementById('chat-form')) as HTMLFormElement | null;
    if (!this.formEl) {
      console.warn('[ChatBox] Element "#chatForm" was not found in DOM.');
    }

    const submitMessage = () => {
      if (!this.inputEl) return;
      const text = this.inputEl.value.trim();
      if (text && this.onSendMessage) {
        this.onSendMessage(text);
      }
      this.inputEl.value = '';
      this.inputEl.blur(); // Return focus to gameplay
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
        this.blur();
      }
    });
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
