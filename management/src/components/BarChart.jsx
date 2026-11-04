/**
 * Simple accessible bar chart. The last bar (current period) is highlighted in rally lime,
 * matching the Figma charts. A visually-hidden table carries the numbers for screen readers.
 */
export default function BarChart({ data, max, ticks, formatValue = String, caption, highlightLast = true, unitLabel }) {
  const top = max ?? Math.max(...data.map((d) => d.value), 1);
  const tickValues = ticks ?? [top, (top * 2) / 3, top / 3, 0];

  return (
    <figure className="bar-chart">
      <div className="bar-chart__plot" aria-hidden="true">
        <div className="bar-chart__axis">
          {tickValues.map((t) => (
            <span key={t}>{unitLabel ? unitLabel(t) : t}</span>
          ))}
        </div>
        <div className="bar-chart__bars">
          {data.map((d, i) => (
            <div key={d.label} className="bar-chart__point">
              <div className="bar-chart__track">
                <span className="bar-chart__value">{formatValue(d.value)}</span>
                <span
                  className={`bar-chart__bar${highlightLast && i === data.length - 1 ? ' bar-chart__bar--current' : ''}`}
                  style={{ '--ratio': Math.min(d.value / top, 1) }}
                />
              </div>
              <span className="bar-chart__label">{d.label}</span>
            </div>
          ))}
        </div>
      </div>
      {/* Wrapped in a div: overflow clipping doesn't apply to table boxes, which widened mobile pages. */}
      <div className="visually-hidden">
        <table>
          <caption>{caption}</caption>
          <tbody>
            {data.map((d) => (
              <tr key={d.label}>
                <th scope="row">{d.label}</th>
                <td>{formatValue(d.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {caption && <figcaption className="bar-chart__caption">{caption}</figcaption>}
    </figure>
  );
}
