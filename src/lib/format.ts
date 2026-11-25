/**
 * Byte and time formatting shared by the table and the payload panels.
 */

const PRINTABLE_MIN = 0x20;
const PRINTABLE_MAX = 0x7e;

export function toHex(bytes: Uint8Array, separator = ' '): string {
  const parts: string[] = [];
  for (const byte of bytes) parts.push(byte.toString(16).padStart(2, '0'));
  return parts.join(separator).toUpperCase();
}

/** Lowercase, unseparated hex: the form the filter compares against. */
export function toHexCompact(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

/** Printable ASCII as-is, everything else as a dot. */
export function toAscii(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) {
    out += byte >= PRINTABLE_MIN && byte <= PRINTABLE_MAX ? String.fromCharCode(byte) : '.';
  }
  return out;
}

export function isPrintable(byte: number): boolean {
  return byte >= PRINTABLE_MIN && byte <= PRINTABLE_MAX;
}

export interface ByteRow {
  offset: number;
  bytes: number[];
}

/** Splits a payload into fixed-width rows so hex and ASCII can share a grid. */
export function byteRows(bytes: Uint8Array, width = 16): ByteRow[] {
  const rows: ByteRow[] = [];
  for (let offset = 0; offset < bytes.byteLength; offset += width) {
    rows.push({ offset, bytes: [...bytes.subarray(offset, offset + width)] });
  }
  return rows;
}

export interface NumberDecode {
  offset: number;
  uint8: number;
  int8: number;
  uint16le: number | null;
  uint16be: number | null;
  uint32le: number | null;
  uint32be: number | null;
}

/**
 * Every plausible fixed-width decode at every offset. Widths that would run
 * past the end of the payload come back as null rather than being omitted, so
 * the table keeps its shape.
 */
export function decodeNumbers(bytes: Uint8Array): NumberDecode[] {
  if (bytes.byteLength === 0) return [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: NumberDecode[] = [];

  for (let offset = 0; offset < bytes.byteLength; offset += 1) {
    const has16 = offset + 2 <= bytes.byteLength;
    const has32 = offset + 4 <= bytes.byteLength;
    out.push({
      offset,
      uint8: view.getUint8(offset),
      int8: view.getInt8(offset),
      uint16le: has16 ? view.getUint16(offset, true) : null,
      uint16be: has16 ? view.getUint16(offset, false) : null,
      uint32le: has32 ? view.getUint32(offset, true) : null,
      uint32be: has32 ? view.getUint32(offset, false) : null,
    });
  }

  return out;
}

/** Renders a decoded value as hex of a fixed byte width, e.g. 0x07ea. */
export function hexValue(value: number | null, byteWidth: number): string {
  if (value === null) return '';
  return `0x${value.toString(16).padStart(byteWidth * 2, '0')}`;
}

export function formatHandle(handle: number): string {
  return `0x${handle.toString(16).padStart(4, '0')}`;
}

export function formatOpcode(opcode: number): string {
  return `0x${opcode.toString(16).padStart(2, '0')}`;
}

function pad(value: number, width: number): string {
  return value.toString().padStart(width, '0');
}

/** Local wall clock with microsecond precision: 20:41:18.466000 */
export function formatClock(epochUs: bigint): string {
  const date = new Date(Number(epochUs / 1000n));
  const micros = Number(((epochUs % 1000000n) + 1000000n) % 1000000n);
  return `${pad(date.getHours(), 2)}:${pad(date.getMinutes(), 2)}:${pad(date.getSeconds(), 2)}.${pad(
    micros,
    6,
  )}`;
}

/** Full local date and time, for the expanded row. */
export function formatAbsolute(epochUs: bigint): string {
  const date = new Date(Number(epochUs / 1000n));
  const micros = Number(((epochUs % 1000000n) + 1000000n) % 1000000n);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1, 2)}-${pad(date.getDate(), 2)} ${pad(
    date.getHours(),
    2,
  )}:${pad(date.getMinutes(), 2)}:${pad(date.getSeconds(), 2)}.${pad(micros, 6)}`;
}

/** Signed offset from a reference instant: +1.250 s */
export function formatRelative(epochUs: bigint, baseUs: bigint): string {
  const delta = epochUs - baseUs;
  const sign = delta < 0n ? '-' : '+';
  const abs = delta < 0n ? -delta : delta;
  const seconds = Number(abs / 1000000n);
  const micros = Number(abs % 1000000n);
  return `${sign}${seconds}.${pad(Math.floor(micros / 1000), 3)} s`;
}

export function formatDuration(us: bigint): string {
  const totalSeconds = Number(us / 1000000n);
  const millis = Number((us % 1000000n) / 1000n);
  if (totalSeconds < 60) return `${totalSeconds}.${pad(millis, 3)} s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${pad(seconds, 2)}s`;
  return `${Math.floor(minutes / 60)}h ${pad(minutes % 60, 2)}m ${pad(seconds, 2)}s`;
}

export function formatFileSize(byteLength: number): string {
  if (byteLength < 1024) return `${byteLength} B`;
  if (byteLength < 1024 * 1024) return `${(byteLength / 1024).toFixed(1)} KB`;
  return `${(byteLength / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatCount(value: number, singular: string, plural = `${singular}s`): string {
  return `${value.toLocaleString()} ${value === 1 ? singular : plural}`;
}
