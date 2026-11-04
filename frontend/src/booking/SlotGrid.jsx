import { Check } from 'lucide-react';
import { formatPaise, slotLabel } from './schedule';

/** DK / Booking slot grid: Available · Selected · Unavailable. */
export default function SlotGrid({ slots, value, onChange, className = '' }) {
  return (
    <div className={`slot-grid ${className}`} role="radiogroup" aria-label="Time slots">
      {slots.map((slot) => {
        const selected = value === slot.start;
        const state = selected ? 'selected' : slot.available ? 'available' : 'unavailable';
        return (
          <button key={slot.start} type="button" role="radio" aria-checked={selected} disabled={!slot.available} className={`slot slot--${state}`} onClick={() => onChange(slot)}>
            <span className="slot__time">{slotLabel(slot)}</span>
            <span className="slot__state">
              {selected ? (
                <>
                  Selected <Check size={11} strokeWidth={2.4} aria-hidden="true" />
                </>
              ) : slot.available ? (
                formatPaise(slot.pricePaise)
              ) : (
                'Unavailable'
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
