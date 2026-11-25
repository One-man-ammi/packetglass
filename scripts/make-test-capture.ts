/**
 * Writes a synthetic btsnoop_hci.log for manual testing. Run with:
 *   npx vite-node scripts/make-test-capture.ts -- tmp/btsnoop_hci.log
 *
 * The file is only used to exercise the importer against a file on disk; the
 * app itself never needs it.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { AttOpcode } from '../src/parser/att';
import {
  advertisingReportEvent,
  aclPacket,
  aclRecord,
  attRecord,
  buildBtsnoopFile,
  bytes,
  disconnectionCompleteEvent,
  eventRecord,
  fragmentedAttRecords,
  l2capPacket,
  leConnectionCompleteEvent,
} from '../src/parser/synthetic';
import type { SyntheticRecord } from '../src/parser/synthetic';

const BAND = 'C4:19:D1:3F:07:AE';
const BUDS = '58:FC:DB:92:14:60';
const BAND_HANDLE = 0x0040;
const BUDS_HANDLE = 0x0041;
const COMMAND_HANDLE = 0x000e;
const NOTIFY_HANDLE = 0x000c;

function build(): Uint8Array {
  const start = BigInt(Date.UTC(2026, 10, 25, 20, 41, 18)) * 1000n;
  const at = (seconds: number): bigint => start + BigInt(Math.round(seconds * 1_000_000));
  const records: SyntheticRecord[] = [
    eventRecord(advertisingReportEvent(BAND, 'FVP60'), at(0)),
    eventRecord(leConnectionCompleteEvent(BAND_HANDLE, BAND), at(0.12)),
    eventRecord(advertisingReportEvent(BUDS, 'Aurora Buds'), at(0.2)),
    eventRecord(leConnectionCompleteEvent(BUDS_HANDLE, BUDS, { enhanced: true }), at(0.26)),

    // ATT plumbing the viewer deliberately hides.
    attRecord({
      connectionHandle: BAND_HANDLE,
      opcode: AttOpcode.ExchangeMtuRequest,
      attHandle: 0x0017,
      value: new Uint8Array(0),
      direction: 'TX',
      epochUs: at(0.3),
    }),
    aclRecord(
      aclPacket(BAND_HANDLE, l2capPacket(0x0006, bytes(0x12, 0x01, 0x02, 0x00, 0x06, 0x00))),
      'TX',
      at(0.32),
    ),

    // Model and serial, which leak readable strings.
    attRecord({
      connectionHandle: BAND_HANDLE,
      opcode: AttOpcode.WriteCommand,
      attHandle: COMMAND_HANDLE,
      value: bytes(0xb1, 0x01, 0x00),
      direction: 'TX',
      epochUs: at(0.41),
    }),
    attRecord({
      connectionHandle: BAND_HANDLE,
      opcode: AttOpcode.HandleValueNotification,
      attHandle: NOTIFY_HANDLE,
      value: bytes(0xb1, 0x01, 0x46, 0x56, 0x50, 0x36, 0x30, 0x00, 0x5a),
      direction: 'RX',
      epochUs: at(0.47),
    }),
    attRecord({
      connectionHandle: BAND_HANDLE,
      opcode: AttOpcode.HandleValueNotification,
      attHandle: NOTIFY_HANDLE,
      value: bytes(
        0xb1, 0x02, 0x53, 0x4e, 0x3a, 0x30, 0x37, 0x41, 0x45, 0x31, 0x39, 0x44, 0x31, 0x00,
      ),
      direction: 'RX',
      epochUs: at(0.53),
    }),

    // Battery, then a clock sync carrying a big-endian year.
    attRecord({
      connectionHandle: BAND_HANDLE,
      opcode: AttOpcode.WriteCommand,
      attHandle: COMMAND_HANDLE,
      value: bytes(0xb2, 0x00),
      direction: 'TX',
      epochUs: at(1.25),
    }),
    attRecord({
      connectionHandle: BAND_HANDLE,
      opcode: AttOpcode.HandleValueNotification,
      attHandle: NOTIFY_HANDLE,
      value: bytes(0xb2, 0x5a, 0x01, 0x00),
      direction: 'RX',
      epochUs: at(1.3),
    }),
    attRecord({
      connectionHandle: BAND_HANDLE,
      opcode: AttOpcode.WriteRequest,
      attHandle: COMMAND_HANDLE,
      value: bytes(0xb3, 0x07, 0xea, 0x0b, 0x19, 0x14, 0x29, 0x12),
      direction: 'TX',
      epochUs: at(2.11),
    }),
    attRecord({
      connectionHandle: BAND_HANDLE,
      opcode: AttOpcode.HandleValueNotification,
      attHandle: NOTIFY_HANDLE,
      value: bytes(0xb3, 0x00),
      direction: 'RX',
      epochUs: at(2.17),
    }),

    // "Start heart rate" in the stock app.
    attRecord({
      connectionHandle: BAND_HANDLE,
      opcode: AttOpcode.WriteRequest,
      attHandle: COMMAND_HANDLE,
      value: bytes(0xc1, 0x01),
      direction: 'TX',
      epochUs: at(3.4),
    }),
  ];

  // A long heart-rate stream, so the table has to virtualise.
  let second = 4.4;
  for (let sample = 0; sample < 2400; sample += 1) {
    const bpm = 70 + Math.round(12 * Math.sin(sample / 9) + (sample % 5));
    records.push(
      attRecord({
        connectionHandle: BAND_HANDLE,
        opcode: AttOpcode.HandleValueNotification,
        attHandle: NOTIFY_HANDLE,
        value: bytes(0xc1, 0x00, bpm, (sample >> 8) & 0xff, sample & 0xff),
        direction: 'RX',
        epochUs: at(second),
      }),
    );
    second += 1;

    if (sample % 60 === 59) {
      records.push(
        attRecord({
          connectionHandle: BAND_HANDLE,
          opcode: AttOpcode.WriteCommand,
          attHandle: COMMAND_HANDLE,
          value: bytes(0xb2, 0x00),
          direction: 'TX',
          epochUs: at(second - 0.4),
        }),
        attRecord({
          connectionHandle: BAND_HANDLE,
          opcode: AttOpcode.HandleValueNotification,
          attHandle: NOTIFY_HANDLE,
          value: bytes(0xb2, 0x5a - Math.floor(sample / 240), 0x01, 0x00),
          direction: 'RX',
          epochUs: at(second - 0.3),
        }),
      );
    }

    if (sample % 300 === 299) {
      records.push(
        ...fragmentedAttRecords({
          connectionHandle: BAND_HANDLE,
          opcode: AttOpcode.HandleValueNotification,
          attHandle: NOTIFY_HANDLE,
          value: bytes(
            0xd4, 0x00, 0x07, 0xea, 0x0b, 0x19, 0x00, 0x00, 0x13, 0x88, 0x00, 0x00, 0x27, 0x10,
            0x00, 0x1e, 0x00, 0x2d, 0x52, 0x55, 0x4e, 0x00,
          ),
          direction: 'RX',
          epochUs: at(second - 0.1),
          splitAt: 16,
        }),
      );
    }

    if (sample % 150 === 100) {
      records.push(
        attRecord({
          connectionHandle: BUDS_HANDLE,
          opcode: AttOpcode.WriteCommand,
          attHandle: 0x0021,
          value: bytes(0x01, 0x03, 0x00, 0x64),
          direction: 'TX',
          epochUs: at(second - 0.5),
        }),
        attRecord({
          connectionHandle: BUDS_HANDLE,
          opcode: AttOpcode.HandleValueNotification,
          attHandle: 0x0023,
          value: bytes(0x01, 0x03, 0x64, 0x58, 0x5f, 0x52),
          direction: 'RX',
          epochUs: at(second - 0.4),
        }),
      );
    }
  }

  records.push(
    attRecord({
      connectionHandle: BAND_HANDLE,
      opcode: AttOpcode.WriteRequest,
      attHandle: COMMAND_HANDLE,
      value: bytes(0xc1, 0x00),
      direction: 'TX',
      epochUs: at(second + 1),
    }),
    eventRecord(disconnectionCompleteEvent(BAND_HANDLE), at(second + 2)),
  );

  return buildBtsnoopFile(records);
}

const target = resolve(process.argv[2] ?? 'tmp/btsnoop_hci.log');
const file = build();
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, file);
console.log(`Wrote ${target} (${(file.byteLength / 1024).toFixed(1)} KB)`);
