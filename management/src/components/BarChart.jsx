import { Info } from 'lucide-react';

/**
 * Modern accessible bar chart matching the green theme and the screenshot.
 */
export default function BarChart({
  data,
  max,
  ticks,
  formatValue = String,
  caption,
  highlightLast = true,
  unitLabel,
}) {
  const top = max ?? Math.max(...data.map((d) => d.value), 1);
  const tickValues = ticks ?? [top, (top * 2) / 3, top / 3, 0];

  return (
    <figure className="bar-chart">
      <div className="bar-chart__plot" aria-hidden="true">
        {/* Y-axis labels */}
        <div className="bar-chart__axis">
          {tickValues.map((t) => (
            <span key={t} className="bar-chart__tick">
              {unitLabel ? unitLabel(t) : t}
            </span>
          ))}
        </div>

        {/* Horizontal gridlines */}
        <div className="bar-chart__gridlines">
          {tickValues.map((t) => (
            <div key={t} className="bar-chart__gridline" />
          ))}
        </div>

        {/* Bars Container */}
        <div className="bar-chart__bars">
          {data.map((d, i) => (
            <div key={d.label} className="bar-chart__point">
              <div className="bar-chart__track">
                <span className="bar-chart__value">{formatValue(d.value)}</span>
                <span
                  className={`bar-chart__bar${highlightLast && i === data.length - 1 ? ' bar-chart__bar--current' : ''}`}
                  style={{ '--ratio': Math.max(0.01, Math.min(d.value / top, 1)) }}
                />
              </div>
              <span className="bar-chart__label">{d.label}</span>
            </div>
          ))}
        </div>
      </div>

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

      {caption && (
        <figcaption className="bar-chart__caption">
          <Info size={14} strokeWidth={1.8} className="bar-chart__caption-icon" />
          <span>{caption}</span>
        </figcaption>
      )}

      {/* Decorative corner wave */}
      <div className="bar-chart__corner-wave" aria-hidden="true">
        <svg viewBox="0 0 160 90" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path
            d="M0 90 C40 50 80 80 120 30 C140 5 155 20 160 0 L160 90 Z"
            fill="rgba(187, 247, 208, 0.45)"
          />
        </svg>
      </div>
    </figure>
  );
}
