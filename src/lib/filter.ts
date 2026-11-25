/**
 * The table's live filter. One box takes three kinds of query: a hex substring
 * of the payload, an ASCII substring of the payload, or an attribute handle.
 * A bare term is tried against all three; an explicit `hex:`, `ascii:` or
 * `handle:` prefix narrows it to one.
 */

import type { AttPacket } from '../parser/types';
import { toAscii, toHexCompact } from './format';

export type FilterField = 'any' | 'hex' | 'ascii' | 'handle';

export interface ParsedFilter {
  raw: string;
  field: FilterField;
  /** The query with its prefix removed. */
  term: string;
  /** Hex digits only, lowercased; empty when the term is not hex-shaped. */
  hexTerm: string;
  /** Lowercased term for ASCII matching. */
  asciiTerm: string;
  /** Parsed attribute handle, when the term reads as a number. */
  handle: number | null;
  isEmpty: boolean;
  /** Set when the query cannot match anything, e.g. `handle:zz`. */
  error: string | null;
}

const PREFIXES: Record<string, FilterField> = {
  hex: 'hex',
  ascii: 'ascii',
  text: 'ascii',
  handle: 'handle',
  h: 'handle',
};

export function parseFilterQuery(raw: string): ParsedFilter {
  const trimmed = raw.trim();
  const empty: ParsedFilter = {
    raw,
    field: 'any',
    term: '',
    hexTerm: '',
    asciiTerm: '',
    handle: null,
    isEmpty: true,
    error: null,
  };
  if (trimmed === '') return empty;

  let field: FilterField = 'any';
  let term = trimmed;

  const separator = trimmed.indexOf(':');
  if (separator > 0) {
    const candidate = trimmed.slice(0, separator).toLowerCase();
    if (candidate in PREFIXES) {
      field = PREFIXES[candidate]!;
      term = trimmed.slice(separator + 1).trim();
    }
  }

  if (term === '') return { ...empty, raw, field };

  const hexTerm = normaliseHex(term);
  const handle = parseHandle(term);

  if (field === 'hex' && hexTerm === '') {
    return { ...empty, raw, field, term, isEmpty: false, error: 'Not a hex value' };
  }
  if (field === 'handle' && handle === null) {
    return { ...empty, raw, field, term, isEmpty: false, error: 'Not a handle' };
  }

  return {
    raw,
    field,
    term,
    hexTerm,
    asciiTerm: term.toLowerCase(),
    handle,
    isEmpty: false,
    error: null,
  };
}

/** Keeps hex digits only; returns '' when the term holds anything else. */
function normaliseHex(term: string): string {
  const stripped = term.replace(/^0x/i, '').replace(/[\s:_-]/g, '');
  if (stripped === '' || !/^[0-9a-f]+$/i.test(stripped)) return '';
  return stripped.toLowerCase();
}

function parseHandle(term: string): number | null {
  const cleaned = term.trim();
  if (/^0x[0-9a-f]+$/i.test(cleaned)) return parseInt(cleaned.slice(2), 16);
  if (/^[0-9]+$/.test(cleaned)) return parseInt(cleaned, 10);
  // Anything containing a-f can only be hex, so read it that way.
  if (/^[0-9a-f]+$/i.test(cleaned)) return parseInt(cleaned, 16);
  return null;
}

export interface PacketSearchText {
  hex: string;
  ascii: string;
  handleHex: string;
}

export function packetSearchText(packet: AttPacket): PacketSearchText {
  return {
    hex: toHexCompact(packet.payload),
    ascii: toAscii(packet.payload).toLowerCase(),
    handleHex: packet.attHandle.toString(16).padStart(4, '0'),
  };
}

export function matchesFilter(packet: AttPacket, filter: ParsedFilter): boolean {
  if (filter.isEmpty) return true;
  if (filter.error) return false;

  const text = packetSearchText(packet);

  switch (filter.field) {
    case 'hex':
      return text.hex.includes(filter.hexTerm);
    case 'ascii':
      return text.ascii.includes(filter.asciiTerm);
    case 'handle':
      return packet.attHandle === filter.handle;
    case 'any':
      return (
        (filter.hexTerm !== '' && text.hex.includes(filter.hexTerm)) ||
        text.ascii.includes(filter.asciiTerm) ||
        (filter.hexTerm !== '' && text.handleHex.includes(filter.hexTerm)) ||
        (filter.handle !== null && packet.attHandle === filter.handle)
      );
    default:
      return true;
  }
}

export function filterPackets(packets: AttPacket[], filter: ParsedFilter): AttPacket[] {
  if (filter.isEmpty) return packets;
  return packets.filter((packet) => matchesFilter(packet, filter));
}

/** Byte ranges of the payload that a hex query matched, for highlighting. */
export function hexMatchRanges(packet: AttPacket, filter: ParsedFilter): Array<[number, number]> {
  if (filter.isEmpty || filter.error || filter.hexTerm === '') return [];
  if (filter.field === 'ascii' || filter.field === 'handle') return [];

  const hex = toHexCompact(packet.payload);
  const ranges: Array<[number, number]> = [];
  let from = hex.indexOf(filter.hexTerm);

  while (from !== -1) {
    const start = Math.floor(from / 2);
    const end = Math.ceil((from + filter.hexTerm.length) / 2);
    ranges.push([start, end]);
    from = hex.indexOf(filter.hexTerm, from + 1);
  }

  return ranges;
}
