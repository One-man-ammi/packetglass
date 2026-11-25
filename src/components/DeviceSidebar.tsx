import { formatClock, formatCount, formatDuration } from '../lib/format';
import type { DeviceSummary } from '../parser/types';

interface DeviceSidebarProps {
  devices: DeviceSummary[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
}

export function DeviceSidebar({ devices, selectedKey, onSelect }: DeviceSidebarProps) {
  return (
    <aside className="devices">
      <h2 className="sidebar-title">
        Devices <span className="muted">{devices.length}</span>
      </h2>

      {devices.length === 0 ? (
        <p className="muted sidebar-empty">
          No ATT writes or notifications in this capture. It may only contain pairing or
          advertising traffic.
        </p>
      ) : (
        <ul className="device-list">
          {devices.map((device) => {
            const selected = device.key === selectedKey;
            return (
              <li key={device.key}>
                <button
                  type="button"
                  className={selected ? 'device-card selected' : 'device-card'}
                  aria-pressed={selected}
                  onClick={() => onSelect(device.key)}
                >
                  <span className="device-name">{device.name ?? 'Unnamed device'}</span>
                  <span className="device-address mono">{device.address ?? device.key}</span>
                  <span className="device-counts">
                    <span className="chip chip-tx">{device.writeCount} writes</span>
                    <span className="chip chip-rx">{device.notificationCount} notifs</span>
                  </span>
                  <span className="device-meta muted">
                    {formatClock(device.firstSeenUs)} ·{' '}
                    {formatDuration(device.lastSeenUs - device.firstSeenUs)} ·{' '}
                    {formatCount(device.attHandles.length, 'handle')}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
