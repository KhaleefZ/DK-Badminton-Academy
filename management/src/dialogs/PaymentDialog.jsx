import { useState } from 'react';
import Button from '../components/Button';
import Dialog from '../components/Dialog';
import Field from '../components/Field';
import Notice from '../components/Notice';
import { api } from '../lib/api';
import { formatPaise, PAYMENT_LABELS, toPaise } from '../lib/format';

// Online payments arrive through the website, so staff only record what they took in person.
const METHODS = ['cash', 'upi'].map((value) => ({ value, label: PAYMENT_LABELS[value] }));

/** Records cash or UPI received at the venue. No money moves through this system. */
export default function PaymentDialog({ booking, onClose, onSaved }) {
  const [rupees, setRupees] = useState(String(booking.outstandingPaise / 100));
  const [method, setMethod] = useState('cash');
  const [reference, setReference] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [pending, setPending] = useState(false);
  const [serverError, setServerError] = useState('');

  const amountPaise = toPaise(rupees);
  const error = !(amountPaise > 0) ? 'Enter an amount above ₹0.' : amountPaise > booking.outstandingPaise ? `This booking owes ${formatPaise(booking.outstandingPaise)}.` : undefined;

  const submit = async (e) => {
    e.preventDefault();
    setSubmitted(true);
    if (error || pending) return;
    setPending(true);
    setServerError('');
    try {
      const result = await api(`/bookings/${booking.id}/payments`, { method: 'POST', body: { amountPaise, method, reference } });
      onSaved(result.payment);
    } catch (err) {
      setServerError(err.message);
      setPending(false);
    }
  };

  return (
    <Dialog
      as="form"
      onSubmit={submit}
      title={`Record payment · ${booking.bookingNo}`}
      description={`${booking.customer.name} owes ${formatPaise(booking.outstandingPaise)}.`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} icon={false}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" icon={false} disabled={pending} aria-busy={pending}>
            {pending ? 'Saving…' : 'Record payment'}
          </Button>
        </>
      }
    >
      {serverError && (
        <div role="alert" className="staff-dialog__alert">
          <Notice tone="warning">{serverError}</Notice>
        </div>
      )}
      <div className="form-grid">
        <Field label="Amount received (₹)" type="number" min="0" step="any" value={rupees} onChange={(e) => setRupees(e.target.value)} error={submitted ? error : undefined} />
        <Field as="select" label="Method" options={METHODS} value={method} onChange={(e) => setMethod(e.target.value)} />
        {method === 'upi' && (
          <div className="form-grid__full">
            <Field label="UPI reference (optional)" maxLength={100} autoComplete="off" value={reference} onChange={(e) => setReference(e.target.value)} />
          </div>
        )}
      </div>
    </Dialog>
  );
}
