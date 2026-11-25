import { useState } from 'react';

import { datalinkTypeName } from '../parser';
import { formatCount, formatDuration, formatFileSize } from '../lib/format';
import type { ParsedCapture } from '../parser/types';

interface CaptureHeaderProps {
  capture: ParsedCapture;
  fileName: string;
  fileSize: number;
  onReset: () => void;
}

export function CaptureHeader({ capture, fileName, fileSize, onReset }: CaptureHeaderProps) {
  const [showWarnings, setShowWarnings] = useState(false);
  const { stats, warnings } = capture;

  return (
    <header className="capture-header">
      <div className="capture-identity">
        <span className="brand">Packetglass</span>
        <span className="capture-file mono" title={fileName}>
          {fileName}
        </span>
        <span className="muted">{formatFileSize(fileSize)}</span>
      </div>

      <dl className="capture-stats">
        <Stat label="HCI records" value={stats.records.toLocaleString()} />
        <Stat
          label="ATT shown"
          value={`${(stats.attWrites + stats.attNotifications).toLocaleString()}`}
          detail={`${stats.attWrites} w / ${stats.attNotifications} n`}
        />
        <Stat label="Devices" value={capture.devices.length.toLocaleString()} />
        <Stat label="Span" value={formatDuration(stats.durationUs)} />
        <Stat label="Link" value={datalinkTypeName(capture.header.datalinkType)} />
      </dl>

      <div className="capture-actions">
        {warnings.length > 0 ? (
          <button
            type="button"
            className="button ghost warn"
            aria-expanded={showWarnings}
            onClick={() => setShowWarnings((open) => !open)}
          >
            {formatCount(warnings.length, 'note')}
          </button>
        ) : null}
        <button type="button" className="button ghost" onClick={onReset}>
          New capture
        </button>
      </div>

      {showWarnings && warnings.length > 0 ? (
        <ul className="warning-list">
          {warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}
    </header>
  );
}

function Stat({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="stat">
      <dt>{label}</dt>
      <dd>
        {value}
        {detail ? <span className="muted"> {detail}</span> : null}
      </dd>
    </div>
  );
}
