import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence } from 'motion/react';
import PageHeader from '../layout/PageHeader';
import Button from '../components/Button';
import Field from '../components/Field';
import Notice from '../components/Notice';
import Panel from '../components/Panel';
import StatusBadge from '../components/StatusBadge';
import Pagination, { usePagination } from '../components/Pagination';
import { FilterBar, SearchFilter } from '../components/Filters';
import ActionDialog from '../dialogs/ActionDialog';
import SimpleFormDialog from '../dialogs/SimpleFormDialog';
import { useCan } from '../auth/AuthContext';
import { useWorkspace } from '../store/WorkspaceContext';
import { api } from '../lib/api';
import { formatDate, formatInstant, formatPaise, toPaise, venueToday } from '../lib/format';
import { useResource } from '../lib/useResource';

const TYPE_OPTIONS = [
  { value: 'percent', label: 'Percentage off' },
  { value: 'fixed', label: 'Amount off (₹)' },
];

function ProgramPanel({ program, onSaved }) {
  const [form, setForm] = useState({
    enabled: program.enabled,
    discountType: program.discountType,
    value: String(program.discountType === 'percent' ? program.discountValue : program.discountValue / 100),
    reward: String(program.rewardPaise / 100),
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const can = useCan();
  const manage = can('referrals.manage');
  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setPending(true);
    setError('');
    try {
      const discountValue = form.discountType === 'percent' ? Number(form.value) : toPaise(form.value);
      await api('/referrals/program', { method: 'PUT', body: { enabled: form.enabled, discountType: form.discountType, discountValue: discountValue ?? undefined, rewardPaise: toPaise(form.reward) ?? undefined } });
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setPending(false);
    }
  };

  return (
    <Panel title="Referral program" meta={<StatusBadge tone={program.enabled ? 'success' : 'tint'}>{program.enabled ? 'On' : 'Off'}</StatusBadge>}>
      <form className="settings-form" onSubmit={submit} noValidate>
        {error && (
          <div role="alert">
            <Notice tone="warning">{error}</Notice>
          </div>
        )}
        <label className="day-check">
          <input type="checkbox" disabled={!manage} checked={form.enabled} onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))} />
          <span>Accept referral codes</span>
        </label>
        <div className="form-grid">
          <Field as="select" label="New member’s discount" disabled={!manage} options={TYPE_OPTIONS} value={form.discountType} onChange={set('discountType')} />
          <Field label={form.discountType === 'percent' ? 'Percent off the first month' : '₹ off the first month'} type="number" min="0" step="any" disabled={!manage} value={form.value} onChange={set('value')} />
          <Field label="Credit for the referrer (₹)" type="number" min="0" step="any" disabled={!manage} hint="Earned when the new member has paid their first month; taken off the referrer’s next renewal. 0 means no credit." value={form.reward} onChange={set('reward')} />
        </div>
        <p className="muted small">Changes apply to new referrals only. Codes are for new members: a phone or email that has had a membership can’t use one.</p>
        {manage && (
          <div>
            <Button type="submit" variant="primary" icon={false} disabled={pending} aria-busy={pending}>
              {pending ? 'Saving…' : 'Save referral program'}
            </Button>
          </div>
        )}
      </form>
    </Panel>
  );
}

function CodeDialog({ code, onClose, onSaved }) {
  const [form, setForm] = useState({ code: code?.code ?? '', label: code?.label ?? '', maxUses: code?.maxUses ? String(code.maxUses) : '', expiresOn: code?.expiresOn ?? '', active: code?.active ?? true });
  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  const submit = async () => {
    const body = { ...form, maxUses: form.maxUses === '' ? null : Number(form.maxUses) };
    if (code) await api(`/referrals/codes/${code.id}`, { method: 'PATCH', body });
    else await api('/referrals/codes', { method: 'POST', body });
    onSaved();
  };
  return (
    <SimpleFormDialog title={code ? `Edit ${code.code}` : 'Add promotion code'} description={code ? undefined : 'Gives the same discount, with no credit for anyone.'} submitLabel="Save code" onSubmit={submit} onClose={onClose}>
      <div className="form-grid">
        <Field label="Code" maxLength={30} autoComplete="off" hint={code ? undefined : 'Blank makes one up.'} value={form.code} onChange={set('code')} />
        <Field label="Label" maxLength={120} hint="For your reference, such as Diwali offer." value={form.label} onChange={set('label')} />
        <Field label="Most uses" type="number" min="1" hint="Blank means no limit." value={form.maxUses} onChange={set('maxUses')} />
        <Field label="Last date" type="date" min={venueToday()} hint="Blank means no end." value={form.expiresOn} onChange={set('expiresOn')} />
        <label className="day-check form-grid__full">
          <input type="checkbox" checked={form.active} onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))} />
          <span>Code can be used</span>
        </label>
      </div>
    </SimpleFormDialog>
  );
}

