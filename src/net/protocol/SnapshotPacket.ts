import { OP_SNAPSHOT } from './BinaryProtocol';
import { GameSnapshot, DiscSnapshot } from '../../core/game/GameState';
import { MatchState } from '../../core/game/GameFSM';

const STATE_TO_NUM: Record<MatchState, number> = {
  STOPPED: 0,
  PAUSED: 1,
  COUNTDOWN: 2,
  PLAYING: 3,
  GOAL_CELEBRATION: 4,
  MATCH_ENDED: 5
};

const NUM_TO_STATE: MatchState[] = [
  'STOPPED',
  'PAUSED',
  'COUNTDOWN',
  'PLAYING',
  'GOAL_CELEBRATION',
  'MATCH_ENDED'
];

export class SnapshotPacket {
  public static readonly HEADER_LENGTH = 11;
  public static readonly DISC_LENGTH = 18;

  public static encode(snapshot: GameSnapshot): ArrayBuffer {
    const discCount = snapshot.discs.length;
    const totalLength = SnapshotPacket.HEADER_LENGTH + discCount * SnapshotPacket.DISC_LENGTH;
    const buffer = new ArrayBuffer(totalLength);
    const view = new DataView(buffer);

    // Header
    view.setUint8(0, OP_SNAPSHOT);
    view.setUint32(1, snapshot.tick, false);
    view.setUint8(5, STATE_TO_NUM[snapshot.matchState] ?? 0);
    view.setUint16(6, snapshot.matchTimerSeconds, false);
    view.setUint8(8, snapshot.redScore);
    view.setUint8(9, snapshot.blueScore);
    view.setUint8(10, discCount);


    // Disc records
    let offset = SnapshotPacket.HEADER_LENGTH;
    for (let i = 0; i < discCount; i++) {
      const disc = snapshot.discs[i];
      view.setUint16(offset, disc.id, false);
      view.setUint8(offset + 2, disc.team);

      let flags = 0;
      if (disc.kicking) flags |= 1 << 0;
      view.setUint8(offset + 3, flags);

      view.setFloat32(offset + 4, disc.x, false);
      view.setFloat32(offset + 8, disc.y, false);

      // Quantize velocities (clamped to int16 range, scale factor 20 allows up to 1638 units/s)
      const qvx = Math.max(-32768, Math.min(32767, Math.round(disc.vx * 20)));
      const qvy = Math.max(-32768, Math.min(32767, Math.round(disc.vy * 20)));
      view.setInt16(offset + 12, qvx, false);
      view.setInt16(offset + 14, qvy, false);

      // Pack 2-char avatar ASCII
      const c1 = disc.avatar.charCodeAt(0) || 32;
      const c2 = disc.avatar.charCodeAt(1) || 32;
      view.setUint16(offset + 16, (c1 << 8) | c2, false);

      offset += SnapshotPacket.DISC_LENGTH;
    }

    return buffer;
  }

  public static decode(buffer: ArrayBuffer | DataView): GameSnapshot | null {
    const view = buffer instanceof DataView ? buffer : new DataView(buffer);

    if (view.byteLength < SnapshotPacket.HEADER_LENGTH) return null;
    if (view.getUint8(0) !== OP_SNAPSHOT) return null;

    const tick = view.getUint32(1, false);
    const stateNum = view.getUint8(5);
    const matchState: MatchState = NUM_TO_STATE[stateNum] ?? 'STOPPED';
    const matchTimerSeconds = view.getUint16(6, false);
    const redScore = view.getUint8(8);
    const blueScore = view.getUint8(9);
    const discCount = view.getUint8(10);


    const expectedLength = SnapshotPacket.HEADER_LENGTH + discCount * SnapshotPacket.DISC_LENGTH;
    if (view.byteLength < expectedLength) return null;

    const discs: DiscSnapshot[] = [];
    let offset = SnapshotPacket.HEADER_LENGTH;

    for (let i = 0; i < discCount; i++) {
      const id = view.getUint16(offset, false);
      const team = view.getUint8(offset + 2) as 0 | 1 | 2;
      const flags = view.getUint8(offset + 3);
      const kicking = (flags & (1 << 0)) !== 0;

      const x = view.getFloat32(offset + 4, false);
      const y = view.getFloat32(offset + 8, false);
      const vx = view.getInt16(offset + 12, false) / 20;
      const vy = view.getInt16(offset + 14, false) / 20;

      const avatarChars = view.getUint16(offset + 16, false);
      const c1 = String.fromCharCode((avatarChars >> 8) & 0xff);
      const c2 = String.fromCharCode(avatarChars & 0xff);
      const avatar = (c1 + c2).trim();

      discs.push({
        id,
        team,
        x,
        y,
        vx,
        vy,
        radius: team === 0 ? 10 : 15,
        kicking,
        avatar
      });

      offset += SnapshotPacket.DISC_LENGTH;
    }

    return {
      tick,
      matchState,
      matchTimerSeconds,
      redScore,
      blueScore,
      discs
    };
  }
}
