import { useState } from 'react';
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
import { endFromInput, endToInput, formatDate, formatDays, formatInstant, formatPaise, PAYMENT_LABELS, toPaise, venueToday } from '../lib/format';
import { useResource } from '../lib/useResource';

const KIND_OPTIONS = [
  { value: 'all', label: 'All memberships' },
  { value: 'individual', label: 'Individual (MEM)' },
  { value: 'court', label: 'Court (CRT)' },
];
const STATES = ['Active', 'Expiring', 'Expired', 'Held', 'Cancelled', 'Lapsed'];
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
  const [form, setForm] = useState({ planId: available[0]?.id ?? '', batchId: '', holderName: '', phone: '', email: '', notes: '', startsOn: venueToday(), start: '', end: '', rupees: '', referralCode: '' });
  const [days, setDays] = useState([]);
  const [courtIds, setCourtIds] = useState([]);
  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  const plan = plans.find((p) => p.id === form.planId);
  const planBatches = batches.filter((b) => b.planId === form.planId && b.active);
  const batchId = form.batchId || planBatches.find((b) => b.seatsLeft > 0)?.id || '';
  const usual = plan ? plan.pricePaise * (plan.kind === 'court' ? Math.max(courtIds.length, 1) : 1) : 0;

  const submit = async () => {
    const pricePaise = form.rupees.trim() === '' ? undefined : (toPaise(form.rupees) ?? undefined);
    const base = { planId: form.planId, holderName: form.holderName, phone: form.phone, email: form.email, notes: form.notes, startsOn: form.startsOn, pricePaise, referralCode: form.referralCode };
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
        <Field label="Phone" type="tel" required autoComplete="off" value={form.phone} onChange={set('phone')} />
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
        <Field label="Referral code (optional)" maxLength={30} autoComplete="off" hint="Takes the discount off the first month." value={form.referralCode} onChange={set('referralCode')} />
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
        <Field label="Phone" type="tel" required autoComplete="off" value={form.phone} onChange={set('phone')} />
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
  const { membership: m, periods, players, playerLimit, payments, referralCode, credits, creditBalancePaise } = data;
  const manage = can('memberships.manage');
  const live = m.status === 'active';
  const unpaid = periods.filter((p) => p.duePaise > 0);
  return (
    <Panel className="detail-panel">
      <div className="detail-panel__head">
        <h2 className="detail-panel__id">{m.membershipNo}</h2>
        <StatusBadge status={m.state} />
      </div>
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
        Valid {formatDate(m.startsOn)} to {formatDate(m.endsOn)}
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
                {p.discountPaise > 0 && ` · ${formatPaise(p.discountPaise)} referral discount`}
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
      {(referralCode || credits.length > 0) && (
        <>
          <p className="panel__title">Referral and credit</p>
          <p className="detail-panel__lines">
            {referralCode && (
              <>
                Referral code: <strong>{referralCode}</strong>
                <br />
              </>
            )}
            Credit: {formatPaise(creditBalancePaise)}
          </p>
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
      {unpaid.length > 0 && !live && <Notice tone="warning">{formatPaise(m.duePaise)} was still owed when this ended.</Notice>}
      <div className="detail-panel__actions">
        {live && manage && (
          <Button variant="primary" onClick={() => onAction({ type: 'renew' })}>
            Renew one month
          </Button>
        )}
        {live && m.email && can('messages.manage') && <Button onClick={() => onAction({ type: 'remind' })}>Send renewal reminder</Button>}
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
  const close = () => setDialog(null);
  const changed = (message) => {
    close();
    reload();
    detail.reload();
    batchesRes.reload();
    notify(message);
  };
  const onAction = async (action) => {
    if (action.type === 'remind') {
      try {
        await api(`/memberships/${selected.id}/remind`, { method: 'POST' });
        notify('Reminder email queued.');
      } catch (err) {
        notify(err.message);
      }
      return;
    }
    setDialog(action);
  };

  return (
    <>
      <PageHeader
        title="Memberships"
        subtitle="Individual members and court memberships, kept apart from other customers."
        action={
          can('memberships.manage') ? (
            <Button onClick={() => setDialog({ type: 'add' })} disabled={!plans.some((p) => p.active)}>
              Add membership
            </Button>
          ) : undefined
        }
      />

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
                        <td>{formatDate(m.endsOn)}</td>
                        <td>
                          <span className="staff-status">
                            <StatusBadge status={m.state} />
                            {m.duePaise > 0 && m.status === 'active' && <StatusBadge status="Due">{formatPaise(m.duePaise)} due</StatusBadge>}
                          </span>
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
            description={`Adds one month at ${formatPaise(Math.max(selected.pricePaise - shown.creditBalancePaise, 0))}${shown.creditBalancePaise > 0 ? ' after credit' : ''}, which shows as due until it’s paid.`}
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
            description="Future court time is freed. Refund rules aren’t set yet, so handle any refund yourself."
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
