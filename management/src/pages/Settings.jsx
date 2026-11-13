import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import PageHeader from '../layout/PageHeader';
import Button from '../components/Button';
import Dialog from '../components/Dialog';
import Field from '../components/Field';
import Notice from '../components/Notice';
import Panel from '../components/Panel';
import PasswordField from '../components/PasswordField';
import StatusBadge from '../components/StatusBadge';
import { useCan } from '../auth/AuthContext';
import { useWorkspace } from '../store/WorkspaceContext';
import { api } from '../lib/api';
import { useResource } from '../lib/useResource';
import { endFromInput, endToInput, formatINR, venueToday } from '../lib/format';

// Monday first, as staff read a week; the server's weekday 0 is Sunday.
const WEEK = [
  { day: 1, name: 'Monday', short: 'Mon' },
  { day: 2, name: 'Tuesday', short: 'Tue' },
  { day: 3, name: 'Wednesday', short: 'Wed' },
  { day: 4, name: 'Thursday', short: 'Thu' },
  { day: 5, name: 'Friday', short: 'Fri' },
  { day: 6, name: 'Saturday', short: 'Sat' },
  { day: 0, name: 'Sunday', short: 'Sun' },
];
const SLOT_OPTIONS = [
  { value: '60', label: '60 minutes' },
  { value: '30', label: '30 minutes' },
];
const SLOT_LABELS = { free: 'Free', reserved: 'Reserved', closed: 'Closed', past: 'Past' };
const SLOT_TONES = { free: 'success', reserved: 'warning', closed: 'danger', past: 'tint' };

const venueClock = new Intl.DateTimeFormat('sv-SE', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Kolkata' });
const toLocalInput = (value) => (value ? venueClock.format(new Date(value)).replace(' ', 'T') : '');
const fromLocalInput = (value) => `${value}:00+05:30`;
const formatWhen = (value) => new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(value));

function FormAlert({ error }) {
  if (!error) return null;
  return (
    <div role="alert">
      <Notice tone="warning">{error}</Notice>
    </div>
  );
}

/** Runs a save, tracking pending and the message to show if it fails. */
function useSave() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const save = async (run) => {
    if (pending) return false;
    setPending(true);
    setError('');
    try {
      await run();
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setPending(false);
    }
  };
  return { pending, error, setError, save };
}

function VenuePanel({ venue, onSaved }) {
  const [form, setForm] = useState({
    venueName: venue.venueName,
    address: venue.address ?? '',
    phone: venue.phone ?? '',
    email: venue.email ?? '',
    slotMinutes: String(venue.slotMinutes),
    advanceBookingDays: String(venue.advanceBookingDays),
    minNoticeMinutes: String(venue.minNoticeMinutes),
    holdMinutes: String(venue.holdMinutes),
  });
  const { pending, error, save } = useSave();
  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    const body = {
      ...form,
      slotMinutes: Number(form.slotMinutes),
      advanceBookingDays: form.advanceBookingDays === '' ? undefined : Number(form.advanceBookingDays),
      minNoticeMinutes: form.minNoticeMinutes === '' ? undefined : Number(form.minNoticeMinutes),
      holdMinutes: form.holdMinutes === '' ? undefined : Number(form.holdMinutes),
    };
    if (await save(() => api('/settings', { method: 'PATCH', body }))) onSaved('Venue details saved.');
  };

  return (
    <Panel title="Venue and booking rules">
      <form className="settings-form" onSubmit={submit} noValidate>
        <FormAlert error={error} />
        <div className="form-grid">
          <Field label="Venue name" required value={form.venueName} onChange={set('venueName')} />
          <Field label="Phone" type="tel" value={form.phone} onChange={set('phone')} />
          <Field label="Email" type="email" value={form.email} onChange={set('email')} />
          <Field as="select" label="Slot length" options={SLOT_OPTIONS} value={form.slotMinutes} onChange={set('slotMinutes')} />
          <Field label="Website: days ahead" type="number" min="0" max="365" hint="How far ahead people can book online." value={form.advanceBookingDays} onChange={set('advanceBookingDays')} />
          <Field label="Website: notice (minutes)" type="number" min="0" hint="The shortest time before a slot starts." value={form.minNoticeMinutes} onChange={set('minNoticeMinutes')} />
          <Field label="Website: hold for payment (minutes)" type="number" min="2" max="60" hint="How long a slot waits while someone pays." value={form.holdMinutes} onChange={set('holdMinutes')} />
          <div className="form-grid__full">
            <Field as="textarea" label="Address" value={form.address} onChange={set('address')} />
          </div>
        </div>
        <div>
          <Button type="submit" variant="primary" icon={false} disabled={pending} aria-busy={pending}>
            {pending ? 'Saving…' : 'Save venue details'}
          </Button>
        </div>
      </form>
    </Panel>
  );
}

