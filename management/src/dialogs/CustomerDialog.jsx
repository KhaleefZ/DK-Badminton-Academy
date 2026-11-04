import { useState } from 'react';
import Button from '../components/Button';
import Dialog from '../components/Dialog';
import Field from '../components/Field';
import Notice from '../components/Notice';
import { api } from '../lib/api';

export default function CustomerDialog({ customer, onClose, onSaved }) {
  const [form, setForm] = useState({ name: customer?.name ?? '', phone: customer?.phone ?? '', email: customer?.email ?? '', notes: customer?.notes ?? '' });
  const [submitted, setSubmitted] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  const errors = {
    ...(!form.name.trim() && { name: 'Enter the customer’s name.' }),
    ...(!form.phone.trim() && { phone: 'Enter a phone number.' }),
  };

  const submit = async (e) => {
    e.preventDefault();
    setSubmitted(true);
    if (Object.keys(errors).length || pending) return;
    setPending(true);
    setError('');
    try {
      const result = customer ? await api(`/customers/${customer.id}`, { method: 'PATCH', body: form }) : await api('/customers', { method: 'POST', body: form });
      onSaved(result.customer);
    } catch (err) {
      setError(err.message);
      setPending(false);
    }
  };

  return (
    <Dialog
      title={customer ? `Edit ${customer.customerNo}` : 'Add walk-in customer'}
      description={customer ? undefined : 'They get a WLK number. Website customers are created when they book online.'}
      as="form"
      onSubmit={submit}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} icon={false}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" icon={false} disabled={pending} aria-busy={pending}>
            {pending ? 'Saving…' : 'Save customer'}
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
        <Field label="Full name" required autoComplete="off" value={form.name} onChange={set('name')} error={submitted ? errors.name : undefined} />
        <Field label="Phone" type="tel" required autoComplete="off" value={form.phone} onChange={set('phone')} error={submitted ? errors.phone : undefined} />
        <div className="form-grid__full">
          <Field label="Email (optional)" type="email" autoComplete="off" value={form.email} onChange={set('email')} />
        </div>
        <div className="form-grid__full">
          <Field as="textarea" label="Notes" maxLength={1000} value={form.notes} onChange={set('notes')} />
        </div>
      </div>
    </Dialog>
  );
}
