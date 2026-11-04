import { useState } from 'react';
import Button from '../components/Button';
import Dialog from '../components/Dialog';
import Field from '../components/Field';
import Notice from '../components/Notice';

/** Confirms an API action, optionally asking for a reason, and stays open if the server refuses. */
export default function ActionDialog({ title, description, label, danger = true, reasonLabel, reasonRequired, onConfirm, onClose, children }) {
  const [reason, setReason] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const missing = reasonRequired && !reason.trim();

  const submit = async (e) => {
    e.preventDefault();
    setSubmitted(true);
    if (missing || pending) return;
    setPending(true);
    setError('');
    try {
      await onConfirm(reason);
    } catch (err) {
      setError(err.message);
      setPending(false);
    }
  };

  return (
    <Dialog
      title={title}
      description={description}
      as="form"
      onSubmit={submit}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} icon={false}>
            Keep as is
          </Button>
          <Button type="submit" variant={danger ? 'danger' : 'primary'} icon={false} disabled={pending} aria-busy={pending}>
            {pending ? 'Working…' : label}
          </Button>
        </>
      }
    >
      {error && (
        <div role="alert" className="staff-dialog__alert">
          <Notice tone="warning">{error}</Notice>
        </div>
      )}
      {children}
      {reasonLabel && <Field label={reasonLabel} required={reasonRequired} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} error={submitted && missing ? 'Enter a reason.' : undefined} />}
    </Dialog>
  );
}
