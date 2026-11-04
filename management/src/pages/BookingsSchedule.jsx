import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AnimatePresence } from 'motion/react';
import PageHeader from '../layout/PageHeader';
import Button from '../components/Button';
import Panel from '../components/Panel';
import Notice from '../components/Notice';
import StatusBadge from '../components/StatusBadge';
import ViewTabs from '../components/ViewTabs';
import { EmptyState } from '../components/States';
import { DateFilter, FilterBar, SelectFilter } from '../components/Filters';
import ActionDialog from '../dialogs/ActionDialog';
import BlockDialog from '../dialogs/BlockDialog';
import BookingDialog from '../dialogs/BookingDialog';
import { useCan } from '../auth/AuthContext';
import { useWorkspace } from '../store/WorkspaceContext';
import { api } from '../lib/api';
import { BLOCK_LABELS, formatLongDate, formatPaise, venueToday } from '../lib/format';
import { useResource } from '../lib/useResource';

export const BOOKING_TABS = [
  { to: '/bookings/schedule', label: 'Schedule' },
  { to: '/bookings/records', label: 'Table' },
];

const PAYMENT_OPTIONS = [
  { value: 'all', label: 'All payment states' },
  { value: 'Paid', label: 'Paid' },
  { value: 'Due', label: 'Due' },
];

function SlotCell({ slot, booking, block, selected, dimmed, onAdd, onSelect, onBlock }) {
  if (slot.status === 'closed') {
    return <span className="slot-cell slot-cell--closed">Closed{slot.closureReason ? ` · ${slot.closureReason}` : ''}</span>;
  }
  if (booking) {
    const state = booking.paymentState === 'Paid' ? 'paid' : 'due';
    return (
      <button type="button" aria-pressed={selected} className={`slot-cell slot-cell--${state}${selected ? ' is-selected' : ''}${dimmed ? ' is-dimmed' : ''}`} onClick={() => onSelect(booking)}>
        <strong>
          {booking.bookingNo} · {booking.customer.name}
        </strong>
        <span className="slot-cell__meta">
          {booking.paymentState} · {formatPaise(booking.amountPaise)}
        </span>
      </button>
    );
  }
  if (block) {
    return (
      <button type="button" className="slot-cell slot-cell--block" onClick={() => onBlock(block)}>
        <strong>{block.note}</strong>
        <span className="slot-cell__meta">{BLOCK_LABELS[block.kind]}</span>
      </button>
    );
  }
  return (
    <button type="button" className="slot-cell slot-cell--empty" onClick={onAdd}>
      {slot.status === 'past' ? 'Past · record walk-in' : 'Free'}
      {slot.pricePaise !== null && ` · ${formatPaise(slot.pricePaise)}`}
    </button>
  );
}

