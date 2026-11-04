import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Flag } from 'lucide-react';
import { m } from 'motion/react';
import { EASE_OUT, useMotionTransform } from '../../lib/motion';
import { ScrambleText } from '../../motion';
import Button from '../../components/Button';
import Notice from '../../components/Notice';
import BookingStepper from '../../booking/BookingStepper';
import BookingSummary from '../../booking/BookingSummary';
import { api } from '../../lib/api';
import { useVenue, whatsappLink } from '../../lib/useVenue';
import { fill, useContent } from '../../lib/site';

/** The private page for one booking. Its address is the only key to it, so keep it safe. */
export default function Outcome() {
  const { token } = useParams();
  const tf = useMotionTransform();
  const [booking, setBooking] = useState(null);
  const [error, setError] = useState('');
  const venue = useVenue();
  const text = useContent().booking.outcome;

  useEffect(() => {
    const controller = new AbortController();
    api(`/bookings/${token}`, { signal: controller.signal })
      .then((result) => setBooking(result.booking))
      .catch((err) => {
        if (err.name !== 'AbortError') setError(err.status === 404 ? text.notFound : err.message);
      });
    return () => controller.abort();
  }, [token, text.notFound]);

  if (error || !booking) {
    return (
      <div className="booking-page">
        <div className="container container--narrow stack">
          {error ? (
            <div role="alert">
              <Notice>{error}</Notice>
            </div>
          ) : (
            <p className="meta muted">{text.loading}</p>
          )}
          <Button to="/booking" variant="secondary">
            {text.chooseButton}
          </Button>
        </div>
      </div>
    );
  }

  const confirmed = booking.status === 'active';
  const ended = { expired: { heading: text.expiredTitle, text: text.expiredText }, cancelled: { heading: text.cancelledTitle, text: text.cancelledText } }[booking.status];
  const chat = whatsappLink(venue?.whatsappNumber, fill(text.whatsappMessage, { bookingNo: booking.bookingNo }));

  return (
    <div className="booking-page">
      <div className="container container--narrow">
        <BookingStepper current={confirmed ? 4 : 3} />

        <div className="booking-layout">
          <section className="stack booking-layout__main" aria-labelledby="outcome-heading">
            {confirmed && (
              // Rare completion moment: the one place in the flow with a spring.
              <m.span
                className="outcome-flag"
                aria-hidden="true"
                initial={{ opacity: 0, transform: tf('scale(0.9)') }}
                animate={{ opacity: 1, transform: tf('scale(1)') }}
                transition={{ type: 'spring', duration: 0.5, bounce: 0.2 }}
              >
                <Flag size={22} strokeWidth={1.6} />
              </m.span>
            )}
            <p className="overline">{confirmed ? text.confirmedOverline : text.statusOverline}</p>
            <m.h1
              id="outcome-heading"
              className="display display--lg"
              initial={{ opacity: 0, transform: tf('translateY(12px)') }}
              animate={{ opacity: 1, transform: tf('translateY(0px)') }}
              transition={{ duration: 0.4, ease: EASE_OUT, delay: 0.08 }}
            >
              {confirmed ? fill(text.confirmedTitle, { name: booking.name }) : (ended?.heading ?? text.waitingTitle)}
            </m.h1>
            {confirmed ? (
              <>
                <Notice>
                  {text.numberBefore} <ScrambleText text={booking.bookingNo} trigger="mount" duration={800} delay={400} /> {text.numberAfter}
                </Notice>
                <p className="small muted">{text.changeNote}</p>
              </>
            ) : (
              <p className="lead">{ended?.text ?? text.waitingText}</p>
            )}
            <div className="button-row">
              {booking.status === 'pending_payment' && <Button to={`/booking/pay/${token}`}>{text.continueButton}</Button>}
              {!confirmed && booking.status !== 'pending_payment' && <Button to="/booking">{text.chooseButton}</Button>}
              {chat && <Button href={chat}>{text.whatsappButton}</Button>}
              <Button to="/contact?topic=court-sessions" variant="secondary">
                {text.contactButton}
              </Button>
            </div>
          </section>

          <aside className="booking-layout__aside stack" style={{ '--stack-gap': '16px' }}>
            <BookingSummary date={booking.date} courtName={booking.courtName} slot={booking} amountPaise={booking.amountPaise} />
          </aside>
        </div>
      </div>
    </div>
  );
}
