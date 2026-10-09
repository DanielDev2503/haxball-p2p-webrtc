import { OP_INPUT } from './BinaryProtocol';
import {
  INPUT_TURBO,
  INPUT_DASH,
  INPUT_MAGNUS_LEFT,
  INPUT_MAGNUS_RIGHT,
  INPUT_TYPING
} from '../../core/game/Player';

export interface InputData {
  sequence: number;
  inputMask: number;
  clientTimestamp: number;
  curveInput?: number | undefined; // 00 (ninguno), 01 (Z - Izquierda), 10 (C - Derecha)
  curveX?: number | undefined;
  curveY?: number | undefined;
  isTurbo?: boolean | undefined;
  triggerDash?: boolean | undefined;
  isTyping?: boolean | undefined;
}

export class InputPacket {
  public static readonly BYTE_LENGTH = 9;

  /**
   * Encodes an input message into a clean 9-byte ArrayBuffer without bit overlap.
   * Byte 0: OP_INPUT (0x01)
   * Bytes 1-4: sequence (uint32)
   * Bytes 5-6: inputMask (uint16: bits 0-9 sin colisiones)
   *   Bit 0: ArrowUp
   *   Bit 1: ArrowDown
   *   Bit 2: ArrowLeft
   *   Bit 3: ArrowRight
   *   Bit 4: Kick (X)
   *   Bit 5: Turbo (Shift)
   *   Bit 6: DashTrigger (Space) — Flanco ascendente exclusivo
   *   Bit 7: MagnusLeft (Z)
   *   Bit 8: MagnusRight (C)
   *   Bit 9: Chat Typing Indicator
   * Bytes 7-8: clientTimestamp (uint16)
   */
  public static encode(data: InputData, buffer?: ArrayBuffer): ArrayBuffer {
    const buf = buffer ?? new ArrayBuffer(InputPacket.BYTE_LENGTH);
    const view = new DataView(buf);

    view.setUint8(0, OP_INPUT);
    view.setUint32(1, data.sequence, false); // Big-endian

    let mask = data.inputMask || 0;
    if (data.isTurbo) mask |= INPUT_TURBO;
    if (data.triggerDash) mask |= INPUT_DASH;
    if (data.curveInput === 1 || data.curveX === -1) mask |= INPUT_MAGNUS_LEFT;
    if (data.curveInput === 2 || data.curveX === 1) mask |= INPUT_MAGNUS_RIGHT;
    if (data.isTyping) mask |= INPUT_TYPING;

    view.setUint16(5, mask, false);
    view.setUint16(7, data.clientTimestamp, false);

    return buf;
  }

  /**
   * Decodes an input message from a DataView or ArrayBuffer with backwards compatibility for 8-byte packets.
   */
  public static decode(buffer: ArrayBuffer | DataView): InputData | null {
    const view = buffer instanceof DataView ? buffer : new DataView(buffer);

    if (view.byteLength < 8) return null;
    if (view.getUint8(0) !== OP_INPUT) return null;

    const sequence = view.getUint32(1, false);

    let inputMask = 0;
    let clientTimestamp = 0;

    if (view.byteLength >= 9) {
      inputMask = view.getUint16(5, false);
      clientTimestamp = view.getUint16(7, false);
    } else {
      // Legacy 8-byte fallback
      inputMask = view.getUint8(5);
      clientTimestamp = view.getUint16(6, false);
    }

    const isTurbo = (inputMask & INPUT_TURBO) !== 0;
    const triggerDash = (inputMask & INPUT_DASH) !== 0;
    const magnusLeft = (inputMask & INPUT_MAGNUS_LEFT) !== 0;
    const magnusRight = (inputMask & INPUT_MAGNUS_RIGHT) !== 0;
    const isTyping = (inputMask & INPUT_TYPING) !== 0;

    const curveInput = magnusLeft ? 1 : (magnusRight ? 2 : 0);
    const curveX = magnusLeft ? -1 : (magnusRight ? 1 : 0);
    const curveY = 0;

    return {
      sequence,
      inputMask,
      clientTimestamp,
      curveInput,
      curveX,
      curveY,
      isTurbo,
      triggerDash,
      isTyping
    };
  }
}
