import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AnimatePresence } from 'motion/react';
import PageHeader from '../layout/PageHeader';
import Button from '../components/Button';
import KpiTile, { KpiRow } from '../components/KpiTile';
import Panel from '../components/Panel';
import Notice from '../components/Notice';
import StatusBadge from '../components/StatusBadge';
import ViewTabs from '../components/ViewTabs';
import Pagination, { usePagination } from '../components/Pagination';
import { EmptyState } from '../components/States';
import { DateFilter, FilterBar, SearchFilter, SelectFilter, toOptions } from '../components/Filters';
import ActionDialog from '../dialogs/ActionDialog';
import BookingDialog from '../dialogs/BookingDialog';
import PaymentDialog from '../dialogs/PaymentDialog';
import { useCan } from '../auth/AuthContext';
import { useWorkspace } from '../store/WorkspaceContext';
import { api } from '../lib/api';
import { formatDate, formatFullDate, formatInstant, formatPaise, MESSAGE_LABELS, MESSAGE_STATUS, MESSAGE_TONES, PAYMENT_LABELS, venueToday } from '../lib/format';
import { useResource } from '../lib/useResource';
import { BOOKING_TABS } from './BookingsSchedule';

const totals = (rows, key) => rows.reduce((sum, row) => sum + row[key], 0);

