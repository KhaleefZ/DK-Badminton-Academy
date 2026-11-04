import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import Button from '../../components/Button';
import Notice from '../../components/Notice';
import { formatLong, formatPaise } from '../../booking/schedule';
import { api } from '../../lib/api';
import { useVenue, whatsappLink } from '../../lib/useVenue';
import { fill, useContent } from '../../lib/site';

const remaining = (until) => Math.max(0, Math.ceil((new Date(until).getTime() - Date.now()) / 1000));
const clock = (seconds) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

/** The private page for one membership, and its test payment while one is waiting. */
export default function Status() {
  const { token } = useParams();
  const [m, setM] = useState(null);
  const [error, setError] = useState('');
  const [missing, setMissing] = useState(false);
  const [seconds, setSeconds] = useState(null);
  const [pending, setPending] = useState(false);
  const venue = useVenue();
  const text = useContent().membership.status;

  const load = useCallback(async () => {
    try {
      setM((await api(`/memberships/${token}`)).membership);
    } catch (err) {
      if (err.status === 404) setMissing(true);
      else setError(err.message);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const expiresAt = m?.holdExpiresAt;
  useEffect(() => {
    if (!expiresAt) return undefined;
    setSeconds(remaining(expiresAt));
    const timer = setInterval(() => setSeconds(remaining(expiresAt)), 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);

  useEffect(() => {
    if (seconds === 0) load();
  }, [seconds, load]);

  const act = async (path, body) => {
    setPending(true);
    setError('');
    try {
      setM((await api(`/memberships/${token}/${path}`, { method: 'POST', body })).membership);
    } catch (err) {
      setError(err.message);
      if (err.code === 'HOLD_EXPIRED') load();
    } finally {
      setPending(false);
    }
  };

  const chat = m && whatsappLink(venue?.whatsappNumber, fill(text.whatsappMessage, { membershipNo: m.membershipNo }));
  const waiting = m?.status === 'pending_payment';
  const confirmed = m?.status === 'active';

  return (
    <div className="booking-page">
      <div className="container container--narrow stack" style={{ '--stack-gap': '24px' }}>
        {missing && (
          <div role="alert">
            <Notice>{text.notFound}</Notice>
          </div>
        )}
        {!m && !missing && !error && <p className="meta muted">{text.loading}</p>}
        {error && (
          <div role="alert">
            <Notice>{error}</Notice>
          </div>
        )}
        {m && (
          <>
            <p className="overline">Membership {m.membershipNo}</p>
            <h1 className="display display--lg">{confirmed ? fill(text.welcomeTitle, { name: m.name }) : waiting ? text.heldTitle : m.status === 'cancelled' ? text.cancelledTitle : text.endedTitle}</h1>
            <section className="summary-card" aria-label="Membership summary">
              <p className="overline">{m.planName}</p>
              <div className="summary-card__lines">
                <p>From {formatLong(m.startsOn)}</p>
                <p>To {formatLong(m.endsOn)}</p>
              </div>
              <hr className="rule" />
              <div className="summary-card__price">
                <span>First month</span>
                <span className="summary-card__amount">{formatPaise(m.amountPaise)}</span>
              </div>
              {m.discountPaise > 0 && <p className="fine muted">Includes {formatPaise(m.discountPaise)} referral discount. Then {formatPaise(m.monthlyPaise)} a month.</p>}
            </section>
            {waiting && (
              <>
                <Notice>{text.testModeNotice}</Notice>
                <p className="lead" role="timer">
                  {text.timerBefore} <strong>{seconds === null ? '…' : clock(seconds)}</strong> {text.timerAfter}
                </p>
                <div className="button-row">
                  <Button icon={false} disabled={pending} aria-busy={pending} onClick={() => act('pay', { result: 'success' })}>
                    Pay {formatPaise(m.amountPaise)} (test)
                  </Button>
                  <Button variant="secondary" icon={false} disabled={pending} onClick={() => act('pay', { result: 'failure' })}>
                    Simulate a failed payment
                  </Button>
                </div>
                <button type="button" className="link-button fine" disabled={pending} onClick={() => act('release')}>
                  {text.releaseButton}
                </button>
              </>
            )}
            {confirmed && <Notice>{fill(text.numberNotice, { membershipNo: m.membershipNo })}</Notice>}
            {confirmed && m.referralCode && <Notice>{fill(text.referralNotice, { code: m.referralCode })}</Notice>}
            {!confirmed && !waiting && <p className="lead">{text.nothingCharged}</p>}
            <div className="button-row">
              {!confirmed && !waiting && <Button to="/membership">{text.seeButton}</Button>}
              {chat && <Button href={chat}>{text.whatsappButton}</Button>}
              <Button to="/contact?topic=regular-play" variant="secondary">
                {text.contactButton}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
