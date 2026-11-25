import { describe, expect, it } from 'vitest';

import { DatalinkType } from './btsnoop';
import {
  ConnectionTracker,
  H4PacketType,
  L2capReassembler,
  demuxHciPacket,
  formatAddress,
  localNameFromAdvertisingData,
  parseAclFragment,
} from './hci';
import {
  addressBytes,
  advertisingReportEvent,
  aclPacket,
  bytes,
  connectionCompleteEvent,
  concatBytes,
  disconnectionCompleteEvent,
  l2capPacket,
  leConnectionCompleteEvent,
  remoteNameRequestCompleteEvent,
} from './synthetic';
import type { SnoopRecord } from './types';

function record(data: Uint8Array, overrides: Partial<SnoopRecord> = {}): SnoopRecord {
  return {
    index: 0,
    originalLength: data.byteLength,
    includedLength: data.byteLength,
    flags: 0,
    cumulativeDrops: 0,
    timestampUs: 0n,
    epochUs: 0n,
    direction: 'TX',
    isCommandOrEvent: false,
    data,
    truncated: false,
    ...overrides,
  };
}

/** Strips the leading H4 type byte the event builders add. */
function eventBody(event: Uint8Array): Uint8Array {
  return event.subarray(1);
}

describe('demuxHciPacket', () => {
  it('splits the H4 type byte off a UART capture', () => {
    const packet = demuxHciPacket(record(bytes(0x02, 0x40, 0x20, 0x07, 0x00)), DatalinkType.HciUart);
    expect(packet?.type).toBe(H4PacketType.AclData);
    expect([...packet!.payload]).toEqual([0x40, 0x20, 0x07, 0x00]);
  });

  it('infers the packet type for an unencapsulated capture', () => {
    const data = bytes(0x0e, 0x04, 0x01, 0x03);
    const asEvent = demuxHciPacket(
      record(data, { direction: 'RX', isCommandOrEvent: true }),
      DatalinkType.HciUnencapsulated,
    );
    const asCommand = demuxHciPacket(
      record(data, { direction: 'TX', isCommandOrEvent: true }),
      DatalinkType.HciUnencapsulated,
    );
    const asAcl = demuxHciPacket(
      record(data, { direction: 'TX', isCommandOrEvent: false }),
      DatalinkType.HciUnencapsulated,
    );

    expect(asEvent?.type).toBe(H4PacketType.Event);
    expect(asCommand?.type).toBe(H4PacketType.Command);
    expect(asAcl?.type).toBe(H4PacketType.AclData);
    expect([...asEvent!.payload]).toEqual([...data]);
  });

  it('returns null for an empty record', () => {
    expect(demuxHciPacket(record(new Uint8Array(0)), DatalinkType.HciUart)).toBeNull();
  });
});

describe('parseAclFragment', () => {
  it('separates the connection handle from the PB and BC flags', () => {
    const packet = aclPacket(0x0040, bytes(0xaa, 0xbb), { pbFlag: 0b10, bcFlag: 0b01 });
    const fragment = parseAclFragment(packet.subarray(1));

    expect(fragment).not.toBeNull();
    expect(fragment!.connectionHandle).toBe(0x0040);
    expect(fragment!.pbFlag).toBe(0b10);
    expect(fragment!.bcFlag).toBe(0b01);
    expect([...fragment!.data]).toEqual([0xaa, 0xbb]);
  });

  it('honours the ACL data length rather than the record length', () => {
    const payload = concatBytes(bytes(0x40, 0x20, 0x02, 0x00), bytes(0xaa, 0xbb, 0xcc, 0xdd));
    expect([...parseAclFragment(payload)!.data]).toEqual([0xaa, 0xbb]);
  });

  it('returns null when the ACL header is incomplete', () => {
    expect(parseAclFragment(bytes(0x40, 0x20))).toBeNull();
  });
});

