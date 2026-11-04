import { useState } from 'react';
import { AnimatePresence } from 'motion/react';
import PageHeader from '../layout/PageHeader';
import Button from '../components/Button';
import Field from '../components/Field';
import Notice from '../components/Notice';
import Panel from '../components/Panel';
import StatusBadge from '../components/StatusBadge';
import ActionDialog from '../dialogs/ActionDialog';
import DayPicker from '../dialogs/DayPicker';
import SimpleFormDialog from '../dialogs/SimpleFormDialog';
import { useCan } from '../auth/AuthContext';
import { useWorkspace } from '../store/WorkspaceContext';
import { api } from '../lib/api';
import { addDays, addMonths, endFromInput, endToInput, formatDate, formatDays, formatPaise, toPaise, venueToday } from '../lib/format';
import { useResource } from '../lib/useResource';

const KIND_LABELS = { individual: 'Individual', court: 'Whole court' };
const KIND_OPTIONS = Object.entries(KIND_LABELS).map(([value, label]) => ({ value, label }));
const BATCH_DEFAULT_MONTHS = 3;

function PlanDialog({ plan, onClose, onSaved }) {
  const [form, setForm] = useState({
    name: plan?.name ?? '',
    kind: plan?.kind ?? 'individual',
    description: plan?.description ?? '',
    features: plan?.features.join('\n') ?? '',
    rupees: plan ? String(plan.pricePaise / 100) : '',
    playersPerCourt: String(plan?.playersPerCourt ?? 10),
    active: plan?.active ?? true,
  });
  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const submit = async () => {
    const body = {
      name: form.name,
      kind: form.kind,
      description: form.description,
      features: form.features.split('\n').map((x) => x.trim()).filter(Boolean),
      pricePaise: toPaise(form.rupees) ?? undefined,
      playersPerCourt: Number(form.playersPerCourt) || undefined,
      active: form.active,
    };
    const result = plan ? await api(`/memberships/plans/${plan.id}`, { method: 'PATCH', body }) : await api('/memberships/plans', { method: 'POST', body });
    onSaved(result.plan);
  };

  return (
    <SimpleFormDialog title={plan ? `Edit ${plan.name}` : 'Add plan'} submitLabel="Save plan" onSubmit={submit} onClose={onClose}>
      <div className="form-grid">
        <Field label="Plan name" required maxLength={80} value={form.name} onChange={set('name')} />
        <Field as="select" label="Type" options={KIND_OPTIONS} value={form.kind} onChange={set('kind')} disabled={Boolean(plan)} />
        <Field label={form.kind === 'court' ? 'Price per court, per month (₹)' : 'Price per person, per month (₹)'} type="number" min="0" step="any" required value={form.rupees} onChange={set('rupees')} />
        {form.kind === 'court' && <Field label="Players per court" type="number" min="1" max="10" hint="At most 10, so 20 across both courts." value={form.playersPerCourt} onChange={set('playersPerCourt')} />}
        <div className="form-grid__full">
          <Field as="textarea" label="Description" maxLength={500} value={form.description} onChange={set('description')} />
        </div>
        <div className="form-grid__full">
          <Field as="textarea" label="What’s included" hint="One per line. Shown on the website." value={form.features} onChange={set('features')} />
        </div>
        <label className="day-check form-grid__full">
          <input type="checkbox" checked={form.active} onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))} />
          <span>Available to new members</span>
        </label>
      </div>
    </SimpleFormDialog>
  );
}

function BatchDialog({ batch, plans, courts, onClose, onSaved }) {
  const today = venueToday();
  const individual = plans.filter((p) => p.kind === 'individual');
  const [form, setForm] = useState({
    name: batch?.name ?? '',
    planId: batch?.planId ?? individual[0]?.id ?? '',
    courtId: batch?.courtId ?? courts[0]?.id ?? '',
    start: batch?.start ?? '',
    end: endToInput(batch?.end ?? ''),
    capacity: String(batch?.capacity ?? 10),
    startsOn: batch?.startsOn ?? today,
    endsOn: batch?.endsOn ?? addDays(addMonths(today, BATCH_DEFAULT_MONTHS), -1),
  });
  const [days, setDays] = useState(batch?.days ?? []);
  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const submit = async () => {
    const body = { ...form, end: endFromInput(form.end), days, capacity: Number(form.capacity) || 0 };
    const result = batch ? await api(`/memberships/batches/${batch.id}`, { method: 'PATCH', body }) : await api('/memberships/batches', { method: 'POST', body });
    onSaved(result.batch);
  };

  return (
    <SimpleFormDialog
      title={batch ? `Edit ${batch.name}` : 'Add batch'}
      description="This blocks the court at this time on every chosen day. If anything clashes, nothing changes and you’ll see the dates."
      submitLabel="Save batch"
      onSubmit={submit}
      onClose={onClose}
    >
      <div className="form-grid">
        <Field label="Batch name" required maxLength={80} hint="For example, Morning batch." value={form.name} onChange={set('name')} />
        <Field as="select" label="Plan" options={individual.map((p) => ({ value: p.id, label: p.name }))} value={form.planId} onChange={set('planId')} />
        <Field as="select" label="Court" options={courts.map((c) => ({ value: c.id, label: c.name }))} value={form.courtId} onChange={set('courtId')} />
        <Field label="Places" type="number" min="1" max="100" value={form.capacity} onChange={set('capacity')} />
        <DayPicker value={days} onChange={setDays} />
        <Field label="Start · IST" type="time" required value={form.start} onChange={set('start')} />
        <Field label="End · IST" type="time" required hint="Use 00:00 for midnight." value={form.end} onChange={set('end')} />
        <Field label="First date" type="date" required value={form.startsOn} onChange={set('startsOn')} />
        <Field label="Last date" type="date" required hint="A member can only be paid up to this date. Extend it any time." value={form.endsOn} onChange={set('endsOn')} />
      </div>
    </SimpleFormDialog>
  );
}