function MessagingPanel({ onSaved }) {
  const { data, error: loadError, reload } = useResource('/messages/settings');
  if (loadError) return <Panel title="Messages"><FormAlert error={loadError} /></Panel>;
  if (!data) return <Panel title="Messages"><p className="muted small">Loading…</p></Panel>;
  return <MessagingForm saved={data.settings} onSaved={(message) => { reload(); onSaved(message); }} />;
}

function MessagingForm({ saved, onSaved }) {
  const [form, setForm] = useState({
    emailEnabled: saved.emailEnabled,
    senderName: saved.senderName ?? '',
    senderEmail: saved.senderEmail ?? '',
    notifyEmail: saved.notifyEmail ?? '',
    dailyEmailLimit: String(saved.dailyEmailLimit),
    whatsappNumber: saved.whatsappNumber ?? '',
  });
  const [appPassword, setAppPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [testResult, setTestResult] = useState(null);
  const { pending, error, save } = useSave();
  const test = useSave();
  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  const senderChanged = form.senderEmail.trim().toLowerCase() !== (saved.senderEmail ?? '') || Boolean(appPassword);
  const ready = saved.senderEmail && saved.hasAppPassword;

  const submit = async (e) => {
    e.preventDefault();
    setTestResult(null);
    const body = { ...form, dailyEmailLimit: form.dailyEmailLimit === '' ? undefined : Number(form.dailyEmailLimit), appPassword, currentPassword };
    const ok = await save(() => api('/messages/settings', { method: 'PUT', body }));
    setCurrentPassword('');
    if (ok) {
      setAppPassword('');
      onSaved('Message settings saved.');
    }
  };

  const sendTest = () => {
    setTestResult(null);
    test.save(async () => {
      const { sentTo } = await api('/messages/settings/test', { method: 'POST' });
      setTestResult(sentTo);
    });
  };

  return (
    <Panel title="Messages" meta={<StatusBadge tone={ready && saved.emailEnabled ? 'success' : 'warning'}>{!saved.emailEnabled ? 'Email off' : ready ? 'Email ready' : 'No sender yet'}</StatusBadge>}>
      <form className="settings-form" onSubmit={submit} noValidate>
        <FormAlert error={error} />
        {!ready && <Notice tone="warning">Emails wait in the queue until you add a sender here. Nothing is lost unless the session passes first.</Notice>}
        <label className="day-check">
          <input type="checkbox" checked={form.emailEnabled} onChange={(e) => setForm((f) => ({ ...f, emailEnabled: e.target.checked }))} />
          <span>Send emails</span>
        </label>
        <div className="form-grid">
          <Field label="Sender name" hint="The name customers see." maxLength={80} autoComplete="off" value={form.senderName} onChange={set('senderName')} />
          <Field label="Sender Gmail address" type="email" autoComplete="off" value={form.senderEmail} onChange={set('senderEmail')} />
          <PasswordField
            label="Gmail app password"
            autoComplete="new-password"
            hint={saved.hasAppPassword ? 'One is saved. Leave blank to keep it.' : 'Made in your Google account under 2-Step Verification. Not your normal Gmail password.'}
            value={appPassword}
            onChange={(e) => setAppPassword(e.target.value)}
          />
          <Field label="Send staff alerts to" type="email" hint="New website bookings and enquiries. Blank uses the sender." autoComplete="off" value={form.notifyEmail} onChange={set('notifyEmail')} />
          <Field label="Emails per day, at most" type="number" min="1" max="2000" hint="Extra emails wait for the next day." value={form.dailyEmailLimit} onChange={set('dailyEmailLimit')} />
          <Field label="WhatsApp number" type="tel" hint="Shown on the website for customers to message you." autoComplete="off" value={form.whatsappNumber} onChange={set('whatsappNumber')} />
          {senderChanged && (
            <div className="form-grid__full">
              <PasswordField label="Your password" autoComplete="current-password" required hint="Changing the sender needs your own password." value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
            </div>
          )}
        </div>
        <FormAlert error={test.error} />
        {testResult && (
          <div role="status">
            <Notice>Test email sent to {testResult}. Check that inbox, including spam.</Notice>
          </div>
        )}
        <div className="settings-form__actions">
          <Button type="submit" variant="primary" icon={false} disabled={pending} aria-busy={pending}>
            {pending ? 'Saving…' : 'Save message settings'}
          </Button>
          <Button icon={false} onClick={sendTest} disabled={test.pending} aria-busy={test.pending}>
            {test.pending ? 'Sending…' : 'Send test email'}
          </Button>
        </div>
      </form>
    </Panel>
  );
}

const GATEWAY_OPTIONS = [
  { value: '', label: 'Not set up' },
  { value: 'cashfree', label: 'Cashfree' },
  { value: 'razorpay', label: 'Razorpay' },
];
const MODE_OPTIONS = [
  { value: 'test', label: 'Test (sandbox, no real money)' },
  { value: 'live', label: 'Live (real payments)' },
];
// What each gateway calls its keys, and which webhook events to tick in its dashboard.
const GATEWAY_HELP = {
  cashfree: { keyId: 'App ID', keySecret: 'Secret key', events: 'Payment success and Payment failed' },
  razorpay: { keyId: 'Key ID', keySecret: 'Key Secret', events: 'payment.captured and payment.failed' },
};

function PaymentsPanel({ onSaved }) {
  const { data, error: loadError, reload } = useResource('/settings/payments');
  if (loadError) return <Panel title="Online payments"><FormAlert error={loadError} /></Panel>;
  if (!data) return <Panel title="Online payments"><p className="muted small">Loading…</p></Panel>;
  return <PaymentsForm key={JSON.stringify(data.settings)} saved={data.settings} onSaved={(message) => { reload(); onSaved(message); }} />;
}

function PaymentsForm({ saved, onSaved }) {
  const [form, setForm] = useState({ enabled: saved.enabled, gateway: saved.gateway ?? '', mode: saved.mode, keyId: saved.keyId ?? '' });
  const [keySecret, setKeySecret] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [checked, setChecked] = useState(false);
  const { pending, error, save } = useSave();
  const check = useSave();
  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  const help = GATEWAY_HELP[form.gateway];
  // A different gateway's keys aren't kept, so new ones must be typed in.
  const keepsSecrets = form.gateway === (saved.gateway ?? '');

  const submit = async (e) => {
    e.preventDefault();
    setChecked(false);
    const body = { ...form, gateway: form.gateway || null, keyId: form.keyId || null, keySecret, webhookSecret, currentPassword };
    const ok = await save(() => api('/settings/payments', { method: 'PUT', body }));
    setCurrentPassword('');
    if (ok) onSaved(form.enabled ? `Online payments are on (${form.mode === 'live' ? 'live' : 'test'}).` : 'Payment settings saved.');
  };

  const checkKeys = () => {
    setChecked(false);
    check.save(async () => {
      await api('/settings/payments/check', { method: 'POST' });
      setChecked(true);
    });
  };

  const badge = saved.enabled ? (saved.mode === 'live' ? ['success', 'On · Live'] : ['warning', 'On · Test']) : ['tint', 'Off'];

  return (
    <Panel title="Online payments" meta={<StatusBadge tone={badge[0]}>{badge[1]}</StatusBadge>}>
      <form className="settings-form" onSubmit={submit} noValidate>
        <FormAlert error={error} />
        {!saved.enabled && saved.simulator && <Notice>While this is off, the website shows test “Pay” buttons (local development only). On the live site it says online payment isn’t available.</Notice>}
        <ol className="fine muted settings-steps">
          <li>Get your keys from the gateway’s dashboard (Developers / API keys). Use the test keys first.</li>
          <li>Choose the gateway and Test or Live, paste the keys and your password, then save.</li>
          {form.gateway === 'razorpay' ? (
            <li>
              In Razorpay, add a webhook to the address below with the events {help.events}, and make up a secret for it. Enter the same secret here.
            </li>
          ) : (
            <li>Cashfree is told the address below with every payment. You can also add it in Cashfree’s webhook settings.</li>
          )}
          <li>Press Check connection, then tick Take payments online and save.</li>
        </ol>
        <div className="form-grid">
          <Field as="select" label="Gateway" options={GATEWAY_OPTIONS} value={form.gateway} onChange={set('gateway')} />
          <Field as="select" label="Mode" options={MODE_OPTIONS} value={form.mode} onChange={set('mode')} />
          {help && (
            <>
              <Field label={help.keyId} autoComplete="off" spellCheck={false} value={form.keyId} onChange={set('keyId')} />
              <PasswordField
                label={help.keySecret}
                autoComplete="new-password"
                hint={keepsSecrets && saved.hasKeySecret ? 'One is saved. Leave blank to keep it.' : 'Never shown again after saving.'}
                value={keySecret}
                onChange={(e) => setKeySecret(e.target.value)}
              />
              {form.gateway === 'razorpay' && (
                <PasswordField
                  label="Webhook secret"
                  autoComplete="new-password"
                  hint={keepsSecrets && saved.hasWebhookSecret ? 'One is saved. Leave blank to keep it.' : 'The secret you typed when creating the webhook in Razorpay.'}
                  value={webhookSecret}
                  onChange={(e) => setWebhookSecret(e.target.value)}
                />
              )}
              <div className="form-grid__full">
                <Field label="Webhook address (copy into the gateway)" readOnly value={saved.webhookUrl} onFocus={(e) => e.target.select()} />
              </div>
            </>
          )}
          <div className="form-grid__full">
            <label className="day-check">
              <input type="checkbox" checked={form.enabled} onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))} />
              <span>Take payments online{form.mode === 'live' ? ' (real money)' : ''}</span>
            </label>
          </div>
          <div className="form-grid__full">
            <PasswordField label="Your password" autoComplete="current-password" required hint="Payment settings always need your own password." value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
          </div>
        </div>
        <FormAlert error={check.error} />
        {checked && (
          <div role="status">
            <Notice>The saved keys work.</Notice>
          </div>
        )}
        <div className="settings-form__actions">
          <Button type="submit" variant="primary" icon={false} disabled={pending} aria-busy={pending}>
            {pending ? 'Saving…' : 'Save payment settings'}
          </Button>
          {saved.gateway && saved.hasKeySecret && (
            <Button icon={false} onClick={checkKeys} disabled={check.pending} aria-busy={check.pending}>
              {check.pending ? 'Checking…' : 'Check connection'}
            </Button>
          )}
        </div>
      </form>
    </Panel>
  );
}

