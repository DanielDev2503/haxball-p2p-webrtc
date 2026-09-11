import { OP_INPUT } from './BinaryProtocol';

export interface InputData {
  sequence: number;
  inputMask: number;
  clientTimestamp: number;
}

export class InputPacket {
  public static readonly BYTE_LENGTH = 8;

  /**
   * Encodes an input message into an 8-byte ArrayBuffer.
   */
  public static encode(data: InputData, buffer?: ArrayBuffer): ArrayBuffer {
    const buf = buffer ?? new ArrayBuffer(InputPacket.BYTE_LENGTH);
    const view = new DataView(buf);

    view.setUint8(0, OP_INPUT);
    view.setUint32(1, data.sequence, false); // Big-endian
    view.setUint8(5, data.inputMask);
    view.setUint16(6, data.clientTimestamp, false);

    return buf;
  }

  /**
   * Decodes an input message from a DataView or ArrayBuffer.
   */
  public static decode(buffer: ArrayBuffer | DataView): InputData | null {
    const view = buffer instanceof DataView ? buffer : new DataView(buffer);

    if (view.byteLength < InputPacket.BYTE_LENGTH) return null;
    if (view.getUint8(0) !== OP_INPUT) return null;

    const sequence = view.getUint32(1, false);
    const inputMask = view.getUint8(5);
    const clientTimestamp = view.getUint16(6, false);

    return {
      sequence,
      inputMask,
      clientTimestamp
    };
  }
}
