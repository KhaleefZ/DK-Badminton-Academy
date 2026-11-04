import { useState } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { addDays, dayOfMonth, formatLong, formatMonth, formatWeekday, startOfWeek, todayISO } from './schedule';

/** Week-at-a-time date picker. Past days, and days beyond `maxDate`, are disabled. */
export default function DateStrip({ value, onChange, maxDate }) {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(value));
  const today = todayISO();
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const canGoBack = addDays(weekStart, -1) >= today;

  return (
    <div className="date-strip">
      <div className="date-strip__header">
        <p className="date-strip__month" aria-live="polite">
          {formatMonth(days[3])}
        </p>
        <div className="date-strip__arrows">
          <button
            type="button"
            className="icon-button"
            aria-label="Previous week"
            disabled={!canGoBack}
            onClick={() => setWeekStart(addDays(weekStart, -7))}
          >
            <ArrowLeft size={18} strokeWidth={1.6} />
          </button>
          <button type="button" className="icon-button" aria-label="Next week" disabled={Boolean(maxDate) && addDays(weekStart, 7) > maxDate} onClick={() => setWeekStart(addDays(weekStart, 7))}>
            <ArrowRight size={18} strokeWidth={1.6} />
          </button>
        </div>
      </div>
      <div className="date-strip__days" role="radiogroup" aria-label="Date">
        {days.map((iso) => {
          const selected = iso === value;
          return (
            <button
              key={iso}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={formatLong(iso)}
              disabled={iso < today || (Boolean(maxDate) && iso > maxDate)}
              className={`date-strip__day${selected ? ' is-selected' : ''}`}
              onClick={() => onChange(iso)}
            >
              <span className="date-strip__weekday">{formatWeekday(iso)}</span>
              <span className="date-strip__date">{dayOfMonth(iso)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