export default function BookingsTable() {
  const { bookingId } = useParams();
  const navigate = useNavigate();
  const { notify } = useWorkspace();
  const today = venueToday();

  const [query, setQuery] = useState('');
  const [date, setDate] = useState(today);
  const [session, setSession] = useState('all');
  const [payment, setPayment] = useState('all');
  const [dialog, setDialog] = useState(null);

  const q = query.trim();
  // A search looks across every date; otherwise the table shows one day.
  const { data, error, reload } = useResource(q ? `/bookings?q=${encodeURIComponent(q)}` : `/bookings?date=${date}`);
  const detail = useResource(bookingId ? `/bookings/${encodeURIComponent(bookingId)}` : null);
  const routed = bookingId && detail.data?.booking.bookingNo === bookingId.toUpperCase() ? detail.data.booking : null;

  // Jump the table to the routed booking's day (e.g. arriving from search or alerts).
  useEffect(() => {
    if (routed?.date) setDate(routed.date);
  }, [routed?.date]);

  const bookings = data?.bookings ?? [];
  const rows = bookings.filter((b) => (session === 'all' || b.session === session) && (payment === 'all' || b.paymentState === payment));
  const pager = usePagination(rows, 6);
  const active = bookings.filter((b) => b.status === 'active');
  const clearFilters = () => {
    setQuery('');
    setSession('all');
    setPayment('all');
  };
  const close = () => setDialog(null);
  const changed = (message) => {
    close();
    reload();
    detail.reload();
    notify(message);
  };

  return (
    <>
      <PageHeader
        title="Bookings"
        subtitle="Every court booking, its customer and its payments."
        action={<Button onClick={() => setDialog({ type: 'add' })}>Add booking</Button>}
      />

      <KpiRow columns={3}>
        <KpiTile label={q ? 'Matching bookings' : date === today ? 'Today’s bookings' : 'Bookings'} value={active.length} caption={q ? `Search: ${q}` : formatFullDate(date)} />
        <KpiTile label="Billed amount" value={formatPaise(totals(active, 'amountPaise'))} caption={`${active.length} active ${active.length === 1 ? 'booking' : 'bookings'}`} />
        <KpiTile
          label="Collected / outstanding"
          value={`${formatPaise(totals(active, 'paidPaise'))} / ${formatPaise(totals(active, 'outstandingPaise'))}`}
          caption={`${active.filter((b) => b.paymentState === 'Paid').length} paid / ${active.filter((b) => b.paymentState === 'Due').length} due`}
        />
      </KpiRow>

      <FilterBar>
        <SearchFilter label="Search booking, name, phone or email" value={query} onChange={setQuery} />
        <DateFilter
          label="Date"
          value={date}
          onChange={(value) => {
            setDate(value);
            setQuery('');
            if (routed && routed.date !== value) navigate('/bookings/records', { replace: true });
          }}
        />
        <SelectFilter label="Session status" value={session} onChange={setSession} options={toOptions('All statuses', ['Upcoming', 'Completed', 'Cancelled'])} />
        <SelectFilter label="Payment state" value={payment} onChange={setPayment} options={toOptions('All payments', ['Paid', 'Due', 'Held', 'Cancelled', 'Expired'])} />
      </FilterBar>

      <ViewTabs tabs={BOOKING_TABS} label="Booking views" />

      {error && (
        <div role="alert">
          <Notice tone="warning">{error}</Notice>
        </div>
      )}

      <div className="detail-layout">
        <div className="stack-lg">
          <Panel title="Booking records" meta={`${rows.length} ${rows.length === 1 ? 'record' : 'records'}`}>
            {rows.length ? (
              <>
                <div className="table-wrap">
                  <table className="data-table data-table--interactive">
                    <thead>
                      <tr>
                        <th>Booking / court</th>
                        <th>Customer</th>
                        <th>Time · IST</th>
                        <th>Payment</th>
                        <th>Billed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pager.rows.map((b) => (
                        <tr key={b.id} className={b.id === routed?.id ? 'is-selected' : undefined} onClick={() => navigate(`/bookings/records/${b.bookingNo}`, { replace: true })}>
                          <td className="data-table__key">
                            <Link to={`/bookings/records/${b.bookingNo}`} replace onClick={(e) => e.stopPropagation()}>
                              {b.bookingNo}
                            </Link>
                            <span className="data-table__sub">{b.courtName}</span>
                          </td>
                          <td>
                            {b.customer.name}
                            <span className="data-table__sub">{b.customer.customerNo}</span>
                          </td>
                          <td>
                            {b.start}–{b.end}
                            {q && <span className="data-table__sub">{formatDate(b.date)}</span>}
                          </td>
                          <td>
                            <StatusBadge status={b.paymentState} />
                          </td>
                          <td>{formatPaise(b.amountPaise)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pagination pager={pager} />
              </>
            ) : (
              <EmptyState text={data ? 'No bookings match. Try another date, or clear the filters.' : 'Loading…'} onClear={clearFilters} />
            )}
          </Panel>
        </div>

        {routed ? (
          <BookingDetail
            booking={routed}
            receipts={detail.data.payments}
            messages={detail.data.messages}
            whatsappUrl={detail.data.whatsappUrl}
            onResend={async () => {
              try {
                await api(`/bookings/${routed.id}/resend-email`, { method: 'POST' });
                detail.reload();
                notify('Confirmation email queued.');
              } catch (err) {
                notify(err.message);
              }
            }}
            onWhatsapp={() => {
              // Only a record for the history, so a failure mustn't get in the way of the chat.
              api(`/bookings/${routed.id}/whatsapp-opened`, { method: 'POST' }).then(detail.reload).catch(() => {});
            }}
            onPay={() => setDialog({ type: 'pay' })}
            onEdit={() => setDialog({ type: 'edit' })}
            onCancel={() => setDialog({ type: 'cancel' })}
            onRestore={() => setDialog({ type: 'restore' })}
            onVoid={(receipt) => setDialog({ type: 'void', receipt })}
          />
        ) : (
          <Panel className="detail-panel">
            {bookingId && detail.error ? (
              <div role="alert">
                <Notice tone="warning">{detail.error}</Notice>
              </div>
            ) : (
              <p className="small muted">{bookingId ? 'Loading…' : 'Select a booking to see its details.'}</p>
            )}
          </Panel>
        )}
      </div>

      <AnimatePresence>
        {dialog?.type === 'add' && (
          <BookingDialog
            key="add"
            defaults={{ date }}
            onClose={close}
            onSaved={(booking) => {
              changed(`${booking.bookingNo} added.`);
              navigate(`/bookings/records/${booking.bookingNo}`, { replace: true });
            }}
          />
        )}
        {dialog?.type === 'edit' && <BookingDialog key="edit" booking={routed} onClose={close} onSaved={(b) => changed(`${b.bookingNo} updated.`)} />}
        {dialog?.type === 'pay' && <PaymentDialog key="pay" booking={routed} onClose={close} onSaved={(p) => changed(`${formatPaise(p.amountPaise)} recorded · ${p.receiptNo}`)} />}
        {dialog?.type === 'cancel' && (
          <ActionDialog
            key="cancel"
            title={`Cancel ${routed.bookingNo}?`}
            description={`${routed.customer.name} · ${routed.courtName} · ${formatDate(routed.date)} · ${routed.start}–${routed.end}. The slot becomes free. No message is sent.`}
            label="Cancel booking"
            reasonLabel="Reason (optional)"
            onClose={close}
            onConfirm={async (reason) => {
              await api(`/bookings/${routed.id}/cancel`, { method: 'POST', body: { reason } });
              changed(`${routed.bookingNo} cancelled.`);
            }}
          >
            {routed.paidPaise > 0 && <Notice tone="warning">{formatPaise(routed.paidPaise)} has been paid. Under the refund policy: 24 hours or more before the start, refund in full; 6–24 hours, refund 50%; under 6 hours, nothing. Refund from the Payments page.</Notice>}
          </ActionDialog>
        )}
        {dialog?.type === 'restore' && (
          <ActionDialog
            key="restore"
            title={`Restore ${routed.bookingNo}?`}
            description="It takes its slot back, if that time is still free."
            label="Restore booking"
            danger={false}
            onClose={close}
            onConfirm={async () => {
              await api(`/bookings/${routed.id}/restore`, { method: 'POST' });
              changed(`${routed.bookingNo} restored.`);
            }}
          />
        )}
        {dialog?.type === 'void' && (
          <ActionDialog
            key="void"
            title={`Void ${dialog.receipt.receiptNo}?`}
            description={`${formatPaise(dialog.receipt.amountPaise)} stops counting as received, and the booking’s balance reopens. The receipt stays on record.`}
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

function BookingDetail({ booking, receipts, messages, whatsappUrl, onResend, onWhatsapp, onPay, onEdit, onCancel, onRestore, onVoid }) {
  const can = useCan();
  const cancelled = booking.status === 'cancelled';
  const confirmed = booking.status === 'active';
  const held = booking.status === 'pending_payment';

  return (
    <Panel className="detail-panel">
      <div className="detail-panel__head">
        <h2 className="detail-panel__id">{booking.bookingNo}</h2>
        <StatusBadge status={booking.paymentState} />
      </div>
      <hr className="rule" />
      <Link to={`/customers?selected=${booking.customer.id}`} className="detail-panel__name">
        {booking.customer.name}
      </Link>
      <p className="detail-panel__lines">
        {booking.customer.customerNo} · {booking.customer.phone || 'No phone'}
        <br />
        {formatDate(booking.date)}
        <br />
        {booking.courtName} · {booking.start}–{booking.end}
      </p>
      <hr className="rule" />
      <p className="detail-panel__lines">
        Billed: {formatPaise(booking.amountPaise)}
        <br />
        Paid: {formatPaise(booking.paidPaise)}
        <br />
        Outstanding: {formatPaise(booking.outstandingPaise)}
      </p>
      <StatusBadge status={booking.session}>{booking.session === 'Cancelled' ? 'Session cancelled' : `Session ${booking.session.toLowerCase()}`}</StatusBadge>
      {held && <Notice tone="warning">Waiting for the customer to pay online. The slot is held until {formatInstant(booking.holdExpiresAt)}.</Notice>}
      {booking.source === 'website' && <p className="fine muted">Booked on the website.</p>}
      {booking.paidOnCancelledPaise > 0 && <Notice tone="warning">{formatPaise(booking.paidOnCancelledPaise)} was paid on this cancelled booking. Check whether it needs refunding.</Notice>}
      <p className="fine muted">
        {cancelled && booking.cancelReason && (
          <>
            Cancelled: {booking.cancelReason}
            <br />
          </>
        )}
        Notes: {booking.notes || '—'}
      </p>
      {receipts.length > 0 && (
        <ul className="receipt-list">
          {receipts.map((r) => (
            <li key={r.id} className={r.voidedAt ? 'is-voided' : undefined}>
              <span>
                <strong>{r.receiptNo}</strong> · {formatPaise(r.amountPaise)} · {PAYMENT_LABELS[r.method]}
                {r.reference ? ` · ${r.reference}` : ''}
                <span className="fine muted receipt-list__when">
                  {formatInstant(r.receivedAt)}
                  {r.voidedAt ? ` · Voided: ${r.voidReason}` : ''}
                </span>
              </span>
              {!r.voidedAt && can('payments.void') && (
                <button type="button" className="link-button small" onClick={() => onVoid(r)}>
                  Void
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {messages.length > 0 && (
        <>
          <p className="panel__title">Messages</p>
          <ul className="receipt-list">
            {messages.map((m) => (
              <li key={m.id}>
                <span>
                  {MESSAGE_LABELS[m.template] ?? m.template}
                  <span className="fine muted receipt-list__when">
                    {formatInstant(m.sentAt ?? m.createdAt)}
                    {m.lastError ? ` · ${m.lastError}` : ''}
                  </span>
                </span>
                <StatusBadge tone={MESSAGE_TONES[m.status]}>{MESSAGE_STATUS[m.status]}</StatusBadge>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="detail-panel__actions">
        {booking.outstandingPaise > 0 && (
          <Button variant="primary" onClick={onPay}>
            Record payment
          </Button>
        )}
        {confirmed && <Button onClick={onEdit}>Edit booking</Button>}
        {(confirmed || held) && <Button onClick={onCancel}>{held ? 'Release hold' : 'Cancel booking'}</Button>}
        {cancelled && <Button onClick={onRestore}>Restore booking</Button>}
        {confirmed && booking.customer.email && <Button onClick={onResend}>Resend email</Button>}
        {whatsappUrl && (
          <Button href={whatsappUrl} onClick={onWhatsapp}>
            Send on WhatsApp
          </Button>
        )}
        <Button to={`/bookings/schedule?date=${booking.date}&selected=${booking.bookingNo}`}>Show in schedule</Button>
      </div>
    </Panel>
  );
}
