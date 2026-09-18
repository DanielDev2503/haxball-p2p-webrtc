import { INPUT_UP, INPUT_DOWN, INPUT_LEFT, INPUT_RIGHT, INPUT_KICK, INPUT_TURBO, INPUT_DASH } from '../core/game/Player';

export interface KeyBinds {
  up: string[];
  down: string[];
  left: string[];
  right: string[];
  kick: string[];
  curveUp: string[];
  curveDown: string[];
  curveLeft: string[];
  curveRight: string[];
  turbo: string[];
  dash: string[];
  menu: string[];
  pause: string[];
  chat: string[];
}

export const DEFAULT_KEYBINDS: KeyBinds = {
  up: ['KeyW'],
  down: ['KeyS'],
  left: ['KeyA'],
  right: ['KeyD'],
  kick: ['KeyX'],
  curveUp: ['ArrowUp', 'KeyI'],
  curveDown: ['ArrowDown', 'KeyK'],
  curveLeft: ['ArrowLeft', 'KeyJ'],
  curveRight: ['ArrowRight', 'KeyL'],
  turbo: ['ShiftLeft', 'ShiftRight'],
  dash: ['KeyE', 'Space'],
  menu: ['Escape'],
  pause: ['KeyP'],
  chat: ['Enter']
};

export const KEYBIND_STORAGE_KEY = 'haxball_keybinds';

export class InputManager {
  private keyStates: Map<string, boolean> = new Map();
  public currentMask: number = 0;
  public onInputChanged?: (mask: number) => void;
  public keyBinds: KeyBinds;
  public isEnabled: boolean = false;
  private dashTriggered: boolean = false;

  constructor() {
    this.keyBinds = this.loadKeyBinds();
    this.setupListeners();
  }

