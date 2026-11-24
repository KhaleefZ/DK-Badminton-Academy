import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AnimatePresence } from 'motion/react';
import PageHeader from '../layout/PageHeader';
import Button from '../components/Button';
import Field from '../components/Field';
import KpiTile, { KpiRow } from '../components/KpiTile';
import Notice from '../components/Notice';
import Panel from '../components/Panel';
import StatusBadge from '../components/StatusBadge';
import Pagination, { usePagination } from '../components/Pagination';
import { EmptyState } from '../components/States';
import { FilterBar, SearchFilter, SelectFilter, toOptions } from '../components/Filters';
import ActionDialog from '../dialogs/ActionDialog';
import DayPicker from '../dialogs/DayPicker';
import SimpleFormDialog from '../dialogs/SimpleFormDialog';
import { useCan } from '../auth/AuthContext';
import { useWorkspace } from '../store/WorkspaceContext';
import { api } from '../lib/api';
import { CHANNEL_LABELS, endFromInput, endToInput, formatDate, formatDays, formatInstant, formatPaise, MESSAGE_LABELS, MESSAGE_STATUS, MESSAGE_TONES, PAYMENT_LABELS, toPaise, venueToday } from '../lib/format';
import { useResource } from '../lib/useResource';
import ViewTabs from '../components/ViewTabs';
import { PEOPLE } from '../layout/sections';

const KIND_OPTIONS = [
  { value: 'all', label: 'All memberships' },
  { value: 'individual', label: 'Individual (MEM)' },
  { value: 'court', label: 'Court (CRT)' },
];
const STATES = ['Active', 'Expiring', 'Expired', 'Held', 'Cancelled', 'Lapsed'];

const DAY_MS = 86_400_000;
const dayNumber = (iso) => Date.UTC(...iso.split('-').map((n, i) => Number(n) - (i === 1 ? 1 : 0))) / DAY_MS;

/**
 * How far a membership is from its end date, for people to read: "12 days left", "Ends tomorrow",
 * "Ended 3 days ago". `tone` drives the colour. The last day itself is still a playing day.
 */
export function endCountdown(endsOn, today = venueToday()) {
  const days = dayNumber(endsOn) - dayNumber(today);
  const plural = (n) => `${n} day${n === 1 ? '' : 's'}`;
  if (days > 7) return { days, tone: 'ok', text: `${plural(days)} left` };
  if (days > 1) return { days, tone: 'soon', text: `Ends in ${plural(days)}` };
  if (days === 1) return { days, tone: 'soon', text: 'Ends tomorrow' };
  if (days === 0) return { days, tone: 'soon', text: 'Last day today' };
  return { days, tone: 'ended', text: `Ended ${plural(-days)} ago` };
}

/** Renewal is the next step from a week before the end date onwards. */
const needsRenewal = (m) => m.status === 'active' && endCountdown(m.endsOn).days <= 7;
const METHODS = ['cash', 'upi'].map((value) => ({ value, label: PAYMENT_LABELS[value] }));

