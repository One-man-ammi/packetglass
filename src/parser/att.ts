/**
 * ATT PDU decoding. v0.1 surfaces the two things a device reverse-engineer
 * cares about - what the phone wrote, and what the device sent back - while
 * still naming the other opcodes so statistics stay honest.
 */

import type { AttPacketKind } from './types';

export const ATT_CID = 0x0004;

export const AttOpcode = {
  ErrorResponse: 0x01,
  ExchangeMtuRequest: 0x02,
  ExchangeMtuResponse: 0x03,
  FindInformationRequest: 0x04,
  FindInformationResponse: 0x05,
  FindByTypeValueRequest: 0x06,
  FindByTypeValueResponse: 0x07,
  ReadByTypeRequest: 0x08,
  ReadByTypeResponse: 0x09,
  ReadRequest: 0x0a,
  ReadResponse: 0x0b,
  ReadBlobRequest: 0x0c,
  ReadBlobResponse: 0x0d,
  ReadMultipleRequest: 0x0e,
  ReadMultipleResponse: 0x0f,
  ReadByGroupTypeRequest: 0x10,
  ReadByGroupTypeResponse: 0x11,
  WriteRequest: 0x12,
  WriteResponse: 0x13,
  PrepareWriteRequest: 0x16,
  PrepareWriteResponse: 0x17,
  ExecuteWriteRequest: 0x18,
  ExecuteWriteResponse: 0x19,
  HandleValueNotification: 0x1b,
  HandleValueIndication: 0x1d,
  HandleValueConfirmation: 0x1e,
  WriteCommand: 0x52,
  SignedWriteCommand: 0xd2,
} as const;

const OPCODE_NAMES: Record<number, string> = {
  [AttOpcode.ErrorResponse]: 'Error Response',
  [AttOpcode.ExchangeMtuRequest]: 'Exchange MTU Request',
  [AttOpcode.ExchangeMtuResponse]: 'Exchange MTU Response',
  [AttOpcode.FindInformationRequest]: 'Find Information Request',
  [AttOpcode.FindInformationResponse]: 'Find Information Response',
  [AttOpcode.FindByTypeValueRequest]: 'Find By Type Value Request',
  [AttOpcode.FindByTypeValueResponse]: 'Find By Type Value Response',
  [AttOpcode.ReadByTypeRequest]: 'Read By Type Request',
  [AttOpcode.ReadByTypeResponse]: 'Read By Type Response',
  [AttOpcode.ReadRequest]: 'Read Request',
  [AttOpcode.ReadResponse]: 'Read Response',
  [AttOpcode.ReadBlobRequest]: 'Read Blob Request',
  [AttOpcode.ReadBlobResponse]: 'Read Blob Response',
  [AttOpcode.ReadMultipleRequest]: 'Read Multiple Request',
  [AttOpcode.ReadMultipleResponse]: 'Read Multiple Response',
  [AttOpcode.ReadByGroupTypeRequest]: 'Read By Group Type Request',
  [AttOpcode.ReadByGroupTypeResponse]: 'Read By Group Type Response',
  [AttOpcode.WriteRequest]: 'Write Request',
  [AttOpcode.WriteResponse]: 'Write Response',
  [AttOpcode.PrepareWriteRequest]: 'Prepare Write Request',
  [AttOpcode.PrepareWriteResponse]: 'Prepare Write Response',
  [AttOpcode.ExecuteWriteRequest]: 'Execute Write Request',
  [AttOpcode.ExecuteWriteResponse]: 'Execute Write Response',
  [AttOpcode.HandleValueNotification]: 'Notification',
  [AttOpcode.HandleValueIndication]: 'Indication',
  [AttOpcode.HandleValueConfirmation]: 'Confirmation',
  [AttOpcode.WriteCommand]: 'Write Command',
  [AttOpcode.SignedWriteCommand]: 'Signed Write Command',
};

/** Length of the authentication signature trailing a signed write. */
const SIGNATURE_LENGTH = 12;

export interface AttPdu {
  opcode: number;
  opcodeName: string;
  /** Attribute handle for handle-carrying opcodes, null otherwise. */
  attHandle: number | null;
  /** Attribute value, with any trailing signature removed. */
  value: Uint8Array;
  /** Set for the opcodes v0.1 shows; null for everything else. */
  kind: AttPacketKind | null;
}

export function attOpcodeName(opcode: number): string {
  return OPCODE_NAMES[opcode] ?? `Unknown opcode 0x${opcode.toString(16).padStart(2, '0')}`;
}

export function attPacketKind(opcode: number): AttPacketKind | null {
  switch (opcode) {
    case AttOpcode.WriteRequest:
    case AttOpcode.WriteCommand:
    case AttOpcode.SignedWriteCommand:
      return 'write';
    case AttOpcode.HandleValueNotification:
    case AttOpcode.HandleValueIndication:
      return 'notification';
    default:
      return null;
  }
}

/**
 * Decodes an L2CAP payload on the ATT channel. Returns null for an empty PDU.
 */
export function decodeAttPdu(payload: Uint8Array): AttPdu | null {
  if (payload.byteLength < 1) return null;

  const opcode = payload[0]!;
  const kind = attPacketKind(opcode);
  const body = payload.subarray(1);

  if (kind === null) {
    return { opcode, opcodeName: attOpcodeName(opcode), attHandle: null, value: body, kind };
  }

  if (body.byteLength < 2) return null;

  const attHandle = body[0]! | (body[1]! << 8);
  let value = body.subarray(2);

  if (opcode === AttOpcode.SignedWriteCommand && value.byteLength > SIGNATURE_LENGTH) {
    value = value.subarray(0, value.byteLength - SIGNATURE_LENGTH);
  }

  return { opcode, opcodeName: attOpcodeName(opcode), attHandle, value, kind };
}
