/**
 * Capture parsing entry point: btsnoop bytes in, ATT packets and the devices
 * they belong to out.
 */

import { DatalinkType, readBtsnoopHeader, readBtsnoopRecords } from './btsnoop';
import { ATT_CID, decodeAttPdu } from './att';
import {
  ConnectionTracker,
  demuxHciPacket,
  H4PacketType,
  L2capReassembler,
  parseAclFragment,
} from './hci';
import type { AttPacket, DeviceSummary, ParsedCapture } from './types';

export * from './types';
export { BtsnoopFormatError, DatalinkType, datalinkTypeName, BTSNOOP_EPOCH_DELTA_US } from './btsnoop';
export { AttOpcode, attOpcodeName, attPacketKind, decodeAttPdu, ATT_CID } from './att';
export {
  ConnectionTracker,
  L2capReassembler,
  demuxHciPacket,
  formatAddress,
  localNameFromAdvertisingData,
  parseAclFragment,
} from './hci';

const SUPPORTED_DATALINKS: number[] = [
  DatalinkType.HciUnencapsulated,
  DatalinkType.HciUart,
  DatalinkType.HciBscp,
  DatalinkType.HciSerial,
];

export function unknownDeviceKey(connectionHandle: number): string {
  return `handle:0x${connectionHandle.toString(16).padStart(4, '0')}`;
}

export function deviceLabel(address: string | null, name: string | null, key: string): string {
  if (!address) {
    return `Unknown device (${key.replace('handle:', 'handle ')})`;
  }
  return name ? `${name} - ${address}` : address;
}

export function parseCapture(input: ArrayBuffer | Uint8Array): ParsedCapture {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const header = readBtsnoopHeader(bytes);
  const warnings: string[] = [];

  if (!SUPPORTED_DATALINKS.includes(header.datalinkType)) {
    warnings.push(
      `Datalink type ${header.datalinkType} is not a known HCI encapsulation; decoding it as HCI UART anyway.`,
    );
  }

  const tracker = new ConnectionTracker();
  const reassembler = new L2capReassembler();
  const packets: AttPacket[] = [];

  let records = 0;
  let hciEvents = 0;
  let aclFragments = 0;
  let l2capPackets = 0;
  let attPdus = 0;
  let attWrites = 0;
  let attNotifications = 0;
  let truncatedRecords = 0;
  let firstUs: bigint | null = null;
  let lastUs: bigint | null = null;

  for (const record of readBtsnoopRecords(bytes, (message) => warnings.push(message))) {
    records += 1;
    if (record.truncated) truncatedRecords += 1;
    if (firstUs === null) firstUs = record.epochUs;
    lastUs = record.epochUs;

    const hci = demuxHciPacket(record, header.datalinkType);
    if (!hci) continue;

    if (hci.type === H4PacketType.Event) {
      hciEvents += 1;
      const { disconnectedHandle } = tracker.handleEvent(hci.payload);
      if (disconnectedHandle !== undefined) reassembler.dropHandle(disconnectedHandle);
      continue;
    }

    if (hci.type !== H4PacketType.AclData) continue;

    const fragment = parseAclFragment(hci.payload);
    if (!fragment) continue;
    aclFragments += 1;

    const l2cap = reassembler.push(fragment, record.direction);
    if (!l2cap) continue;
    l2capPackets += 1;
    if (l2cap.cid !== ATT_CID) continue;

    const pdu = decodeAttPdu(l2cap.payload);
    if (!pdu) continue;
    attPdus += 1;
    if (pdu.kind === null || pdu.attHandle === null) continue;

    if (pdu.kind === 'write') attWrites += 1;
    else attNotifications += 1;

    const address = tracker.addressForHandle(l2cap.connectionHandle);
    packets.push({
      id: packets.length,
      recordIndex: record.index,
      timestampUs: record.epochUs,
      direction: record.direction,
      connectionHandle: l2cap.connectionHandle,
      deviceKey: address ?? unknownDeviceKey(l2cap.connectionHandle),
      deviceAddress: address,
      opcode: pdu.opcode,
      opcodeName: pdu.opcodeName,
      kind: pdu.kind,
      attHandle: pdu.attHandle,
      // Copied so the payload survives being moved out of the capture buffer.
      payload: new Uint8Array(pdu.value),
    });
  }

  if (truncatedRecords > 0) {
    warnings.push(
      `${truncatedRecords} record${truncatedRecords === 1 ? ' was' : 's were'} snapshot-truncated by the capture; payloads may be short.`,
    );
  }
  if (reassembler.orphanFragments > 0) {
    warnings.push(
      `${reassembler.orphanFragments} ACL continuation fragment${
        reassembler.orphanFragments === 1 ? '' : 's'
      } had no start fragment; the capture probably began mid-message.`,
    );
  }
  if (records === 0) {
    warnings.push('The capture header is valid but it contains no records.');
  }

  const devices = summariseDevices(packets, tracker);
  if (devices.some((device) => device.address === null)) {
    warnings.push(
      'Some packets use a connection handle that never appeared in a connection-complete event, so their device address is unknown.',
    );
  }

  return {
    header,
    packets,
    devices,
    warnings,
    stats: {
      records,
      hciEvents,
      aclFragments,
      l2capPackets,
      attPdus,
      attWrites,
      attNotifications,
      durationUs: firstUs !== null && lastUs !== null ? lastUs - firstUs : 0n,
    },
  };
}

function summariseDevices(packets: AttPacket[], tracker: ConnectionTracker): DeviceSummary[] {
  const byKey = new Map<string, DeviceSummary>();
  const handleSets = new Map<string, Set<number>>();
  const attHandleSets = new Map<string, Set<number>>();

  for (const packet of packets) {
    let summary = byKey.get(packet.deviceKey);
    if (!summary) {
      const name = packet.deviceAddress ? tracker.nameForAddress(packet.deviceAddress) : null;
      summary = {
        key: packet.deviceKey,
        address: packet.deviceAddress,
        name,
        label: deviceLabel(packet.deviceAddress, name, packet.deviceKey),
        packetCount: 0,
        writeCount: 0,
        notificationCount: 0,
        firstSeenUs: packet.timestampUs,
        lastSeenUs: packet.timestampUs,
        connectionHandles: [],
        attHandles: [],
      };
      byKey.set(packet.deviceKey, summary);
      handleSets.set(packet.deviceKey, new Set());
      attHandleSets.set(packet.deviceKey, new Set());
    }

    summary.packetCount += 1;
    if (packet.kind === 'write') summary.writeCount += 1;
    else summary.notificationCount += 1;
    if (packet.timestampUs < summary.firstSeenUs) summary.firstSeenUs = packet.timestampUs;
    if (packet.timestampUs > summary.lastSeenUs) summary.lastSeenUs = packet.timestampUs;
    handleSets.get(packet.deviceKey)!.add(packet.connectionHandle);
    attHandleSets.get(packet.deviceKey)!.add(packet.attHandle);
  }

  for (const [key, summary] of byKey) {
    summary.connectionHandles = [...handleSets.get(key)!].sort((a, b) => a - b);
    summary.attHandles = [...attHandleSets.get(key)!].sort((a, b) => a - b);
  }

  return [...byKey.values()].sort((a, b) => b.packetCount - a.packetCount);
}