  public setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
    if (!enabled) {
      this.resetMovement();
    }
  }

  public loadKeyBinds(): KeyBinds {
    if (typeof localStorage === 'undefined') {
      return JSON.parse(JSON.stringify(DEFAULT_KEYBINDS));
    }
    try {
      const saved = localStorage.getItem(KEYBIND_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        return {
          up: Array.isArray(parsed.up) ? parsed.up : DEFAULT_KEYBINDS.up,
          down: Array.isArray(parsed.down) ? parsed.down : DEFAULT_KEYBINDS.down,
          left: Array.isArray(parsed.left) ? parsed.left : DEFAULT_KEYBINDS.left,
          right: Array.isArray(parsed.right) ? parsed.right : DEFAULT_KEYBINDS.right,
          kick: Array.isArray(parsed.kick) ? parsed.kick : DEFAULT_KEYBINDS.kick,
          curveUp: Array.isArray(parsed.curveUp) ? parsed.curveUp : DEFAULT_KEYBINDS.curveUp,
          curveDown: Array.isArray(parsed.curveDown) ? parsed.curveDown : DEFAULT_KEYBINDS.curveDown,
          curveLeft: Array.isArray(parsed.curveLeft) ? parsed.curveLeft : DEFAULT_KEYBINDS.curveLeft,
          curveRight: Array.isArray(parsed.curveRight) ? parsed.curveRight : DEFAULT_KEYBINDS.curveRight,
          turbo: Array.isArray(parsed.turbo) ? parsed.turbo : DEFAULT_KEYBINDS.turbo,
          dash: Array.isArray(parsed.dash) ? parsed.dash : DEFAULT_KEYBINDS.dash,
          menu: Array.isArray(parsed.menu) ? parsed.menu : DEFAULT_KEYBINDS.menu,
          pause: Array.isArray(parsed.pause) ? parsed.pause : DEFAULT_KEYBINDS.pause,
          chat: Array.isArray(parsed.chat) ? parsed.chat : DEFAULT_KEYBINDS.chat
        };
      }
    } catch (e) {
      console.warn('Error al cargar keybinds desde localStorage:', e);
    }
    return JSON.parse(JSON.stringify(DEFAULT_KEYBINDS));
  }

  public saveKeyBinds(binds: KeyBinds): void {
    this.keyBinds = binds;
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(KEYBIND_STORAGE_KEY, JSON.stringify(binds));
    } catch (e) {
      console.warn('Error al guardar keybinds en localStorage:', e);
    }
  }

  public resetToDefaultKeyBinds(): KeyBinds {
    const defaults = JSON.parse(JSON.stringify(DEFAULT_KEYBINDS));
    this.saveKeyBinds(defaults);
    return defaults;
  }

  public isActionKey(action: keyof KeyBinds, code: string): boolean {
    return this.keyBinds[action]?.includes(code) ?? false;
  }

  private isGameplayKey(code: string): boolean {
    return (
      this.keyBinds.up.includes(code) ||
      this.keyBinds.down.includes(code) ||
      this.keyBinds.left.includes(code) ||
      this.keyBinds.right.includes(code) ||
      this.keyBinds.kick.includes(code) ||
      this.keyBinds.curveUp.includes(code) ||
      this.keyBinds.curveDown.includes(code) ||
      this.keyBinds.curveLeft.includes(code) ||
      this.keyBinds.curveRight.includes(code) ||
      this.keyBinds.turbo.includes(code) ||
      this.keyBinds.dash.includes(code)
    );
  }

  private setupListeners(): void {
    if (typeof window === 'undefined') return;

    window.addEventListener('keydown', (e) => {
      if (!this.isEnabled) return;

      // Si el foco está en un input/textarea, no capturamos controles de juego
      if (
        document.activeElement instanceof HTMLInputElement ||
        document.activeElement instanceof HTMLTextAreaElement
      ) {
        return;
      }

      if (this.isGameplayKey(e.code)) {
        e.preventDefault();
      }

      if (this.isActionKey('dash', e.code)) {
        this.dashTriggered = true;
      }

      if (!this.keyStates.get(e.code)) {
        this.keyStates.set(e.code, true);
        this.updateMask();
      }
    });

    window.addEventListener('keyup', (e) => {
      if (!this.isEnabled) return;

      if (this.keyStates.get(e.code)) {
        this.keyStates.set(e.code, false);
        this.updateMask();
      }
    });

    // Reset inputs if window loses focus
    window.addEventListener('blur', () => {
      this.resetMovement();
    });

    // Reset inputs immediately if any text field gains focus
    document.addEventListener('focusin', (e) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        this.resetMovement();
      }
    });
  }

  public resetMovement(): void {
    this.keyStates.clear();
    this.dashTriggered = false;
    if (this.currentMask !== 0) {
      this.currentMask = 0;
      if (this.onInputChanged) {
        this.onInputChanged(0);
      }
    }
  }

  private updateMask(): void {
    let mask = 0;
    let up = false;
    let down = false;
    let left = false;
    let right = false;
    let kick = false;
    let turbo = false;
    let dash = false;

    for (const [code, isPressed] of this.keyStates.entries()) {
      if (!isPressed) continue;
      if (this.keyBinds.up.includes(code)) up = true;
      if (this.keyBinds.down.includes(code)) down = true;
      if (this.keyBinds.left.includes(code)) left = true;
      if (this.keyBinds.right.includes(code)) right = true;
      if (this.keyBinds.kick.includes(code)) kick = true;
      if (this.keyBinds.turbo?.includes(code)) turbo = true;
      if (this.keyBinds.dash?.includes(code)) dash = true;
    }

    if (up) mask |= INPUT_UP;
    if (down) mask |= INPUT_DOWN;
    if (left) mask |= INPUT_LEFT;
    if (right) mask |= INPUT_RIGHT;
    if (kick) mask |= INPUT_KICK;
    if (turbo) mask |= INPUT_TURBO;
    if (dash) mask |= INPUT_DASH;

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

  public getCurveVector(): { x: number; y: number } {
    let cx = 0;
    let cy = 0;
    for (const [code, isPressed] of this.keyStates.entries()) {
      if (!isPressed) continue;
      if (this.keyBinds.curveLeft?.includes(code)) cx -= 1;
      if (this.keyBinds.curveRight?.includes(code)) cx += 1;
      if (this.keyBinds.curveUp?.includes(code)) cy -= 1;
      if (this.keyBinds.curveDown?.includes(code)) cy += 1;
    }
    return { x: cx, y: cy };
  }

  public isTurboActive(): boolean {
    for (const [code, isPressed] of this.keyStates.entries()) {
      if (isPressed && this.keyBinds.turbo?.includes(code)) return true;
    }
    return false;
  }

  public consumeDashTrigger(): boolean {
    const triggered = this.dashTriggered;
    this.dashTriggered = false;
    return triggered;
  }
}
