import { describe, it, expect } from 'vitest';
import { InputPacket } from '../../src/net/protocol/InputPacket';
import { SnapshotPacket } from '../../src/net/protocol/SnapshotPacket';
import { GameSnapshot } from '../../src/core/game/GameState';
import { INPUT_UP, INPUT_KICK, INPUT_TURBO, INPUT_DASH } from '../../src/core/game/Player';
import { MatchPhase } from '../../src/core/game/GameFSM';
import { OP_INPUT, OP_SNAPSHOT } from '../../src/net/protocol/BinaryProtocol';

describe('Extended Binary Protocol Serialization (Magnus, Stamina, Turbo, Dash)', () => {
  it('encodes and decodes 9-byte extended InputPacket with directional curve, turbo, and dash', () => {
    const input = {
      sequence: 550,
      inputMask: INPUT_UP | INPUT_KICK | INPUT_TURBO | INPUT_DASH,
      clientTimestamp: 60000,
      curveX: -1,
      curveY: 1,
      isTurbo: true,
      triggerDash: true
    };

    const buffer = InputPacket.encode(input);
    expect(buffer.byteLength).toBe(9);

    const decoded = InputPacket.decode(buffer);
    expect(decoded).not.toBeNull();
    expect(decoded!.sequence).toBe(550);
    expect(decoded!.inputMask).toBe(INPUT_UP | INPUT_KICK | INPUT_TURBO | INPUT_DASH);
    expect(decoded!.clientTimestamp).toBe(60000);
    expect(decoded!.curveX).toBe(-1);
    expect(decoded!.curveY).toBe(1);
    expect(decoded!.isTurbo).toBe(true);
    expect(decoded!.triggerDash).toBe(true);
  });

  it('gracefully decodes legacy 8-byte InputPacket without extended action byte', () => {
    // Manually construct an 8-byte buffer
    const legacyBuffer = new ArrayBuffer(8);
    const view = new DataView(legacyBuffer);
    view.setUint8(0, OP_INPUT);
    view.setUint32(1, 300, false);
    view.setUint8(5, INPUT_UP);
    view.setUint16(6, 12345, false);

    const decoded = InputPacket.decode(legacyBuffer);
    expect(decoded).not.toBeNull();
    expect(decoded!.sequence).toBe(300);
    expect(decoded!.inputMask).toBe(INPUT_UP);
    expect(decoded!.clientTimestamp).toBe(12345);
    expect(decoded!.curveX).toBe(0);
    expect(decoded!.curveY).toBe(0);
    expect(decoded!.isTurbo).toBe(false);
    expect(decoded!.triggerDash).toBe(false);
  });

  it('encodes and decodes 20-byte disc SnapshotPacket with spin and stamina flags', () => {
    const snapshot: GameSnapshot = {
      tick: 100,
      matchPhase: MatchPhase.PLAYING,
      timerSeconds: 90,
      subStateTimer: 0,
      targetTeam: 0,
      scoreRed: 1,
      scoreBlue: 0,
      soundMask: 0,
      matchState: MatchPhase.PLAYING,
      matchTimerSeconds: 90,
      redScore: 1,
      blueScore: 0,
      discs: [
        {
          id: 0,
          team: 0,
          x: 50.5,
          y: -20.25,
          vx: 12.0,
          vy: -5.0,
          radius: 10,
          kicking: false,
          avatar: '',
          isSpinActive: true,
          curveFactor: -7
        },
        {
          id: 1001,
          team: 1,
          x: 40.0,
          y: -20.0,
          vx: 8.0,
          vy: 0.0,
          radius: 15,
          kicking: true,
          avatar: '7',
          stamina: 65,
          isDashing: true,
          isTurbo: false
        },
        {
          id: 1002,
          team: 2,
          x: -100.0,
          y: 0.0,
          vx: 0.0,
          vy: 0.0,
          radius: 15,
          kicking: false,
          avatar: '10',
          stamina: 100,
          isDashing: false,
          isTurbo: true
        }
      ]
    };

    const buffer = SnapshotPacket.encode(snapshot);
    const expectedBytes = SnapshotPacket.HEADER_LENGTH + 3 * SnapshotPacket.DISC_LENGTH;
    expect(SnapshotPacket.DISC_LENGTH).toBe(20);
    expect(buffer.byteLength).toBe(expectedBytes);

    const decoded = SnapshotPacket.decode(buffer);
    expect(decoded).not.toBeNull();
    expect(decoded!.discs.length).toBe(3);

    // Disc 0: Ball
    const ball = decoded!.discs[0];
    expect(ball.id).toBe(0);
    expect(ball.isSpinActive).toBe(true);
    expect(ball.curveFactor).toBe(-7);

    // Disc 1: Red Player (Dashing, stamina 65)
    const p1 = decoded!.discs[1];
    expect(p1.id).toBe(1001);
    expect(p1.stamina).toBe(65);
    expect(p1.isDashing).toBe(true);
    expect(p1.isTurbo).toBe(false);

    // Disc 2: Blue Player (Turbo, stamina 100)
    const p2 = decoded!.discs[2];
    expect(p2.id).toBe(1002);
    expect(p2.stamina).toBe(100);
    expect(p2.isDashing).toBe(false);
    expect(p2.isTurbo).toBe(true);
  });

  it('gracefully decodes legacy 18-byte disc SnapshotPacket', () => {
    // Construct a legacy snapshot buffer with 1 disc (18 bytes)
    const legacyDiscLen = 18;
    const legacyBuffer = new ArrayBuffer(SnapshotPacket.HEADER_LENGTH + legacyDiscLen);
    const view = new DataView(legacyBuffer);

    // Header (17 bytes)
    view.setUint8(0, OP_SNAPSHOT);
    view.setUint32(1, 50, false); // tick
    view.setUint8(5, MatchPhase.PLAYING);
    view.setUint16(6, 120, false); // timerSeconds
    view.setFloat32(8, 0, false); // subStateTimer
    view.setUint8(12, 0); // targetTeam
    view.setUint8(13, 0); // scoreRed
    view.setUint8(14, 0); // scoreBlue
    view.setUint8(15, 0); // soundMask
    view.setUint8(16, 1); // discCount: 1

    // Disc at offset 17 (18 bytes total)
    const offset = 17;
    view.setUint16(offset, 1001, false); // id
    view.setUint8(offset + 2, 1); // team
    view.setUint8(offset + 3, 0); // flags (kicking = false)
    view.setFloat32(offset + 4, 50.0, false); // x
    view.setFloat32(offset + 8, 20.0, false); // y
    view.setInt16(offset + 12, 20, false); // vx (20 / 20 = 1.0)
    view.setInt16(offset + 14, -20, false); // vy (-20 / 20 = -1.0)
    view.setUint16(offset + 16, 0x4142, false); // avatar 'AB'

    const decoded = SnapshotPacket.decode(legacyBuffer);
    expect(decoded).not.toBeNull();
    expect(decoded!.discs.length).toBe(1);
    const disc = decoded!.discs[0];
    expect(disc.id).toBe(1001);
    expect(disc.stamina).toBe(100); // Default stamina fallback
    expect(disc.isDashing).toBe(false);
    expect(disc.isTurbo).toBe(false);
  });
});
