export interface ChatMessage {
  author: string;
  text: string;
  team?: 'red' | 'blue' | 'spec' | 'sys';
}

export class ChatBox {
  private container: HTMLElement;
  private inputEl: HTMLInputElement;
  private formEl: HTMLFormElement;
  public onSendMessage?: (text: string) => void;

  constructor() {
    this.container = (document.getElementById('chat-messages') || document.getElementById('chatMessages'))!;
    this.inputEl = (document.getElementById('chat-input') || document.getElementById('chatInput')) as HTMLInputElement;
    this.formEl = (document.getElementById('chatForm') || document.getElementById('chat-form')) as HTMLFormElement;


    const submitMessage = () => {
      const text = this.inputEl.value.trim();
      if (text && this.onSendMessage) {
        this.onSendMessage(text);
      }
      this.inputEl.value = '';
      this.inputEl.blur(); // Return focus to gameplay
    };

    if (this.formEl) {
      this.formEl.addEventListener('submit', (e) => {
        e.preventDefault();
        submitMessage();
      });
    }

    if (this.inputEl) {
      this.inputEl.addEventListener('keydown', (e) => {
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
  }

  public focus(): void {
    this.inputEl?.focus();
  }

  public blur(): void {
    this.inputEl?.blur();
  }

  public isFocused(): boolean {
    return document.activeElement === this.inputEl;
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
