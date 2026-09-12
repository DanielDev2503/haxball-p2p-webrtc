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
