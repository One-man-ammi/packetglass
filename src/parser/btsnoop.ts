/**
 * btsnoop file reader.
 *
 * Format (all multi-byte fields big-endian):
 *
 *   File header, 16 bytes
 *     0  identification pattern  8 bytes  "btsnoop\0"
 *     8  version number          4 bytes  always 1
 *    12  datalink type           4 bytes  1001..1004
 *
 *   Record header, 24 bytes, followed by `includedLength` bytes of packet data
 *     0  original length         4 bytes
 *     4  included length         4 bytes
 *     8  packet flags            4 bytes
 *    12  cumulative drops        4 bytes
 *    16  timestamp microseconds  8 bytes  signed, since 0000-01-01 00:00
 *
 *   Packet flags
 *     bit 0  0 = sent by host, 1 = received by host
 *     bit 1  0 = ACL/SCO data,  1 = HCI command or event
 */

import type { BtsnoopHeader, SnoopRecord } from './types';

export const BTSNOOP_MAGIC = 'btsnoop\0';
export const BTSNOOP_HEADER_SIZE = 16;
export const BTSNOOP_RECORD_HEADER_SIZE = 24;

export const DatalinkType = {
  HciUnencapsulated: 1001,
  HciUart: 1002,
  HciBscp: 1003,
  HciSerial: 1004,
} as const;

/**
 * Microseconds between 0000-01-01 00:00 and the Unix epoch, as used by every
 * btsnoop writer and reader in practice (Wireshark calls this KUnixTimeBase).
 * It is 719540 days, which is the nominal-Gregorian value the format specifies
 * rather than a strict proleptic-Gregorian day count.
 */
export const BTSNOOP_EPOCH_DELTA_US = 62168256000000000n;

export class BtsnoopFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BtsnoopFormatError';
  }
}

export function datalinkTypeName(datalinkType: number): string {
  switch (datalinkType) {
    case DatalinkType.HciUnencapsulated:
      return 'HCI unencapsulated';
    case DatalinkType.HciUart:
      return 'HCI UART (H4)';
    case DatalinkType.HciBscp:
      return 'HCI BSCP';
    case DatalinkType.HciSerial:
      return 'HCI serial (H5)';
    default:
      return `unknown datalink ${datalinkType}`;
  }
}

export function readBtsnoopHeader(bytes: Uint8Array): BtsnoopHeader {
  if (bytes.byteLength < BTSNOOP_HEADER_SIZE) {
    throw new BtsnoopFormatError(
      `File is ${bytes.byteLength} bytes, too short to be a btsnoop capture.`,
    );
  }

  for (let i = 0; i < BTSNOOP_MAGIC.length; i += 1) {
    if (bytes[i] !== BTSNOOP_MAGIC.charCodeAt(i)) {
      throw new BtsnoopFormatError(
        'Not a btsnoop capture: the file does not start with the "btsnoop" identification pattern.',
      );
    }
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint32(8, false);
  const datalinkType = view.getUint32(12, false);

  if (version !== 1) {
    throw new BtsnoopFormatError(`Unsupported btsnoop version ${version}; only version 1 is defined.`);
  }

  return { version, datalinkType };
}

/**
 * Walks the records after the file header. Record data is handed out as views
 * into the source buffer so that large captures are not duplicated in memory.
 * A trailing record with a truncated header or body ends iteration and is
 * reported through `onWarning` instead of throwing, because captures pulled off
 * a phone are routinely cut off mid-record.
 */
export function* readBtsnoopRecords(
  bytes: Uint8Array,
  onWarning?: (message: string) => void,
): Generator<SnoopRecord> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = BTSNOOP_HEADER_SIZE;
  let index = 0;

  while (offset < bytes.byteLength) {
    if (offset + BTSNOOP_RECORD_HEADER_SIZE > bytes.byteLength) {
      onWarning?.(
        `Capture ends with ${bytes.byteLength - offset} stray bytes after record ${index}; ignored.`,
      );
      return;
    }

    const originalLength = view.getUint32(offset, false);
    const includedLength = view.getUint32(offset + 4, false);
    const flags = view.getUint32(offset + 8, false);
    const cumulativeDrops = view.getUint32(offset + 12, false);
    const timestampUs = view.getBigInt64(offset + 16, false);
    const dataOffset = offset + BTSNOOP_RECORD_HEADER_SIZE;

    if (dataOffset + includedLength > bytes.byteLength) {
      onWarning?.(
        `Record ${index} claims ${includedLength} bytes but only ${
          bytes.byteLength - dataOffset
        } remain; capture appears truncated.`,
      );
      return;
    }

    yield {
      index,
      originalLength,
      includedLength,
      flags,
      cumulativeDrops,
      timestampUs,
      epochUs: timestampUs - BTSNOOP_EPOCH_DELTA_US,
      direction: (flags & 0x01) === 0 ? 'TX' : 'RX',
      isCommandOrEvent: (flags & 0x02) !== 0,
      data: bytes.subarray(dataOffset, dataOffset + includedLength),
      truncated: includedLength < originalLength,
    };

    offset = dataOffset + includedLength;
    index += 1;
  }
}

/** Convenience wrapper that materialises every record; handy in tests. */
export function parseBtsnoop(input: ArrayBuffer | Uint8Array): {
  header: BtsnoopHeader;
  records: SnoopRecord[];
  warnings: string[];
} {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const header = readBtsnoopHeader(bytes);
  const warnings: string[] = [];
  const records = [...readBtsnoopRecords(bytes, (message) => warnings.push(message))];
  return { header, records, warnings };
}
