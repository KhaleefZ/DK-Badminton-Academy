import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
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
import { DateFilter, FilterBar, SearchFilter, SelectFilter } from '../components/Filters';
import ActionDialog from '../dialogs/ActionDialog';
import ConfirmDialog from '../dialogs/ConfirmDialog';
import PaymentDialog from '../dialogs/PaymentDialog';
import { useCan } from '../auth/AuthContext';
import { useWorkspace } from '../store/WorkspaceContext';
import { api } from '../lib/api';
import { formatDate, formatInstant, formatLongDate, formatPaise, PAYMENT_LABELS, toPaise, venueToday } from '../lib/format';
import { useResource } from '../lib/useResource';

const METHOD_OPTIONS = [{ value: 'all', label: 'All methods' }, ...Object.entries(PAYMENT_LABELS).map(([value, label]) => ({ value, label }))];
const targetOf = (p) => (p.bookingNo ? `/bookings/records/${p.bookingNo}` : `/memberships?selected=${p.membershipId}`);
const sumPaise = (rows, key) => rows.reduce((sum, row) => sum + row[key], 0);
const stateOf = (p) => (p.refundedAt && p.voidedAt ? 'Refunded' : p.voidedAt ? 'Voided' : p.refundedPaise > 0 ? 'Part refunded' : 'Received');
/** What can still be refunded from an online receipt. */
const refundable = (p) => (p.voidedAt ? 0 : p.amountPaise - (p.refundedPaise ?? 0));

/**
 * Refund all or part of an online payment. The amount starts at what's left; the Cancellation & Refund
 * Policy gives 50% back for a cancellation 6–24 hours before the start time.
 */
