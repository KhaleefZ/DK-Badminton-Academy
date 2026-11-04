import { useState } from 'react';
import Button from '../components/Button';
import Dialog from '../components/Dialog';
import Field from '../components/Field';
import Notice from '../components/Notice';
import { api } from '../lib/api';
import { BLOCK_LABELS, endFromInput, endToInput, venueToday } from '../lib/format';

const KINDS = Object.entries(BLOCK_LABELS).map(([value, label]) => ({ value, label }));

/** Holds court time without a customer, such as a members' batch or maintenance. */
export default function BlockDialog({ block, defaults = {}, courts, onClose, onSaved }) {
  const [form, setForm] = useState({
    kind: block?.kind ?? 'member_block',
    note: block?.note ?? '',
    courtId: block?.courtId ?? defaults.courtId ?? courts[0]?.id ?? '',
    date: block?.date ?? defaults.date ?? venueToday(),
    start: block?.start ?? defaults.start ?? '',
    end: endToInput(block?.end ?? defaults.end ?? ''),
    repeatWeeks: '1',
  });
  const [submitted, setSubmitted] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  const errors = {
    ...(!form.note.trim() && { note: 'Enter a label for this block.' }),
    ...(!form.date && { date: 'Choose a date.' }),
    ...(!form.start && { start: 'Enter a start time.' }),
    ...(!form.end && { end: 'Enter an end time.' }),
  };

  const submit = async (e) => {
    e.preventDefault();
    setSubmitted(true);
    if (Object.keys(errors).length || pending) return;
    setPending(true);
    setError('');
    const body = { ...form, end: endFromInput(form.end), repeatWeeks: Number(form.repeatWeeks) || 1 };
    try {
      const result = block ? await api(`/blocks/${block.id}`, { method: 'PATCH', body }) : await api('/blocks', { method: 'POST', body });
      onSaved(result);
    } catch (err) {
      setError(err.message);
      setPending(false);
    }
  };

  return (
    <Dialog
      as="form"
      onSubmit={submit}
      title={block ? 'Edit block' : 'Block court time'}
      description="Nobody can book this time, online or at the desk."
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} icon={false}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" icon={false} disabled={pending} aria-busy={pending}>
            {pending ? 'Saving…' : 'Save block'}
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
        <Field as="select" label="Block for" options={KINDS} value={form.kind} onChange={set('kind')} />
        <Field label="Label" required maxLength={200} hint="For example, Morning batch." value={form.note} onChange={set('note')} error={submitted ? errors.note : undefined} />
        <Field as="select" label="Court" options={courts.map((c) => ({ value: c.id, label: c.name }))} value={form.courtId} onChange={set('courtId')} />
        <Field label="Date" type="date" required value={form.date} onChange={set('date')} error={submitted ? errors.date : undefined} />
        <Field label="Start · IST" type="time" required value={form.start} onChange={set('start')} error={submitted ? errors.start : undefined} />
        <Field label="End · IST" type="time" required hint="Use 00:00 for midnight." value={form.end} onChange={set('end')} error={submitted ? errors.end : undefined} />
        {!block && (
          <Field label="Repeat for (weeks)" type="number" min="1" max="26" hint="Same day and time each week. If any week clashes, none are created." value={form.repeatWeeks} onChange={set('repeatWeeks')} />
        )}
      </div>
    </Dialog>
  );
}
