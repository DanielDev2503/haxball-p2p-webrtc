import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { $theme, setTheme, toggleTheme, applyThemeToDOM } from '../../src/ui/stores/gameStore';
import { ScoreboardHUD } from '../../src/ui/components/ScoreboardHUD';
import { GameplayModifierModal } from '../../src/ui/components/GameplayModifierModal';
import { DEFAULT_GAMEPLAY_CONFIG, GAMEPLAY_CONFIG_LIMITS } from '../../src/core/game/GameConfig';
import { TeamSelectModal } from '../../src/ui/components/TeamSelectModal';

// Helper mock DOM Element
function createMockElement(id: string = '', tag: string = 'div') {
  const classSet = new Set<string>();
  const attributes = new Map<string, string>();
  const children: any[] = [];
  const listeners: Record<string, Function[]> = {};

  const el = {
    id,
    tagName: tag.toUpperCase(),
    className: '',
    innerHTML: '',
    textContent: '',
    style: {} as Record<string, string>,
    dataset: {} as Record<string, string>,
    disabled: false,
    classList: {
      add: vi.fn((...classes: string[]) => {
        classes.forEach(c => classSet.add(c));
        el.className = Array.from(classSet).join(' ');
      }),
      remove: vi.fn((...classes: string[]) => {
        classes.forEach(c => classSet.delete(c));
        el.className = Array.from(classSet).join(' ');
      }),
      toggle: vi.fn((c: string, force?: boolean) => {
        const shouldAdd = force !== undefined ? force : !classSet.has(c);
        if (shouldAdd) classSet.add(c);
        else classSet.delete(c);
        el.className = Array.from(classSet).join(' ');
        return shouldAdd;
      }),
      contains: vi.fn((c: string) => classSet.has(c))
    },
    setAttribute: vi.fn((name: string, val: string) => {
      attributes.set(name, val);
    }),
    getAttribute: vi.fn((name: string) => attributes.get(name) || null),
    removeAttribute: vi.fn((name: string) => {
      attributes.delete(name);
    }),
    appendChild: vi.fn((child: any) => {
      children.push(child);
      return child;
    }),
    addEventListener: vi.fn((event: string, cb: Function) => {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(cb);
    }),
    removeEventListener: vi.fn((event: string, cb: Function) => {
      if (listeners[event]) {
        listeners[event] = listeners[event].filter(fn => fn !== cb);
      }
    }),
    querySelector: vi.fn((_sel: string) => null),
    querySelectorAll: vi.fn((_sel: string) => [])
  };

  return el;
}

