import { describe, it, expect, vi } from 'vitest';
import { UIStateMachine, UIState } from '../../src/ui/UIStateMachine';
import { InputManager } from '../../src/client/InputManager';

describe('UIStateMachine Navigation & Lifecycle', () => {
  it('initializes with the provided state', () => {
    const fsmNickname = new UIStateMachine('STATE_NICKNAME');
    expect(fsmNickname.getState()).toBe('STATE_NICKNAME');

    const fsmLobby = new UIStateMachine('STATE_LOBBY');
    expect(fsmLobby.getState()).toBe('STATE_LOBBY');
  });

  it('handles state transitions and invokes onStateChange with previous and new states', () => {
    const transitions: Array<{ next: UIState; prev: UIState }> = [];
    const fsm = new UIStateMachine('STATE_NICKNAME', {
      onStateChange: (next, prev) => transitions.push({ next, prev })
    });

    // 1. Nickname confirmed -> STATE_LOBBY
    fsm.transitionTo('STATE_LOBBY');
    expect(fsm.getState()).toBe('STATE_LOBBY');
    expect(transitions).toHaveLength(1);
    expect(transitions[0]).toEqual({ next: 'STATE_LOBBY', prev: 'STATE_NICKNAME' });

    // 2. Joining room -> STATE_IN_GAME
    fsm.transitionTo('STATE_IN_GAME');
    expect(fsm.getState()).toBe('STATE_IN_GAME');
    expect(transitions).toHaveLength(2);
    expect(transitions[1]).toEqual({ next: 'STATE_IN_GAME', prev: 'STATE_LOBBY' });

    // 3. Leaving room -> STATE_LOBBY
    fsm.transitionTo('STATE_LOBBY');
    expect(fsm.getState()).toBe('STATE_LOBBY');
    expect(transitions).toHaveLength(3);
    expect(transitions[2]).toEqual({ next: 'STATE_LOBBY', prev: 'STATE_IN_GAME' });

    // 4. Edit nickname -> STATE_NICKNAME
    fsm.transitionTo('STATE_NICKNAME');
    expect(fsm.getState()).toBe('STATE_NICKNAME');
    expect(transitions).toHaveLength(4);
    expect(transitions[3]).toEqual({ next: 'STATE_NICKNAME', prev: 'STATE_LOBBY' });
  });

  it('ignores redundant transitions to the same state (idempotent)', () => {
    const onStateChange = vi.fn();
    const fsm = new UIStateMachine('STATE_LOBBY', { onStateChange });

    fsm.transitionTo('STATE_LOBBY');
    expect(onStateChange).not.toHaveBeenCalled();
    expect(fsm.getState()).toBe('STATE_LOBBY');
  });

  it('applies and removes .u-hidden correctly to DOM elements during state transitions', () => {
    const mockClassList = (classes: Set<string>) => ({
      add: vi.fn((...c: string[]) => c.forEach(cls => classes.add(cls))),
      remove: vi.fn((...c: string[]) => c.forEach(cls => classes.delete(cls))),
      contains: vi.fn((cls: string) => classes.has(cls))
    });

    const createMockEl = (id: string, initialClasses: string[] = ['u-hidden']) => {
      const classes = new Set(initialClasses);
      return {
        id,
        style: { display: 'none' },
        classList: mockClassList(classes)
      } as any;
    };

    const nicknameEl = createMockEl('nicknameGatekeeperModal');
    const lobbyEl = createMockEl('lobbyModal');
    const appRootEl = createMockEl('app-root');
    const hudEl = createMockEl('hud-container');
    const gameViewEl = createMockEl('game-view');
    const chatSectionEl = createMockEl('chat-section');

    const elements: Record<string, any> = {
      nicknameGatekeeperModal: nicknameEl,
      lobbyModal: lobbyEl,
      'app-root': appRootEl,
      'game-view': gameViewEl,
      'chat-section': chatSectionEl
    };

    (globalThis as any).document = {
      getElementById: (id: string) => elements[id] || null,
      querySelector: (selector: string) => {
        if (selector === '.modal-nickname') return nicknameEl;
        if (selector === '.lobby-container') return lobbyEl;
        if (selector === '.game-container') return appRootEl;
        if (selector === '.hud-container') return hudEl;
        return null;
      }
    };

    const fsm = new UIStateMachine('STATE_NICKNAME');
    expect(nicknameEl.classList.remove).toHaveBeenCalledWith('u-hidden', 'ui-screen-hidden');
    expect(lobbyEl.classList.add).toHaveBeenCalledWith('u-hidden', 'ui-screen-hidden');
    expect(appRootEl.classList.add).toHaveBeenCalledWith('u-hidden', 'ui-screen-hidden');

    // Transition to STATE_LOBBY
    fsm.transitionTo('STATE_LOBBY');
    expect(nicknameEl.classList.add).toHaveBeenCalledWith('u-hidden', 'ui-screen-hidden');
    expect(lobbyEl.classList.remove).toHaveBeenCalledWith('u-hidden', 'ui-screen-hidden');

    // Transition to STATE_IN_GAME
    fsm.transitionTo('STATE_IN_GAME');
    expect(appRootEl.classList.remove).toHaveBeenCalledWith('u-hidden', 'ui-screen-hidden');
    expect(hudEl.classList.remove).toHaveBeenCalledWith('u-hidden', 'ui-screen-hidden');
    expect(chatSectionEl.classList.remove).toHaveBeenCalledWith('u-hidden', 'ui-screen-hidden');

    delete (globalThis as any).document;
  });
});

describe('InputManager Keyboard Isolation', () => {
  it('defaults to disabled (isEnabled: false) and supports setEnabled toggling', () => {
    const input = new InputManager();
    expect(input.isEnabled).toBe(false);

    input.setEnabled(true);
    expect(input.isEnabled).toBe(true);

    input.setEnabled(false);
    expect(input.isEnabled).toBe(false);
  });

  it('resets mask to 0 when disabled', () => {
    const input = new InputManager();
    input.setEnabled(true);
    input.currentMask = 0b0001; // Mock an active movement mask

    input.setEnabled(false);
    expect(input.currentMask).toBe(0);
  });
});
