import { useEffect, useState } from 'react';
import Button from '../components/Button';
import Dialog from '../components/Dialog';
import Field from '../components/Field';
import Notice from '../components/Notice';
import { api } from '../lib/api';
import { endFromInput, endToInput, formatPaise, toPaise, venueToday } from '../lib/format';
import { useResource } from '../lib/useResource';

/** Finds an existing customer, or takes the details of a new walk-in. */
function CustomerPicker({ value, onChange, error }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);

  useEffect(() => {
    const q = query.trim();
    if (value.mode !== 'existing' || !q) return undefined;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api(`/customers?q=${encodeURIComponent(q)}`, { signal: controller.signal })
        .then(({ customers }) => setResults(customers.slice(0, 6)))
        .catch(() => {});
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, value.mode]);

  const setNew = (field) => (e) => onChange({ ...value, newCustomer: { ...value.newCustomer, [field]: e.target.value } });

  return (
    <div className="customer-picker form-grid__full">
      <div className="customer-picker__modes" role="radiogroup" aria-label="Customer">
        {[
          ['existing', 'Existing customer'],
          ['new', 'New walk-in'],
        ].map(([mode, label]) => (
          <label key={mode} className="day-check">
            <input type="radio" name="customer-mode" checked={value.mode === mode} onChange={() => onChange({ ...value, mode })} />
            <span>{label}</span>
          </label>
        ))}
      </div>
      {value.mode === 'new' ? (
        <div className="form-grid">
          <Field label="Customer name" required autoComplete="off" value={value.newCustomer.name} onChange={setNew('name')} error={error?.name} />
          <Field label="Customer phone" type="tel" required autoComplete="off" value={value.newCustomer.phone} onChange={setNew('phone')} error={error?.phone} />
        </div>
      ) : value.customer ? (
        <p className="customer-picker__chosen">
          <span>
            <strong>{value.customer.customerNo}</strong> · {value.customer.name} · {value.customer.phone}
          </span>
          <button type="button" className="link-button small" onClick={() => onChange({ ...value, customer: null })}>
            Change
          </button>
        </p>
      ) : (
        <>
          <Field label="Find customer" hint="Search by name, phone, email or number." autoComplete="off" value={query} onChange={(e) => setQuery(e.target.value)} error={error?.customer} />
          {query.trim() && (
            <ul className="customer-picker__results">
              {results.map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => onChange({ ...value, customer: c })}>
                    <strong>{c.customerNo}</strong> · {c.name} · {c.phone}
                  </button>
                </li>
              ))}
              {!results.length && <li className="muted small">No customers found. Choose “New walk-in” to add one.</li>}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

/** Add or edit a real booking. Pass `booking` to edit, `defaults` to prefill a new one. */
export default function BookingDialog({ booking, defaults = {}, onClose, onSaved }) {
  const { data: setup } = useResource('/settings');
  const activeCourts = setup?.courts.filter((c) => c.active || c.id === booking?.courtId) ?? [];
  const [form, setForm] = useState(() => ({
    date: booking?.date ?? defaults.date ?? venueToday(),
    courtId: booking?.courtId ?? defaults.courtId ?? '',
    start: booking?.start ?? defaults.start ?? '',
    end: endToInput(booking?.end ?? defaults.end ?? ''),
    rupees: booking ? String(booking.amountPaise / 100) : '',
    notes: booking?.notes ?? '',
  }));
  const [who, setWho] = useState({ mode: defaults.customer ? 'existing' : 'new', customer: defaults.customer ?? null, newCustomer: { name: '', phone: '' } });
  const [amountTouched, setAmountTouched] = useState(Boolean(booking));
  const [usualPrice, setUsualPrice] = useState(null);
  const [submitted, setSubmitted] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const courtId = form.courtId || activeCourts[0]?.id || '';
  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  // Fills in the usual price until staff type their own.
  useEffect(() => {
    if (!courtId || !form.date || !form.start || !form.end) return undefined;
    const controller = new AbortController();
    const params = new URLSearchParams({ courtId, date: form.date, start: form.start, end: endFromInput(form.end) });
    api(`/bookings/quote?${params}`, { signal: controller.signal })
      .then(({ pricePaise }) => {
        setUsualPrice(pricePaise);
        if (!amountTouched) setForm((f) => ({ ...f, rupees: pricePaise === null ? '' : String(pricePaise / 100) }));
      })
      .catch(() => setUsualPrice(null));
    return () => controller.abort();
  }, [courtId, form.date, form.start, form.end, amountTouched]);

  const whoErrors = booking
    ? {}
    : who.mode === 'new'
      ? { ...(!who.newCustomer.name.trim() && { name: 'Enter the customer’s name.' }), ...(!who.newCustomer.phone.trim() && { phone: 'Enter a phone number.' }) }
      : { ...(!who.customer && { customer: 'Choose a customer.' }) };
  const amountPaise = toPaise(form.rupees);
  const errors = {
    ...(!form.date && { date: 'Choose a date.' }),
    ...(!form.start && { start: 'Enter a start time.' }),
    ...(!form.end && { end: 'Enter an end time.' }),
    ...(amountPaise === null && { amount: 'Enter an amount.' }),
    ...(amountPaise < 0 && { amount: 'An amount can’t be negative.' }),
  };

  const submit = async (e) => {
    e.preventDefault();
    setSubmitted(true);
    if (Object.keys(errors).length || Object.keys(whoErrors).length || pending) return;
    setPending(true);
    setError('');
    const body = { courtId, date: form.date, start: form.start, end: endFromInput(form.end), amountPaise, notes: form.notes };
    try {
      const result = booking
        ? await api(`/bookings/${booking.id}`, { method: 'PATCH', body })
        : await api('/bookings', { method: 'POST', body: { ...body, ...(who.mode === 'new' ? { newCustomer: who.newCustomer } : { customerId: who.customer.id }) } });
      onSaved(result.booking);
    } catch (err) {
      setError(err.message);
      setPending(false);
    }
  };

  return (
    <Dialog
      as="form"
      onSubmit={submit}
      title={booking ? `Edit ${booking.bookingNo}` : 'Add booking'}
      description={booking ? `${booking.customer.name} · ${booking.customer.customerNo}` : 'The customer is sent a confirmation (WhatsApp, or email as a backup), and the owner numbers are told.'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} icon={false}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" icon={false} disabled={pending} aria-busy={pending}>
            {pending ? 'Saving…' : booking ? 'Save changes' : 'Add booking'}
          </Button>
        </>
      }
    >
      {error && (
        <div role="alert" className="staff-dialog__alert">
          <Notice tone="warning">{error}</Notice>
        </div>
      )}
      <div className="form-grid">
        {!booking && <CustomerPicker value={who} onChange={setWho} error={submitted ? whoErrors : undefined} />}
        <Field label="Date" type="date" required value={form.date} onChange={set('date')} error={submitted ? errors.date : undefined} />
        <Field as="select" label="Court" value={courtId} onChange={set('courtId')} options={activeCourts.map((c) => ({ value: c.id, label: c.name }))} />
        <Field label="Start · IST" type="time" required value={form.start} onChange={set('start')} error={submitted ? errors.start : undefined} />
        <Field label="End · IST" type="time" required hint="Use 00:00 for midnight." value={form.end} onChange={set('end')} error={submitted ? errors.end : undefined} />
        <Field
          label="Amount (₹)"
          type="number"
          min="0"
          step="any"
          hint={usualPrice === null ? 'No usual price for this time.' : `Usual price: ${formatPaise(usualPrice)}`}
          value={form.rupees}
          onChange={(e) => {
            setAmountTouched(true);
            set('rupees')(e);
          }}
          error={submitted ? errors.amount : undefined}
        />
        <div className="form-grid__full">
          <Field as="textarea" label="Notes" maxLength={1000} value={form.notes} onChange={set('notes')} />
        </div>
      </div>
    </Dialog>
  );
}
