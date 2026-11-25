import { describe, expect, it } from 'vitest';

import {
  BTSNOOP_EPOCH_DELTA_US,
  BtsnoopFormatError,
  DatalinkType,
  datalinkTypeName,
  parseBtsnoop,
  readBtsnoopHeader,
} from './btsnoop';
import { bytes, buildBtsnoopFile, concatBytes } from './synthetic';

const AT_2026_11_25 = Date.UTC(2026, 10, 25, 20, 41, 18, 500);

describe('readBtsnoopHeader', () => {
  it('reads the version and datalink type as big-endian words', () => {
    const file = buildBtsnoopFile([], { datalinkType: DatalinkType.HciUart });
    expect(readBtsnoopHeader(file)).toEqual({ version: 1, datalinkType: 1002 });
    expect(file.subarray(8, 16)).toEqual(bytes(0, 0, 0, 1, 0, 0, 0x03, 0xea));
  });

  it('rejects a file that does not carry the btsnoop identification pattern', () => {
    const file = buildBtsnoopFile([], { magic: 'notsnop\0' });
    expect(() => readBtsnoopHeader(file)).toThrow(BtsnoopFormatError);
    expect(() => readBtsnoopHeader(file)).toThrow(/identification pattern/);
  });

  it('rejects a file shorter than the 16-byte header', () => {
    expect(() => readBtsnoopHeader(bytes(0x62, 0x74, 0x73))).toThrow(/too short/);
  });

  it('rejects an unknown version', () => {
    expect(() => readBtsnoopHeader(buildBtsnoopFile([], { version: 2 }))).toThrow(/version 2/);
  });

  it('names the datalink encapsulations', () => {
    expect(datalinkTypeName(DatalinkType.HciUart)).toBe('HCI UART (H4)');
    expect(datalinkTypeName(DatalinkType.HciUnencapsulated)).toBe('HCI unencapsulated');
    expect(datalinkTypeName(7)).toBe('unknown datalink 7');
  });
});

describe('readBtsnoopRecords', () => {
  it('reads record header fields in big-endian order', () => {
    const file = buildBtsnoopFile([
      {
        data: bytes(0x04, 0x05, 0x04, 0x00, 0x40, 0x00, 0x13),
        direction: 'RX',
        isCommandOrEvent: true,
        epochUs: BigInt(AT_2026_11_25) * 1000n,
      },
    ]);

    const { records } = parseBtsnoop(file);
    expect(records).toHaveLength(1);
    const record = records[0]!;
    expect(record.index).toBe(0);
    expect(record.originalLength).toBe(7);
    expect(record.includedLength).toBe(7);
    expect(record.flags).toBe(0x03);
    expect(record.cumulativeDrops).toBe(0);
    expect(record.truncated).toBe(false);
    expect([...record.data]).toEqual([0x04, 0x05, 0x04, 0x00, 0x40, 0x00, 0x13]);
  });

  it('converts the 0000-01-01 timestamp base to Unix microseconds', () => {
    const epochUs = BigInt(AT_2026_11_25) * 1000n + 123n;
    const file = buildBtsnoopFile([
      { data: bytes(0x04, 0x05), direction: 'RX', isCommandOrEvent: true, epochUs },
    ]);

    const record = parseBtsnoop(file).records[0]!;
    expect(record.epochUs).toBe(epochUs);
    expect(record.timestampUs).toBe(epochUs + BTSNOOP_EPOCH_DELTA_US);
    expect(new Date(Number(record.epochUs / 1000n)).toISOString()).toBe('2026-11-25T20:41:18.500Z');
  });

  it('matches the documented epoch base of 719540 days', () => {
    expect(BTSNOOP_EPOCH_DELTA_US).toBe(719540n * 86400n * 1000000n);
  });

  it('derives direction and the command/event flag from the packet flags', () => {
    const file = buildBtsnoopFile([
      { data: bytes(0x02, 0x40), direction: 'TX', isCommandOrEvent: false, epochUs: 1000n },
      { data: bytes(0x02, 0x40), direction: 'RX', isCommandOrEvent: false, epochUs: 2000n },
      { data: bytes(0x01, 0x03), direction: 'TX', isCommandOrEvent: true, epochUs: 3000n },
      { data: bytes(0x04, 0x0e), direction: 'RX', isCommandOrEvent: true, epochUs: 4000n },
    ]);

    const { records } = parseBtsnoop(file);
    expect(records.map((record) => record.direction)).toEqual(['TX', 'RX', 'TX', 'RX']);
    expect(records.map((record) => record.isCommandOrEvent)).toEqual([false, false, true, true]);
  });

  it('flags records the capture snapshot cut short', () => {
    const file = buildBtsnoopFile([
      {
        data: bytes(0x02, 0x40, 0x20, 0x07),
        direction: 'RX',
        isCommandOrEvent: false,
        epochUs: 1000n,
        originalLength: 31,
      },
    ]);

    const record = parseBtsnoop(file).records[0]!;
    expect(record.truncated).toBe(true);
    expect(record.originalLength).toBe(31);
    expect(record.includedLength).toBe(4);
  });

  it('warns instead of throwing when the file ends mid-record', () => {
    const complete = buildBtsnoopFile([
      { data: bytes(0x04, 0x05, 0x04), direction: 'RX', isCommandOrEvent: true, epochUs: 1000n },
      { data: bytes(0x04, 0x05, 0x04), direction: 'RX', isCommandOrEvent: true, epochUs: 2000n },
    ]);
    const cut = complete.subarray(0, complete.byteLength - 2);

    const { records, warnings } = parseBtsnoop(cut);
    expect(records).toHaveLength(1);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/truncated/);
  });

  it('warns about stray bytes that are too short to be a record header', () => {
    const file = buildBtsnoopFile([
      { data: bytes(0x04, 0x05, 0x04), direction: 'RX', isCommandOrEvent: true, epochUs: 1000n },
    ]);
    const padded = concatBytes(file, bytes(0x00, 0x00, 0x00));

    const { records, warnings } = parseBtsnoop(padded);
    expect(records).toHaveLength(1);
    expect(warnings[0]).toMatch(/3 stray bytes/);
  });

  it('reads an empty capture as zero records', () => {
    expect(parseBtsnoop(buildBtsnoopFile([])).records).toEqual([]);
  });
});
