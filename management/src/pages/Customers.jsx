import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AnimatePresence } from 'motion/react';
import PageHeader from '../layout/PageHeader';
import Button from '../components/Button';
import KpiTile, { KpiRow } from '../components/KpiTile';
import Notice from '../components/Notice';
import Panel from '../components/Panel';
import StatusBadge from '../components/StatusBadge';
import Pagination, { usePagination } from '../components/Pagination';
import { EmptyState } from '../components/States';
import { FilterBar, SearchFilter, SelectFilter } from '../components/Filters';
import ActionDialog from '../dialogs/ActionDialog';
import BookingDialog from '../dialogs/BookingDialog';
import CustomerDialog from '../dialogs/CustomerDialog';
import { useWorkspace } from '../store/WorkspaceContext';
import { api } from '../lib/api';
import { CUSTOMER_TYPES, formatDate, formatPaise } from '../lib/format';
import { useResource } from '../lib/useResource';

const TYPE_OPTIONS = [{ value: 'all', label: 'All customers' }, ...Object.entries(CUSTOMER_TYPES).map(([value, label]) => ({ value, label }))];
const VIEW_OPTIONS = [
  { value: 'current', label: 'Current' },
  { value: 'trash', label: 'Trash' },
];

export default function Customers() {
  const { notify } = useWorkspace();
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('selected');
  const [query, setQuery] = useState('');
  const [type, setType] = useState('all');
  const [view, setView] = useState('current');
  const [dialog, setDialog] = useState(null);

  const search = new URLSearchParams();
  if (query.trim()) search.set('q', query.trim());
  if (type !== 'all') search.set('type', type);
  if (view === 'trash') search.set('trash', 'true');
  const { data, error, reload } = useResource(`/customers?${search}`);
  const detail = useResource(selectedId ? `/customers/${selectedId}` : null);

  const rows = data?.customers ?? [];
  const pager = usePagination(rows, 10);
  const selected = detail.data?.customer.id === selectedId ? detail.data.customer : null;
  const close = () => setDialog(null);
  const changed = (message) => {
    close();
    reload();
    detail.reload();
    notify(message);
  };
  const select = (id) => setParams({ selected: id }, { replace: true });

  return (
    <>
      <PageHeader title="Customers" subtitle="Website and walk-in customers. Members are kept separately." action={<Button onClick={() => setDialog({ type: 'add' })}>Add customer</Button>} />

      <KpiRow columns={3}>
        <KpiTile label="Walk-in" value={rows.filter((c) => c.type === 'walk_in').length} caption="WLK numbers, in this list" />
        <KpiTile label="Website" value={rows.filter((c) => c.type === 'website').length} caption="WEB numbers, in this list" />
        <KpiTile label="Owed" value={formatPaise(rows.reduce((sum, c) => sum + c.duePaise, 0))} caption={`${rows.filter((c) => c.duePaise > 0).length} with a balance`} />
      </KpiRow>

      <FilterBar>
        <SearchFilter label="Search name, phone, email, notes or number" value={query} onChange={setQuery} />
        <SelectFilter label="Type" value={type} onChange={setType} options={TYPE_OPTIONS} />
        <SelectFilter label="View" value={view} onChange={setView} options={VIEW_OPTIONS} />
      </FilterBar>

      {error && (
        <div role="alert">
          <Notice tone="warning">{error}</Notice>
        </div>
      )}

      <div className="detail-layout">
        <Panel title={view === 'trash' ? 'Trash' : 'Customer records'} meta={`${rows.length} ${rows.length === 1 ? 'customer' : 'customers'}`}>
          {rows.length ? (
            <>
              <div className="table-wrap">
                <table className="data-table data-table--interactive">
                  <thead>
                    <tr>
                      <th>Customer</th>
                      <th>Contact</th>
                      <th>Bookings</th>
                      <th>Owed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pager.rows.map((c) => (
                      <tr key={c.id} className={c.id === selectedId ? 'is-selected' : undefined} onClick={() => select(c.id)}>
                        <td className="data-table__key">
                          <button type="button" className="link-button" onClick={() => select(c.id)}>
                            {c.name}
                          </button>
                          <span className="data-table__sub">{c.customerNo}</span>
                        </td>
                        <td>
                          {c.phone || '—'}
                          <span className="data-table__sub">{c.email}</span>
                        </td>
                        <td>{c.bookingCount}</td>
                        <td>{c.duePaise > 0 ? <StatusBadge status="Due">{formatPaise(c.duePaise)}</StatusBadge> : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination pager={pager} noun="customers" />
            </>
          ) : (
            <EmptyState title="No customers" text={data ? 'Nobody matches. Add a customer, or clear the search.' : 'Loading…'} onClear={query ? () => setQuery('') : undefined} />
          )}
        </Panel>

        {selected ? (
          <Panel className="detail-panel">
            <div className="detail-panel__head">
              <h2 className="detail-panel__id">{selected.customerNo}</h2>
              <StatusBadge tone={selected.deletedAt ? 'danger' : 'tint'}>{selected.deletedAt ? 'In trash' : CUSTOMER_TYPES[selected.type]}</StatusBadge>
            </div>
            <hr className="rule" />
            <p className="detail-panel__name">{selected.name}</p>
            <p className="detail-panel__lines">
              {selected.phone || 'No phone'}
              <br />
              {selected.email || 'No email'}
            </p>
            <p className="fine muted">Notes: {selected.notes || '—'}</p>
            <hr className="rule" />
            <p className="panel__title">Bookings</p>
            {detail.data.bookings.length ? (
              <ul className="receipt-list">
                {[...detail.data.bookings].reverse().map((b) => (
                  <li key={b.id}>
                    <span>
                      <Link to={`/bookings/records/${b.bookingNo}`}>
                        <strong>{b.bookingNo}</strong>
                      </Link>{' '}
                      · {formatDate(b.date)} · {b.start}–{b.end}
                      <span className="fine muted receipt-list__when">
                        {b.courtName} · {formatPaise(b.amountPaise)}
                      </span>
                    </span>
                    <StatusBadge status={b.paymentState} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="small muted">No bookings yet.</p>
            )}
            <div className="detail-panel__actions">
              {selected.deletedAt ? (
                <Button onClick={() => setDialog({ type: 'restore' })}>Restore customer</Button>
              ) : (
                <>
                  <Button variant="primary" onClick={() => setDialog({ type: 'book' })}>
                    Add booking
                  </Button>
                  <Button onClick={() => setDialog({ type: 'edit' })}>Edit customer</Button>
                  <Button onClick={() => setDialog({ type: 'delete' })}>Delete customer</Button>
                </>
              )}
            </div>
          </Panel>
        ) : (
          <Panel className="detail-panel">
            <p className="small muted">{selectedId && !detail.error ? 'Loading…' : (detail.error || 'Select a customer to see their details.')}</p>
          </Panel>
        )}
      </div>

      <AnimatePresence>
        {dialog?.type === 'add' && (
          <CustomerDialog
            key="add"
            onClose={close}
            onSaved={(customer) => {
              changed(`${customer.customerNo} added.`);
              select(customer.id);
            }}
          />
        )}
        {dialog?.type === 'edit' && <CustomerDialog key="edit" customer={selected} onClose={close} onSaved={(c) => changed(`${c.customerNo} updated.`)} />}
        {dialog?.type === 'book' && <BookingDialog key="book" defaults={{ customer: selected }} onClose={close} onSaved={(b) => changed(`${b.bookingNo} added.`)} />}
        {dialog?.type === 'delete' && (
          <ActionDialog
            key="delete"
            title={`Move ${selected.name} to the trash?`}
            description="Their past bookings and receipts stay on record. You can restore them later."
            label="Move to trash"
            onClose={close}
            onConfirm={async () => {
              await api(`/customers/${selected.id}`, { method: 'DELETE' });
              changed('Customer moved to the trash.');
            }}
          />
        )}
        {dialog?.type === 'restore' && (
          <ActionDialog
            key="restore"
            title={`Restore ${selected.name}?`}
            label="Restore"
            danger={false}
            onClose={close}
            onConfirm={async () => {
              await api(`/customers/${selected.id}/restore`, { method: 'POST' });
              changed('Customer restored.');
            }}
          />
        )}
      </AnimatePresence>
    </>
  );
}
