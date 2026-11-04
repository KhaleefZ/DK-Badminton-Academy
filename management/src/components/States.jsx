import { CalendarSearch, CircleAlert } from 'lucide-react';
import Button from './Button';

/** DK / Empty state — "No matching …" with a way back. */
export function EmptyState({ title = 'No matching bookings', text, onClear }) {
  return (
    <div className="state-card">
      <CalendarSearch size={28} strokeWidth={1.5} aria-hidden="true" className="state-card__icon" />
      <h3 className="state-card__title">{title}</h3>
      <p className="state-card__text">{text ?? 'No records match these filters. Clear them to see everything.'}</p>
      {onClear && <Button onClick={onClear}>Clear filters</Button>}
    </div>
  );
}

/** Error state — "Couldn't load this view" with retry. */
export function ErrorState({ onRetry }) {
  return (
    <div className="state-card">
      <CircleAlert size={28} strokeWidth={1.5} aria-hidden="true" className="state-card__icon state-card__icon--danger" />
      <h3 className="state-card__title">Couldn’t load this view</h3>
      <p className="state-card__text">Your records haven’t changed. Try loading it again.</p>
      <Button variant="primary" onClick={onRetry ?? (() => window.location.reload())}>
        Try again
      </Button>
    </div>
  );
}
