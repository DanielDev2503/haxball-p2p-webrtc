import { INPUT_UP, INPUT_DOWN, INPUT_LEFT, INPUT_RIGHT, INPUT_KICK } from '../core/game/Player';

export class InputManager {
  private keyStates: Map<string, boolean> = new Map();
  public currentMask: number = 0;
  public onInputChanged?: (mask: number) => void;

  constructor() {
    this.setupListeners();
  }

  private setupListeners(): void {
    window.addEventListener('keydown', (e) => {
      // Avoid capturing inputs if typing in chat or text inputs
      if (
        document.activeElement instanceof HTMLInputElement ||
        document.activeElement instanceof HTMLTextAreaElement
      ) {
        return;
      }

      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyS', 'KeyA', 'KeyD', 'Space', 'KeyX'].includes(e.code)) {
        e.preventDefault();
      }

      if (!this.keyStates.get(e.code)) {
        this.keyStates.set(e.code, true);
        this.updateMask();
      }
    });

    window.addEventListener('keyup', (e) => {
      if (this.keyStates.get(e.code)) {
        this.keyStates.set(e.code, false);
        this.updateMask();
      }
    });

    // Reset inputs if window loses focus
    window.addEventListener('blur', () => {
      this.keyStates.clear();
      this.updateMask();
    });
  }

  private updateMask(): void {
    let mask = 0;

    const up = this.keyStates.get('KeyW') || this.keyStates.get('ArrowUp');
    const down = this.keyStates.get('KeyS') || this.keyStates.get('ArrowDown');
    const left = this.keyStates.get('KeyA') || this.keyStates.get('ArrowLeft');
    const right = this.keyStates.get('KeyD') || this.keyStates.get('ArrowRight');
    const kick = this.keyStates.get('Space') || this.keyStates.get('KeyX') || this.keyStates.get('ControlLeft');

    if (up) mask |= INPUT_UP;
    if (down) mask |= INPUT_DOWN;
    if (left) mask |= INPUT_LEFT;
    if (right) mask |= INPUT_RIGHT;
    if (kick) mask |= INPUT_KICK;

    if (mask !== this.currentMask) {
      this.currentMask = mask;
      if (this.onInputChanged) {
        this.onInputChanged(mask);
      }
    }
  }

  public getMask(): number {
    return this.currentMask;
  }
}
