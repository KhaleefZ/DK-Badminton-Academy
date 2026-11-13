import { useState } from 'react';
import Button from '../components/Button';
import Notice from '../components/Notice';
import { api } from '../lib/api';
import { fill } from '../lib/site';
import { openCheckout, waitForPayment } from '../lib/payments';
import { formatPaise } from './schedule';

/**
 * The pay step for a held booking or membership. With a gateway set up it opens that gateway's
 * checkout; in local development the simulator's two buttons stand in for it.
 *
 * base: '/bookings/<token>' or '/memberships/<token>'; key: 'booking' or 'membership'.
 * text needs payButton, checking, slow, closed and unavailable.
 */
export default function PayButtons({ info, base, recordKey, amountPaise, text, onSettled, onExpired }) {
  const [phase, setPhase] = useState('idle'); // idle | paying | checking | slow
  const [error, setError] = useState('');
  const busy = phase === 'paying' || phase === 'checking';

  const fail = (err) => {
    setError(err.message);
    setPhase('idle');
    if (err.code === 'HOLD_EXPIRED') onExpired();
  };

  const simulate = async (result) => {
    setPhase('paying');
    setError('');
    try {
      onSettled((await api(`${base}/pay`, { method: 'POST', body: { result } }))[recordKey]);
    } catch (err) {
      fail(err);
    }
  };

  const pay = async () => {
    setPhase('paying');
    setError('');
    try {
      const started = await api(`${base}/checkout`, { method: 'POST' });
      // A free slot or month is confirmed without a payment.
      if (!started.checkout) return onSettled(started[recordKey]);
      const outcome = await openCheckout(started.checkout);
      setPhase('checking');
      const record = await waitForPayment(base, recordKey, { patient: outcome === 'done' });
      if (record.status !== 'pending_payment') return onSettled(record);
      if (outcome === 'done') return setPhase('slow');
      setPhase('idle');
      setError(text.closed);
    } catch (err) {
      fail(err);
    }
  };

  const checkAgain = async () => {
    setPhase('checking');
    try {
      const record = await waitForPayment(base, recordKey, { patient: false });
      if (record.status !== 'pending_payment') return onSettled(record);
      setPhase('slow');
    } catch (err) {
      fail(err);
    }
  };

  if (!info) return null;
  if (!info.online) return <Notice>{text.unavailable}</Notice>;

  return (
    <div className="stack" style={{ '--stack-gap': '12px' }}>
      {error && (
        <div role="alert">
          <Notice>{error}</Notice>
        </div>
      )}
      {phase === 'checking' && (
        <p className="meta" role="status">
          {text.checking}
        </p>
      )}
      {phase === 'slow' && (
        <div role="status" className="stack" style={{ '--stack-gap': '12px' }}>
          <Notice>{text.slow}</Notice>
          <div>
            <Button variant="secondary" icon={false} onClick={checkAgain}>
              Check again
            </Button>
          </div>
        </div>
      )}
      {info.via === 'simulator' ? (
        <div className="button-row">
          <Button icon={false} disabled={busy} aria-busy={busy} onClick={() => simulate('success')}>
            Pay {formatPaise(amountPaise)} (test)
          </Button>
          <Button variant="secondary" icon={false} disabled={busy} onClick={() => simulate('failure')}>
            Simulate a failed payment
          </Button>
        </div>
      ) : (
        phase !== 'slow' && (
          <div className="button-row">
            <Button icon={false} disabled={busy} aria-busy={busy} onClick={pay}>
              {fill(text.payButton, { amount: formatPaise(amountPaise) })}
            </Button>
          </div>
        )
      )}
    </div>
  );
}
