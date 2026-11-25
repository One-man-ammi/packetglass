/**
 * Byte-level builders for synthetic btsnoop captures.
 *
 * These exist so the parser can be tested against files whose every byte is
 * known, and so the app can offer a sample capture without shipping someone's
 * real Bluetooth traffic. Everything here writes the format by hand, the same
 * way the parser reads it.
 */

import { BTSNOOP_EPOCH_DELTA_US, BTSNOOP_HEADER_SIZE, DatalinkType } from './btsnoop';
import { AttOpcode, ATT_CID } from './att';
import { H4PacketType, HciEventCode, LeMetaSubevent } from './hci';
import type { Direction } from './types';

export interface SyntheticRecord {
  /** Record payload including the H4 packet type byte. */
  data: Uint8Array;
  direction: Direction;
  isCommandOrEvent: boolean;
  /** Microseconds since the Unix epoch. */
  epochUs: bigint;
  /** Original packet length, when simulating a snapshot-truncated capture. */
  originalLength?: number;
}

export interface BuildFileOptions {
  version?: number;
  datalinkType?: number;
  magic?: string;
}

export function buildBtsnoopFile(
  records: SyntheticRecord[],
  options: BuildFileOptions = {},
): Uint8Array {
  const { version = 1, datalinkType = DatalinkType.HciUart, magic = 'btsnoop\0' } = options;

  const bodySize = records.reduce((total, record) => total + 24 + record.data.byteLength, 0);
  const out = new Uint8Array(BTSNOOP_HEADER_SIZE + bodySize);
  const view = new DataView(out.buffer);

  for (let i = 0; i < magic.length; i += 1) out[i] = magic.charCodeAt(i);
  view.setUint32(8, version, false);
  view.setUint32(12, datalinkType, false);

  let offset = BTSNOOP_HEADER_SIZE;
  for (const record of records) {
    const flags = (record.direction === 'RX' ? 0x01 : 0x00) | (record.isCommandOrEvent ? 0x02 : 0x00);
    view.setUint32(offset, record.originalLength ?? record.data.byteLength, false);
    view.setUint32(offset + 4, record.data.byteLength, false);
    view.setUint32(offset + 8, flags, false);
    view.setUint32(offset + 12, 0, false);
    view.setBigInt64(offset + 16, record.epochUs + BTSNOOP_EPOCH_DELTA_US, false);
    out.set(record.data, offset + 24);
    offset += 24 + record.data.byteLength;
  }

  return out;
}

