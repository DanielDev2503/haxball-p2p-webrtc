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
        submitMessage();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.blur();
      }
    });
  }

  public focus(): void {
    this.inputEl?.focus();
  }

  public blur(): void {
    this.inputEl?.blur();
  }

  public isFocused(): boolean {
    return Boolean(this.inputEl && document.activeElement === this.inputEl);
  }

  public addMessage(msg: ChatMessage): void {
    if (!this.container) return;

    const row = document.createElement('div');
    row.className = `chat-msg ${msg.team ?? 'spec'}`;

    if (msg.team === 'sys') {
      row.textContent = `[SYSTEM] ${msg.text}`;
    } else {
      const authorSpan = document.createElement('span');
      authorSpan.className = 'author';
      authorSpan.textContent = `${msg.author}:`;
      row.appendChild(authorSpan);

      const textSpan = document.createElement('span');
      textSpan.textContent = ` ${msg.text}`;
      row.appendChild(textSpan);
    }

    this.container.appendChild(row);
    this.container.scrollTop = this.container.scrollHeight;
  }
}