describe('Theme Synchronization & ScoreboardHUD Tokens', () => {
  let docEl: any;
  let bodyEl: any;
  let appEl: any;
  let scoreboardCapsule: any;
  let hudContainer: any;
  let matchClockContainer: any;
  let clockSlot: any;
  let wifiSlot: any;
  let redScoreEl: any;
  let blueScoreEl: any;
  let matchTimerEl: any;
  let goldenGoalBadgeEl: any;
  let pingValueEl: any;
  let fpsValueEl: any;
  let themeToggleBtnEl: any;

  beforeEach(() => {
    docEl = createMockElement('html', 'html');
    bodyEl = createMockElement('body', 'body');
    appEl = createMockElement('app-root', 'div');
    scoreboardCapsule = createMockElement('scoreboard-capsule', 'div');
    hudContainer = createMockElement('hud-container', 'header');
    matchClockContainer = createMockElement('match-clock-container', 'div');
    clockSlot = createMockElement('clockIconSlot', 'span');
    wifiSlot = createMockElement('wifiIconSlot', 'span');
    redScoreEl = createMockElement('redScore', 'span');
    blueScoreEl = createMockElement('blueScore', 'span');
    matchTimerEl = createMockElement('matchTimer', 'span');
    goldenGoalBadgeEl = createMockElement('goldenGoalBadge', 'span');
    pingValueEl = createMockElement('pingValue', 'span');
    fpsValueEl = createMockElement('fpsValue', 'span');
    themeToggleBtnEl = createMockElement('theme-toggle-btn', 'button');

    const domRegistry: Record<string, any> = {
      'html': docEl,
      'body': bodyEl,
      'app': appEl,
      'app-root': appEl,
      'redScore': redScoreEl,
      'blueScore': blueScoreEl,
      'matchTimer': matchTimerEl,
      'goldenGoalBadge': goldenGoalBadgeEl,
      'pingValue': pingValueEl,
      'fpsValue': fpsValueEl,
      'clockIconSlot': clockSlot,
      'wifiIconSlot': wifiSlot,
      'theme-toggle-btn': themeToggleBtnEl,
      'scoreboard-capsule': scoreboardCapsule,
      'match-clock-container': matchClockContainer
    };

    (globalThis as any).document = {
      documentElement: docEl,
      body: bodyEl,
      getElementById: (id: string) => domRegistry[id] || null,
      querySelector: (sel: string) => {
        if (sel === '.scoreboard-capsule' || sel === '.scoreboard') return scoreboardCapsule;
        if (sel === '.hud-container') return hudContainer;
        if (sel === '.match-clock-container') return matchClockContainer;
        return null;
      },
      querySelectorAll: () => [],
      createElement: (tag: string) => createMockElement('', tag),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    };
  });

  afterEach(() => {
    setTheme('light');
  });

  it('propagates dark theme to documentElement and #app-root when $theme is set to dark', () => {
    setTheme('dark');

    expect($theme.get()).toBe('dark');
    expect(docEl.classList.contains('dark')).toBe(true);
    expect(docEl.getAttribute('data-theme')).toBe('dark');
    expect(bodyEl.classList.contains('dark')).toBe(true);
    expect(appEl.classList.contains('dark')).toBe(true);
    expect(appEl.getAttribute('data-theme')).toBe('dark');
  });

  it('directly applies theme tokens via applyThemeToDOM', () => {
    applyThemeToDOM('dark');
    expect(docEl.classList.contains('dark')).toBe(true);
    expect(docEl.getAttribute('data-theme')).toBe('dark');

    applyThemeToDOM('light');
    expect(docEl.classList.contains('dark')).toBe(false);
    expect(docEl.getAttribute('data-theme')).toBe('light');
  });

  it('propagates light theme to documentElement and #app-root when toggled back', () => {
    setTheme('dark');
    expect(docEl.classList.contains('dark')).toBe(true);

    toggleTheme();
    expect($theme.get()).toBe('light');
    expect(docEl.classList.contains('dark')).toBe(false);
    expect(docEl.getAttribute('data-theme')).toBe('light');
    expect(appEl.classList.contains('dark')).toBe(false);
    expect(appEl.getAttribute('data-theme')).toBe('light');
  });

  it('updates ScoreboardHUD tokens and classes reactively when theme changes', () => {
    const hud = new ScoreboardHUD();

    // Verify initial light mode tokens on capsule
    expect(scoreboardCapsule.classList.contains('scoreboard-light')).toBe(true);
    expect(scoreboardCapsule.classList.contains('bg-slate-900/10')).toBe(true);
    expect(scoreboardCapsule.classList.contains('border-slate-900/15')).toBe(true);
    expect(scoreboardCapsule.classList.contains('text-slate-800')).toBe(true);

    // Switch to dark mode
    $theme.set('dark');

    expect(scoreboardCapsule.classList.contains('scoreboard-dark')).toBe(true);
    expect(scoreboardCapsule.classList.contains('dark:bg-slate-950/70')).toBe(true);
    expect(scoreboardCapsule.classList.contains('dark:border-cyan-500/20')).toBe(true);
    expect(scoreboardCapsule.classList.contains('dark:text-slate-100')).toBe(true);
    expect(scoreboardCapsule.getAttribute('data-theme')).toBe('dark');

    // Switch back to light mode
    $theme.set('light');
    expect(scoreboardCapsule.classList.contains('scoreboard-light')).toBe(true);
    expect(scoreboardCapsule.getAttribute('data-theme')).toBe('light');

    hud.destroy();
  });
});

