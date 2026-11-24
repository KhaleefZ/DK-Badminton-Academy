import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Button from '../../components/Button';
import Notice from '../../components/Notice';
import BookingStepper from '../../booking/BookingStepper';
import BookingSummary from '../../booking/BookingSummary';
import DateStrip from '../../booking/DateStrip';
import SlotGrid from '../../booking/SlotGrid';
import { useAvailability, useBooking } from '../../booking/BookingContext';
import { durationLabel, formatPaise, formatShort, liveSelection, slotLabel, tapSlot, usable } from '../../booking/schedule';
import { useContent } from '../../lib/site';

export default function ChooseSlot() {
  const navigate = useNavigate();
  const { date, courtId, slot, setDate, setCourt, setSlot } = useBooking();
  const [tapNote, setTapNote] = useState('');
  const { data, error } = useAvailability(date);
  const next = () => navigate('/booking/details');
  const text = useContent().booking.choose;

  const courts = data?.courts ?? [];
  const court = courts.find((c) => c.id === courtId) ?? courts[0];
  const slots = court?.slots ?? [];
  // A booking is 1 h or longer, made of back-to-back 30-minute slots.
  const minCount = (data?.minBookingMinutes ?? 60) / 30;
  // A free half-hour boxed in by bookings can't make a whole booking, so it shows as unavailable.
  const shown = slots.map((s, i) => ({ ...s, available: usable(slots, i, minCount) }));
  // Recomputed from live slots, so the price is current and a time someone else took drops away.
  const chosen = liveSelection(slots, slot);

  const pick = (_slot, index) => {
    const { selection, note = '' } = tapSlot(slots, chosen, index, minCount);
    setSlot(selection);
    setTapNote(note);
  };

  return (
    <div className="booking-page">
      <div className="container">
        <BookingStepper current={1} />
        {data && !data.onlineBooking && <Notice className="booking-page__notice">{text.offlineNotice}</Notice>}

        <div className="booking-layout">
          <section className="stack booking-layout__main" aria-labelledby="choose-heading">
            <p className="overline">{text.overline}</p>
            <h1 id="choose-heading" className="display display--md">
              {text.title}
            </h1>

            <DateStrip value={date} onChange={setDate} maxDate={data?.lastOnlineDate} />

            {courts.length > 0 && (
              <div className="court-picker">
                <p className="court-picker__label" id="court-label">
                  {text.courtLabel}
                </p>
                <div className="court-picker__options" role="radiogroup" aria-labelledby="court-label">
                  {courts.map((c) => {
                    const selected = c.id === court?.id;
                    // 'No times left', not 'Fully booked': a slot may be gone because it's past, not booked.
                    const free = c.slots.filter((s, i) => usable(c.slots, i, minCount)).length;
                    return (
                      <button key={c.id} type="button" role="radio" aria-checked={selected} className={`court-option${selected ? ' is-selected' : ''}`} onClick={() => setCourt(c.id)}>
                        <span className="court-option__name">{c.name}</span>
                        <span className="court-option__meta">{free === 0 ? 'No times left' : `${durationLabel(free * 30)} free`}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <ul className="slot-legend" aria-label="Slot legend">
              <li className="slot-legend__item slot-legend__item--selected">{text.legendSelected}</li>
              <li className="slot-legend__item slot-legend__item--available">{text.legendAvailable}</li>
              <li className="slot-legend__item slot-legend__item--blocked">{text.legendBlocked ?? 'Blocked'}</li>
              <li className="slot-legend__item slot-legend__item--unavailable">{text.legendUnavailable}</li>
            </ul>

            {error && (
              <div role="alert">
                <Notice>{error}</Notice>
              </div>
            )}
            {!data && !error && <p className="meta muted">{text.checking}</p>}
            {data && slots.length === 0 && <p className="meta muted">{text.noSlots}</p>}
            {slots.length > 0 && <SlotGrid slots={shown} selection={chosen} onSelect={pick} className="slot-grid--half" />}
            {slots.length > 0 && (
              <p className="slot-hint" aria-live="polite">
                {tapNote || (chosen ? `${durationLabel(chosen.durationMinutes)} selected, ${slotLabel(chosen)}. Tap more half-hours to make it longer, or the first or last one to shorten it.` : '')}
              </p>
            )}
          </section>

          <aside className="booking-layout__aside stack" style={{ '--stack-gap': '16px' }}>
            <BookingSummary date={date} courtName={court?.name} slot={chosen} amountPaise={chosen?.pricePaise} />
            <Button onClick={next} disabled={!chosen || !court} className="btn--block-mobile btn--full">
              {text.nextButton}
            </Button>
          </aside>
        </div>
      </div>

      <div className="sticky-summary on-dark" aria-hidden={!chosen}>
        <div className="sticky-summary__line">
          <span>
            {formatShort(date)} · {court?.name} {chosen ? slotLabel(chosen) : '— choose a time'}
          </span>
          <span>{chosen ? formatPaise(chosen.pricePaise) : '₹—'}</span>
        </div>
        <Button variant="lime" onClick={next} disabled={!chosen || !court}>
          {text.nextButton}
        </Button>
      </div>
    </div>
  );
}
