import { OP_SNAPSHOT } from './BinaryProtocol';
import { GameSnapshot, DiscSnapshot } from '../../core/game/GameState';
import { MatchPhase, toMatchPhase } from '../../core/game/GameFSM';

export class SnapshotPacket {
  public static readonly HEADER_LENGTH = 17;
  public static readonly DISC_LENGTH = 18;

  public static encode(snapshot: GameSnapshot): ArrayBuffer {
    const discCount = snapshot.discs.length;
    const totalLength = SnapshotPacket.HEADER_LENGTH + discCount * SnapshotPacket.DISC_LENGTH;
    const buffer = new ArrayBuffer(totalLength);
    const view = new DataView(buffer);

    const phase = snapshot.matchPhase !== undefined
      ? snapshot.matchPhase
      : (typeof snapshot.matchState === 'number' ? snapshot.matchState : toMatchPhase(snapshot.matchState));

    const timer = snapshot.timerSeconds !== undefined ? snapshot.timerSeconds : (snapshot.matchTimerSeconds ?? 0);
    const subTimer = snapshot.subStateTimer !== undefined ? snapshot.subStateTimer : (snapshot.countdownSeconds ?? 0);
    const red = snapshot.scoreRed !== undefined ? snapshot.scoreRed : (snapshot.redScore ?? 0);
    const blue = snapshot.scoreBlue !== undefined ? snapshot.scoreBlue : (snapshot.blueScore ?? 0);
    let targetByte = (snapshot.targetTeam ?? 0) & 0x03;
    if (snapshot.kickoffActive) targetByte |= 0x80;
    if (snapshot.kickoffMode === 'TEAM_KICKOFF') targetByte |= 0x40;
    if (snapshot.possessingTeam === 'blue') targetByte |= 0x20;
    else if (snapshot.possessingTeam === 'red') targetByte |= 0x10;

    const soundMask = snapshot.soundMask ?? 0;

    // Header (17 bytes)
    view.setUint8(0, OP_SNAPSHOT);
    view.setUint32(1, snapshot.tick, false);
    view.setUint8(5, phase);
    view.setUint16(6, timer, false);
    view.setFloat32(8, subTimer, false);
    view.setUint8(12, targetByte);
    view.setUint8(13, red);
    view.setUint8(14, blue);
    view.setUint8(15, soundMask);
    view.setUint8(16, discCount);

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
    const phaseNum = view.getUint8(5);
    const matchPhase: MatchPhase = (phaseNum in MatchPhase) ? (phaseNum as MatchPhase) : MatchPhase.STOPPED;
    const timerSeconds = view.getUint16(6, false);
    const subStateTimer = view.getFloat32(8, false);
    const rawTarget = view.getUint8(12);
    const targetTeam = rawTarget & 0x03;
    const kickoffActive = (rawTarget & 0x80) !== 0;
    const isTeamKickoff = (rawTarget & 0x40) !== 0;
    const kickoffMode: 'NEUTRAL' | 'TEAM_KICKOFF' = isTeamKickoff ? 'TEAM_KICKOFF' : 'NEUTRAL';
    let possessingTeam: 'red' | 'blue' | null = null;
    if (isTeamKickoff) {
      if ((rawTarget & 0x20) !== 0) possessingTeam = 'blue';
      else if ((rawTarget & 0x10) !== 0) possessingTeam = 'red';
    }

    const scoreRed = view.getUint8(13);
    const scoreBlue = view.getUint8(14);
    const soundMask = view.getUint8(15);
    const discCount = view.getUint8(16);

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
      matchPhase,
      timerSeconds,
      subStateTimer,
      targetTeam,
      scoreRed,
      scoreBlue,
      soundMask,
      kickoffActive,
      kickoffMode,
      possessingTeam,
      discs,

      // Compat
      matchState: matchPhase,
      matchTimerSeconds: timerSeconds,
      redScore: scoreRed,
      blueScore: scoreBlue,
      countdownSeconds: Math.ceil(subStateTimer)
    };
  }
}