describe('L2capReassembler', () => {
  it('emits a complete single-fragment packet', () => {
    const reassembler = new L2capReassembler();
    const fragment = parseAclFragment(
      aclPacket(0x0040, l2capPacket(0x0004, bytes(0x52, 0x0e, 0x00, 0xb1))).subarray(1),
    )!;

    const packet = reassembler.push(fragment, 'TX');
    expect(packet).not.toBeNull();
    expect(packet!.cid).toBe(0x0004);
    expect(packet!.connectionHandle).toBe(0x0040);
    expect([...packet!.payload]).toEqual([0x52, 0x0e, 0x00, 0xb1]);
  });

  it('joins a message split across two ACL fragments', () => {
    const reassembler = new L2capReassembler();
    const value = Uint8Array.from({ length: 30 }, (_, i) => i + 1);
    const full = l2capPacket(0x0004, concatBytes(bytes(0x1b, 0x0c, 0x00), value));

    const start = parseAclFragment(
      aclPacket(0x0040, full.subarray(0, 16), { pbFlag: 0b10 }).subarray(1),
    )!;
    const continuation = parseAclFragment(
      aclPacket(0x0040, full.subarray(16), { pbFlag: 0b01 }).subarray(1),
    )!;

    expect(reassembler.push(start, 'RX')).toBeNull();
    const packet = reassembler.push(continuation, 'RX');
    expect(packet).not.toBeNull();
    expect([...packet!.payload]).toEqual([0x1b, 0x0c, 0x00, ...value]);
  });

  it('keeps the two directions of one handle independent', () => {
    const reassembler = new L2capReassembler();
    const txFull = l2capPacket(0x0004, bytes(0x52, 0x0e, 0x00, 0x01, 0x02, 0x03));
    const rxFull = l2capPacket(0x0004, bytes(0x1b, 0x0c, 0x00, 0x09));

    const txStart = parseAclFragment(
      aclPacket(0x0040, txFull.subarray(0, 6), { pbFlag: 0b10 }).subarray(1),
    )!;
    const rxWhole = parseAclFragment(aclPacket(0x0040, rxFull, { pbFlag: 0b10 }).subarray(1))!;
    const txRest = parseAclFragment(
      aclPacket(0x0040, txFull.subarray(6), { pbFlag: 0b01 }).subarray(1),
    )!;

    expect(reassembler.push(txStart, 'TX')).toBeNull();
    expect([...reassembler.push(rxWhole, 'RX')!.payload]).toEqual([0x1b, 0x0c, 0x00, 0x09]);
    expect([...reassembler.push(txRest, 'TX')!.payload]).toEqual([
      0x52, 0x0e, 0x00, 0x01, 0x02, 0x03,
    ]);
  });

  it('counts continuation fragments that have nothing to continue', () => {
    const reassembler = new L2capReassembler();
    const orphan = parseAclFragment(
      aclPacket(0x0040, bytes(0x05, 0x06, 0x07), { pbFlag: 0b01 }).subarray(1),
    )!;

    expect(reassembler.push(orphan, 'RX')).toBeNull();
    expect(reassembler.orphanFragments).toBe(1);
  });

  it('forgets half-assembled messages when a handle disconnects', () => {
    const reassembler = new L2capReassembler();
    const full = l2capPacket(0x0004, bytes(0x1b, 0x0c, 0x00, 0x01, 0x02, 0x03));
    const start = parseAclFragment(
      aclPacket(0x0040, full.subarray(0, 6), { pbFlag: 0b10 }).subarray(1),
    )!;
    const rest = parseAclFragment(
      aclPacket(0x0040, full.subarray(6), { pbFlag: 0b01 }).subarray(1),
    )!;

    reassembler.push(start, 'RX');
    reassembler.dropHandle(0x0040);
    expect(reassembler.push(rest, 'RX')).toBeNull();
    expect(reassembler.orphanFragments).toBe(1);
  });
});

describe('formatAddress', () => {
  it('reverses the little-endian HCI byte order', () => {
    expect(formatAddress(addressBytes('C4:19:D1:3F:07:AE'))).toBe('C4:19:D1:3F:07:AE');
    expect(formatAddress(bytes(0xae, 0x07, 0x3f, 0xd1, 0x19, 0xc4))).toBe('C4:19:D1:3F:07:AE');
  });
});

