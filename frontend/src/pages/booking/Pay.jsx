import { useCallback, useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import Notice from '../../components/Notice';
import BookingStepper from '../../booking/BookingStepper';
import BookingSummary from '../../booking/BookingSummary';
import TestModeNotice from '../../booking/TestModeNotice';
import { useBooking } from '../../booking/BookingContext';
import PayButtons from '../../booking/PayButtons';
import { api } from '../../lib/api';
import { usePaymentInfo } from '../../lib/payments';
import { fill, useContent } from '../../lib/site';

const remaining = (until) => Math.max(0, Math.ceil((new Date(until).getTime() - Date.now()) / 1000));
const clock = (seconds) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

/** The pay step: the gateway's checkout, or the simulator's buttons in local development. */
export default function Pay() {
  const { token } = useParams();
  const navigate = useNavigate();
  const { reset } = useBooking();
  const [booking, setBooking] = useState(null);
  const [seconds, setSeconds] = useState(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [missing, setMissing] = useState(false);
  const text = useContent().booking.pay;
  const info = usePaymentInfo();

  const load = useCallback(async () => {
    try {
      const result = await api(`/bookings/${token}`);
      setBooking(result.booking);
    } catch (err) {
      if (err.status === 404) setMissing(true);
      else setError(err.message);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const expiresAt = booking?.holdExpiresAt;
  useEffect(() => {
    if (!expiresAt) return undefined;
    setSeconds(remaining(expiresAt));
    const timer = setInterval(() => setSeconds(remaining(expiresAt)), 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);

  // Re-read the server's answer the moment the clock runs out, rather than trusting this one.
  useEffect(() => {
    if (seconds === 0) load();
  }, [seconds, load]);

  if (missing) return <Navigate to="/booking" replace />;

  const settled = (record) => {
    if (record.status === 'active') reset();
    navigate(`/booking/status/${token}`, { replace: true });
  };

  const release = async () => {
    setPending(true);
    try {
      await api(`/bookings/${token}/release`, { method: 'POST' });
    } catch {
      // Nothing to release: the hold has already ended.
    }
    navigate('/booking', { replace: true });
  };

  if (booking && booking.status !== 'pending_payment') return <Navigate to={`/booking/status/${token}`} replace />;

  return (
    <div className="booking-page">
      <div className="container">
        <BookingStepper current={3} />
        {info?.testMode && <TestModeNotice className="booking-page__notice" />}

        <div className="booking-layout">
          <section className="stack booking-layout__main" aria-labelledby="pay-heading">
            <p className="overline">{text.overline}</p>
            <h1 id="pay-heading" className="display display--md">
              {text.title}
            </h1>
            {booking ? (
              <p className="lead" role="timer">
                {text.timerBefore} <strong>{seconds === null ? '…' : clock(seconds)}</strong> {fill(text.timerAfter, { bookingNo: booking.bookingNo })}
              </p>
            ) : (
              <p className="meta muted">{text.loading}</p>
            )}
            {error && (
              <div role="alert">
                <Notice>{error}</Notice>
              </div>
            )}
            {booking && <PayButtons info={info} base={`/bookings/${token}`} recordKey="booking" amountPaise={booking.amountPaise} text={text} onSettled={settled} onExpired={load} />}
            {booking && (
              <button type="button" className="link-button fine" disabled={pending} onClick={release}>
                {text.releaseButton}
              </button>
            )}
          </section>

          <aside className="booking-layout__aside stack" style={{ '--stack-gap': '16px' }}>
            {booking && <BookingSummary date={booking.date} courtName={booking.courtName} slot={booking} amountPaise={booking.amountPaise} />}
          </aside>
        </div>
      </div>
    </div>
  );
}
