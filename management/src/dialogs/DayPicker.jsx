import { WEEK } from '../lib/format';

/** Tick-box row for choosing weekdays. */
export default function DayPicker({ value, onChange, error }) {
  const toggle = (day) => onChange(value.includes(day) ? value.filter((d) => d !== day) : [...value, day]);
  return (
    <fieldset className="day-picker form-grid__full">
      <legend className="field__label">Days</legend>
      <div className="price-row__days">
        {WEEK.map(({ day, short, name }) => (
          <label key={day} className="day-check">
            <input type="checkbox" aria-label={name} checked={value.includes(day)} onChange={() => toggle(day)} />
            <span>{short}</span>
          </label>
        ))}
      </div>
      {error && <p className="field__error">{error}</p>}
    </fieldset>
  );
}