export default function Referrals() {
  const { notify } = useWorkspace();
  const can = useCan();
  const manage = can('referrals.manage');
  const { data, error, reload } = useResource('/referrals');
  const [dialog, setDialog] = useState(null);
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const codes = (data?.codes ?? []).filter((c) => !q || `${c.code} ${c.label ?? ''} ${c.memberName ?? ''} ${c.memberNo ?? ''}`.toLowerCase().includes(q));
  const pager = usePagination(codes, 10);
  const redemptions = data?.redemptions ?? [];
  const close = () => setDialog(null);
  const changed = (message) => {
    close();
    reload();
    notify(message);
  };

  return (
    <>
      <PageHeader title="Referrals" subtitle="Discounts for new members, and credit for whoever sent them." action={manage ? <Button onClick={() => setDialog({ type: 'code' })}>Add promotion code</Button> : undefined} />

      {error && (
        <div role="alert">
          <Notice tone="warning">{error}</Notice>
        </div>
      )}
      {!data && !error && <p className="muted small">Loading…</p>}

      {data && (
        <div className="settings-stack">
          <ProgramPanel key={data.program.updatedAt} program={data.program} onSaved={() => changed('Referral program saved.')} />

          <FilterBar>
            <SearchFilter label="Search code, label or member" value={query} onChange={setQuery} />
          </FilterBar>

          <Panel title="Codes" meta={`${codes.length} ${codes.length === 1 ? 'code' : 'codes'}`}>
            {codes.length ? (
              <>
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Code</th>
                        <th>Belongs to</th>
                        <th>Used</th>
                        <th>Status</th>
                        {manage && <th>Actions</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {pager.rows.map((c) => (
                        <tr key={c.id}>
                          <td className="data-table__key">{c.code}</td>
                          <td>
                            {c.membershipId ? <Link to={`/memberships?selected=${c.membershipId}`}>{c.memberName}</Link> : c.label || 'Promotion'}
                            <span className="data-table__sub">{c.memberNo ?? 'Promotion code'}</span>
                          </td>
                          <td>
                            {c.uses}
                            {c.maxUses ? ` of ${c.maxUses}` : ''}
                            {c.expiresOn && <span className="data-table__sub">Until {formatDate(c.expiresOn)}</span>}
                          </td>
                          <td>
                            <StatusBadge tone={c.active ? 'success' : 'tint'}>{c.active ? 'On' : 'Off'}</StatusBadge>
                          </td>
                          {manage && (
                            <td>
                              <div className="staff-actions">
                                <button type="button" className="link-button small" onClick={() => setDialog({ type: 'code', code: c })}>
                                  Edit
                                </button>
                                {!c.membershipId && (
                                  <button type="button" className="link-button small" onClick={() => setDialog({ type: 'delete', code: c })}>
                                    Delete
                                  </button>
                                )}
                              </div>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pagination pager={pager} noun="codes" />
              </>
            ) : (
              <p className="muted small settings-empty">No codes yet. Every confirmed member gets one automatically.</p>
            )}
          </Panel>

          <Panel title="Referrals used" meta={`Latest ${redemptions.length}`}>
            {redemptions.length ? (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>New member</th>
                      <th>Code</th>
                      <th>Discount</th>
                      <th>Referrer’s credit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {redemptions.map((r) => (
                      <tr key={r.id}>
                        <td className="data-table__key">
                          <Link to={`/memberships?selected=${r.membershipId}`}>{r.memberName}</Link>
                          <span className="data-table__sub">
                            {r.memberNo} · {formatInstant(r.createdAt)}
                          </span>
                        </td>
                        <td>{r.code}</td>
                        <td>{formatPaise(r.discountPaise)}</td>
                        <td>{r.rewardPaise === 0 ? '—' : r.creditedAt ? `${formatPaise(r.rewardPaise)} given` : `${formatPaise(r.rewardPaise)} after first payment`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted small settings-empty">Nobody has used a code yet.</p>
            )}
          </Panel>
        </div>
      )}

      <AnimatePresence>
        {dialog?.type === 'code' && <CodeDialog key="code" code={dialog.code} onClose={close} onSaved={() => changed('Code saved.')} />}
        {dialog?.type === 'delete' && (
          <ActionDialog
            key="delete"
            title={`Delete ${dialog.code.code}?`}
            description="A code that has been used can’t be deleted; switch it off instead."
            label="Delete code"
            onClose={close}
            onConfirm={async () => {
              await api(`/referrals/codes/${dialog.code.id}`, { method: 'DELETE' });
              changed('Code deleted.');
            }}
          />
        )}
      </AnimatePresence>
    </>
  );
}