export function bytes(...values: number[]): Uint8Array {
  return Uint8Array.from(values);
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

export function uint16le(value: number): Uint8Array {
  return bytes(value & 0xff, (value >> 8) & 0xff);
}

/** Turns AA:BB:CC:DD:EE:FF into the little-endian byte order HCI uses. */
export function addressBytes(address: string): Uint8Array {
  const parts = address.split(':').map((part) => parseInt(part, 16));
  if (parts.length !== 6 || parts.some((part) => Number.isNaN(part))) {
    throw new Error(`Invalid address: ${address}`);
  }
  return Uint8Array.from(parts.reverse());
}

export function hciEvent(code: number, params: Uint8Array): Uint8Array {
  return concatBytes(bytes(H4PacketType.Event, code, params.byteLength), params);
}

export function leMetaEvent(subevent: number, body: Uint8Array): Uint8Array {
  return hciEvent(HciEventCode.LeMeta, concatBytes(bytes(subevent), body));
}

export function leConnectionCompleteEvent(
  connectionHandle: number,
  address: string,
  options: { enhanced?: boolean; status?: number } = {},
): Uint8Array {
  const { enhanced = false, status = 0x00 } = options;
  const common = concatBytes(
    bytes(status),
    uint16le(connectionHandle),
    bytes(0x00, 0x00), // role: central, peer address type: public
    addressBytes(address),
  );
  const tail = enhanced
    ? concatBytes(new Uint8Array(12), bytes(0x18, 0x00, 0x00, 0x00, 0x2a, 0x00, 0x00))
    : bytes(0x18, 0x00, 0x00, 0x00, 0x2a, 0x00, 0x00);
  return leMetaEvent(
    enhanced ? LeMetaSubevent.EnhancedConnectionComplete : LeMetaSubevent.ConnectionComplete,
    concatBytes(common, tail),
  );
}

export function connectionCompleteEvent(connectionHandle: number, address: string): Uint8Array {
  return hciEvent(
    HciEventCode.ConnectionComplete,
    concatBytes(bytes(0x00), uint16le(connectionHandle), addressBytes(address), bytes(0x01, 0x00)),
  );
}

export function disconnectionCompleteEvent(connectionHandle: number, reason = 0x13): Uint8Array {
  return hciEvent(
    HciEventCode.DisconnectionComplete,
    concatBytes(bytes(0x00), uint16le(connectionHandle), bytes(reason)),
  );
}

export function advertisingReportEvent(address: string, localName: string): Uint8Array {
  const nameBytes = new TextEncoder().encode(localName);
  const adData = concatBytes(
    bytes(0x02, 0x01, 0x06), // flags
    bytes(nameBytes.byteLength + 1, 0x09),
    nameBytes,
  );
  return leMetaEvent(
    LeMetaSubevent.AdvertisingReport,
    concatBytes(
      bytes(0x01, 0x00, 0x00), // one report, connectable undirected, public address
      addressBytes(address),
      bytes(adData.byteLength),
      adData,
      bytes(0xbf), // RSSI -65 dBm
    ),
  );
}

export function remoteNameRequestCompleteEvent(address: string, name: string): Uint8Array {
  const nameBytes = new TextEncoder().encode(name);
  const padded = new Uint8Array(248);
  padded.set(nameBytes.subarray(0, 248));
  return hciEvent(
    HciEventCode.RemoteNameRequestComplete,
    concatBytes(bytes(0x00), addressBytes(address), padded),
  );
}

export function l2capPacket(cid: number, payload: Uint8Array): Uint8Array {
  return concatBytes(uint16le(payload.byteLength), uint16le(cid), payload);
}

export function attPdu(opcode: number, attHandle: number, value: Uint8Array): Uint8Array {
  return concatBytes(bytes(opcode), uint16le(attHandle), value);
}

export interface AclOptions {
  /** Packet boundary flag: 0b10 starts a message, 0b01 continues one. */
  pbFlag?: number;
  bcFlag?: number;
}

export function aclPacket(
  connectionHandle: number,
  data: Uint8Array,
  options: AclOptions = {},
): Uint8Array {
  const { pbFlag = 0b10, bcFlag = 0b00 } = options;
  const handleAndFlags = (connectionHandle & 0x0fff) | (pbFlag << 12) | (bcFlag << 14);
  return concatBytes(
    bytes(H4PacketType.AclData),
    uint16le(handleAndFlags),
    uint16le(data.byteLength),
    data,
  );
}

export function eventRecord(data: Uint8Array, epochUs: bigint): SyntheticRecord {
  return { data, direction: 'RX', isCommandOrEvent: true, epochUs };
}

export function aclRecord(
  data: Uint8Array,
  direction: Direction,
  epochUs: bigint,
): SyntheticRecord {
  return { data, direction, isCommandOrEvent: false, epochUs };
}

/** Builds an ATT write or notification as a single, unfragmented ACL record. */
export function attRecord(options: {
  connectionHandle: number;
  opcode: number;
  attHandle: number;
  value: Uint8Array;
  direction: Direction;
  epochUs: bigint;
}): SyntheticRecord {
  const { connectionHandle, opcode, attHandle, value, direction, epochUs } = options;
  const pdu = attPdu(opcode, attHandle, value);
  return aclRecord(aclPacket(connectionHandle, l2capPacket(ATT_CID, pdu)), direction, epochUs);
}

/** Splits one L2CAP message across two ACL records, as a long write does. */
export function fragmentedAttRecords(options: {
  connectionHandle: number;
  opcode: number;
  attHandle: number;
  value: Uint8Array;
  direction: Direction;
  epochUs: bigint;
  splitAt: number;
  gapUs?: bigint;
}): SyntheticRecord[] {
  const { connectionHandle, opcode, attHandle, value, direction, epochUs, splitAt } = options;
  const gapUs = options.gapUs ?? 1500n;
  const full = l2capPacket(ATT_CID, attPdu(opcode, attHandle, value));

  return [
    aclRecord(
      aclPacket(connectionHandle, full.subarray(0, splitAt), { pbFlag: 0b10 }),
      direction,
      epochUs,
    ),
    aclRecord(
      aclPacket(connectionHandle, full.subarray(splitAt), { pbFlag: 0b01 }),
      direction,
      epochUs + gapUs,
    ),
  ];
}

const BAND_ADDRESS = 'C4:19:D1:3F:07:AE';
const EARBUDS_ADDRESS = '58:FC:DB:92:14:60';

/**
 * A small but realistic capture: a fitness band that is written to and answers
 * with notifications, plus a second device sharing the capture, one fragmented
 * notification, and a disconnect at the end.
 */
export function buildSampleCapture(startMs = Date.UTC(2026, 10, 25, 20, 41, 18, 0)): Uint8Array {
  const t0 = BigInt(startMs) * 1000n;
  const ms = (value: number): bigint => t0 + BigInt(Math.round(value * 1000));
  const bandHandle = 0x0040;
  const earbudHandle = 0x0041;
  const commandHandle = 0x000e;
  const notifyHandle = 0x000c;

  const write = (at: number, value: number[], opcode: number = AttOpcode.WriteCommand) =>
    attRecord({
      connectionHandle: bandHandle,
      opcode,
      attHandle: commandHandle,
      value: bytes(...value),
      direction: 'TX',
      epochUs: ms(at),
    });

  const notify = (at: number, value: number[]) =>
    attRecord({
      connectionHandle: bandHandle,
      opcode: AttOpcode.HandleValueNotification,
      attHandle: notifyHandle,
      value: bytes(...value),
      direction: 'RX',
      epochUs: ms(at),
    });

  return buildBtsnoopFile([
    eventRecord(advertisingReportEvent(BAND_ADDRESS, 'FVP60'), ms(0)),
    eventRecord(leConnectionCompleteEvent(bandHandle, BAND_ADDRESS), ms(120)),
    eventRecord(advertisingReportEvent(EARBUDS_ADDRESS, 'Aurora Buds'), ms(180)),
    eventRecord(leConnectionCompleteEvent(earbudHandle, EARBUDS_ADDRESS, { enhanced: true }), ms(240)),

    // Device info request, answered with a model string.
    write(410, [0xb1, 0x01, 0x00]),
    notify(466, [0xb1, 0x01, 0x46, 0x56, 0x50, 0x36, 0x30, 0x00, 0x5a]),

    // Battery query: 0x5a is the 90% the stock app shows.
    write(1250, [0xb2, 0x00]),
    notify(1302, [0xb2, 0x5a, 0x01, 0x00]),

    // Clock sync, big-endian year 0x07ea = 2026.
    write(2110, [0xb3, 0x07, 0xea, 0x0b, 0x19, 0x14, 0x29, 0x12]),
    notify(2168, [0xb3, 0x00]),

    // "Start heart rate" in the stock app, then a stream of samples.
    write(3400, [0xc1, 0x01], AttOpcode.WriteRequest),
    notify(4402, [0xc1, 0x00, 0x48]),
    notify(5405, [0xc1, 0x00, 0x4b]),
    notify(6407, [0xc1, 0x00, 0x4a]),
    notify(7410, [0xc1, 0x00, 0x51]),

    // A long activity record the controller had to fragment.
    ...fragmentedAttRecords({
      connectionHandle: bandHandle,
      opcode: AttOpcode.HandleValueNotification,
      attHandle: notifyHandle,
      value: bytes(
        0xd4, 0x00, 0x07, 0xea, 0x0b, 0x19, 0x00, 0x00, 0x13, 0x88, 0x00, 0x00, 0x27, 0x10, 0x00,
        0x1e, 0x00, 0x2d, 0x52, 0x55, 0x4e, 0x00,
      ),
      direction: 'RX',
      epochUs: ms(8900),
      splitAt: 16,
    }),

    attRecord({
      connectionHandle: earbudHandle,
      opcode: AttOpcode.WriteCommand,
      attHandle: 0x0021,
      value: bytes(0x01, 0x03, 0x00, 0x64),
      direction: 'TX',
      epochUs: ms(9600),
    }),
    attRecord({
      connectionHandle: earbudHandle,
      opcode: AttOpcode.HandleValueNotification,
      attHandle: 0x0023,
      value: bytes(0x01, 0x03, 0x64, 0x58, 0x5f, 0x52),
      direction: 'RX',
      epochUs: ms(9712),
    }),

    write(10400, [0xc1, 0x00], AttOpcode.WriteRequest),
    notify(10455, [0xc1, 0x00, 0x00]),
    eventRecord(disconnectionCompleteEvent(bandHandle), ms(11800)),
  ]);
}