describe('localNameFromAdvertisingData', () => {
  it('prefers the complete local name over the shortened one', () => {
    const data = bytes(
      0x02, 0x01, 0x06, // flags
      0x04, 0x08, 0x46, 0x56, 0x50, // shortened name "FVP"
      0x06, 0x09, 0x46, 0x56, 0x50, 0x36, 0x30, // complete name "FVP60"
    );
    expect(localNameFromAdvertisingData(data)).toBe('FVP60');
  });

  it('falls back to the shortened name', () => {
    expect(localNameFromAdvertisingData(bytes(0x04, 0x08, 0x46, 0x56, 0x50))).toBe('FVP');
  });

  it('returns null when no name is advertised', () => {
    expect(localNameFromAdvertisingData(bytes(0x02, 0x01, 0x06))).toBeNull();
  });
});

describe('ConnectionTracker', () => {
  it('maps a handle to the peer address from an LE connection complete event', () => {
    const tracker = new ConnectionTracker();
    tracker.handleEvent(eventBody(leConnectionCompleteEvent(0x0040, 'C4:19:D1:3F:07:AE')));
    expect(tracker.addressForHandle(0x0040)).toBe('C4:19:D1:3F:07:AE');
    expect(tracker.connectedAddresses).toEqual(['C4:19:D1:3F:07:AE']);
  });

  it('reads the enhanced connection complete variant', () => {
    const tracker = new ConnectionTracker();
    tracker.handleEvent(
      eventBody(leConnectionCompleteEvent(0x0041, '58:FC:DB:92:14:60', { enhanced: true })),
    );
    expect(tracker.addressForHandle(0x0041)).toBe('58:FC:DB:92:14:60');
  });

  it('reads classic connection complete events', () => {
    const tracker = new ConnectionTracker();
    tracker.handleEvent(eventBody(connectionCompleteEvent(0x000c, '11:22:33:44:55:66')));
    expect(tracker.addressForHandle(0x000c)).toBe('11:22:33:44:55:66');
  });

  it('ignores a failed connection attempt', () => {
    const tracker = new ConnectionTracker();
    tracker.handleEvent(
      eventBody(leConnectionCompleteEvent(0x0040, 'C4:19:D1:3F:07:AE', { status: 0x02 })),
    );
    expect(tracker.addressForHandle(0x0040)).toBeNull();
  });

  it('releases the handle on disconnect and re-maps it on reconnect', () => {
    const tracker = new ConnectionTracker();
    tracker.handleEvent(eventBody(leConnectionCompleteEvent(0x0040, 'C4:19:D1:3F:07:AE')));

    const result = tracker.handleEvent(eventBody(disconnectionCompleteEvent(0x0040)));
    expect(result.disconnectedHandle).toBe(0x0040);
    expect(tracker.addressForHandle(0x0040)).toBeNull();

    tracker.handleEvent(eventBody(leConnectionCompleteEvent(0x0040, '58:FC:DB:92:14:60')));
    expect(tracker.addressForHandle(0x0040)).toBe('58:FC:DB:92:14:60');
    expect(tracker.connectedAddresses).toEqual(['C4:19:D1:3F:07:AE', '58:FC:DB:92:14:60']);
  });

  it('picks up device names from advertising reports and name responses', () => {
    const tracker = new ConnectionTracker();
    tracker.handleEvent(eventBody(advertisingReportEvent('C4:19:D1:3F:07:AE', 'FVP60')));
    tracker.handleEvent(eventBody(remoteNameRequestCompleteEvent('11:22:33:44:55:66', 'Car Audio')));

    expect(tracker.nameForAddress('C4:19:D1:3F:07:AE')).toBe('FVP60');
    expect(tracker.nameForAddress('11:22:33:44:55:66')).toBe('Car Audio');
    expect(tracker.nameForAddress('58:FC:DB:92:14:60')).toBeNull();
  });

  it('ignores truncated event bodies', () => {
    const tracker = new ConnectionTracker();
    expect(tracker.handleEvent(bytes(0x3e))).toEqual({});
    expect(tracker.handleEvent(bytes(0x3e, 0x01, 0x01))).toEqual({});
    expect(tracker.handleEvent(new Uint8Array(0))).toEqual({});
  });
});
