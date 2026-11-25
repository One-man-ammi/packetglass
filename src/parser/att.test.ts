import { describe, expect, it } from 'vitest';

import { AttOpcode, attOpcodeName, attPacketKind, decodeAttPdu } from './att';
import { attPdu, bytes, concatBytes } from './synthetic';

describe('decodeAttPdu', () => {
  it('decodes a write command into handle and value', () => {
    const pdu = decodeAttPdu(attPdu(AttOpcode.WriteCommand, 0x000e, bytes(0xb1, 0x01, 0x00)));
    expect(pdu).not.toBeNull();
    expect(pdu!.kind).toBe('write');
    expect(pdu!.opcodeName).toBe('Write Command');
    expect(pdu!.attHandle).toBe(0x000e);
    expect([...pdu!.value]).toEqual([0xb1, 0x01, 0x00]);
  });

  it('reads the attribute handle as little-endian', () => {
    const pdu = decodeAttPdu(attPdu(AttOpcode.WriteRequest, 0x0123, bytes(0x01)));
    expect(pdu!.attHandle).toBe(0x0123);
  });

  it('decodes notifications and indications as the same kind', () => {
    const notification = decodeAttPdu(
      attPdu(AttOpcode.HandleValueNotification, 0x000c, bytes(0xb2, 0x5a)),
    );
    const indication = decodeAttPdu(attPdu(AttOpcode.HandleValueIndication, 0x000c, bytes(0x01)));

    expect(notification!.kind).toBe('notification');
    expect(notification!.opcodeName).toBe('Notification');
    expect(indication!.kind).toBe('notification');
    expect(indication!.opcodeName).toBe('Indication');
  });

  it('strips the authentication signature from a signed write', () => {
    const value = bytes(0xb1, 0x01, 0x00);
    const signature = new Uint8Array(12).fill(0xcc);
    const pdu = decodeAttPdu(
      attPdu(AttOpcode.SignedWriteCommand, 0x000e, concatBytes(value, signature)),
    );

    expect([...pdu!.value]).toEqual([...value]);
  });

  it('leaves a signed write alone when there is no room for a signature', () => {
    const pdu = decodeAttPdu(attPdu(AttOpcode.SignedWriteCommand, 0x000e, bytes(0x01, 0x02)));
    expect([...pdu!.value]).toEqual([0x01, 0x02]);
  });

  it('names opcodes outside the v0.1 view but marks them as not shown', () => {
    const pdu = decodeAttPdu(attPdu(AttOpcode.ReadResponse, 0x000e, bytes(0x5a)));
    expect(pdu!.kind).toBeNull();
    expect(pdu!.attHandle).toBeNull();
    expect(pdu!.opcodeName).toBe('Read Response');
  });

  it('returns null for an empty PDU or a handle cut in half', () => {
    expect(decodeAttPdu(new Uint8Array(0))).toBeNull();
    expect(decodeAttPdu(bytes(AttOpcode.WriteCommand, 0x0e))).toBeNull();
  });

  it('accepts a zero-length value', () => {
    const pdu = decodeAttPdu(attPdu(AttOpcode.WriteCommand, 0x000e, new Uint8Array(0)));
    expect(pdu!.value.byteLength).toBe(0);
  });
});

describe('opcode helpers', () => {
  it('classifies the opcodes v0.1 shows', () => {
    expect(attPacketKind(AttOpcode.WriteRequest)).toBe('write');
    expect(attPacketKind(AttOpcode.WriteCommand)).toBe('write');
    expect(attPacketKind(AttOpcode.SignedWriteCommand)).toBe('write');
    expect(attPacketKind(AttOpcode.HandleValueNotification)).toBe('notification');
    expect(attPacketKind(AttOpcode.HandleValueIndication)).toBe('notification');
    expect(attPacketKind(AttOpcode.WriteResponse)).toBeNull();
    expect(attPacketKind(AttOpcode.ExchangeMtuRequest)).toBeNull();
  });

  it('labels unknown opcodes with their value', () => {
    expect(attOpcodeName(0x7f)).toBe('Unknown opcode 0x7f');
  });
});
