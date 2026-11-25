import { describe, expect, it } from 'vitest';

import { AttOpcode } from './att';
import { DatalinkType } from './btsnoop';
import { parseCapture } from './index';
import {
  aclPacket,
  aclRecord,
  advertisingReportEvent,
  attRecord,
  buildBtsnoopFile,
  buildSampleCapture,
  bytes,
  disconnectionCompleteEvent,
  eventRecord,
  fragmentedAttRecords,
  l2capPacket,
  leConnectionCompleteEvent,
} from './synthetic';

const BAND = 'C4:19:D1:3F:07:AE';
const BUDS = '58:FC:DB:92:14:60';

describe('parseCapture', () => {
  it('extracts writes and notifications with their device, handle and payload', () => {
    const file = buildBtsnoopFile([
      eventRecord(advertisingReportEvent(BAND, 'FVP60'), 1_000_000n),
      eventRecord(leConnectionCompleteEvent(0x0040, BAND), 1_100_000n),
      attRecord({
        connectionHandle: 0x0040,
        opcode: AttOpcode.WriteCommand,
        attHandle: 0x000e,
        value: bytes(0xb2, 0x00),
        direction: 'TX',
        epochUs: 1_200_000n,
      }),
      attRecord({
        connectionHandle: 0x0040,
        opcode: AttOpcode.HandleValueNotification,
        attHandle: 0x000c,
        value: bytes(0xb2, 0x5a, 0x01, 0x00),
        direction: 'RX',
        epochUs: 1_250_000n,
      }),
    ]);

    const capture = parseCapture(file);
    expect(capture.header.datalinkType).toBe(DatalinkType.HciUart);
    expect(capture.warnings).toEqual([]);
    expect(capture.packets).toHaveLength(2);

    const [write, notification] = capture.packets;
    expect(write).toMatchObject({
      id: 0,
      direction: 'TX',
      kind: 'write',
      opcodeName: 'Write Command',
      attHandle: 0x000e,
      connectionHandle: 0x0040,
      deviceAddress: BAND,
      timestampUs: 1_200_000n,
    });
    expect([...write!.payload]).toEqual([0xb2, 0x00]);
    expect(notification).toMatchObject({
      id: 1,
      direction: 'RX',
      kind: 'notification',
      attHandle: 0x000c,
      deviceAddress: BAND,
    });
    expect([...notification!.payload]).toEqual([0xb2, 0x5a, 0x01, 0x00]);
  });

  it('ignores ATT traffic that is not a write or a notification', () => {
    const file = buildBtsnoopFile([
      eventRecord(leConnectionCompleteEvent(0x0040, BAND), 0n),
      attRecord({
        connectionHandle: 0x0040,
        opcode: AttOpcode.ReadRequest,
        attHandle: 0x000e,
        value: new Uint8Array(0),
        direction: 'TX',
        epochUs: 10n,
      }),
      attRecord({
        connectionHandle: 0x0040,
        opcode: AttOpcode.WriteResponse,
        attHandle: 0x000e,
        value: new Uint8Array(0),
        direction: 'RX',
        epochUs: 20n,
      }),
      attRecord({
        connectionHandle: 0x0040,
        opcode: AttOpcode.WriteCommand,
        attHandle: 0x000e,
        value: bytes(0x01),
        direction: 'TX',
        epochUs: 30n,
      }),
    ]);

    const capture = parseCapture(file);
    expect(capture.packets).toHaveLength(1);
    expect(capture.stats.attPdus).toBe(3);
    expect(capture.stats.attWrites).toBe(1);
    expect(capture.stats.attNotifications).toBe(0);
  });

  it('skips L2CAP channels other than ATT', () => {
    const file = buildBtsnoopFile([
      eventRecord(leConnectionCompleteEvent(0x0040, BAND), 0n),
      aclRecord(
        aclPacket(0x0040, l2capPacket(0x0006, bytes(0x12, 0x01, 0x02, 0x00, 0x06, 0x00))),
        'TX',
        10n,
      ),
    ]);

    const capture = parseCapture(file);
    expect(capture.stats.l2capPackets).toBe(1);
    expect(capture.stats.attPdus).toBe(0);
    expect(capture.packets).toEqual([]);
  });

  it('reassembles a notification split across ACL fragments', () => {
    const value = Uint8Array.from({ length: 22 }, (_, i) => 0xd0 + i);
    const file = buildBtsnoopFile([
      eventRecord(leConnectionCompleteEvent(0x0040, BAND), 0n),
      ...fragmentedAttRecords({
        connectionHandle: 0x0040,
        opcode: AttOpcode.HandleValueNotification,
        attHandle: 0x000c,
        value,
        direction: 'RX',
        epochUs: 1_000n,
        splitAt: 16,
      }),
    ]);

    const capture = parseCapture(file);
    expect(capture.stats.aclFragments).toBe(2);
    expect(capture.packets).toHaveLength(1);
    expect([...capture.packets[0]!.payload]).toEqual([...value]);
    // The packet is timed by the fragment that completed it.
    expect(capture.packets[0]!.timestampUs).toBe(2_500n);
  });

  it('groups packets by remote device address', () => {
    const file = buildBtsnoopFile([
      eventRecord(leConnectionCompleteEvent(0x0040, BAND), 0n),
      eventRecord(advertisingReportEvent(BAND, 'FVP60'), 10n),
      eventRecord(leConnectionCompleteEvent(0x0041, BUDS, { enhanced: true }), 20n),
      attRecord({
        connectionHandle: 0x0040,
        opcode: AttOpcode.WriteCommand,
        attHandle: 0x000e,
        value: bytes(0x01),
        direction: 'TX',
        epochUs: 100n,
      }),
      attRecord({
        connectionHandle: 0x0041,
        opcode: AttOpcode.WriteCommand,
        attHandle: 0x0021,
        value: bytes(0x02),
        direction: 'TX',
        epochUs: 200n,
      }),
      attRecord({
        connectionHandle: 0x0040,
        opcode: AttOpcode.HandleValueNotification,
        attHandle: 0x000c,
        value: bytes(0x03),
        direction: 'RX',
        epochUs: 300n,
      }),
    ]);

    const capture = parseCapture(file);
    expect(capture.devices).toHaveLength(2);

    const band = capture.devices.find((device) => device.address === BAND)!;
    expect(band.key).toBe(BAND);
    expect(band.name).toBe('FVP60');
    expect(band.label).toBe(`FVP60 - ${BAND}`);
    expect(band.packetCount).toBe(2);
    expect(band.writeCount).toBe(1);
    expect(band.notificationCount).toBe(1);
    expect(band.firstSeenUs).toBe(100n);
    expect(band.lastSeenUs).toBe(300n);
    expect(band.connectionHandles).toEqual([0x0040]);
    expect(band.attHandles).toEqual([0x000c, 0x000e]);

    const buds = capture.devices.find((device) => device.address === BUDS)!;
    expect(buds.name).toBeNull();
    expect(buds.label).toBe(BUDS);
    expect(buds.packetCount).toBe(1);
  });

  it('attributes a reused connection handle to whichever device holds it', () => {
    const file = buildBtsnoopFile([
      eventRecord(leConnectionCompleteEvent(0x0040, BAND), 0n),
      attRecord({
        connectionHandle: 0x0040,
        opcode: AttOpcode.WriteCommand,
        attHandle: 0x000e,
        value: bytes(0x01),
        direction: 'TX',
        epochUs: 100n,
      }),
      eventRecord(disconnectionCompleteEvent(0x0040), 200n),
      eventRecord(leConnectionCompleteEvent(0x0040, BUDS), 300n),
      attRecord({
        connectionHandle: 0x0040,
        opcode: AttOpcode.WriteCommand,
        attHandle: 0x0021,
        value: bytes(0x02),
        direction: 'TX',
        epochUs: 400n,
      }),
    ]);

    const capture = parseCapture(file);
    expect(capture.packets.map((packet) => packet.deviceAddress)).toEqual([BAND, BUDS]);
    expect(capture.devices.map((device) => device.key).sort()).toEqual([BAND, BUDS].sort());
  });

  it('keeps packets whose connection was never seen, under a handle placeholder', () => {
    const file = buildBtsnoopFile([
      attRecord({
        connectionHandle: 0x0040,
        opcode: AttOpcode.HandleValueNotification,
        attHandle: 0x000c,
        value: bytes(0x5a),
        direction: 'RX',
        epochUs: 100n,
      }),
    ]);

    const capture = parseCapture(file);
    expect(capture.packets).toHaveLength(1);
    expect(capture.packets[0]!.deviceAddress).toBeNull();
    expect(capture.devices[0]!.key).toBe('handle:0x0040');
    expect(capture.devices[0]!.label).toBe('Unknown device (handle 0x0040)');
    expect(capture.warnings.some((warning) => warning.includes('connection-complete'))).toBe(true);
  });

  it('decodes an unencapsulated capture, which carries no H4 type byte', () => {
    const connect = leConnectionCompleteEvent(0x0040, BAND).subarray(1);
    const write = aclPacket(
      0x0040,
      l2capPacket(0x0004, bytes(AttOpcode.WriteCommand, 0x0e, 0x00, 0xb1)),
    ).subarray(1);

    const file = buildBtsnoopFile(
      [eventRecord(connect, 0n), aclRecord(write, 'TX', 100n)],
      { datalinkType: DatalinkType.HciUnencapsulated },
    );

    const capture = parseCapture(file);
    expect(capture.packets).toHaveLength(1);
    expect(capture.packets[0]!.deviceAddress).toBe(BAND);
    expect([...capture.packets[0]!.payload]).toEqual([0xb1]);
  });

  it('warns about an unknown datalink type but still decodes', () => {
    const file = buildBtsnoopFile(
      [
        eventRecord(leConnectionCompleteEvent(0x0040, BAND), 0n),
        attRecord({
          connectionHandle: 0x0040,
          opcode: AttOpcode.WriteCommand,
          attHandle: 0x000e,
          value: bytes(0x01),
          direction: 'TX',
          epochUs: 100n,
        }),
      ],
      { datalinkType: 2001 },
    );

    const capture = parseCapture(file);
    expect(capture.warnings[0]).toMatch(/Datalink type 2001/);
    expect(capture.packets).toHaveLength(1);
  });

  it('reports an empty capture', () => {
    const capture = parseCapture(buildBtsnoopFile([]));
    expect(capture.packets).toEqual([]);
    expect(capture.devices).toEqual([]);
    expect(capture.warnings[0]).toMatch(/no records/);
    expect(capture.stats.durationUs).toBe(0n);
  });
});

describe('buildSampleCapture', () => {
  it('parses into two devices with a readable conversation', () => {
    const capture = parseCapture(buildSampleCapture());

    expect(capture.devices.map((device) => device.label)).toEqual([
      `FVP60 - ${BAND}`,
      `Aurora Buds - ${BUDS}`,
    ]);

    const band = capture.devices[0]!;
    expect(band.writeCount).toBeGreaterThan(3);
    expect(band.notificationCount).toBeGreaterThan(5);

    const timestamps = capture.packets.map((packet) => packet.timestampUs);
    expect([...timestamps].sort((a, b) => Number(a - b))).toEqual(timestamps);

    const model = capture.packets.find((packet) =>
      [...packet.payload].slice(2, 7).every((byte, i) => byte === 'FVP60'.charCodeAt(i)),
    );
    expect(model).toBeDefined();
    expect(model!.kind).toBe('notification');

    const fragmented = capture.packets.find((packet) => packet.payload.byteLength === 22);
    expect(fragmented).toBeDefined();
    expect(fragmented!.payload[0]).toBe(0xd4);

    expect(capture.warnings).toEqual([]);
    expect(capture.stats.records).toBeGreaterThan(20);
  });
});