export default function BookingsSchedule() {
  const { notify } = useWorkspace();
  const can = useCan();
  const [params, setParams] = useSearchParams();
  const date = params.get('date') ?? venueToday();
  const selectedId = params.get('selected');
  const [courtFilter, setCourtFilter] = useState('all');
  const [payment, setPayment] = useState('all');
  const [dialog, setDialog] = useState(null);
  const { data, error, reload } = useResource(`/schedule?date=${date}`);

  const showing = data?.date === date ? data : null;
  const allCourts = showing?.courts ?? [];
  const courts = courtFilter === 'all' ? allCourts : allCourts.filter((c) => c.id === courtFilter);
  // Includes website holds: they occupy the slot until they're paid or run out.
  const active = showing?.bookings.filter((b) => b.status === 'active' || b.status === 'pending_payment') ?? [];
  const blocks = showing?.blocks ?? [];
  const selected = active.find((b) => b.bookingNo === selectedId);
  const times = [...new Map(allCourts.flatMap((c) => c.slots).map((s) => [s.start, s.end])).entries()].sort(([a], [b]) => a.localeCompare(b));
  // Hours can change after a booking was made, so it may no longer line up with any slot.
  const shownIds = new Set(allCourts.flatMap((c) => c.slots.map((s) => s.reservationId)));
  const offGrid = active.filter((b) => !shownIds.has(b.reservationId));

  const select = (booking) => setParams({ date, selected: booking.bookingNo }, { replace: true });
  const close = () => setDialog(null);
  const saved = (message) => {
    close();
    reload();
    notify(message);
  };

  return (
    <>
      <PageHeader
        title="Bookings"
        subtitle={`Court schedule · ${formatLongDate(date)} · All times IST`}
        action={
          <div className="header-actions">
            <Button icon={false} onClick={() => setDialog({ type: 'block', defaults: { date } })} disabled={!allCourts.length}>
              Block time
            </Button>
            <Button onClick={() => setDialog({ type: 'add', defaults: { date } })}>Add booking</Button>
          </div>
        }
      />

      <FilterBar>
        <DateFilter label="Day" value={date} onChange={(value) => setParams({ date: value }, { replace: true })} />
        <SelectFilter label="Court" value={courtFilter} onChange={setCourtFilter} options={[{ value: 'all', label: 'All courts' }, ...allCourts.map((c) => ({ value: c.id, label: c.name }))]} />
        <SelectFilter label="Payment state" value={payment} onChange={setPayment} options={PAYMENT_OPTIONS} />
      </FilterBar>

      <div className="toolbar">
        <ViewTabs tabs={BOOKING_TABS} label="Booking views" />
        <ul className="legend" aria-label="Legend">
          <li className="legend__item legend__item--paid">Paid</li>
          <li className="legend__item legend__item--due">Due</li>
          <li className="legend__item legend__item--selected">Selected</li>
          <li className="legend__item">Free</li>
        </ul>
      </div>

      {error && (
        <div role="alert">
          <Notice tone="warning">{error}</Notice>
        </div>
      )}
      {!showing && !error && <p className="muted small">Loading…</p>}

      {showing && !times.length && (
        <EmptyState
          title="No slots on this day"
          text={can('settings.manage') ? 'The venue is closed this day, or opening hours haven’t been set yet.' : 'The venue is closed this day, or the Owner hasn’t set opening hours yet.'}
        />
      )}
      {showing && !times.length && can('settings.manage') && <Button to="/settings">Open Settings</Button>}

      {times.length > 0 && (
        <div className="schedule" role="region" aria-label="Court schedule" tabIndex={0}>
          <table className="schedule__table" style={{ '--court-count': courts.length }}>
            <thead>
              <tr>
                <th scope="col" className="schedule__time-head">
                  IST
                </th>
                {courts.map((c) => (
                  <th key={c.id} scope="col">
                    {c.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {times.map(([start, end]) => (
                <tr key={start}>
                  <th scope="row" className="schedule__time">
                    {start}
                  </th>
                  {courts.map((court) => {
                    const slot = court.slots.find((s) => s.start === start);
                    if (!slot) return <td key={court.id} />;
                    const booking = active.find((b) => b.reservationId === slot.reservationId);
                    const block = blocks.find((b) => b.id === slot.reservationId);
                    return (
                      <td key={court.id}>
                        <SlotCell
                          slot={slot}
                          booking={booking}
                          block={block}
                          selected={booking && booking.bookingNo === selectedId}
                          dimmed={booking && payment !== 'all' && booking.paymentState !== payment}
                          onSelect={select}
                          onBlock={(b) => setDialog({ type: 'blockDetail', block: b })}
                          onAdd={() => setDialog({ type: 'add', defaults: { date, courtId: court.id, start, end } })}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {offGrid.length > 0 && (
        <Notice tone="warning">
          Outside the current opening hours:{' '}
          {offGrid.map((b, i) => (
            <span key={b.id}>
              {i > 0 && ', '}
              <Link to={`/bookings/records/${b.bookingNo}`}>{b.bookingNo}</Link> ({b.courtName}, {b.start}–{b.end})
            </span>
          ))}
          . These bookings still hold their time.
        </Notice>
      )}

      {selected && (
        <Panel className="selected-bar">
          <div className="selected-bar__inner">
            <div>
              <p className="panel__title">
                {selected.bookingNo} / {selected.customer.name}
              </p>
              <p className="small muted">
                {selected.courtName} · {selected.start}–{selected.end} · {formatPaise(selected.amountPaise)} billed / {formatPaise(selected.paidPaise)} paid / {formatPaise(selected.outstandingPaise)} due
              </p>
            </div>
            <Button to={`/bookings/records/${selected.bookingNo}`}>View booking details</Button>
          </div>
        </Panel>
      )}

      <AnimatePresence>
        {dialog?.type === 'add' && (
          <BookingDialog
            key="add"
            defaults={dialog.defaults}
            onClose={close}
            onSaved={(booking) => {
              saved(`${booking.bookingNo} added.`);
              if (booking.date !== date) setParams({ date: booking.date, selected: booking.bookingNo }, { replace: true });
              else select(booking);
            }}
          />
        )}
        {dialog?.type === 'block' && <BlockDialog key="block" defaults={dialog.defaults} courts={allCourts} onClose={close} onSaved={({ created }) => saved(created > 1 ? `${created} weekly blocks added.` : 'Block added.')} />}
        {dialog?.type === 'editBlock' && <BlockDialog key="edit-block" block={dialog.block} courts={allCourts} onClose={close} onSaved={() => saved('Block updated.')} />}
        {dialog?.type === 'blockDetail' && (
          <ActionDialog
            key="block-detail"
            title={dialog.block.note}
            description={`${BLOCK_LABELS[dialog.block.kind]} · ${dialog.block.courtName} · ${dialog.block.start}–${dialog.block.end}`}
            label="Remove block"
            onClose={close}
            onConfirm={async () => {
              await api(`/blocks/${dialog.block.id}`, { method: 'DELETE' });
              saved('Block removed. The time is free again.');
            }}
          >
            <p className="small">
              <StatusBadge tone="tint">This occurrence only</StatusBadge>
            </p>
            <button type="button" className="link-button small" onClick={() => setDialog({ type: 'editBlock', block: dialog.block })}>
              Edit this block
            </button>
          </ActionDialog>
        )}
      </AnimatePresence>
    </>
  );
}
