import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import Button from '../../components/Button';
import Field from '../../components/Field';
import Notice from '../../components/Notice';
import BookingStepper from '../../booking/BookingStepper';
import BookingSummary from '../../booking/BookingSummary';
import { useAvailability, useBooking } from '../../booking/BookingContext';
import { validateDetails } from '../../booking/validation';
import { api } from '../../lib/api';
import { flagFirstInvalid } from '../../lib/formFeedback';
import { fill, useContent } from '../../lib/site';
import TestModeNotice from '../../booking/TestModeNotice';

export default function Details() {
  const navigate = useNavigate();
  const { date, courtId, slot, details, setDetails } = useBooking();
  const { data } = useAvailability(date);
  const [agreed, setAgreed] = useState(false);
  const [touched, setTouched] = useState({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const [trap, setTrap] = useState('');
  const text = useContent().booking.details;

  if (!slot) return <Navigate to="/booking" replace />;

  const court = data?.courts.find((c) => c.id === courtId) ?? data?.courts[0];
  const errors = validateDetails(details);
  const ready = Object.keys(errors).length === 0 && agreed;
  const show = (field) => (touched[field] ? errors[field] : undefined);
  const bind = (field) => ({
    value: details[field],
    onChange: (e) => setDetails({ [field]: e.target.value }),
    onBlur: () => setTouched((t) => ({ ...t, [field]: true })),
  });

  const submit = async (e) => {
    e.preventDefault();
    setTouched({ name: true, phone: true, email: true });
    if (!ready) {
      flagFirstInvalid(e.currentTarget, '.ack-box input:not(:checked)');
      return;
    }
    if (pending || !court) return;
    setPending(true);
    setError(null);
    try {
      const { token } = await api('/bookings', { method: 'POST', body: { courtId: court.id, date, start: slot.start, ...details, website: trap } });
      navigate(`/booking/pay/${token}`);
    } catch (err) {
      setError(err);
      setPending(false);
    }
  };

  return (
    <div className="booking-page">
      <div className="container">
        <BookingStepper current={2} />
        {data?.testMode && <TestModeNotice className="booking-page__notice" />}

        <form className="booking-layout" onSubmit={submit} noValidate>
          <section className="stack booking-layout__main" aria-labelledby="details-heading">
            <p className="overline">{text.overline}</p>
            <h1 id="details-heading" className="display display--md">
              {text.title}
            </h1>

            <div className="form-grid">
              <Field label={text.nameLabel} required autoComplete="name" hint={text.nameHint} error={show('name')} {...bind('name')} />
              <Field label={text.phoneLabel} required type="tel" inputMode="tel" autoComplete="tel" error={show('phone')} {...bind('phone')} />
              <Field label={text.emailLabel} required type="email" autoComplete="email" hint={text.emailHint} error={show('email')} className="form-grid__full" {...bind('email')} />
              <Field label={text.notesLabel} maxLength={1000} className="form-grid__full" {...bind('notes')} />
            </div>

            <div className="visually-hidden" aria-hidden="true">
              <label>
                Website
                <input tabIndex={-1} autoComplete="off" value={trap} onChange={(e) => setTrap(e.target.value)} />
              </label>
            </div>

            <fieldset className="ack-box">
              <legend className="visually-hidden">Agreement</legend>
              <label className="checkbox">
                <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
                <span>{text.consent}</span>
              </label>
            </fieldset>

            <p className="fine muted">{text.policyNote}</p>

            <Button to="/booking" variant="secondary" size="sm">
              {text.backButton}
            </Button>
          </section>

          <aside className="booking-layout__aside stack" style={{ '--stack-gap': '16px' }}>
            <BookingSummary date={date} courtName={court?.name} slot={slot} amountPaise={slot.pricePaise} />
            {error && (
              <div role="alert">
                <Notice>
                  {error.message} {error.code === 'SLOT_TAKEN' && <Link to="/booking">Choose another slot</Link>}
                </Notice>
              </div>
            )}
            <Button type="submit" variant={ready ? 'primary' : 'muted'} icon={false} aria-disabled={!ready} disabled={pending} aria-busy={pending}>
              {pending ? text.submittingButton : text.submitButton}
            </Button>
            {!ready && <p className="fine muted">{text.incompleteNote}</p>}
            {data && <p className="fine muted">{fill(text.holdNote, { minutes: data.holdMinutes })}</p>}
          </aside>
        </form>
      </div>
    </div>
  );
}
