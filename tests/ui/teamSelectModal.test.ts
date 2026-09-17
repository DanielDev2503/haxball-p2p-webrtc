import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TeamSelectModal } from '../../src/ui/components/TeamSelectModal';

describe('TeamSelectModal Lifecycle and Match State Synchronization', () => {
  let ingameMenuEl: any;
  let closeBtnEl: any;
  let returnGameBtnEl: any;
  let listeners: Record<string, Function>;

  beforeEach(() => {
    listeners = {};
    const classSet = new Set<string>(['hidden']);

    ingameMenuEl = {
      classList: {
        add: vi.fn((...cls: string[]) => cls.forEach(c => classSet.add(c))),
        remove: vi.fn((...cls: string[]) => cls.forEach(c => classSet.delete(c))),
        contains: vi.fn((cls: string) => classSet.has(cls))
      },
      style: {
        display: 'none',
        pointerEvents: 'none'
      }
    };

    closeBtnEl = {
      style: { display: '' },
      addEventListener: vi.fn((event: string, cb: Function) => {
        listeners['close_' + event] = cb;
      })
    };

    returnGameBtnEl = {
      style: { display: 'none' },
      addEventListener: vi.fn((event: string, cb: Function) => {
        listeners['return_' + event] = cb;
      })
    };

    (globalThis as any).document = {
      getElementById: (id: string) => {
        if (id === 'ingame-menu') return ingameMenuEl;
        if (id === 'menu-close-btn') return closeBtnEl;
        if (id === 'btn-return-game') return returnGameBtnEl;
        return null;
      },
      querySelectorAll: () => [],
      querySelector: () => null,
      createElement: () => ({ className: '', appendChild: vi.fn(), setAttribute: vi.fn(), addEventListener: vi.fn() })
    };
  });

  it('forces open and blocks closing when state is STOPPED', () => {
    const modal = new TeamSelectModal();

    modal.updateMatchState('STOPPED');

    expect(ingameMenuEl.classList.remove).toHaveBeenCalledWith('hidden', 'u-hidden', 'ui-screen-hidden');
    expect(ingameMenuEl.classList.add).toHaveBeenCalledWith('is-forced-open');
    expect(ingameMenuEl.style.display).toBe('flex');

    // Attempting to close while in STOPPED must be rejected/ignored
    modal.close();
    expect(ingameMenuEl.classList.contains('hidden')).toBe(false);

    // Escape toggle while STOPPED must not close
    modal.toggle();
    expect(ingameMenuEl.classList.contains('hidden')).toBe(false);
  });

  it('automatically closes modal when match transitions to COUNTDOWN or PLAYING', () => {
    const modal = new TeamSelectModal();
    modal.open(false);

    modal.updateMatchState('COUNTDOWN');
    expect(ingameMenuEl.classList.add).toHaveBeenCalledWith('hidden');
    expect(ingameMenuEl.classList.remove).toHaveBeenCalledWith('is-forced-open');
    expect(ingameMenuEl.style.display).toBe('none');

    // Simulate match playing
    modal.open(false);
    modal.updateMatchState('PLAYING');
    expect(ingameMenuEl.classList.add).toHaveBeenCalledWith('hidden');
    expect(ingameMenuEl.style.display).toBe('none');
  });

  it('allows toggle and close during PLAYING and PAUSED', () => {
    const modal = new TeamSelectModal();
    modal.updateMatchState('PLAYING');

    modal.open(false);
    expect(modal.isOpen()).toBe(true);

    modal.close();
    expect(modal.isOpen()).toBe(false);

    modal.toggle();
    expect(modal.isOpen()).toBe(true);

    modal.toggle();
    expect(modal.isOpen()).toBe(false);
  });

  it('closes via contingency button or close button during PLAYING/PAUSED', () => {
    const modal = new TeamSelectModal();
    modal.updateMatchState('PLAYING');
    modal.open(false);

    // Click contingency return button
    listeners['return_click']();
    expect(modal.isOpen()).toBe(false);

    // Reopen and click close button
    modal.open(false);
    expect(modal.isOpen()).toBe(true);
    listeners['close_click']();
    expect(modal.isOpen()).toBe(false);
  });
});
