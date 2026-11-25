import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { useVirtualRows } from '../hooks/useVirtualRows';
import type { ParsedFilter } from '../lib/filter';
import { hexMatchRanges } from '../lib/filter';
import {
  formatAbsolute,
  formatClock,
  formatHandle,
  formatOpcode,
  formatRelative,
  toAscii,
  toHex,
} from '../lib/format';
import type { AttPacket } from '../parser/types';
import { PayloadPanels } from './PayloadPanels';

const ROW_HEIGHT = 40;
const PREVIEW_BYTES = 14;

interface PacketTableProps {
  packets: AttPacket[];
  filter: ParsedFilter;
  /** First packet of the selected device, used for relative timing. */
  baseUs: bigint | null;
}

export function PacketTable({ packets, filter, baseUs }: PacketTableProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [expandedHeight, setExpandedHeight] = useState(0);

  const expandedIndex = expandedId === null ? null : packets.findIndex((p) => p.id === expandedId);
  const activeIndex = expandedIndex === null || expandedIndex < 0 ? null : expandedIndex;

  // A packet that the filter just excluded should not hold the detail panel open.
  useEffect(() => {
    if (expandedId !== null && !packets.some((packet) => packet.id === expandedId)) {
      setExpandedId(null);
    }
  }, [packets, expandedId]);

  useLayoutEffect(() => {
    if (activeIndex === null) {
      setExpandedHeight(0);
      return;
    }
    const element = detailRef.current;
    if (!element) return;

    const measure = () => setExpandedHeight(element.offsetHeight);
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [activeIndex, expandedId]);

  const { start, end, totalHeight, offsetForIndex } = useVirtualRows(scrollRef, {
    count: packets.length,
    rowHeight: ROW_HEIGHT,
    expandedIndex: activeIndex,
    expandedHeight,
  });

  const toggle = useCallback((id: number) => {
    setExpandedId((current) => (current === id ? null : id));
  }, []);

  if (packets.length === 0) {
    return (
      <div className="table-empty">
        <p>No packets match this filter.</p>
        <p className="muted">
          Try a hex fragment such as <code>b1</code>, text such as <code>ascii:FVP</code>, or a
          handle such as <code>handle:0x000e</code>.
        </p>
      </div>
    );
  }

  const visible = packets.slice(start, end);

  return (
    <div className="packet-table">
      <div className="packet-head" role="row">
        <span className="col-caret" />
        <span className="col-time">Time</span>
        <span className="col-dir">Dir</span>
        <span className="col-opcode">ATT opcode</span>
        <span className="col-handle">Handle</span>
        <span className="col-len">Len</span>
        <span className="col-preview">Payload</span>
      </div>

      <div className="packet-scroll" ref={scrollRef}>
        <div className="packet-canvas" style={{ height: totalHeight }}>
          {visible.map((packet, offsetIndex) => {
            const index = start + offsetIndex;
            const expanded = packet.id === expandedId;
            return (
              <div
                key={packet.id}
                className={expanded ? 'packet-slot expanded' : 'packet-slot'}
                style={{ transform: `translateY(${offsetForIndex(index)}px)` }}
              >
                <button
                  type="button"
                  className={`packet-row ${packet.direction === 'TX' ? 'tx' : 'rx'}`}
                  aria-expanded={expanded}
                  onClick={() => toggle(packet.id)}
                >
                  <span className="col-caret" aria-hidden="true">
                    {expanded ? '-' : '+'}
                  </span>
                  <span className="col-time">{formatClock(packet.timestampUs)}</span>
                  <span className="col-dir">
                    <span className={`pill ${packet.direction === 'TX' ? 'pill-tx' : 'pill-rx'}`}>
                      {packet.direction}
                    </span>
                  </span>
                  <span className="col-opcode">
                    {packet.opcodeName}
                    <span className="muted"> {formatOpcode(packet.opcode)}</span>
                  </span>
                  <span className="col-handle mono">{formatHandle(packet.attHandle)}</span>
                  <span className="col-len mono">{packet.payload.byteLength}</span>
                  <span className="col-preview mono">
                    {toHex(packet.payload.subarray(0, PREVIEW_BYTES))}
                    {packet.payload.byteLength > PREVIEW_BYTES ? ' ...' : ''}
                  </span>
                </button>

                {expanded ? (
                  <div className="packet-detail" ref={detailRef}>
                    <dl className="detail-meta">
                      <div>
                        <dt>Captured</dt>
                        <dd className="mono">{formatAbsolute(packet.timestampUs)}</dd>
                      </div>
                      {baseUs !== null ? (
                        <div>
                          <dt>Since first packet</dt>
                          <dd className="mono">{formatRelative(packet.timestampUs, baseUs)}</dd>
                        </div>
                      ) : null}
                      <div>
                        <dt>Connection handle</dt>
                        <dd className="mono">{formatHandle(packet.connectionHandle)}</dd>
                      </div>
                      <div>
                        <dt>Characteristic handle</dt>
                        <dd className="mono">{formatHandle(packet.attHandle)}</dd>
                      </div>
                      <div>
                        <dt>Record</dt>
                        <dd className="mono">#{packet.recordIndex}</dd>
                      </div>
                      <div>
                        <dt>ASCII</dt>
                        <dd className="mono">{toAscii(packet.payload) || '-'}</dd>
                      </div>
                    </dl>
                    <PayloadPanels
                      payload={packet.payload}
                      highlight={hexMatchRanges(packet, filter)}
                    />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
