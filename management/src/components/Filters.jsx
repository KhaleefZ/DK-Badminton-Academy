import { useId } from 'react';
import { ChevronDown, Search } from 'lucide-react';

export function FilterBar({ children }) {
  return (
    <div className="filter-bar" role="search">
      {children}
    </div>
  );
}

/** DK / Search */
export function SearchFilter({ label, value, onChange, placeholder }) {
  const id = useId();
  return (
    <div className="filter filter--search">
      <label htmlFor={id} className="visually-hidden">
        {label}
      </label>
      <input id={id} type="search" value={value} placeholder={placeholder ?? label} onChange={(e) => onChange(e.target.value)} />
      <Search size={14} strokeWidth={1.6} aria-hidden="true" />
    </div>
  );
}

/** DK / Select used as a filter. `options` is [{ value, label }]. */
export function SelectFilter({ label, value, onChange, options }) {
  const id = useId();
  return (
    <div className="filter filter--select">
      <label htmlFor={id} className="visually-hidden">
        {label}
      </label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <ChevronDown size={14} strokeWidth={1.6} aria-hidden="true" />
    </div>
  );
}

export function DateFilter({ label, value, onChange, min, max }) {
  const id = useId();
  return (
    <div className="filter filter--date">
      <label htmlFor={id} className="visually-hidden">
        {label}
      </label>
      <input id={id} type="date" value={value} min={min} max={max} onChange={(e) => e.target.value && onChange(e.target.value)} />
    </div>
  );
}

export const toOptions = (all, values) => [{ value: 'all', label: all }, ...values.map((v) => ({ value: v, label: v }))];
