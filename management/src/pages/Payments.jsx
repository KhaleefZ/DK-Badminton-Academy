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
import { DateFilter, FilterBar, SearchFilter, SelectFilter } from '../components/Filters';
import ActionDialog from '../dialogs/ActionDialog';
import ConfirmDialog from '../dialogs/ConfirmDialog';
import PaymentDialog from '../dialogs/PaymentDialog';
import { useCan } from '../auth/AuthContext';
import { useWorkspace } from '../store/WorkspaceContext';
import { api } from '../lib/api';
import { formatDate, formatInstant, formatLongDate, formatPaise, PAYMENT_LABELS, venueToday } from '../lib/format';
import { useResource } from '../lib/useResource';

const METHOD_OPTIONS = [{ value: 'all', label: 'All methods' }, ...Object.entries(PAYMENT_LABELS).map(([value, label]) => ({ value, label }))];
const targetOf = (p) => (p.bookingNo ? `/bookings/records/${p.bookingNo}` : `/memberships?selected=${p.membershipId}`);
const sumPaise = (rows, key) => rows.reduce((sum, row) => sum + row[key], 0);

export default function Payments() {
  const { notify } = useWorkspace();
  const can = useCan();
  const today = venueToday();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const [date, setDate] = useState(today);
  const [method, setMethod] = useState('all');
  const [view, setView] = useState('all');
  const [dialog, setDialog] = useState(null);

  const q = query.trim();
  const search = new URLSearchParams();
  if (q) search.set('q', q);
  else search.set('date', date);
  if (method !== 'all') search.set('method', method);
  const receiptsRes = useResource(`/payments?${search}`);
  const duesRes = useResource(q ? `/bookings?payment=Due&q=${encodeURIComponent(q)}` : '/bookings?payment=Due');

  const receipts = receiptsRes.data?.payments ?? [];
  const live = receipts.filter((p) => !p.voidedAt);
  const dues = duesRes.data?.bookings ?? [];
  const pager = usePagination(receipts, 8);
  const receipt = receipts.find((p) => p.receiptNo === params.get('receipt')) ?? receipts[0];

  const close = () => setDialog(null);
  const changed = (message) => {
    close();
    receiptsRes.reload();
    duesRes.reload();
    notify(message);
  };

  const showReceipts = view !== 'Due';
  const showDues = view !== 'Paid';

  return (
    <>
      <PageHeader title="Payments & outstanding dues" subtitle={q ? `Search: ${q}` : `${date === today ? 'Today, ' : ''}${formatLongDate(date)}`} />

      <KpiRow>
        <KpiTile label={date === today && !q ? 'Received today' : 'Received'} value={formatPaise(sumPaise(live, 'amountPaise'))} caption={`${live.length} ${live.length === 1 ? 'receipt' : 'receipts'}`} />
        <KpiTile label="Cash" value={formatPaise(sumPaise(live.filter((p) => p.method === 'cash'), 'amountPaise'))} caption="Should match the cash drawer" />
        <KpiTile label="UPI" value={formatPaise(sumPaise(live.filter((p) => p.method === 'upi'), 'amountPaise'))} caption="Should match the bank statement" />
        <KpiTile label="Bookings outstanding" value={formatPaise(sumPaise(dues, 'outstandingPaise'))} caption={`${dues.length} unpaid ${dues.length === 1 ? 'booking' : 'bookings'}`} />
      </KpiRow>

      <FilterBar>
        <SearchFilter label="Search receipt, booking or customer" value={query} onChange={setQuery} />
        <DateFilter label="Date" value={date} onChange={setDate} />
        <SelectFilter label="Method" value={method} onChange={setMethod} options={METHOD_OPTIONS} />
        <SelectFilter
          label="Payment state"
          value={view}
          onChange={setView}
          options={[
            { value: 'all', label: 'Received and outstanding' },
            { value: 'Paid', label: 'Received only' },
            { value: 'Due', label: 'Bookings outstanding only' },
          ]}
        />
      </FilterBar>

      {(receiptsRes.error || duesRes.error) && (
        <div role="alert">
          <Notice tone="warning">{receiptsRes.error || duesRes.error}</Notice>
        </div>
      )}

      <div className="detail-layout">
        <div className="stack-lg">
          {showReceipts && (
            <Panel title="Receipts" meta={`${receipts.length} ${receipts.length === 1 ? 'receipt' : 'receipts'}`}>
              {receipts.length ? (
                <>
                  <div className="table-wrap">
                    <table className="data-table data-table--interactive">
                      <thead>
                        <tr>
                          <th>Receipt / booking</th>
                          <th>Customer</th>
                          <th>Method</th>
                          <th>Received</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pager.rows.map((p) => {
                          const choose = () => setParams({ receipt: p.receiptNo }, { replace: true });
                          return (
                            <tr key={p.id} className={p.id === receipt?.id ? 'is-selected' : undefined} onClick={choose}>
                              <td className="data-table__key">
                                <button type="button" className="link-button" onClick={choose}>
                                  {p.receiptNo}
                                </button>
                                <Link to={targetOf(p)} className="data-table__sub" onClick={(e) => e.stopPropagation()}>
                                  {p.bookingNo ?? p.membershipNo}
                                </Link>
                              </td>
                              <td>{p.customerName}</td>
                              <td>{PAYMENT_LABELS[p.method]}</td>
                              <td>{p.voidedAt ? <StatusBadge status="Cancelled">Voided {formatPaise(p.amountPaise)}</StatusBadge> : formatPaise(p.amountPaise)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <Pagination pager={pager} noun="receipts" />
                </>
              ) : (
                <EmptyState title="No receipts" text={receiptsRes.data ? 'No payments match. Record one from a booking.' : 'Loading…'} />
              )}
            </Panel>
          )}

          {showDues && (
            <Panel title="Outstanding dues" meta={`${formatPaise(sumPaise(dues, 'outstandingPaise'))} total`}>
              {dues.length ? (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Booking</th>
                        <th>Customer</th>
                        <th>Session</th>
                        <th>Due</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dues.map((b) => (
                        <tr key={b.id}>
                          <td className="data-table__key">
                            <Link to={`/bookings/records/${b.bookingNo}`}>{b.bookingNo}</Link>
                          </td>
                          <td>
                            {b.customer.name}
                            <span className="data-table__sub">{b.customer.phone}</span>
                          </td>
                          <td>{formatDate(b.date)}</td>
                          <td>{formatPaise(b.outstandingPaise)}</td>
                          <td>
                            <button type="button" className="link-button small" onClick={() => setDialog({ type: 'record', booking: b })}>
                              Record payment
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="small muted">No outstanding dues.</p>
              )}
            </Panel>
          )}
        </div>

        <div className="stack-lg">
          {receipt && (
            <Panel className="detail-panel" title={`Receipt ${receipt.receiptNo}`}>
              <StatusBadge status={receipt.voidedAt ? 'Cancelled' : 'Paid'}>{receipt.voidedAt ? 'Voided' : 'Received'}</StatusBadge>
              <Link to={receipt.customerId ? `/customers?selected=${receipt.customerId}` : targetOf(receipt)} className="detail-panel__name">
                {receipt.customerName}
              </Link>
              <p className="detail-panel__lines">
                {receipt.bookingNo ? 'Booking' : 'Membership'} <Link to={targetOf(receipt)}>{receipt.bookingNo ?? receipt.membershipNo}</Link>
                <br />
                {formatInstant(receipt.receivedAt)} IST
                <br />
                Method: {PAYMENT_LABELS[receipt.method]}
                {receipt.reference ? ` · ${receipt.reference}` : ''}
                <br />
                Amount: {formatPaise(receipt.amountPaise)}
                {receipt.voidedAt && (
                  <>
                    <br />
                    Voided: {receipt.voidReason}
                  </>
                )}
              </p>
              <div className="detail-panel__actions">
                <Button onClick={() => setDialog({ type: 'receipt' })}>View receipt</Button>
                {!receipt.voidedAt && can('payments.void') && <Button onClick={() => setDialog({ type: 'void' })}>Void receipt</Button>}
              </div>
            </Panel>
          )}
        </div>
      </div>

      <AnimatePresence>
        {dialog?.type === 'record' && <PaymentDialog key="record" booking={dialog.booking} onClose={close} onSaved={(p) => changed(`${formatPaise(p.amountPaise)} recorded · ${p.receiptNo}`)} />}
        {dialog?.type === 'receipt' && receipt && (
          <ConfirmDialog key="receipt" title={`Receipt ${receipt.receiptNo}`} onClose={close}>
            <div className="receipt">
              <p className="receipt__brand">DK BADMINTON ACADEMY</p>
              <p className="fine muted">Selvapuram North · Coimbatore</p>
              <hr className="rule" />
              <dl className="receipt__lines">
                <dt>Receipt</dt>
                <dd>{receipt.receiptNo}</dd>
                <dt>Customer</dt>
                <dd>
                  {receipt.customerName} ({receipt.customerNo})
                </dd>
                <dt>{receipt.bookingNo ? 'Booking' : 'Membership'}</dt>
                <dd>{receipt.bookingNo ?? receipt.membershipNo}</dd>
                <dt>Received</dt>
                <dd>{formatInstant(receipt.receivedAt)}</dd>
                <dt>Method</dt>
                <dd>{PAYMENT_LABELS[receipt.method]}</dd>
                <dt>Amount</dt>
                <dd className="receipt__amount">{formatPaise(receipt.amountPaise)}</dd>
              </dl>
              <p className="fine muted">{receipt.voidedAt ? `VOIDED: ${receipt.voidReason}` : 'Not a tax invoice.'}</p>
            </div>
          </ConfirmDialog>
        )}
        {dialog?.type === 'void' && receipt && (
          <ActionDialog
            key="void"
            title={`Void ${receipt.receiptNo}?`}
            description={`${formatPaise(receipt.amountPaise)} stops counting as received, and the booking’s balance reopens. The receipt stays on record.`}
            label="Void receipt"
            reasonLabel="Reason"
            reasonRequired
            onClose={close}
            onConfirm={async (reason) => {
              await api(`/payments/${receipt.id}/void`, { method: 'POST', body: { reason } });
              changed(`${receipt.receiptNo} voided.`);
            }}
          />
        )}
      </AnimatePresence>
    </>
  );
}
