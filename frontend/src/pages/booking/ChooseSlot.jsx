import { useNavigate } from 'react-router-dom';
import Button from '../../components/Button';
import Field from '../../components/Field';
import Notice from '../../components/Notice';
import BookingStepper from '../../booking/BookingStepper';
import BookingSummary from '../../booking/BookingSummary';
import DateStrip from '../../booking/DateStrip';
import SlotGrid from '../../booking/SlotGrid';
import TestModeNotice from '../../booking/TestModeNotice';
import { useAvailability, useBooking } from '../../booking/BookingContext';
import { formatPaise, formatShort, slotLabel } from '../../booking/schedule';
import { useContent } from '../../lib/site';

export default function ChooseSlot() {
  const navigate = useNavigate();
  const { date, courtId, slot, setDate, setCourt, setSlot } = useBooking();
  const { data, error } = useAvailability(date);
  const next = () => navigate('/booking/details');
  const text = useContent().booking.choose;

  const courts = data?.courts ?? [];
  const court = courts.find((c) => c.id === courtId) ?? courts[0];
  const slots = court?.slots ?? [];
  const chosen = slot && slots.find((s) => s.start === slot.start && s.available) ? slot : null;

  return (
    <div className="booking-page">
      <div className="container">
        <BookingStepper current={1} />
        {data?.testMode && <TestModeNotice className="booking-page__notice" />}
        {data && !data.onlineBooking && <Notice className="booking-page__notice">{text.offlineNotice}</Notice>}

        <div className="booking-layout">
          <section className="stack booking-layout__main" aria-labelledby="choose-heading">
            <p className="overline">{text.overline}</p>
            <h1 id="choose-heading" className="display display--md">
              {text.title}
            </h1>

            <DateStrip value={date} onChange={setDate} maxDate={data?.lastOnlineDate} />

            {courts.length > 0 && (
              <Field
                as="select"
                label={text.courtLabel}
                value={court?.id ?? ''}
                onChange={(e) => setCourt(e.target.value)}
                options={courts.map((c) => ({ value: c.id, label: c.name }))}
                className="booking-page__court"
              />
            )}

            <ul className="slot-legend" aria-label="Slot legend">
              <li>{text.legendAvailable}</li>
              <li className="slot-legend__selected">{text.legendSelected}</li>
              <li>{text.legendUnavailable}</li>
            </ul>

            {error && (
              <div role="alert">
                <Notice>{error}</Notice>
              </div>
            )}
            {!data && !error && <p className="meta muted">{text.checking}</p>}
            {data && slots.length === 0 && <p className="meta muted">{text.noSlots}</p>}
            {slots.length > 0 && <SlotGrid slots={slots} value={chosen?.start} onChange={setSlot} />}

            <p className="fine muted">{text.note}</p>
          </section>

          <aside className="booking-layout__aside stack" style={{ '--stack-gap': '16px' }}>
            <BookingSummary date={date} courtName={court?.name} slot={chosen} amountPaise={chosen?.pricePaise} />
            <Button onClick={next} disabled={!chosen || !court} className="btn--block-mobile">
              {text.nextButton}
            </Button>
            <Button to="/courts" variant="secondary" size="sm">
              {text.backButton}
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
