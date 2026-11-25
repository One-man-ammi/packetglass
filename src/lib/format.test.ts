import { describe, expect, it } from 'vitest';

import { bytes } from '../parser/synthetic';
import {
  byteRows,
  decodeNumbers,
  formatAbsolute,
  formatClock,
  formatCount,
  formatDuration,
  formatFileSize,
  formatHandle,
  formatOpcode,
  formatRelative,
  hexValue,
  isPrintable,
  toAscii,
  toHex,
  toHexCompact,
} from './format';

describe('hex and ASCII rendering', () => {
  it('renders uppercase space-separated hex', () => {
    expect(toHex(bytes(0xb2, 0x5a, 0x01, 0x00))).toBe('B2 5A 01 00');
    expect(toHex(bytes(0x0f), '')).toBe('0F');
    expect(toHex(new Uint8Array(0))).toBe('');
  });

  it('renders compact lowercase hex for searching', () => {
    expect(toHexCompact(bytes(0xb2, 0x5a, 0x01, 0x00))).toBe('b25a0100');
  });

  it('shows printable characters and dots for the rest', () => {
    const payload = bytes(0xb1, 0x01, 0x46, 0x56, 0x50, 0x36, 0x30, 0x00, 0x5a);
    expect(toAscii(payload)).toBe('..FVP60.Z');
  });

  it('treats space and tilde as the printable boundaries', () => {
    expect(toAscii(bytes(0x1f, 0x20, 0x7e, 0x7f))).toBe('. ~.');
    expect(isPrintable(0x20)).toBe(true);
    expect(isPrintable(0x7f)).toBe(false);
  });

  it('splits payloads into fixed-width rows', () => {
    const payload = Uint8Array.from({ length: 20 }, (_, i) => i);
    const rows = byteRows(payload, 16);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.offset).toBe(0);
    expect(rows[0]!.bytes).toHaveLength(16);
    expect(rows[1]!.offset).toBe(16);
    expect(rows[1]!.bytes).toEqual([16, 17, 18, 19]);
    expect(byteRows(new Uint8Array(0))).toEqual([]);
  });
});

describe('decodeNumbers', () => {
  it('decodes every width at every offset, little and big endian', () => {
    const decodes = decodeNumbers(bytes(0xb3, 0x07, 0xea, 0x0b));
    expect(decodes).toHaveLength(4);

    expect(decodes[0]).toEqual({
      offset: 0,
      uint8: 0xb3,
      int8: -77,
      uint16le: 0x07b3,
      uint16be: 0xb307,
      uint32le: 0x0bea07b3,
      uint32be: 0xb307ea0b,
    });

    // The year a device clock-sync write carries: big-endian 0x07ea = 2026.
    expect(decodes[1]!.uint16be).toBe(2026);
    expect(decodes[1]!.uint16le).toBe(0xea07);
  });

  it('returns null for widths that run past the payload', () => {
    const decodes = decodeNumbers(bytes(0x5a, 0x01, 0x00));
    expect(decodes[1]!.uint16le).toBe(0x0001);
    expect(decodes[1]!.uint32le).toBeNull();
    expect(decodes[2]!.uint16le).toBeNull();
    expect(decodes[2]!.uint8).toBe(0x00);
  });

  it('handles an empty payload', () => {
    expect(decodeNumbers(new Uint8Array(0))).toEqual([]);
  });

  it('decodes a byte offset inside a larger buffer correctly', () => {
    const backing = bytes(0xff, 0xff, 0x07, 0xea, 0xff);
    const payload = backing.subarray(2, 4);
    expect(decodeNumbers(payload)[0]!.uint16be).toBe(2026);
  });

  it('formats decoded values as fixed-width hex', () => {
    expect(hexValue(2026, 2)).toBe('0x07ea');
    expect(hexValue(0x5a, 1)).toBe('0x5a');
    expect(hexValue(null, 4)).toBe('');
  });
});

describe('identifier formatting', () => {
  it('pads handles to four hex digits and opcodes to two', () => {
    expect(formatHandle(0x0e)).toBe('0x000e');
    expect(formatHandle(0x1234)).toBe('0x1234');
    expect(formatOpcode(0x1b)).toBe('0x1b');
  });
});

describe('time formatting', () => {
  const epochUs = BigInt(new Date(2026, 10, 25, 20, 41, 18, 466).getTime()) * 1000n + 123n;

  it('shows a wall clock with microseconds', () => {
    expect(formatClock(epochUs)).toBe('20:41:18.466123');
  });

  it('shows the full local date and time', () => {
    expect(formatAbsolute(epochUs)).toBe('2026-11-25 20:41:18.466123');
  });

  it('shows a signed offset from a reference instant', () => {
    expect(formatRelative(epochUs + 1_250_000n, epochUs)).toBe('+1.250 s');
    expect(formatRelative(epochUs - 500_000n, epochUs)).toBe('-0.500 s');
    expect(formatRelative(epochUs, epochUs)).toBe('+0.000 s');
  });

  it('formats capture durations', () => {
    expect(formatDuration(11_800_000n)).toBe('11.800 s');
    expect(formatDuration(95_000_000n)).toBe('1m 35s');
    expect(formatDuration(3_725_000_000n)).toBe('1h 02m 05s');
  });
});

describe('miscellaneous formatting', () => {
  it('formats file sizes', () => {
    expect(formatFileSize(512)).toBe('512 B');
    expect(formatFileSize(2048)).toBe('2.0 KB');
    expect(formatFileSize(5 * 1024 * 1024)).toBe('5.0 MB');
  });

  it('pluralises counts', () => {
    expect(formatCount(1, 'packet')).toBe('1 packet');
    expect(formatCount(2, 'packet')).toBe('2 packets');
    expect(formatCount(0, 'device')).toBe('0 devices');
  });
});