describe('Modal Lifecycle & Orphan Body Lock Prevention', () => {
  beforeEach(() => {
    const docEl = createMockElement('html', 'html');
    const bodyEl = createMockElement('body', 'body');
    const ingameMenuEl = createMockElement('ingame-menu', 'div');
    ingameMenuEl.classList.add('hidden');
    const closeBtnEl = createMockElement('menu-close-btn', 'button');
    const returnGameBtnEl = createMockElement('btn-return-game', 'button');
    const matchToggleBtnEl = createMockElement('btn-match-toggle', 'button');

    const domRegistry: Record<string, any> = {
      'ingame-menu': ingameMenuEl,
      'menu-close-btn': closeBtnEl,
      'btn-return-game': returnGameBtnEl,
      'btn-match-toggle': matchToggleBtnEl,
      'redPlayersList': createMockElement('redPlayersList'),
      'bluePlayersList': createMockElement('bluePlayersList'),
      'specPlayersList': createMockElement('specPlayersList'),
      'redCount': createMockElement('redCount'),
      'blueCount': createMockElement('blueCount'),
      'specCount': createMockElement('specCount'),
      'joinRedBtn': createMockElement('joinRedBtn', 'button'),
      'joinBlueBtn': createMockElement('joinBlueBtn', 'button'),
      'joinSpecBtn': createMockElement('joinSpecBtn', 'button'),
    };

    (globalThis as any).document = {
      documentElement: docEl,
      body: bodyEl,
      getElementById: (id: string) => domRegistry[id] || null,
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: (tag: string) => createMockElement('', tag),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    };
  });

  it('opening and closing TeamSelectModal does not leave orphan blocking classes on body', () => {
    const modal = new TeamSelectModal();

    modal.open(true);
    expect(modal.isOpen()).toBe(true);
    expect(document.body.classList.contains('modal-open')).toBe(false);
    expect(document.body.classList.contains('overflow-hidden')).toBe(false);

    modal.close(true);
    expect(modal.isOpen()).toBe(false);
    expect(document.body.classList.contains('modal-open')).toBe(false);
    expect(document.body.classList.contains('overflow-hidden')).toBe(false);

    modal.destroy();
  });

  it('opening and closing GameplayModifierModal does not leave orphan blocking classes on body', () => {
    const onChange = vi.fn();
    const isHost = () => true;
    const modifierModal = new GameplayModifierModal(DEFAULT_GAMEPLAY_CONFIG, onChange, isHost);

    modifierModal.show();
    expect(modifierModal.isOpen()).toBe(true);
    expect(document.body.classList.contains('modal-open')).toBe(false);
    expect(document.body.classList.contains('overflow-hidden')).toBe(false);

    modifierModal.hide();
    expect(modifierModal.isOpen()).toBe(false);
    expect(document.body.classList.contains('modal-open')).toBe(false);
    expect(document.body.classList.contains('overflow-hidden')).toBe(false);
  });
});

describe('GameplayModifierModal Numerical Limits & Sanitization', () => {
  it('enforces config limits and prevents values exceeding min or max', () => {
    let currentConfig = { ...DEFAULT_GAMEPLAY_CONFIG };
    const onChange = vi.fn((cfg) => {
      currentConfig = { ...cfg };
    });
    const modifierModal = new GameplayModifierModal(currentConfig, onChange, () => true);

    // Try setting values beyond max and below min using real GameplayConfig properties
    modifierModal.setConfig({
      playerMaxSpeed: 9999,      // Exceeds max (9.0)
      kickStrength: 0.1,         // Below min (2.0)
      ballRestitution: 2.5       // Exceeds max (0.95)
    });

    const config = modifierModal.getConfig();
    expect(config.playerMaxSpeed).toBeLessThanOrEqual(GAMEPLAY_CONFIG_LIMITS.playerMaxSpeed.max);
    expect(config.kickStrength).toBeGreaterThanOrEqual(GAMEPLAY_CONFIG_LIMITS.kickStrength.min);
    expect(config.ballRestitution).toBeLessThanOrEqual(GAMEPLAY_CONFIG_LIMITS.ballRestitution.max);
  });

  it('resets to defaults cleanly when resetToDefaults is invoked', () => {
    let currentConfig = { ...DEFAULT_GAMEPLAY_CONFIG };
    const onChange = vi.fn((cfg) => {
      currentConfig = { ...cfg };
    });
    const modifierModal = new GameplayModifierModal(currentConfig, onChange, () => true);

    modifierModal.setConfig({
      playerMaxSpeed: 4.5,
      kickStrength: 8.0
    });

    expect(modifierModal.getConfig().playerMaxSpeed).toBe(4.5);

    modifierModal.resetToDefaults();
    expect(modifierModal.getConfig().playerMaxSpeed).toBe(DEFAULT_GAMEPLAY_CONFIG.playerMaxSpeed);
    expect(modifierModal.getConfig().kickStrength).toBe(DEFAULT_GAMEPLAY_CONFIG.kickStrength);
    expect(onChange).toHaveBeenCalled();
  });
});