function CourtDialog({ court, onClose, onSaved }) {
  const [name, setName] = useState(court?.name ?? '');
  const [submitted, setSubmitted] = useState(false);
  const { pending, error, save } = useSave();

  const submit = async (e) => {
    e.preventDefault();
    setSubmitted(true);
    if (!name.trim()) return;
    const request = () => (court ? api(`/settings/courts/${court.id}`, { method: 'PATCH', body: { name } }) : api('/settings/courts', { method: 'POST', body: { name } }));
    if (await save(request)) onSaved(court ? 'Court renamed.' : 'Court added.');
  };

  return (
    <Dialog
      title={court ? `Rename ${court.name}` : 'Add court'}
      as="form"
      onSubmit={submit}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} icon={false}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" icon={false} disabled={pending} aria-busy={pending}>
            {pending ? 'Saving…' : 'Save court'}
          </Button>
        </>
      }
    >
      <FormAlert error={error} />
      <Field label="Court name" required autoFocus value={name} onChange={(e) => setName(e.target.value)} error={submitted && !name.trim() ? 'Enter a court name.' : undefined} />
    </Dialog>
  );
}

function ConfirmDialog({ title, description, label, onClose, onConfirm }) {
  const { pending, error, save } = useSave();
  return (
    <Dialog
      title={title}
      description={description}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} icon={false}>
            Cancel
          </Button>
          <Button variant="danger" icon={false} disabled={pending} aria-busy={pending} onClick={() => save(onConfirm)}>
            {pending ? 'Working…' : label}
          </Button>
        </>
      }
    >
      <FormAlert error={error} />
    </Dialog>
  );
}

