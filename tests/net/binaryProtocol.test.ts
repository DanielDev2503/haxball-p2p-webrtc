import { describe, it, expect } from 'vitest';
import { InputPacket } from '../../src/net/protocol/InputPacket';
import { SnapshotPacket } from '../../src/net/protocol/SnapshotPacket';
import { GameSnapshot } from '../../src/core/game/GameState';
import { MatchState } from '../../src/core/game/GameFSM';
import { INPUT_UP, INPUT_KICK } from '../../src/core/game/Player';

describe('Binary Protocol Serialization', () => {
  it('correctly encodes and decodes an InputPacket via DataView', () => {
    const input = {
      sequence: 4289,
      inputMask: INPUT_UP | INPUT_KICK,
      clientTimestamp: 34500
    };

    const buffer = InputPacket.encode(input);
    expect(buffer.byteLength).toBe(InputPacket.BYTE_LENGTH);

    const decoded = InputPacket.decode(buffer);
    expect(decoded).not.toBeNull();
    expect(decoded!.sequence).toBe(4289);
    expect(decoded!.inputMask).toBe(INPUT_UP | INPUT_KICK);
    expect(decoded!.clientTimestamp).toBe(34500);
  });

  it('correctly encodes and decodes a complex SnapshotPacket via DataView', () => {
    const snapshot: GameSnapshot = {
      tick: 12054,
      matchState: MatchState.PLAYING,
      matchTimerSeconds: 165,
      redScore: 2,
      blueScore: 1,
      discs: [
        {
          id: 0,
          team: 0,
          x: 45.25,
          y: -12.5,
          vx: 3.12,
          vy: -1.84,
          radius: 10,
          kicking: false,
          avatar: ''
        },
        {
          id: 1001,
          team: 1,
          x: -120.75,
          y: 35.1,
          vx: 1.5,
          vy: 0.2,
          radius: 15,
          kicking: true,
          avatar: 'CR'
        },
        {
          id: 1002,
          team: 2,
          x: 140.0,
          y: -50.0,
          vx: -2.0,
          vy: 0.0,
          radius: 15,
          kicking: false,
          avatar: 'M9'
        }
      ]
    };

    const buffer = SnapshotPacket.encode(snapshot);
    const expectedBytes = SnapshotPacket.HEADER_LENGTH + 3 * SnapshotPacket.DISC_LENGTH;
    expect(buffer.byteLength).toBe(expectedBytes);

    const decoded = SnapshotPacket.decode(buffer);
    expect(decoded).not.toBeNull();
    expect(decoded!.tick).toBe(12054);
    expect(decoded!.matchState).toBe(MatchState.PLAYING);
    expect(decoded!.matchTimerSeconds).toBe(165);
    expect(decoded!.redScore).toBe(2);
    expect(decoded!.blueScore).toBe(1);
    expect(decoded!.discs.length).toBe(3);

    // Ball
    expect(decoded!.discs[0].id).toBe(0);
    expect(decoded!.discs[0].team).toBe(0);
    expect(decoded!.discs[0].x).toBeCloseTo(45.25, 2);
    expect(decoded!.discs[0].y).toBeCloseTo(-12.5, 2);

    // Red Player
    expect(decoded!.discs[1].id).toBe(1001);
    expect(decoded!.discs[1].team).toBe(1);
    expect(decoded!.discs[1].kicking).toBe(true);
    expect(decoded!.discs[1].avatar).toBe('CR');
    expect(decoded!.discs[1].x).toBeCloseTo(-120.75, 2);

    // Blue Player
    expect(decoded!.discs[2].id).toBe(1002);
    expect(decoded!.discs[2].team).toBe(2);
    expect(decoded!.discs[2].kicking).toBe(false);
    expect(decoded!.discs[2].avatar).toBe('M9');
  });
});
