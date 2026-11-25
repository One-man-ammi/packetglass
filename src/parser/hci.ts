/**
 * HCI layer: pull HCI packets out of btsnoop records, reassemble ACL fragments
 * into L2CAP packets, and keep track of which remote device each connection
 * handle belongs to.
 */

import { DatalinkType } from './btsnoop';
import type { Direction, SnoopRecord } from './types';

export const H4PacketType = {
  Command: 0x01,
  AclData: 0x02,
  SyncData: 0x03,
  Event: 0x04,
  IsoData: 0x05,
} as const;

export type H4PacketTypeValue = (typeof H4PacketType)[keyof typeof H4PacketType];

export interface HciPacket {
  record: SnoopRecord;
  type: number;
  /** Packet body with the H4 type byte removed. */
  payload: Uint8Array;
}

export interface AclFragment {
  connectionHandle: number;
  /** Packet boundary flag: 0b00/0b10 start a message, 0b01 continues one. */
  pbFlag: number;
  bcFlag: number;
  /** Fragment body, after the 4-byte ACL header. */
  data: Uint8Array;
}

export interface L2capPacket {
  connectionHandle: number;
  cid: number;
  payload: Uint8Array;
  direction: Direction;
}

export const HciEventCode = {
  ConnectionComplete: 0x03,
  DisconnectionComplete: 0x05,
  RemoteNameRequestComplete: 0x07,
  LeMeta: 0x3e,
} as const;

export const LeMetaSubevent = {
  ConnectionComplete: 0x01,
  AdvertisingReport: 0x02,
  EnhancedConnectionComplete: 0x0a,
} as const;

const PB_CONTINUATION = 0b01;

/**
 * Splits the H4 type byte off a record. For the unencapsulated datalink there
 * is no type byte, so the type is inferred from the snoop flags: command/event
 * records are commands when the host sent them and events when it received
 * them, and everything else is ACL data.
 */
export function demuxHciPacket(record: SnoopRecord, datalinkType: number): HciPacket | null {
  if (datalinkType === DatalinkType.HciUnencapsulated) {
    const type = record.isCommandOrEvent
      ? record.direction === 'TX'
        ? H4PacketType.Command
        : H4PacketType.Event
      : H4PacketType.AclData;
    return { record, type, payload: record.data };
  }

  if (record.data.byteLength < 1) return null;
  return { record, type: record.data[0]!, payload: record.data.subarray(1) };
}

export function parseAclFragment(payload: Uint8Array): AclFragment | null {
  if (payload.byteLength < 4) return null;

  const handleAndFlags = payload[0]! | (payload[1]! << 8);
  const dataLength = payload[2]! | (payload[3]! << 8);
  const body = payload.subarray(4, 4 + dataLength);

  return {
    connectionHandle: handleAndFlags & 0x0fff,
    pbFlag: (handleAndFlags >> 12) & 0x03,
    bcFlag: (handleAndFlags >> 14) & 0x03,
    data: body,
  };
}

interface PendingL2cap {
  cid: number;
  expected: number;
  chunks: Uint8Array[];
  received: number;
}

/**
 * Reassembles L2CAP packets from ACL fragments. Each (handle, direction) pair
 * is an independent stream, since the controller and the host fragment their
 * traffic separately.
 */
export class L2capReassembler {
  private pending = new Map<string, PendingL2cap>();

  /** Number of fragments that arrived as a continuation with nothing to continue. */
  orphanFragments = 0;

  push(fragment: AclFragment, direction: Direction): L2capPacket | null {
    const key = `${direction}:${fragment.connectionHandle}`;

    if (fragment.pbFlag === PB_CONTINUATION) {
      const pending = this.pending.get(key);
      if (!pending) {
        this.orphanFragments += 1;
        return null;
      }
      pending.chunks.push(fragment.data);
      pending.received += fragment.data.byteLength;
      return this.complete(key, pending, fragment.connectionHandle, direction);
    }

    if (fragment.data.byteLength < 4) return null;

    const length = fragment.data[0]! | (fragment.data[1]! << 8);
    const cid = fragment.data[2]! | (fragment.data[3]! << 8);
    const body = fragment.data.subarray(4);
    const pending: PendingL2cap = {
      cid,
      expected: length,
      chunks: [body],
      received: body.byteLength,
    };
    this.pending.set(key, pending);
    return this.complete(key, pending, fragment.connectionHandle, direction);
  }

  /** Forgets any half-assembled message for a handle, e.g. on disconnect. */
  dropHandle(connectionHandle: number): void {
    this.pending.delete(`TX:${connectionHandle}`);
    this.pending.delete(`RX:${connectionHandle}`);
  }

  private complete(
    key: string,
    pending: PendingL2cap,
    connectionHandle: number,
    direction: Direction,
  ): L2capPacket | null {
    if (pending.received < pending.expected) return null;
    this.pending.delete(key);

    const payload =
      pending.chunks.length === 1
        ? pending.chunks[0]!.subarray(0, pending.expected)
        : concat(pending.chunks, pending.expected);

    return { connectionHandle, cid: pending.cid, payload, direction };
  }
}

function concat(chunks: Uint8Array[], length: number): Uint8Array {
  const out = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    if (offset >= length) break;
    const slice = chunk.subarray(0, Math.min(chunk.byteLength, length - offset));
    out.set(slice, offset);
    offset += slice.byteLength;
  }
  return out;
}

