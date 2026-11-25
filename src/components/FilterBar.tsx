import type { ParsedFilter } from '../lib/filter';

interface FilterBarProps {
  value: string;
  onChange: (value: string) => void;
  filter: ParsedFilter;
  matched: number;
  total: number;
}

export function FilterBar({ value, onChange, filter, matched, total }: FilterBarProps) {
  return (
    <div className="filter-bar">
      <label className="filter-field">
        <span className="filter-icon" aria-hidden="true">
          /
        </span>
        <input
          type="search"
          value={value}
          placeholder="Filter by hex, text or handle - try b1, ascii:FVP, handle:0x000e"
          aria-label="Filter packets by hex, ASCII or handle"
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => onChange(event.target.value)}
        />
        {value ? (
          <button type="button" className="filter-clear" onClick={() => onChange('')}>
            Clear
          </button>
        ) : null}
      </label>

      <p className="filter-status" role="status">
        {filter.error ? (
          <span className="filter-error">{filter.error}</span>
        ) : filter.isEmpty ? (
          <span className="muted">{total.toLocaleString()} packets</span>
        ) : (
          <span>
            <strong>{matched.toLocaleString()}</strong>
            <span className="muted"> of {total.toLocaleString()} match</span>
            {filter.field !== 'any' ? <span className="filter-mode">{filter.field}</span> : null}
          </span>
        )}
      </p>
    </div>
  );
}