export default function MembershipSetup() {
  const { notify } = useWorkspace();
  const can = useCan();
  const manage = can('memberships.manage');
  const plansRes = useResource('/memberships/plans');
  const batchesRes = useResource('/memberships/batches');
  const setup = useResource('/settings');
  const [dialog, setDialog] = useState(null);
  const plans = plansRes.data?.plans ?? [];
  const batches = batchesRes.data?.batches ?? [];
  const courts = setup.data?.courts.filter((c) => c.active) ?? [];
  const hasIndividualPlan = plans.some((p) => p.kind === 'individual');

  const close = () => setDialog(null);
  const changed = (message) => {
    close();
    plansRes.reload();
    batchesRes.reload();
    notify(message);
  };

  return (
    <>
      <PageHeader title="Plans & batches" subtitle="What you sell, and the fixed times members play." />

      {(plansRes.error || batchesRes.error) && (
        <div role="alert">
          <Notice tone="warning">{plansRes.error || batchesRes.error}</Notice>
        </div>
      )}

      <div className="settings-stack">
        <Panel title="Plans" meta={`${plans.filter((p) => p.active).length} available`}>
          {plans.length ? (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Plan</th>
                    <th>Type</th>
                    <th>Price a month</th>
                    <th>Status</th>
                    {manage && <th>Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {plans.map((p) => (
                    <tr key={p.id}>
                      <td className="data-table__key">
                        {p.name}
                        <span className="data-table__sub">{p.kind === 'court' ? `${p.playersPerCourt} players per court` : p.features.join(' · ')}</span>
                      </td>
                      <td>{KIND_LABELS[p.kind]}</td>
                      <td>
                        {formatPaise(p.pricePaise)} {p.kind === 'court' ? 'per court' : 'per person'}
                      </td>
                      <td>
                        <StatusBadge tone={p.active ? 'success' : 'tint'}>{p.active ? 'Available' : 'Off'}</StatusBadge>
                      </td>
                      {manage && (
                        <td>
                          <div className="staff-actions">
                            <button type="button" className="link-button small" onClick={() => setDialog({ type: 'plan', plan: p })}>
                              Edit
                            </button>
                            <button type="button" className="link-button small" onClick={() => setDialog({ type: 'deletePlan', plan: p })}>
                              Delete
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted small settings-empty">No plans yet. Add one to start taking members.</p>
          )}
          {manage && (
            <div className="settings-form__actions">
              <Button icon={false} onClick={() => setDialog({ type: 'plan' })}>
                Add plan
              </Button>
            </div>
          )}
        </Panel>

        <Panel title="Batches" meta="Shared fixed times for individual members">
          {batches.length ? (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Batch</th>
                    <th>When · IST</th>
                    <th>Runs</th>
                    <th>Places</th>
                    {manage && <th>Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {batches.map((b) => (
                    <tr key={b.id}>
                      <td className="data-table__key">
                        {b.name}
                        <span className="data-table__sub">
                          {b.planName} · {b.courtName}
                        </span>
                      </td>
                      <td>
                        {b.start}–{b.end}
                        <span className="data-table__sub">{formatDays(b.days)}</span>
                      </td>
                      <td>
                        {formatDate(b.startsOn)} to {formatDate(b.endsOn)}
                      </td>
                      <td>{b.active ? `${b.taken} of ${b.capacity}` : <StatusBadge tone="tint">Closed</StatusBadge>}</td>
                      {manage && (
                        <td>
                          {b.active && (
                            <div className="staff-actions">
                              <button type="button" className="link-button small" onClick={() => setDialog({ type: 'batch', batch: b })}>
                                Edit
                              </button>
                              <button type="button" className="link-button small" onClick={() => setDialog({ type: 'closeBatch', batch: b })}>
                                Close
                              </button>
                            </div>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted small settings-empty">{hasIndividualPlan ? 'No batches yet.' : 'Add an individual plan first, then a batch for it.'}</p>
          )}
          {manage && (
            <div className="settings-form__actions">
              <Button icon={false} disabled={!hasIndividualPlan} onClick={() => setDialog({ type: 'batch' })}>
                Add batch
              </Button>
            </div>
          )}
        </Panel>
      </div>

      <AnimatePresence>
        {dialog?.type === 'plan' && <PlanDialog key="plan" plan={dialog.plan} onClose={close} onSaved={() => changed('Plan saved.')} />}
        {dialog?.type === 'batch' && <BatchDialog key="batch" batch={dialog.batch} plans={plans} courts={courts} onClose={close} onSaved={() => changed('Batch saved. The court time is blocked.')} />}
        {dialog?.type === 'deletePlan' && (
          <ActionDialog
            key="delete-plan"
            title={`Delete ${dialog.plan.name}?`}
            description="A plan with batches or members can’t be deleted; switch it off instead."
            label="Delete plan"
            onClose={close}
            onConfirm={async () => {
              await api(`/memberships/plans/${dialog.plan.id}`, { method: 'DELETE' });
              changed('Plan deleted.');
            }}
          />
        )}
        {dialog?.type === 'closeBatch' && (
          <ActionDialog
            key="close-batch"
            title={`Close ${dialog.batch.name}?`}
            description="Its future court time becomes free. A batch with members can’t be closed until they’re moved or cancelled."
            label="Close batch"
            onClose={close}
            onConfirm={async () => {
              await api(`/memberships/batches/${dialog.batch.id}/close`, { method: 'POST' });
              changed('Batch closed.');
            }}
          />
        )}
      </AnimatePresence>
    </>
  );
}
