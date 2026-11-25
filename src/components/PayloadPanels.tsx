import { useMemo } from 'react';

import { byteRows, decodeNumbers, hexValue, isPrintable } from '../lib/format';

const BYTES_PER_ROW = 8;

interface PayloadPanelsProps {
  payload: Uint8Array;
  /** Byte ranges the current filter matched, as [start, end) pairs. */
  highlight?: Array<[number, number]>;
}

export function PayloadPanels({ payload, highlight = [] }: PayloadPanelsProps) {
  const rows = useMemo(() => byteRows(payload, BYTES_PER_ROW), [payload]);
  const numbers = useMemo(() => decodeNumbers(payload), [payload]);
  const isHighlighted = useMemo(() => {
    const flags = new Set<number>();
    for (const [start, end] of highlight) {
      for (let offset = start; offset < end; offset += 1) flags.add(offset);
    }
    return flags;
  }, [highlight]);

  if (payload.byteLength === 0) {
    return <p className="payload-empty">This packet carries no payload bytes.</p>;
  }

  return (
    <div className="payload-panels">
      <section className="panel" aria-label="Hex">
        <h4 className="panel-title">Hex</h4>
        <div className="byte-grid">
          {rows.map((row) => (
            <div className="byte-line" key={row.offset}>
              <span className="byte-offset">{row.offset.toString(16).padStart(4, '0')}</span>
              <span className="byte-cells">
                {row.bytes.map((byte, index) => (
                  <span
                    key={index}
                    className={isHighlighted.has(row.offset + index) ? 'byte hit' : 'byte'}
                  >
                    {byte.toString(16).padStart(2, '0')}
                  </span>
                ))}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="panel" aria-label="ASCII">
        <h4 className="panel-title">ASCII</h4>
        <div className="byte-grid">
          {rows.map((row) => (
            <div className="byte-line" key={row.offset}>
              <span className="byte-offset">{row.offset.toString(16).padStart(4, '0')}</span>
              <span className="byte-cells ascii">
                {row.bytes.map((byte, index) => {
                  const printable = isPrintable(byte);
                  const classes = ['glyph'];
                  if (!printable) classes.push('dim');
                  if (isHighlighted.has(row.offset + index)) classes.push('hit');
                  return (
                    <span key={index} className={classes.join(' ')}>
                      {printable ? String.fromCharCode(byte) : '.'}
                    </span>
                  );
                })}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="panel numbers" aria-label="Numbers">
        <h4 className="panel-title">
          Numbers <span className="panel-note">every field decode, LE and BE</span>
        </h4>
        <div className="numbers-scroll">
          <table className="numbers-table">
            <thead>
              <tr>
                <th scope="col">off</th>
                <th scope="col">uint8</th>
                <th scope="col">uint16 LE</th>
                <th scope="col">uint16 BE</th>
                <th scope="col">uint32 LE</th>
                <th scope="col">uint32 BE</th>
              </tr>
            </thead>
            <tbody>
              {numbers.map((decode) => (
                <tr
                  key={decode.offset}
                  className={isHighlighted.has(decode.offset) ? 'hit-row' : undefined}
                >
                  <th scope="row">{decode.offset.toString(16).padStart(2, '0')}</th>
                  <td>
                    <NumberCell value={decode.uint8} width={1} />
                  </td>
                  <td>
                    <NumberCell value={decode.uint16le} width={2} />
                  </td>
                  <td>
                    <NumberCell value={decode.uint16be} width={2} />
                  </td>
                  <td>
                    <NumberCell value={decode.uint32le} width={4} />
                  </td>
                  <td>
                    <NumberCell value={decode.uint32be} width={4} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function NumberCell({ value, width }: { value: number | null; width: number }) {
  if (value === null) return <span className="number-empty">-</span>;
  return (
    <span className="number-cell">
      {/* No thousands separators: a decoded field reads better as 2026 than 2,026. */}
      <span className="number-dec">{value}</span>
      <span className="number-hex">{hexValue(value, width)}</span>
    </span>
  );
}
