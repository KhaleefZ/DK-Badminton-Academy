import { m } from 'motion/react';
import { formatLong, formatPaise, hoursBooked, slotLabel } from './schedule';
import { useContent } from '../lib/site';

/** "Your court time." summary card shown beside every booking step. */
export default function BookingSummary({ date, courtName, slot, amountPaise }) {
  const { summaryOverline, summaryTitle, summaryNoTime, summaryTotal } = useContent().booking;
  return (
    <section className="summary-card" aria-label="Booking summary">
      <p className="overline">{summaryOverline}</p>
      <h2 className="summary-card__title">{summaryTitle}</h2>
      <hr className="rule" />
      <div className="summary-card__lines">
        <p>{formatLong(date)}</p>
        <p>
          {/* Cross-fades when the court/slot changes so the update is noticed */}
          <m.span key={`${courtName}-${slot?.start}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}>
            {courtName ?? 'Choose a court'} · {slot ? slotLabel(slot) : summaryNoTime}
          </m.span>
        </p>
      </div>
      <div className="summary-card__hours">
        <span>Total hours booked</span>
        <span className="summary-card__hours-value">{slot ? hoursBooked(slot) : '—'}</span>
      </div>
      <hr className="rule" />
      <div className="summary-card__price">
        <span>{summaryTotal}</span>
        <span className="summary-card__amount">{amountPaise === undefined || amountPaise === null ? '₹—' : formatPaise(amountPaise)}</span>
      </div>
    </section>
  );
}