function RefundDialog({ receipt, onClose, onDone }) {
  const left = refundable(receipt);
  const [rupees, setRupees] = useState(String(left / 100));
  const paise = toPaise(rupees);
  const problem = paise === null || paise <= 0 ? 'Enter an amount above ₹0.' : paise > left ? `That’s more than is left to refund (${formatPaise(left)}).` : '';
  return (
    <ActionDialog
      title={`Refund ${receipt.receiptNo}?`}
      description={`Goes back to the customer through the payment gateway, usually within 5–7 working days. The booking or membership isn’t cancelled: do that separately if needed.`}
      label={paise && !problem ? `Refund ${formatPaise(paise)}` : 'Refund'}
      reasonLabel="Reason"
      reasonRequired
      onClose={onClose}
      onConfirm={async (reason) => {
        if (problem) throw new Error(problem);
        await api(`/payments/${receipt.id}/refund`, { method: 'POST', body: { reason, amountPaise: paise } });
        onDone(paise === left ? `${receipt.receiptNo} refunded.` : `${formatPaise(paise)} of ${receipt.receiptNo} refunded.`);
      }}
    >
      <Field
        label="Amount to refund (₹)"
        type="number"
        inputMode="decimal"
        min="1"
        step="0.01"
        value={rupees}
        onChange={(e) => setRupees(e.target.value)}
        error={rupees !== '' && problem ? problem : undefined}
        hint={`${formatPaise(left)} can be refunded${receipt.refundedPaise > 0 ? ` (${formatPaise(receipt.refundedPaise)} already refunded)` : ''}.`}
      />
      <div className="refund-presets">
        <button type="button" className="link-button small" onClick={() => setRupees(String(left / 100))}>
          Full ({formatPaise(left)})
        </button>
        <button type="button" className="link-button small" onClick={() => setRupees(String(Math.round(receipt.amountPaise / 2) / 100))} disabled={Math.round(receipt.amountPaise / 2) > left}>
          50% ({formatPaise(Math.round(receipt.amountPaise / 2))})
        </button>
      </div>
      <p className="fine muted">Policy: 24 hours or more before the start: full refund. 6–24 hours: 50%. Under 6 hours or a no-show: none.</p>
    </ActionDialog>
  );
}

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
  const issuesRes = useResource('/payments/issues');
  const issues = issuesRes.data?.issues ?? [];

  const receipts = receiptsRes.data?.payments ?? [];
  // Money kept: a partly refunded receipt counts only what wasn't given back.
  const live = receipts.filter((p) => !p.voidedAt).map((p) => ({ ...p, keptPaise: p.amountPaise - (p.refundedPaise ?? 0) }));
  const dues = duesRes.data?.bookings ?? [];
  const pager = usePagination(receipts, 8);
  const receipt = receipts.find((p) => p.receiptNo === params.get('receipt')) ?? receipts[0];

  const close = () => setDialog(null);
  const changed = (message) => {
    close();
    receiptsRes.reload();
    duesRes.reload();
    issuesRes.reload();
    notify(message);
  };

  const showReceipts = view !== 'Due';
  const showDues = view !== 'Paid';

  return (
    <>
      <PageHeader title="Payments & outstanding dues" subtitle={q ? `Search: ${q}` : `${date === today ? 'Today, ' : ''}${formatLongDate(date)}`} />

      <KpiRow columns={5}>
        <KpiTile label={date === today && !q ? 'Received today' : 'Received'} value={formatPaise(sumPaise(live, 'keptPaise'))} caption={`${live.length} ${live.length === 1 ? 'receipt' : 'receipts'}`} />
        <KpiTile label="Cash" value={formatPaise(sumPaise(live.filter((p) => p.method === 'cash'), 'keptPaise'))} caption="Should match the cash drawer" />
        <KpiTile label="UPI" value={formatPaise(sumPaise(live.filter((p) => p.method === 'upi'), 'keptPaise'))} caption="Should match the bank statement" />
        <KpiTile label="Online" value={formatPaise(sumPaise(live.filter((p) => p.method === 'online'), 'keptPaise'))} caption="Paid on the website; settles to the bank" />
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

      {issues.length > 0 && (
        <Panel title="Needs attention" meta={`${issues.length} online ${issues.length === 1 ? 'payment' : 'payments'}`}>
          <ul className="issue-list">
            {issues.map((issue) => (
              <li key={issue.id} className="issue-list__item">
                <div>
                  <p>{issue.message}</p>
                  <p className="fine muted">
                    {formatInstant(issue.createdAt)} IST
                    {issue.bookingNo && (
                      <>
                        {' · '}
                        <Link to={`/bookings/records/${issue.bookingNo}`}>{issue.bookingNo}</Link>
                      </>
                    )}
                    {issue.membershipNo && (
                      <>
                        {' · '}
                        <Link to={`/memberships?selected=${issue.membershipId}`}>{issue.membershipNo}</Link>
                      </>
                    )}
                  </p>
                </div>
                {can('payments.void') && (
                  <Button
                    icon={false}
                    onClick={async () => {
                      await api(`/payments/issues/${issue.id}/resolve`, { method: 'POST' });
                      changed('Marked as done.');
                    }}
                  >
                    Mark done
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Panel>
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
                              <td>
                                {p.voidedAt ? <StatusBadge status="Cancelled">{stateOf(p)} {formatPaise(p.amountPaise)}</StatusBadge> : formatPaise(p.amountPaise)}
                                {!p.voidedAt && p.refundedPaise > 0 && <span className="data-table__sub">{formatPaise(p.refundedPaise)} refunded</span>}
                              </td>
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
              <StatusBadge status={receipt.voidedAt ? 'Cancelled' : 'Paid'}>{stateOf(receipt)}</StatusBadge>
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
                {receipt.refundedPaise > 0 && !receipt.voidedAt && (
                  <>
                    <br />
                    Refunded {formatPaise(receipt.refundedPaise)} on {formatInstant(receipt.refundedAt)} IST · {formatPaise(receipt.amountPaise - receipt.refundedPaise)} kept
                  </>
                )}
                {receipt.voidedAt && (
                  <>
                    <br />
                    {receipt.refundedAt ? `Refunded ${formatInstant(receipt.refundedAt)} IST` : 'Voided'}: {receipt.voidReason}
                  </>
                )}
              </p>
              <div className="detail-panel__actions">
                <Button onClick={() => setDialog({ type: 'receipt' })}>View receipt</Button>
                {refundable(receipt) > 0 && can('payments.void') && receipt.method === 'online' && <Button onClick={() => setDialog({ type: 'refund' })}>{receipt.refundedPaise > 0 ? 'Refund more' : 'Refund'}</Button>}
                {!receipt.voidedAt && can('payments.void') && receipt.method !== 'online' && <Button onClick={() => setDialog({ type: 'void' })}>Void receipt</Button>}
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
        {dialog?.type === 'refund' && receipt && <RefundDialog key="refund" receipt={receipt} onClose={close} onDone={changed} />}
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