/** Formats a 6-byte little-endian HCI address as AA:BB:CC:DD:EE:FF. */
export function formatAddress(bytes: Uint8Array, offset = 0): string {
  const parts: string[] = [];
  for (let i = 5; i >= 0; i -= 1) {
    parts.push((bytes[offset + i] ?? 0).toString(16).padStart(2, '0').toUpperCase());
  }
  return parts.join(':');
}

export interface ConnectionInfo {
  connectionHandle: number;
  address: string;
  /** 'le' for LE links, 'classic' for BR/EDR links. */
  transport: 'le' | 'classic';
}

/**
 * Tracks connection handle to remote address from HCI events, plus any device
 * names seen in advertising reports or remote-name responses.
 */
export class ConnectionTracker {
  private handleToAddress = new Map<number, ConnectionInfo>();
  private names = new Map<string, string>();

  /** Every address this capture ever connected to, in first-seen order. */
  readonly connectedAddresses: string[] = [];

  addressForHandle(connectionHandle: number): string | null {
    return this.handleToAddress.get(connectionHandle)?.address ?? null;
  }

  nameForAddress(address: string): string | null {
    return this.names.get(address) ?? null;
  }

  /** Processes an HCI event body (event code, parameter length, parameters). */
  handleEvent(payload: Uint8Array): { disconnectedHandle?: number } {
    if (payload.byteLength < 2) return {};
    const code = payload[0]!;
    const paramLength = payload[1]!;
    const params = payload.subarray(2, 2 + paramLength);

    switch (code) {
      case HciEventCode.ConnectionComplete:
        // status(1) handle(2) bd_addr(6) link_type(1) encryption(1)
        if (params.byteLength >= 11 && params[0] === 0x00) {
          this.remember(params[1]! | (params[2]! << 8), formatAddress(params, 3), 'classic');
        }
        return {};

      case HciEventCode.DisconnectionComplete:
        // status(1) handle(2) reason(1)
        if (params.byteLength >= 4 && params[0] === 0x00) {
          const handle = params[1]! | (params[2]! << 8);
          this.handleToAddress.delete(handle);
          return { disconnectedHandle: handle };
        }
        return {};

      case HciEventCode.RemoteNameRequestComplete:
        // status(1) bd_addr(6) name(up to 248, null padded)
        if (params.byteLength >= 8 && params[0] === 0x00) {
          const name = decodeNullPaddedString(params.subarray(7));
          if (name) this.names.set(formatAddress(params, 1), name);
        }
        return {};

      case HciEventCode.LeMeta:
        return this.handleLeMeta(params);

      default:
        return {};
    }
  }

  private handleLeMeta(params: Uint8Array): { disconnectedHandle?: number } {
    if (params.byteLength < 1) return {};
    const subevent = params[0]!;
    const body = params.subarray(1);

    switch (subevent) {
      case LeMetaSubevent.ConnectionComplete:
      case LeMetaSubevent.EnhancedConnectionComplete:
        // status(1) handle(2) role(1) peer_addr_type(1) peer_addr(6) ...
        if (body.byteLength >= 11 && body[0] === 0x00) {
          this.remember(body[1]! | (body[2]! << 8), formatAddress(body, 5), 'le');
        }
        return {};

      case LeMetaSubevent.AdvertisingReport:
        this.handleAdvertisingReport(body);
        return {};

      default:
        return {};
    }
  }

  /**
   * Advertising reports carry arrayed parameters, and controllers disagree on
   * how they interleave for multi-report events. Only single-report events are
   * decoded here: that covers nearly every real capture and avoids inventing
   * device names from a misread layout.
   */
  private handleAdvertisingReport(body: Uint8Array): void {
    if (body.byteLength < 10 || body[0] !== 0x01) return;
    const address = formatAddress(body, 3);
    const dataLength = body[9]!;
    const data = body.subarray(10, 10 + dataLength);
    const name = localNameFromAdvertisingData(data);
    if (name && !this.names.has(address)) this.names.set(address, name);
  }

  private remember(connectionHandle: number, address: string, transport: 'le' | 'classic'): void {
    this.handleToAddress.set(connectionHandle, { connectionHandle, address, transport });
    if (!this.connectedAddresses.includes(address)) this.connectedAddresses.push(address);
  }
}

/** Reads a complete (0x09) or shortened (0x08) local name out of AD data. */
export function localNameFromAdvertisingData(data: Uint8Array): string | null {
  let shortened: string | null = null;
  let offset = 0;

  while (offset < data.byteLength) {
    const length = data[offset]!;
    if (length === 0) break;
    const type = data[offset + 1];
    const value = data.subarray(offset + 2, offset + 1 + length);
    if (type === 0x09) return decodeNullPaddedString(value);
    if (type === 0x08 && shortened === null) shortened = decodeNullPaddedString(value);
    offset += 1 + length;
  }

  return shortened;
}

function decodeNullPaddedString(bytes: Uint8Array): string {
  const end = bytes.indexOf(0);
  const slice = end === -1 ? bytes : bytes.subarray(0, end);
  if (slice.byteLength === 0) return '';
  return new TextDecoder('utf-8', { fatal: false }).decode(slice).trim();
}
