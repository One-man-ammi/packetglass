import { useCallback, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent } from 'react';

import { formatFileSize } from '../lib/format';
import type { CaptureState } from '../hooks/useCapture';

interface ImportScreenProps {
  state: CaptureState;
  onFile: (file: File) => void;
  onSample: () => void;
}

export function ImportScreen({ state, onFile, onSample }: ImportScreenProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const parsing = state.status === 'parsing';

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setDragging(false);
      const file = event.dataTransfer.files?.[0];
      if (file) onFile(file);
    },
    [onFile],
  );

  return (
    <main className="import-screen">
      <div className="import-inner">
        <header className="import-header">
          <p className="eyebrow">Packetglass v0.1</p>
          <h1>
            See your <span className="glow-text">device</span>, not the Bluetooth stack.
          </h1>
          <p className="lede">
            Load an Android <code>btsnoop_hci.log</code> and read the ATT conversation the way a
            reverse-engineer does: writes and notifications in order, every byte decoded three ways.
          </p>
        </header>

        <div
          className={`dropzone${dragging ? ' dragging' : ''}${parsing ? ' busy' : ''}`}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
        >
          <input
            ref={inputRef}
            type="file"
            className="visually-hidden"
            accept=".log,.cfa,.btsnoop,application/octet-stream"
            onChange={(event: ChangeEvent<HTMLInputElement>) => {
              const file = event.target.files?.[0];
              if (file) onFile(file);
              event.target.value = '';
            }}
          />

          {parsing ? (
            <>
              <div className="spinner" aria-hidden="true" />
              <p className="dropzone-title">Parsing {state.fileName}</p>
              <p className="muted">{formatFileSize(state.fileSize)} - decoding HCI records</p>
            </>
          ) : (
            <>
              <p className="dropzone-title">Drop a capture here</p>
              <p className="muted">btsnoop_hci.log, straight off the phone</p>
              <div className="dropzone-actions">
                <button
                  type="button"
                  className="button primary"
                  onClick={() => inputRef.current?.click()}
                >
                  Choose file
                </button>
                <button type="button" className="button ghost" onClick={onSample}>
                  Open sample capture
                </button>
              </div>
            </>
          )}
        </div>

        {state.status === 'error' ? (
          <p className="import-error" role="alert">
            <strong>{state.fileName} could not be read.</strong> {state.message}
          </p>
        ) : null}

        <ul className="import-notes">
          <li>
            <span className="note-key">Local only</span>
            Parsing happens in this tab, in a web worker. Nothing is uploaded and no capture is
            stored.
          </li>
          <li>
            <span className="note-key">What it reads</span>
            ATT writes, write commands, signed writes, notifications and indications, grouped by the
            remote device address from the connection events.
          </li>
          <li>
            <span className="note-key">Where to find it</span>
            Android developer options, enable Bluetooth HCI snoop log, reproduce the action, then
            pull the capture with a bug report.
          </li>
        </ul>
      </div>
    </main>
  );
}