function CourtsPanel({ courts, onChanged, onEdit, onDelete, onError }) {
  const toggle = async (court) => {
    try {
      await api(`/settings/courts/${court.id}/${court.active ? 'deactivate' : 'activate'}`, { method: 'POST' });
      onChanged(court.active ? 'Court deactivated.' : 'Court activated.');
    } catch (err) {
      onError(err.message);
    }
  };
  return (
    <Panel title="Courts" meta={`${courts.filter((c) => c.active).length} active`}>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Court</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {courts.map((court) => (
              <tr key={court.id}>
                <td className="data-table__key">{court.name}</td>
                <td>
                  <StatusBadge tone={court.active ? 'success' : 'tint'}>{court.active ? 'Active' : 'Inactive'}</StatusBadge>
                </td>
                <td>
                  <div className="staff-actions">
                    <button type="button" className="link-button small" onClick={() => onEdit(court)}>
                      Rename
                    </button>
                    <button type="button" className="link-button small" onClick={() => toggle(court)}>
                      {court.active ? 'Deactivate' : 'Activate'}
                    </button>
                    <button type="button" className="link-button small" onClick={() => onDelete(court)}>
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="settings-form__actions">
        <Button icon={false} onClick={() => onEdit('new')}>
          Add court
        </Button>
      </div>
    </Panel>
  );
}

const newRowKey = () => crypto.randomUUID();

function HoursPanel({ hours, onSaved }) {
  const [rows, setRows] = useState(() => hours.map((h) => ({ ...h, closes: endToInput(h.closes), key: newRowKey() })));
  const { pending, error, save } = useSave();

  const change = (key, field, value) => setRows((all) => all.map((r) => (r.key === key ? { ...r, [field]: value } : r)));
  const add = (weekday) => setRows((all) => [...all, { weekday, opens: '', closes: '', key: newRowKey() }]);
  const remove = (key) => setRows((all) => all.filter((r) => r.key !== key));
  const copyMonday = () =>
    setRows((all) => {
      const monday = all.filter((r) => r.weekday === 1);
      return WEEK.flatMap(({ day }) => monday.map((r) => ({ ...r, weekday: day, key: day === 1 ? r.key : newRowKey() })));
    });

  const submit = async (e) => {
    e.preventDefault();
    const body = { hours: rows.map(({ weekday, opens, closes }) => ({ weekday, opens, closes: endFromInput(closes) })) };
    if (await save(() => api('/settings/hours', { method: 'PUT', body }))) onSaved('Opening hours saved.');
  };

  return (
    <Panel title="Opening hours" meta={rows.length ? 'Applies to all courts' : 'Not set'}>
      <form className="settings-form" onSubmit={submit} noValidate>
        <FormAlert error={error} />
        {!rows.length && <Notice tone="warning">No hours yet, so no slots can be booked. Add the venue’s real times.</Notice>}
        <div className="hours-list">
          {WEEK.map(({ day, name }) => {
            const periods = rows.filter((r) => r.weekday === day);
            return (
              <div className="hours-day" key={day}>
                <strong className="hours-day__name">{name}</strong>
                <div className="hours-day__periods">
                  {!periods.length && <span className="muted small">Closed</span>}
                  {periods.map((p) => (
                    <div className="hours-period" key={p.key}>
                      <input className="field__control" type="time" aria-label={`${name} opens`} value={p.opens} onChange={(e) => change(p.key, 'opens', e.target.value)} />
                      <span aria-hidden="true">to</span>
                      <input className="field__control" type="time" aria-label={`${name} closes`} value={p.closes} onChange={(e) => change(p.key, 'closes', e.target.value)} />
                      <button type="button" className="link-button small" onClick={() => remove(p.key)} aria-label={`Remove ${name} period`}>
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
                <button type="button" className="link-button small" onClick={() => add(day)} aria-label={`Add ${name} period`}>
                  Add time
                </button>
              </div>
            );
          })}
        </div>
        <p className="muted small">Use 00:00 as the closing time for midnight. Bookings that already exist aren’t changed by new hours.</p>
        <div className="settings-form__actions">
          <Button type="submit" variant="primary" icon={false} disabled={pending} aria-busy={pending}>
            {pending ? 'Saving…' : 'Save hours'}
          </Button>
          <Button icon={false} onClick={copyMonday} disabled={!rows.some((r) => r.weekday === 1)}>
            Copy Monday to every day
          </Button>
        </div>
      </form>
    </Panel>
  );
}

function PricesPanel({ prices, courts, onSaved }) {
  const [rows, setRows] = useState(() =>
    prices.map((p) => ({ key: newRowKey(), courtId: p.courtId ?? '', days: p.days, start: p.start, end: endToInput(p.end), rupees: String(p.ratePaise / 100) })),
  );
  const { pending, error, setError, save } = useSave();
  const courtOptions = [{ value: '', label: 'All courts' }, ...courts.map((c) => ({ value: c.id, label: c.name }))];

  const change = (key, field, value) => setRows((all) => all.map((r) => (r.key === key ? { ...r, [field]: value } : r)));
  const toggleDay = (row, day) => change(row.key, 'days', row.days.includes(day) ? row.days.filter((d) => d !== day) : [...row.days, day]);
  const add = () => setRows((all) => [...all, { key: newRowKey(), courtId: '', days: WEEK.map((w) => w.day), start: '', end: '', rupees: '' }]);

  const submit = async (e) => {
    e.preventDefault();
    if (rows.some((r) => r.rupees.trim() === '' || !Number.isFinite(Number(r.rupees)))) {
      setError('Enter a price for each row.');
      return;
    }
    const rules = rows.map((r) => ({ courtId: r.courtId || null, days: r.days, start: r.start, end: endFromInput(r.end), ratePaise: Math.round(Number(r.rupees) * 100) }));
    if (await save(() => api('/settings/prices', { method: 'PUT', body: { rules } }))) onSaved('Prices saved.');
  };

  return (
    <Panel title="Court prices" meta="Per court, per hour">
      <form className="settings-form" onSubmit={submit} noValidate>
        <FormAlert error={error} />
        {!rows.length && <Notice tone="warning">No prices yet, so slots can’t be booked online.</Notice>}
        {rows.map((row, i) => (
          <fieldset className="price-row" key={row.key}>
            <legend className="visually-hidden">Price {i + 1}</legend>
            <div className="price-row__fields">
              <Field as="select" label="Court" options={courtOptions} value={row.courtId} onChange={(e) => change(row.key, 'courtId', e.target.value)} />
              <Field label="From" type="time" value={row.start} onChange={(e) => change(row.key, 'start', e.target.value)} />
              <Field label="To" type="time" value={row.end} onChange={(e) => change(row.key, 'end', e.target.value)} />
              <Field label="₹ per hour" type="number" min="0" step="any" value={row.rupees} onChange={(e) => change(row.key, 'rupees', e.target.value)} />
              <button type="button" className="link-button small price-row__remove" onClick={() => setRows((all) => all.filter((r) => r.key !== row.key))}>
                Remove
              </button>
            </div>
            <div className="price-row__days">
              {WEEK.map(({ day, short, name }) => (
                <label key={day} className="day-check">
                  <input type="checkbox" aria-label={`${name}, price ${i + 1}`} checked={row.days.includes(day)} onChange={() => toggleDay(row, day)} />
                  <span>{short}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ))}
        <p className="muted small">A price for one court replaces the “All courts” price at that time. Use 00:00 in “To” for midnight. A booked slot keeps its price if you change these later.</p>
        <div className="settings-form__actions">
          <Button type="submit" variant="primary" icon={false} disabled={pending} aria-busy={pending}>
            {pending ? 'Saving…' : 'Save prices'}
          </Button>
          <Button icon={false} onClick={add}>
            Add price
          </Button>
        </div>
      </form>
    </Panel>
  );
}

function ClosureDialog({ closure, courts, onClose, onSaved }) {
  const [form, setForm] = useState({
    courtId: closure?.courtId ?? '',
    startsAt: toLocalInput(closure?.startsAt),
    endsAt: toLocalInput(closure?.endsAt),
    reason: closure?.reason ?? '',
  });
  const [submitted, setSubmitted] = useState(false);
  const { pending, error, save } = useSave();
  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  const courtOptions = [{ value: '', label: 'Whole venue' }, ...courts.map((c) => ({ value: c.id, label: c.name }))];

  const submit = async (e) => {
    e.preventDefault();
    setSubmitted(true);
    if (!form.startsAt || !form.endsAt) return;
    const body = { courtId: form.courtId || null, startsAt: fromLocalInput(form.startsAt), endsAt: fromLocalInput(form.endsAt), reason: form.reason };
    let result;
    const ok = await save(async () => {
      result = closure ? await api(`/settings/closures/${closure.id}`, { method: 'PATCH', body }) : await api('/settings/closures', { method: 'POST', body });
    });
    if (ok) onSaved(result.conflicts);
  };

  return (
    <Dialog
      title={closure ? 'Edit closure' : 'Add closure'}
      description="Slots in this period can’t be booked. Times are India time."
      as="form"
      onSubmit={submit}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} icon={false}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" icon={false} disabled={pending} aria-busy={pending}>
            {pending ? 'Saving…' : 'Save closure'}
          </Button>
        </>
      }
    >
      <FormAlert error={error} />
      <div className="form-grid">
        <div className="form-grid__full">
          <Field as="select" label="What’s closed" options={courtOptions} value={form.courtId} onChange={set('courtId')} />
        </div>
        <Field label="From" type="datetime-local" required value={form.startsAt} onChange={set('startsAt')} error={submitted && !form.startsAt ? 'Enter a start date and time.' : undefined} />
        <Field label="To" type="datetime-local" required value={form.endsAt} onChange={set('endsAt')} error={submitted && !form.endsAt ? 'Enter an end date and time.' : undefined} />
        <div className="form-grid__full">
          <Field label="Reason (optional)" maxLength={200} value={form.reason} onChange={set('reason')} />
        </div>
      </div>
    </Dialog>
  );
}

function ClosuresPanel({ closures, courts, onEdit, onDelete, conflicts }) {
  const courtName = (id) => (id ? (courts.find((c) => c.id === id)?.name ?? 'Court') : 'Whole venue');
  return (
    <Panel title="Closures" meta={`${closures.length} upcoming`}>
      {conflicts?.length > 0 && (
        <div role="alert" className="settings-panel-alert">
          <Notice tone="warning">
            This closure overlaps {conflicts.length} existing {conflicts.length === 1 ? 'reservation' : 'reservations'}, which {conflicts.length === 1 ? 'is' : 'are'} still active:{' '}
            {conflicts.map((c) => `${c.courtName}, ${formatWhen(c.startsAt)}`).join('; ')}. Contact those customers and move or cancel them.
          </Notice>
        </div>
      )}
      {closures.length > 0 ? (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>What’s closed</th>
                <th>From</th>
                <th>To</th>
                <th>Reason</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {closures.map((closure) => (
                <tr key={closure.id}>
                  <td className="data-table__key">{courtName(closure.courtId)}</td>
                  <td>{formatWhen(closure.startsAt)}</td>
                  <td>{formatWhen(closure.endsAt)}</td>
                  <td>{closure.reason || '—'}</td>
                  <td>
                    <div className="staff-actions">
                      <button type="button" className="link-button small" onClick={() => onEdit(closure)}>
                        Edit
                      </button>
                      <button type="button" className="link-button small" onClick={() => onDelete(closure)}>
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted small settings-empty">No upcoming closures.</p>
      )}
      <div className="settings-form__actions">
        <Button icon={false} onClick={() => onEdit('new')}>
          Add closure
        </Button>
      </div>
    </Panel>
  );
}

/** What the saved settings actually produce for one date. */
function AvailabilityPanel({ version }) {
  const [date, setDate] = useState(venueToday);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!date) return undefined;
    const controller = new AbortController();
    setError('');
    api(`/availability?date=${date}`, { signal: controller.signal })
      .then(setData)
      .catch((err) => {
        if (err.name !== 'AbortError') {
          setData(null);
          setError(err.message);
        }
      });
    return () => controller.abort();
  }, [date, version]);

  return (
    <Panel title="Check availability" meta="From your saved settings">
      <div className="settings-form">
        <div className="availability-date">
          <Field label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <FormAlert error={error} />
        {data?.courts.map((court) => (
          <section key={court.id} className="availability-court">
            <h3 className="availability-court__name">{court.name}</h3>
            {court.slots.length ? (
              <ul className="slot-list">
                {court.slots.map((slot) => (
                  <li key={slot.start} className="slot-item">
                    <strong>
                      {slot.start}–{slot.end}
                    </strong>
                    <StatusBadge tone={SLOT_TONES[slot.status]}>{SLOT_LABELS[slot.status]}</StatusBadge>
                    <span className="muted small">{slot.pricePaise === null ? 'No price' : formatINR(slot.pricePaise / 100)}</span>
                    {slot.closureReason && <span className="muted small">{slot.closureReason}</span>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted small">Closed on this day.</p>
            )}
          </section>
        ))}
      </div>
    </Panel>
  );
}

export default function Settings() {
  const { notify } = useWorkspace();
  const can = useCan();
  const [data, setData] = useState(null);
  const [version, setVersion] = useState(0);
  const [loadError, setLoadError] = useState('');
  const [pageError, setPageError] = useState('');
  const [editingCourt, setEditingCourt] = useState(null);
  const [deletingCourt, setDeletingCourt] = useState(null);
  const [editingClosure, setEditingClosure] = useState(null);
  const [deletingClosure, setDeletingClosure] = useState(null);
  const [conflicts, setConflicts] = useState(null);

  const load = useCallback(async () => {
    setLoadError('');
    try {
      setData(await api('/settings'));
      setVersion((v) => v + 1);
    } catch (err) {
      setLoadError(err.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const saved = (message) => {
    setPageError('');
    notify(message);
    load();
  };

  return (
    <>
      <PageHeader title="Settings" subtitle="Venue details, messages, online payments, courts, hours, prices and closures." />

      {loadError && (
        <div role="alert">
          <Notice tone="warning">{loadError}</Notice>
        </div>
      )}
      {pageError && (
        <div role="alert">
          <Notice tone="warning">{pageError}</Notice>
        </div>
      )}
      {!data && !loadError && <p className="muted small">Loading…</p>}

      {data && (
        <div className="settings-stack">
          <VenuePanel venue={data.settings} onSaved={saved} />
          <MessagingPanel onSaved={saved} />
          {can('settings.manage') && <PaymentsPanel onSaved={saved} />}
          <CourtsPanel courts={data.courts} onChanged={saved} onEdit={setEditingCourt} onDelete={setDeletingCourt} onError={setPageError} />
          <HoursPanel hours={data.hours} onSaved={saved} />
          {/* Remounts when courts change, so a row can't keep pointing at a deleted court. */}
          <PricesPanel key={data.courts.map((c) => c.id).join()} prices={data.prices} courts={data.courts} onSaved={saved} />
          <ClosuresPanel closures={data.closures} courts={data.courts} conflicts={conflicts} onEdit={setEditingClosure} onDelete={setDeletingClosure} />
          <AvailabilityPanel version={version} />
        </div>
      )}

      <AnimatePresence>
        {editingCourt && (
          <CourtDialog
            key="court"
            court={editingCourt === 'new' ? null : editingCourt}
            onClose={() => setEditingCourt(null)}
            onSaved={(message) => {
              setEditingCourt(null);
              saved(message);
            }}
          />
        )}
        {deletingCourt && (
          <ConfirmDialog
            key="delete-court"
            title={`Delete ${deletingCourt.name}?`}
            description="Its own prices and closures are deleted too. A court with reservation history can only be deactivated."
            label="Delete court"
            onClose={() => setDeletingCourt(null)}
            onConfirm={async () => {
              await api(`/settings/courts/${deletingCourt.id}`, { method: 'DELETE' });
              setDeletingCourt(null);
              saved('Court deleted.');
            }}
          />
        )}
        {editingClosure && (
          <ClosureDialog
            key="closure"
            closure={editingClosure === 'new' ? null : editingClosure}
            courts={data.courts}
            onClose={() => setEditingClosure(null)}
            onSaved={(found) => {
              setEditingClosure(null);
              setConflicts(found);
              saved('Closure saved.');
            }}
          />
        )}
        {deletingClosure && (
          <ConfirmDialog
            key="delete-closure"
            title="Delete this closure?"
            description="These times become bookable again."
            label="Delete closure"
            onClose={() => setDeletingClosure(null)}
            onConfirm={async () => {
              await api(`/settings/closures/${deletingClosure.id}`, { method: 'DELETE' });
              setDeletingClosure(null);
              setConflicts(null);
              saved('Closure deleted.');
            }}
          />
        )}
      </AnimatePresence>
    </>
  );
}