function CourtTimeFields({ form, set, days, setDays, courts, courtIds, setCourtIds }) {
  const toggle = (id) => setCourtIds(courtIds.includes(id) ? courtIds.filter((c) => c !== id) : [...courtIds, id]);
  return (
    <>
      <fieldset className="day-picker form-grid__full">
        <legend className="field__label">Courts</legend>
        <div className="price-row__days">
          {courts.map((c) => (
            <label key={c.id} className="day-check">
              <input type="checkbox" checked={courtIds.includes(c.id)} onChange={() => toggle(c.id)} />
              <span>{c.name}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <DayPicker value={days} onChange={setDays} />
      <Field label="Start · IST" type="time" required value={form.start} onChange={set('start')} />
      <Field label="End · IST" type="time" required hint="Use 00:00 for midnight." value={form.end} onChange={set('end')} />
    </>
  );
}

function AddDialog({ plans, batches, courts, onClose, onSaved }) {
  const available = plans.filter((p) => p.active);
  const [form, setForm] = useState({ planId: available[0]?.id ?? '', batchId: '', holderName: '', phone: '', email: '', notes: '', startsOn: venueToday(), start: '', end: '', rupees: '' });
  const [days, setDays] = useState([]);
  const [courtIds, setCourtIds] = useState([]);
  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  const plan = plans.find((p) => p.id === form.planId);
  const planBatches = batches.filter((b) => b.planId === form.planId && b.active);
  const batchId = form.batchId || planBatches.find((b) => b.seatsLeft > 0)?.id || '';
  const usual = plan ? plan.pricePaise * (plan.kind === 'court' ? Math.max(courtIds.length, 1) : 1) : 0;

  const submit = async () => {
    const pricePaise = form.rupees.trim() === '' ? undefined : (toPaise(form.rupees) ?? undefined);
    const base = { planId: form.planId, holderName: form.holderName, phone: form.phone, email: form.email, notes: form.notes, startsOn: form.startsOn, pricePaise };
    const body = plan?.kind === 'court' ? { ...base, courtIds, days, start: form.start, end: endFromInput(form.end) } : { ...base, batchId };
    const { membership } = await api('/memberships', { method: 'POST', body });
    onSaved(membership);
  };

  return (
    <SimpleFormDialog title="Add membership" description="Runs for one month from the start date." submitLabel="Add membership" onSubmit={submit} onClose={onClose}>
      <div className="form-grid">
        <Field as="select" label="Plan" options={available.map((p) => ({ value: p.id, label: p.name }))} value={form.planId} onChange={(e) => setForm((f) => ({ ...f, planId: e.target.value, batchId: '' }))} />
        <Field label="Start date" type="date" required value={form.startsOn} onChange={set('startsOn')} />
        <Field label={plan?.kind === 'court' ? 'Contact name' : 'Member name'} required autoComplete="off" value={form.holderName} onChange={set('holderName')} />
        <Field label="Phone (WhatsApp)" type="tel" required autoComplete="off" value={form.phone} onChange={set('phone')} />
        <div className="form-grid__full">
          <Field label="Email (optional)" type="email" autoComplete="off" value={form.email} onChange={set('email')} />
        </div>
        {plan?.kind === 'court' ? (
          <CourtTimeFields form={form} set={set} days={days} setDays={setDays} courts={courts} courtIds={courtIds} setCourtIds={setCourtIds} />
        ) : (
          <div className="form-grid__full">
            <Field
              as="select"
              label="Batch"
              hint={planBatches.length ? undefined : 'This plan has no batches yet. Add one under Plans & batches.'}
              options={planBatches.map((b) => ({ value: b.id, disabled: b.seatsLeft === 0, label: `${b.name} · ${b.start}–${b.end} · ${formatDays(b.days)} · ${b.seatsLeft} left` }))}
              value={batchId}
              onChange={set('batchId')}
            />
          </div>
        )}
        <Field label="Price per month (₹)" type="number" min="0" step="any" hint={`Blank uses the usual ${formatPaise(usual)}.`} value={form.rupees} onChange={set('rupees')} />
        <div className="form-grid__full">
          <Field as="textarea" label="Notes" maxLength={1000} value={form.notes} onChange={set('notes')} />
        </div>
      </div>
    </SimpleFormDialog>
  );
}

function CreditDialog({ membership, onClose, onSaved }) {
  const [rupees, setRupees] = useState('');
  const [reason, setReason] = useState('');
  const submit = async () => {
    await api(`/memberships/${membership.id}/credits`, { method: 'POST', body: { amountPaise: toPaise(rupees) ?? undefined, reason } });
    onSaved();
  };
  return (
    <SimpleFormDialog title={`Adjust credit · ${membership.membershipNo}`} description="Credit comes off this member’s next renewal." submitLabel="Save credit" onSubmit={submit} onClose={onClose}>
      <div className="form-grid">
        <Field label="Amount (₹)" type="number" step="any" hint="Use a minus to take credit away." value={rupees} onChange={(e) => setRupees(e.target.value)} />
        <Field label="Reason" required maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
    </SimpleFormDialog>
  );
}

function EditDialog({ membership, onClose, onSaved }) {
  const [form, setForm] = useState({ holderName: membership.holderName, phone: membership.phone, email: membership.email ?? '', notes: membership.notes ?? '', rupees: String(membership.pricePaise / 100) });
  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  const submit = async () => {
    const { rupees, ...details } = form;
    await api(`/memberships/${membership.id}`, { method: 'PATCH', body: { ...details, pricePaise: toPaise(rupees) ?? undefined } });
    onSaved();
  };
  return (
    <SimpleFormDialog title={`Edit ${membership.membershipNo}`} submitLabel="Save changes" onSubmit={submit} onClose={onClose}>
      <div className="form-grid">
        <Field label="Name" required autoComplete="off" value={form.holderName} onChange={set('holderName')} />
        <Field label="Phone (WhatsApp)" type="tel" required autoComplete="off" value={form.phone} onChange={set('phone')} />
        <Field label="Email (optional)" type="email" autoComplete="off" value={form.email} onChange={set('email')} />
        <Field label="Price per month (₹)" type="number" min="0" step="any" hint="Applies from the next renewal." value={form.rupees} onChange={set('rupees')} />
        <div className="form-grid__full">
          <Field as="textarea" label="Notes" maxLength={1000} value={form.notes} onChange={set('notes')} />
        </div>
      </div>
    </SimpleFormDialog>
  );
}

function MoveDialog({ membership, batches, courts, onClose, onSaved }) {
  const options = batches.filter((b) => b.planId === membership.planId && b.active && b.id !== membership.batchId);
  const [batchId, setBatchId] = useState(options.find((b) => b.seatsLeft > 0)?.id ?? '');
  const [form, setForm] = useState({ start: membership.schedule.start, end: endToInput(membership.schedule.end) });
  const [days, setDays] = useState(membership.schedule.days);
  const [courtIds, setCourtIds] = useState(membership.courts.map((c) => c.id));
  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  const submit = async () => {
    const body = membership.kind === 'court' ? { courtIds, days, start: form.start, end: endFromInput(form.end) } : { batchId };
    await api(`/memberships/${membership.id}/move`, { method: 'POST', body });
    onSaved();
  };
  return (
    <SimpleFormDialog title={`Move ${membership.membershipNo}`} description={membership.kind === 'court' ? 'Future court time moves together. If anything clashes, nothing changes.' : undefined} submitLabel="Move" onSubmit={submit} onClose={onClose}>
      <div className="form-grid">
        {membership.kind === 'court' ? (
          <CourtTimeFields form={form} set={set} days={days} setDays={setDays} courts={courts} courtIds={courtIds} setCourtIds={setCourtIds} />
        ) : (
          <div className="form-grid__full">
            <Field as="select" label="New batch" options={options.map((b) => ({ value: b.id, disabled: b.seatsLeft === 0, label: `${b.name} · ${b.start}–${b.end} · ${formatDays(b.days)} · ${b.seatsLeft} left` }))} value={batchId} onChange={(e) => setBatchId(e.target.value)} />
          </div>
        )}
      </div>
    </SimpleFormDialog>
  );
}

function PayDialog({ membership, period, onClose, onSaved }) {
  const [rupees, setRupees] = useState(String(period.duePaise / 100));
  const [method, setMethod] = useState('cash');
  const [reference, setReference] = useState('');
  const submit = async () => {
    const { payment } = await api(`/memberships/${membership.id}/payments`, { method: 'POST', body: { periodId: period.id, amountPaise: toPaise(rupees) ?? undefined, method, reference } });
    onSaved(payment);
  };
  return (
    <SimpleFormDialog title={`Record payment · ${membership.membershipNo}`} description={`${formatDate(period.startsOn)} to ${formatDate(period.endsOn)}: ${formatPaise(period.duePaise)} due.`} submitLabel="Record payment" onSubmit={submit} onClose={onClose}>
      <div className="form-grid">
        <Field label="Amount received (₹)" type="number" min="0" step="any" value={rupees} onChange={(e) => setRupees(e.target.value)} />
        <Field as="select" label="Method" options={METHODS} value={method} onChange={(e) => setMethod(e.target.value)} />
        {method === 'upi' && (
          <div className="form-grid__full">
            <Field label="UPI reference (optional)" maxLength={100} autoComplete="off" value={reference} onChange={(e) => setReference(e.target.value)} />
          </div>
        )}
      </div>
    </SimpleFormDialog>
  );
}

function PlayerDialog({ membership, onClose, onSaved }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const submit = async () => {
    await api(`/memberships/${membership.id}/players`, { method: 'POST', body: { name, phone } });
    onSaved();
  };
  return (
    <SimpleFormDialog title="Add player" submitLabel="Add player" onSubmit={submit} onClose={onClose}>
      <div className="form-grid">
        <Field label="Player name" required autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
        <Field label="Phone (optional)" type="tel" autoComplete="off" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </div>
    </SimpleFormDialog>
  );
}

function Detail({ data, onAction }) {
  const can = useCan();
  const { membership: m, periods, players, playerLimit, payments, credits, creditBalancePaise, messages = [] } = data;
  const manage = can('memberships.manage');
  const live = m.status === 'active';
  const unpaid = periods.filter((p) => p.duePaise > 0);
  const end = endCountdown(m.endsOn);
  // Reminders go out on WhatsApp from the academy's phone: the message is typed, staff press send.
  const canRemind = live && m.whatsappReminderUrl && can('messages.manage');
  return (
    <Panel className="detail-panel">
      <div className="detail-panel__head">
        <h2 className="detail-panel__id">{m.membershipNo}</h2>
        <StatusBadge status={m.state} />
      </div>
      {live && (
        <div className={`membership-end membership-end--${end.tone}`}>
          <p className="membership-end__label">Valid until</p>
          <p className="membership-end__date">{formatDate(m.endsOn)}</p>
          <p className="membership-end__countdown">{end.text}</p>
          {(needsRenewal(m) || (unpaid.length > 0 && can('payments.record'))) && (
            <div className="membership-end__actions">
              {needsRenewal(m) && manage && (
                <Button variant="primary" size="sm" onClick={() => onAction({ type: 'renew' })}>
                  Renew one month
                </Button>
              )}
              {needsRenewal(m) && canRemind && (
                <Button size="sm" href={m.whatsappReminderUrl} onClick={() => onAction({ type: 'whatsapp' })}>
                  WhatsApp reminder
                </Button>
              )}
              {unpaid.length > 0 && can('payments.record') && (
                <Button size="sm" onClick={() => onAction({ type: 'pay', period: unpaid[0] })}>
                  Record {formatPaise(unpaid[0].duePaise)} due
                </Button>
              )}
            </div>
          )}
        </div>
      )}
      <hr className="rule" />
      <p className="detail-panel__name">{m.holderName}</p>
      <p className="detail-panel__lines">
        {m.phone}
        {m.email && (
          <>
            <br />
            {m.email}
          </>
        )}
        <br />
        {m.planName}
        <br />
        {m.batchName ? `${m.batchName} · ` : `${m.courts.map((c) => c.name).join(', ')} · `}
        {formatDays(m.schedule.days)} · {m.schedule.start}–{m.schedule.end}
        <br />
        Member since {formatDate(m.startsOn)} · valid until {formatDate(m.endsOn)}
        <br />
        {formatPaise(m.pricePaise)} a month · {formatPaise(m.duePaise)} due
      </p>
      {m.source === 'website' && <p className="fine muted">Joined on the website.</p>}
      {m.cancelReason && <p className="fine muted">Cancelled: {m.cancelReason}</p>}
      {m.notes && <p className="fine muted">Notes: {m.notes}</p>}
      <hr className="rule" />
      <p className="panel__title">Months</p>
      <ul className="receipt-list">
        {periods.map((p) => (
          <li key={p.id}>
            <span>
              {formatDate(p.startsOn)} to {formatDate(p.endsOn)}
              <span className="fine muted receipt-list__when">
                {formatPaise(p.paidPaise)} of {formatPaise(p.amountPaise)} paid
                {p.discountPaise > 0 && ` · ${formatPaise(p.discountPaise)} discount`}
                {p.creditPaise > 0 && ` · ${formatPaise(p.creditPaise)} credit used`}
              </span>
            </span>
            {p.duePaise > 0 && live && can('payments.record') ? (
              <button type="button" className="link-button small" onClick={() => onAction({ type: 'pay', period: p })}>
                Record payment
              </button>
            ) : (
              <StatusBadge status={p.duePaise > 0 ? 'Due' : 'Paid'} />
            )}
          </li>
        ))}
      </ul>
      {payments.length > 0 && (
        <>
          <p className="panel__title">Receipts</p>
          <ul className="receipt-list">
            {payments.map((r) => (
              <li key={r.id} className={r.voidedAt ? 'is-voided' : undefined}>
                <span>
                  <strong>{r.receiptNo}</strong> · {formatPaise(r.amountPaise)} · {PAYMENT_LABELS[r.method]}
                  <span className="fine muted receipt-list__when">
                    {formatInstant(r.receivedAt)}
                    {r.voidedAt ? ` · Voided: ${r.voidReason}` : ''}
                  </span>
                </span>
                {!r.voidedAt && can('payments.void') && (
                  <button type="button" className="link-button small" onClick={() => onAction({ type: 'void', receipt: r })}>
                    Void
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {(manage || credits.length > 0) && (
        <>
          <p className="panel__title">Credit</p>
          <p className="detail-panel__lines">Credit: {formatPaise(creditBalancePaise)} · comes off the next renewal</p>
          {credits.length > 0 && (
            <ul className="receipt-list">
              {credits.map((c) => (
                <li key={c.id}>
                  <span>
                    {c.reason}
                    <span className="fine muted receipt-list__when">{formatInstant(c.createdAt)}</span>
                  </span>
                  <span>{c.amountPaise < 0 ? `−${formatPaise(-c.amountPaise)}` : formatPaise(c.amountPaise)}</span>
                </li>
              ))}
            </ul>
          )}
          {manage && (
            <button type="button" className="link-button small" onClick={() => onAction({ type: 'credit' })}>
              Adjust credit
            </button>
          )}
        </>
      )}
      {m.kind === 'court' && (
        <>
          <p className="panel__title">
            Players · {players.length} of {playerLimit}
          </p>
          <ul className="receipt-list">
            {players.map((p) => (
              <li key={p.id}>
                <span>
                  {p.name}
                  {p.phone && <span className="fine muted receipt-list__when">{p.phone}</span>}
                </span>
                {manage && (
                  <button type="button" className="link-button small" aria-label={`Remove ${p.name}`} onClick={() => onAction({ type: 'removePlayer', player: p })}>
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
          {manage && players.length < playerLimit && (
            <button type="button" className="link-button small" onClick={() => onAction({ type: 'addPlayer' })}>
              Add player
            </button>
          )}
        </>
      )}
      {messages.length > 0 && (
        <>
          <p className="panel__title">Messages</p>
          <ul className="receipt-list">
            {messages.map((msg) => (
              <li key={msg.id}>
                <span>
                  {MESSAGE_LABELS[msg.template] ?? msg.template}
                  <span className="fine muted receipt-list__when">
                    {CHANNEL_LABELS[msg.channel] ?? msg.channel}
                    {msg.audience === 'owner' ? ' to owner' : ''}
                    {msg.fallbackOf ? ' (instead of WhatsApp)' : ''} · {formatInstant(msg.sentAt ?? msg.createdAt)}
                    {msg.lastError ? ` · ${msg.lastError}` : ''}
                  </span>
                </span>
                <StatusBadge tone={MESSAGE_TONES[msg.status]}>{MESSAGE_STATUS[msg.status]}</StatusBadge>
              </li>
            ))}
          </ul>
        </>
      )}
      {unpaid.length > 0 && !live && <Notice tone="warning">{formatPaise(m.duePaise)} was still owed when this ended.</Notice>}
      <div className="detail-panel__actions">
        {live && manage && !needsRenewal(m) && <Button onClick={() => onAction({ type: 'renew' })}>Renew early</Button>}
        {canRemind && !needsRenewal(m) && (
          <Button href={m.whatsappReminderUrl} onClick={() => onAction({ type: 'whatsapp' })}>
            WhatsApp reminder
          </Button>
        )}
        {manage && m.status !== 'cancelled' && m.status !== 'expired' && <Button onClick={() => onAction({ type: 'edit' })}>Edit details</Button>}
        {live && manage && <Button onClick={() => onAction({ type: 'move' })}>{m.kind === 'court' ? 'Change time' : 'Change batch'}</Button>}
        {manage && (live || m.status === 'pending_payment') && <Button onClick={() => onAction({ type: 'cancel' })}>Cancel membership</Button>}
        {manage && !live && m.status !== 'pending_payment' && <Button onClick={() => onAction({ type: 'delete' })}>Delete record</Button>}
      </div>
    </Panel>
  );
}

export default function Memberships() {
  const { notify } = useWorkspace();
  const can = useCan();
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('selected');
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('all');
  const [state, setState] = useState('all');
  const [dialog, setDialog] = useState(null);

  const search = new URLSearchParams();
  if (query.trim()) search.set('q', query.trim());
  if (kind !== 'all') search.set('kind', kind);
  const { data, error, reload } = useResource(`/memberships?${search}`);
  const detail = useResource(selectedId ? `/memberships/${selectedId}` : null);
  const plansRes = useResource('/memberships/plans');
  const batchesRes = useResource('/memberships/batches');
  const setup = useResource('/settings');

  const all = data?.memberships ?? [];
  const rows = all.filter((m) => state === 'all' || m.state === state);
  const pager = usePagination(rows, 10);
  const shown = selectedId && detail.data?.membership.id === selectedId ? detail.data : null;
  const selected = shown?.membership;
  const plans = plansRes.data?.plans ?? [];
  const batches = batchesRes.data?.batches ?? [];
  const courts = setup.data?.courts.filter((c) => c.active) ?? [];
  const count = (s) => all.filter((m) => m.state === s).length;

  const select = (id) => setParams({ selected: id }, { replace: true });
  // A quick action from a list row: open that member, then the action once their details have loaded.
  const [pending, setPending] = useState(null);
  useEffect(() => {
    if (pending && shown?.membership.id === pending.id) {
      setPending(null);
      onAction(pending.action);
    }
  });
  const quick = (event, m, action) => {
    event.stopPropagation();
    select(m.id);
    setPending({ id: m.id, action });
  };
  const close = () => setDialog(null);
  const changed = (message) => {
    close();
    reload();
    detail.reload();
    batchesRes.reload();
    notify(message);
  };
  /** The WhatsApp chat opens in a new tab (the link does that); this only records it in Messages. */
  const logWhatsapp = (id) =>
    api(`/memberships/${id}/whatsapp-opened`, { method: 'POST' })
      .then(() => notify('WhatsApp opened with the reminder. Press send there.'))
      .catch((err) => notify(err.message));
  const onAction = async (action) => {
    if (action.type === 'whatsapp') return logWhatsapp(selected.id);
    setDialog(action);
  };

  return (
    <>
      <PageHeader
        title={PEOPLE.label}
        subtitle="Individual members and court memberships, kept apart from other customers."
        action={
          can('memberships.manage') ? (
            <Button onClick={() => setDialog({ type: 'add' })} disabled={!plans.some((p) => p.active)}>
              Add membership
            </Button>
          ) : undefined
        }
      />
      <ViewTabs tabs={PEOPLE.tabs} label="Customers and memberships" />

      <KpiRow>
        <KpiTile label="Active" value={count('Active')} caption="More than a week left" />
        <KpiTile label="Expiring" value={count('Expiring')} caption="Within 7 days" />
        <KpiTile label="Expired" value={count('Expired')} caption="Past their last paid date" />
        <KpiTile label="Owed" value={formatPaise(all.reduce((sum, m) => sum + (m.status === 'active' ? m.duePaise : 0), 0))} caption="Across current memberships" />
      </KpiRow>

      <FilterBar>
        <SearchFilter label="Search name, phone, email, player or number" value={query} onChange={setQuery} />
        <SelectFilter label="Type" value={kind} onChange={setKind} options={KIND_OPTIONS} />
        <SelectFilter label="Status" value={state} onChange={setState} options={toOptions('All statuses', STATES)} />
      </FilterBar>

      {error && (
        <div role="alert">
          <Notice tone="warning">{error}</Notice>
        </div>
      )}
      {plansRes.data && !plans.length && <Notice>No plans yet. Start under Plans &amp; batches.</Notice>}

      <div className="detail-layout">
        <Panel title="Membership records" meta={`${rows.length} ${rows.length === 1 ? 'record' : 'records'}`}>
          {rows.length ? (
            <>
              <div className="table-wrap">
                <table className="data-table data-table--interactive">
                  <thead>
                    <tr>
                      <th>Member</th>
                      <th>Fixed time · IST</th>
                      <th>Valid until</th>
                      <th>Status</th>
                      <th>
                        <span className="visually-hidden">Next step</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {pager.rows.map((m) => (
                      <tr key={m.id} className={m.id === selectedId ? 'is-selected' : undefined} onClick={() => select(m.id)}>
                        <td className="data-table__key">
                          <button type="button" className="link-button" onClick={() => select(m.id)}>
                            {m.holderName}
                          </button>
                          <span className="data-table__sub">
                            {m.membershipNo} · {m.planName}
                          </span>
                        </td>
                        <td>
                          {m.schedule.start}–{m.schedule.end}
                          <span className="data-table__sub">
                            {formatDays(m.schedule.days)} · {m.batchName ?? m.courts.map((c) => c.name).join(', ')}
                          </span>
                        </td>
                        <td>
                          {formatDate(m.endsOn)}
                          {m.status === 'active' && <span className={`data-table__sub end-countdown end-countdown--${endCountdown(m.endsOn).tone}`}>{endCountdown(m.endsOn).text}</span>}
                        </td>
                        <td>
                          <span className="staff-status">
                            <StatusBadge status={m.state} />
                            {m.duePaise > 0 && m.status === 'active' && <StatusBadge status="Due">{formatPaise(m.duePaise)} due</StatusBadge>}
                          </span>
                        </td>
                        <td className="data-table__actions">
                          {needsRenewal(m) && can('memberships.manage') && (
                            <button type="button" className="link-button small" onClick={(e) => quick(e, m, { type: 'renew' })}>
                              Renew
                            </button>
                          )}
                          {needsRenewal(m) && m.whatsappReminderUrl && can('messages.manage') && (
                            <a
                              href={m.whatsappReminderUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="link-button small"
                              onClick={(e) => {
                                e.stopPropagation();
                                logWhatsapp(m.id);
                              }}
                            >
                              WhatsApp
                            </a>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination pager={pager} noun="memberships" />
            </>
          ) : (
            <EmptyState title="No memberships" text={data ? 'Nobody matches. Add a membership, or clear the filters.' : 'Loading…'} />
          )}
        </Panel>

        {shown ? (
          <Detail data={shown} onAction={onAction} />
        ) : (
          <Panel className="detail-panel">
            <p className="small muted">{selectedId && !detail.error ? 'Loading…' : detail.error || 'Select a membership to see its details.'}</p>
          </Panel>
        )}
      </div>

      <AnimatePresence>
        {dialog?.type === 'add' && (
          <AddDialog
            key="add"
            plans={plans}
            batches={batches}
            courts={courts}
            onClose={close}
            onSaved={(m) => {
              changed(`${m.membershipNo} added.`);
              select(m.id);
            }}
          />
        )}
        {dialog?.type === 'edit' && <EditDialog key="edit" membership={selected} onClose={close} onSaved={() => changed('Details saved.')} />}
        {dialog?.type === 'move' && <MoveDialog key="move" membership={selected} batches={batches} courts={courts} onClose={close} onSaved={() => changed('Fixed time changed.')} />}
        {dialog?.type === 'pay' && <PayDialog key="pay" membership={selected} period={dialog.period} onClose={close} onSaved={(p) => changed(`${formatPaise(p.amountPaise)} recorded · ${p.receiptNo}`)} />}
        {dialog?.type === 'credit' && <CreditDialog key="credit" membership={selected} onClose={close} onSaved={() => changed('Credit saved.')} />}
        {dialog?.type === 'addPlayer' && <PlayerDialog key="player" membership={selected} onClose={close} onSaved={() => changed('Player added.')} />}
        {dialog?.type === 'removePlayer' && (
          <ActionDialog
            key="remove-player"
            title={`Remove ${dialog.player.name}?`}
            label="Remove player"
            onClose={close}
            onConfirm={async () => {
              await api(`/memberships/${selected.id}/players/${dialog.player.id}`, { method: 'DELETE' });
              changed('Player removed.');
            }}
          />
        )}
        {dialog?.type === 'renew' && (
          <ActionDialog
            key="renew"
            title={`Renew ${selected.membershipNo}?`}
            description={`Adds one month at ${formatPaise(Math.max(selected.pricePaise - shown.creditBalancePaise, 0))}${shown.creditBalancePaise > 0 ? ' after credit' : ''}, which shows as due until it’s paid. The member is sent the amount due and the date to pay by.`}
            label="Renew"
            danger={false}
            onClose={close}
            onConfirm={async () => {
              await api(`/memberships/${selected.id}/renew`, { method: 'POST' });
              changed(`${selected.membershipNo} renewed.`);
            }}
          />
        )}
        {dialog?.type === 'cancel' && (
          <ActionDialog
            key="cancel"
            title={`Cancel ${selected.membershipNo}?`}
            description="Future court time is freed. The member gets no message; the owner numbers are told. Under the cancellation and refund policy, a month that has already started isn’t refunded; a paid month that hasn’t started is refunded in full. Handle any refund from the Payments page."
            label="Cancel membership"
            reasonLabel="Reason (optional)"
            onClose={close}
            onConfirm={async (reason) => {
              await api(`/memberships/${selected.id}/cancel`, { method: 'POST', body: { reason } });
              changed(`${selected.membershipNo} cancelled.`);
            }}
          />
        )}
        {dialog?.type === 'delete' && (
          <ActionDialog
            key="delete"
            title={`Delete ${selected.membershipNo}?`}
            description="It leaves this list. Its receipts stay on the Payments page."
            label="Delete record"
            onClose={close}
            onConfirm={async () => {
              await api(`/memberships/${selected.id}`, { method: 'DELETE' });
              setParams({}, { replace: true });
              changed('Record deleted.');
            }}
          />
        )}
        {dialog?.type === 'void' && (
          <ActionDialog
            key="void"
            title={`Void ${dialog.receipt.receiptNo}?`}
            description={`${formatPaise(dialog.receipt.amountPaise)} stops counting as received, and the month’s balance reopens.`}
            label="Void receipt"
            reasonLabel="Reason"
            reasonRequired
            onClose={close}
            onConfirm={async (reason) => {
              await api(`/payments/${dialog.receipt.id}/void`, { method: 'POST', body: { reason } });
              changed(`${dialog.receipt.receiptNo} voided.`);
            }}
          />
        )}
      </AnimatePresence>
    </>
  );
}
