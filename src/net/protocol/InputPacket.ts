import { OP_INPUT } from './BinaryProtocol';

export interface InputData {
  sequence: number;
  inputMask: number;
  clientTimestamp: number;
  curveX?: number | undefined;
  curveY?: number | undefined;
  isTurbo?: boolean | undefined;
  triggerDash?: boolean | undefined;
}

export class InputPacket {
  public static readonly BYTE_LENGTH = 9;

  /**
   * Encodes an input message into a 9-byte ArrayBuffer.
   * Byte 0: OP_INPUT (0x01)
   * Bytes 1-4: sequence (uint32)
   * Byte 5: inputMask (uint8: movement + kick)
   * Bytes 6-7: clientTimestamp (uint16)
   * Byte 8: actionByte:
   *   Bits 0-1: curveX (0: 0, 1: +1, 2: -1)
   *   Bits 2-3: curveY (0: 0, 1: +1, 2: -1)
   *   Bit 4: isTurbo (0 o 1)
   *   Bit 5: triggerDash (0 o 1)
   */
  public static encode(data: InputData, buffer?: ArrayBuffer): ArrayBuffer {
    const buf = buffer ?? new ArrayBuffer(InputPacket.BYTE_LENGTH);
    const view = new DataView(buf);

    view.setUint8(0, OP_INPUT);
    view.setUint32(1, data.sequence, false); // Big-endian
    view.setUint8(5, data.inputMask);
    view.setUint16(6, data.clientTimestamp, false);

    const encEx = data.curveX === 1 ? 1 : (data.curveX === -1 ? 2 : 0);
    const encEy = data.curveY === 1 ? 1 : (data.curveY === -1 ? 2 : 0);
    const isTurbo = Boolean(data.isTurbo);
    const triggerDash = Boolean(data.triggerDash);
    const actionByte = (encEx & 0x03) | ((encEy & 0x03) << 2) | (isTurbo ? (1 << 4) : 0) | (triggerDash ? (1 << 5) : 0);

    view.setUint8(8, actionByte);

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
    const inputMask = view.getUint8(5);
    const clientTimestamp = view.getUint16(6, false);

    let curveX = 0;
    let curveY = 0;
    let isTurbo = false;
    let triggerDash = false;

    if (view.byteLength >= 9) {
      const actionByte = view.getUint8(8);
      const rawEx = actionByte & 0x03;
      const rawEy = (actionByte >> 2) & 0x03;
      curveX = rawEx === 1 ? 1 : (rawEx === 2 ? -1 : 0);
      curveY = rawEy === 1 ? 1 : (rawEy === 2 ? -1 : 0);
      isTurbo = (actionByte & (1 << 4)) !== 0;
      triggerDash = (actionByte & (1 << 5)) !== 0;
    }

    return {
      sequence,
      inputMask,
      clientTimestamp,
      curveX,
      curveY,
      isTurbo,
      triggerDash
    };
  }
}
