import { useState } from 'react';
import Button from '../components/Button';
import Dialog from '../components/Dialog';
import Notice from '../components/Notice';

/** A form in a dialog that stays open, showing the reason, if the server refuses. */
export default function SimpleFormDialog({ title, description, submitLabel, onSubmit, onClose, children }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError('');
    try {
      await onSubmit();
    } catch (err) {
      setError(err.message);
      setPending(false);
    }
  };

  return (
    <Dialog
      as="form"
      title={title}
      description={description}
      onSubmit={submit}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} icon={false}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" icon={false} disabled={pending} aria-busy={pending}>
            {pending ? 'Saving…' : submitLabel}
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
    </Dialog>
  );
}
