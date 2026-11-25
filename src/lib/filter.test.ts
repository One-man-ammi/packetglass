import { describe, expect, it } from 'vitest';

import { bytes } from '../parser/synthetic';
import type { AttPacket } from '../parser/types';
import { filterPackets, hexMatchRanges, matchesFilter, parseFilterQuery } from './filter';

function packet(overrides: Partial<AttPacket> = {}): AttPacket {
  return {
    id: 0,
    recordIndex: 0,
    timestampUs: 0n,
    direction: 'TX',
    connectionHandle: 0x0040,
    deviceKey: 'C4:19:D1:3F:07:AE',
    deviceAddress: 'C4:19:D1:3F:07:AE',
    opcode: 0x52,
    opcodeName: 'Write Command',
    kind: 'write',
    attHandle: 0x000e,
    payload: bytes(0xb1, 0x01, 0x46, 0x56, 0x50, 0x36, 0x30, 0x00, 0x5a),
    ...overrides,
  };
}

describe('parseFilterQuery', () => {
  it('treats an empty query as no filter', () => {
    expect(parseFilterQuery('   ').isEmpty).toBe(true);
    expect(parseFilterQuery('').field).toBe('any');
  });

  it('recognises field prefixes', () => {
    expect(parseFilterQuery('hex:b1 01').field).toBe('hex');
    expect(parseFilterQuery('ascii:FVP').field).toBe('ascii');
    expect(parseFilterQuery('text:FVP').field).toBe('ascii');
    expect(parseFilterQuery('handle:0x000e').field).toBe('handle');
    expect(parseFilterQuery('h:e').field).toBe('handle');
  });

  it('keeps an unknown prefix as part of a plain term', () => {
    const filter = parseFilterQuery('foo:bar');
    expect(filter.field).toBe('any');
    expect(filter.term).toBe('foo:bar');
  });

  it('normalises hex terms written with separators or 0x', () => {
    expect(parseFilterQuery('hex:B1 01').hexTerm).toBe('b101');
    expect(parseFilterQuery('hex:0xB101').hexTerm).toBe('b101');
    expect(parseFilterQuery('hex:b1:01').hexTerm).toBe('b101');
  });

  it('parses handles as hex when they contain hex digits and decimal otherwise', () => {
    expect(parseFilterQuery('handle:0x000e').handle).toBe(14);
    expect(parseFilterQuery('handle:e').handle).toBe(14);
    expect(parseFilterQuery('handle:12').handle).toBe(12);
  });

  it('reports a query that cannot match', () => {
    expect(parseFilterQuery('hex:zz').error).toBe('Not a hex value');
    expect(parseFilterQuery('handle:zz').error).toBe('Not a handle');
  });
});

describe('matchesFilter', () => {
  it('matches a hex substring of the payload', () => {
    expect(matchesFilter(packet(), parseFilterQuery('hex:4656'))).toBe(true);
    expect(matchesFilter(packet(), parseFilterQuery('hex:46 56 50'))).toBe(true);
    expect(matchesFilter(packet(), parseFilterQuery('hex:dead'))).toBe(false);
  });

  it('matches an ASCII substring of the payload, case-insensitively', () => {
    expect(matchesFilter(packet(), parseFilterQuery('ascii:FVP60'))).toBe(true);
    expect(matchesFilter(packet(), parseFilterQuery('ascii:fvp'))).toBe(true);
    expect(matchesFilter(packet(), parseFilterQuery('ascii:nope'))).toBe(false);
  });

  it('matches an attribute handle', () => {
    expect(matchesFilter(packet(), parseFilterQuery('handle:0x000e'))).toBe(true);
    expect(matchesFilter(packet(), parseFilterQuery('handle:000e'))).toBe(true);
    expect(matchesFilter(packet(), parseFilterQuery('handle:0x000c'))).toBe(false);
  });

  it('tries a bare term against hex, ASCII and the handle', () => {
    expect(matchesFilter(packet(), parseFilterQuery('b101'))).toBe(true);
    expect(matchesFilter(packet(), parseFilterQuery('FVP'))).toBe(true);
    expect(matchesFilter(packet(), parseFilterQuery('000e'))).toBe(true);
    expect(matchesFilter(packet(), parseFilterQuery('zzz'))).toBe(false);
  });

  it('does not let a bare ASCII term accidentally match hex digits', () => {
    const ascii = packet({ payload: bytes(0x61, 0x62, 0x63) }); // "abc"
    // "ab" is both hex and ASCII here, and both readings find it.
    expect(matchesFilter(ascii, parseFilterQuery('ab'))).toBe(true);
    // "6162" only exists as hex, never as text.
    expect(matchesFilter(ascii, parseFilterQuery('ascii:6162'))).toBe(false);
    expect(matchesFilter(ascii, parseFilterQuery('hex:6162'))).toBe(true);
  });

  it('matches nothing when the query is malformed', () => {
    expect(matchesFilter(packet(), parseFilterQuery('hex:zz'))).toBe(false);
  });

  it('matches everything when the query is empty', () => {
    expect(matchesFilter(packet(), parseFilterQuery(''))).toBe(true);
  });
});

describe('filterPackets', () => {
  const packets = [
    packet({ id: 0, payload: bytes(0xb1, 0x01, 0x00) }),
    packet({ id: 1, attHandle: 0x000c, payload: bytes(0xb2, 0x5a, 0x01, 0x00) }),
    packet({ id: 2, attHandle: 0x000c, payload: bytes(0x46, 0x56, 0x50, 0x36, 0x30) }),
  ];

  it('returns the same array when there is nothing to filter by', () => {
    expect(filterPackets(packets, parseFilterQuery(''))).toBe(packets);
  });

  it('keeps packets in order', () => {
    const matched = filterPackets(packets, parseFilterQuery('handle:0x000c'));
    expect(matched.map((item) => item.id)).toEqual([1, 2]);
  });

  it('filters by payload hex', () => {
    expect(filterPackets(packets, parseFilterQuery('hex:5a')).map((item) => item.id)).toEqual([1]);
  });
});

describe('hexMatchRanges', () => {
  it('reports the byte range a hex query covers', () => {
    const target = packet({ payload: bytes(0xb1, 0x01, 0x46, 0x56, 0x50) });
    expect(hexMatchRanges(target, parseFilterQuery('hex:4656'))).toEqual([[2, 4]]);
  });

  it('finds repeated matches', () => {
    const target = packet({ payload: bytes(0x5a, 0x00, 0x5a, 0x00) });
    expect(hexMatchRanges(target, parseFilterQuery('hex:5a'))).toEqual([
      [0, 1],
      [2, 3],
    ]);
  });

  it('reports nothing for ASCII or handle queries', () => {
    expect(hexMatchRanges(packet(), parseFilterQuery('ascii:FVP'))).toEqual([]);
    expect(hexMatchRanges(packet(), parseFilterQuery('handle:0x000e'))).toEqual([]);
    expect(hexMatchRanges(packet(), parseFilterQuery(''))).toEqual([]);
  });
});
