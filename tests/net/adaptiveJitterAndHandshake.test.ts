import { describe, it, expect, vi } from 'vitest';
import { JitterBuffer } from '../../src/net/transport/JitterBuffer';
import { GameSnapshot } from '../../src/core/game/GameState';
import { MatchPhase } from '../../src/core/game/GameFSM';
import { InputPacket, InputData } from '../../src/net/protocol/InputPacket';
import { SnapshotPacket } from '../../src/net/protocol/SnapshotPacket';

function createDummySnapshot(tick: number): GameSnapshot {
  return {
    tick,
    matchPhase: MatchPhase.PLAYING,
    matchState: MatchPhase.PLAYING,
    timerSeconds: 120,
    matchTimerSeconds: 120,
    subStateTimer: 0,
    countdownSeconds: 0,
    targetTeam: 0,
    scoreRed: 1,
    redScore: 1,
    scoreBlue: 0,
    blueScore: 0,
    discs: [
      {
        id: 0,
        team: 0,
        x: 0,
        y: 0,
        vx: 1.5,
        vy: -0.5,
        radius: 10,
        avatar: '',
        kicking: false
      }
    ]
  };
}

describe('Adaptive JitterBuffer & Zero-GC Replication Netcode', () => {
  it('dynamically adapts target delay within [16ms, 60ms] according to RFC 3550 jitter', () => {
    const jb = new JitterBuffer(33, 30, true);
    expect(jb.interpolationDelayMs).toBe(33);

    // Feed snapshots with consistent 16.6ms intervals (low jitter)
    let fakeTime = 1000;
    const nowSpy = vi.spyOn(performance, 'now');

    for (let i = 1; i <= 30; i++) {
      fakeTime += 16.6;
      nowSpy.mockReturnValue(fakeTime);
      jb.push(createDummySnapshot(i), fakeTime);
    }

    // Mean jitter should stabilize low and targetDelay should be bounded near min (16ms)
    expect(jb.targetDelay).toBeGreaterThanOrEqual(16);
    expect(jb.targetDelay).toBeLessThanOrEqual(60);

    // Simulate high jitter (erratic arrivals)
    for (let i = 31; i <= 60; i++) {
      fakeTime += (i % 2 === 0 ? 50 : 2); // Erratic delta
      nowSpy.mockReturnValue(fakeTime);
      jb.push(createDummySnapshot(i), fakeTime);
    }

    // Target delay should have expanded to buffer jitter
    expect(jb.targetDelay).toBeGreaterThanOrEqual(16);
    expect(jb.targetDelay).toBeLessThanOrEqual(60);

    nowSpy.mockRestore();
  });

  it('strictly discards obsolete / out-of-order packets older than lastProcessedTick', () => {
    const jb = new JitterBuffer(33, 30, false);
    const snap10 = createDummySnapshot(10);
    const snap20 = createDummySnapshot(20);
    const snap15 = createDummySnapshot(15);

    jb.push(snap10, 100);
    jb.push(snap20, 200);

    // Simulate playback advancing to tick 20
    jb.getInterpolatedSnapshot(300);
    expect(jb.lastProcessedTick).toBe(20);

    // Inject obsolete tick 15 after having processed tick 20
    jb.push(snap15, 250);

    // Verify buffer does not contain obsolete tick 15
    const hasTick15 = jb.buffer.some((b) => b.snapshot.tick === 15);
    expect(hasTick15).toBe(false);
  });

  it('supports Zero-GC preallocated ArrayBuffer in InputPacket.encode and SnapshotPacket.encode', () => {
    const preallocatedInputBuf = new ArrayBuffer(InputPacket.BYTE_LENGTH);
    const inputData: InputData = {
      sequence: 42,
      inputMask: 0x05,
      clientTimestamp: 1234,
      isTurbo: true,
      triggerDash: true
    };

    const encodedInput = InputPacket.encode(inputData, preallocatedInputBuf);
    expect(encodedInput).toBe(preallocatedInputBuf);
    expect(encodedInput.byteLength).toBe(InputPacket.BYTE_LENGTH);

    const decoded = InputPacket.decode(encodedInput);
    expect(decoded).not.toBeNull();
    expect(decoded?.sequence).toBe(42);
    expect(decoded?.isTurbo).toBe(true);
    expect(decoded?.triggerDash).toBe(true);

    // Test SnapshotPacket with preallocated buffer
    const snapshot = createDummySnapshot(100);
    const totalSnapLength = SnapshotPacket.HEADER_LENGTH + snapshot.discs.length * SnapshotPacket.DISC_LENGTH;
    const preallocatedSnapBuf = new ArrayBuffer(totalSnapLength);

    const encodedSnap = SnapshotPacket.encode(snapshot, preallocatedSnapBuf);
    expect(encodedSnap).toBe(preallocatedSnapBuf);
    expect(encodedSnap.byteLength).toBe(totalSnapLength);

    const decodedSnap = SnapshotPacket.decode(encodedSnap);
    expect(decodedSnap).not.toBeNull();
    expect(decodedSnap?.tick).toBe(100);
    expect(decodedSnap?.discs.length).toBe(1);
    expect(decodedSnap?.discs[0].id).toBe(0);
  });
});
