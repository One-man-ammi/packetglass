/**
 * Shared types for the capture decode chain:
 * btsnoop record -> HCI packet -> ACL fragment -> L2CAP packet -> ATT PDU.
 */

/** Direction from the phone's point of view: the phone is the HCI host. */
export type Direction = 'TX' | 'RX';

export interface BtsnoopHeader {
  /** Big-endian version word; only version 1 exists in the wild. */
  version: number;
  /** 1001 = unencapsulated HCI, 1002 = HCI UART (H4), 1003 = BSCP, 1004 = H5. */
  datalinkType: number;
}

export interface SnoopRecord {
  /** 0-based position of this record in the file. */
  index: number;
  originalLength: number;
  includedLength: number;
  flags: number;
  cumulativeDrops: number;
  /** Raw btsnoop timestamp: microseconds since 0000-01-01 00:00 (nominal Gregorian). */
  timestampUs: bigint;
  /** Same instant expressed as microseconds since the Unix epoch. */
  epochUs: bigint;
  direction: Direction;
  /** Flags bit 1: set for HCI command/event records, clear for data records. */
  isCommandOrEvent: boolean;
  /** Record payload as captured; a view into the source buffer, never a copy. */
  data: Uint8Array;
  /** True when the capture kept fewer bytes than the packet originally had. */
  truncated: boolean;
}

export type AttPacketKind = 'write' | 'notification';

export interface AttPacket {
  /** 0-based position in the capture's ATT packet list. */
  id: number;
  recordIndex: number;
  /** Microseconds since the Unix epoch. */
  timestampUs: bigint;
  direction: Direction;
  connectionHandle: number;
  /** Stable key for grouping; an address when known, else a per-handle placeholder. */
  deviceKey: string;
  /** Remote device address, or null when the capture never showed the connection. */
  deviceAddress: string | null;
  opcode: number;
  opcodeName: string;
  kind: AttPacketKind;
  /** ATT characteristic (attribute) handle the write or notification targets. */
  attHandle: number;
  payload: Uint8Array;
}

export interface DeviceSummary {
  key: string;
  address: string | null;
  name: string | null;
  /** Address plus name when known, otherwise a readable placeholder. */
  label: string;
  packetCount: number;
  writeCount: number;
  notificationCount: number;
  firstSeenUs: bigint;
  lastSeenUs: bigint;
  connectionHandles: number[];
  /** Distinct ATT handles seen for this device. */
  attHandles: number[];
}

export interface CaptureStats {
  records: number;
  hciEvents: number;
  aclFragments: number;
  l2capPackets: number;
  attPdus: number;
  attWrites: number;
  attNotifications: number;
  /** Wall-clock span of the capture in microseconds. */
  durationUs: bigint;
}

export interface ParsedCapture {
  header: BtsnoopHeader;
  packets: AttPacket[];
  devices: DeviceSummary[];
  warnings: string[];
  stats: CaptureStats;
}
