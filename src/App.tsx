import { useCallback, useEffect, useMemo, useState } from 'react';

import { CaptureHeader } from './components/CaptureHeader';
import { DeviceSidebar } from './components/DeviceSidebar';
import { FilterBar } from './components/FilterBar';
import { ImportScreen } from './components/ImportScreen';
import { PacketTable } from './components/PacketTable';
import { useCapture } from './hooks/useCapture';
import { filterPackets, parseFilterQuery } from './lib/filter';
import { buildSampleCapture } from './parser/synthetic';

export function App() {
  const { state, loadFile, loadBytes, reset } = useCapture();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const capture = state.status === 'ready' ? state.capture : null;

  // Land on the busiest device, which is the one the capture was taken for.
  useEffect(() => {
    if (!capture) {
      setSelectedKey(null);
      return;
    }
    setSelectedKey((current) => {
      if (current && capture.devices.some((device) => device.key === current)) return current;
      return capture.devices[0]?.key ?? null;
    });
  }, [capture]);

  const devicePackets = useMemo(() => {
    if (!capture || !selectedKey) return [];
    return capture.packets.filter((packet) => packet.deviceKey === selectedKey);
  }, [capture, selectedKey]);

  const filter = useMemo(() => parseFilterQuery(query), [query]);
  const visiblePackets = useMemo(
    () => filterPackets(devicePackets, filter),
    [devicePackets, filter],
  );

  const handleSample = useCallback(() => {
    void loadBytes(buildSampleCapture(), 'sample_btsnoop_hci.log');
  }, [loadBytes]);

  const handleFile = useCallback(
    (file: File) => {
      void loadFile(file);
    },
    [loadFile],
  );

  if (!capture || state.status !== 'ready') {
    return <ImportScreen state={state} onFile={handleFile} onSample={handleSample} />;
  }

  const selectedDevice = capture.devices.find((device) => device.key === selectedKey) ?? null;

  return (
    <div className="app">
      <CaptureHeader
        capture={capture}
        fileName={state.fileName}
        fileSize={state.fileSize}
        onReset={reset}
      />

      <div className="workspace">
        <DeviceSidebar
          devices={capture.devices}
          selectedKey={selectedKey}
          onSelect={(key) => {
            setSelectedKey(key);
            setQuery('');
          }}
        />

        <main className="packets">
          <div className="packets-head">
            <h2 className="packets-title">
              {selectedDevice ? selectedDevice.label : 'No device selected'}
            </h2>
            <FilterBar
              value={query}
              onChange={setQuery}
              filter={filter}
              matched={visiblePackets.length}
              total={devicePackets.length}
            />
          </div>

          <PacketTable
            packets={visiblePackets}
            filter={filter}
            baseUs={devicePackets[0]?.timestampUs ?? null}
          />
        </main>
      </div>
    </div>
  );
}
