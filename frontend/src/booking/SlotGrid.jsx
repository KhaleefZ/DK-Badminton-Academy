import { Check } from 'lucide-react';
import { formatPaise, slotLabel } from './schedule';

const STATE_TEXT = { blocked: 'Blocked', unavailable: 'Unavailable' };

/**
 * DK / Booking slot grid: Selected · Available · Blocked · Unavailable.
 * A slot's `status` comes from the server ('available', 'blocked' or 'unavailable'); only available ones can be picked.
 * `selection` is the chosen time ({ start, end }); every slot inside it shows as selected.
 */
export default function SlotGrid({ slots, selection = null, onSelect, label = 'Time slots', className = '' }) {
  return (
    <div className={`slot-grid ${className}`} role="group" aria-label={label}>
      {slots.map((slot, index) => {
        const selected = selection !== null && slot.start >= selection.start && slot.end <= selection.end;
        const state = selected ? 'selected' : slot.available ? 'available' : slot.status === 'blocked' ? 'blocked' : 'unavailable';
        return (
          <button key={slot.start} type="button" aria-pressed={selected} disabled={!slot.available && !selected} className={`slot slot--${state}`} onClick={() => onSelect(slot, index)}>
            <span className="slot__time">{slotLabel(slot)}</span>
            <span className="slot__state">
              {selected ? (
                <>
                  Selected <Check size={11} strokeWidth={2.4} aria-hidden="true" />
                </>
              ) : slot.available ? (
                formatPaise(slot.pricePaise)
              ) : (
                STATE_TEXT[state]
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
