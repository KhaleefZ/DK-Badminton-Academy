import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AnimatePresence } from 'motion/react';
import PageHeader from '../layout/PageHeader';
import Button from '../components/Button';
import KpiTile, { KpiRow } from '../components/KpiTile';
import Notice from '../components/Notice';
import Panel from '../components/Panel';
import StatusBadge from '../components/StatusBadge';
import BarChart from '../components/BarChart';
import { DateFilter, FilterBar } from '../components/Filters';
import { EmptyState } from '../components/States';
import BookingDialog from '../dialogs/BookingDialog';
import { useCan } from '../auth/AuthContext';
import { useWorkspace } from '../store/WorkspaceContext';
import { addDays, formatCompactINR, formatDayMonth, formatLongDate, formatPaise, venueToday } from '../lib/format';
import { useResource } from '../lib/useResource';

const sumPaise = (rows, key) => rows.reduce((sum, row) => sum + row[key], 0);
const WEEKS_SHOWN = 4;

export default function Overview() {
  const navigate = useNavigate();
  const { notify } = useWorkspace();
  const can = useCan();
  const today = venueToday();
  const [date, setDate] = useState(today);
  const [adding, setAdding] = useState(false);

  const day = useResource(`/bookings?date=${date}`);
  const duesRes = useResource('/bookings?payment=Due');
  const showMoney = can('reports.view');
  const report = useResource(showMoney ? `/reports?from=${addDays(today, -7 * WEEKS_SHOWN + 1)}&to=${today}` : null);

  const dayBookings = day.data?.bookings ?? [];
  const active = dayBookings.filter((b) => b.status === 'active');
  const dues = duesRes.data?.bookings ?? [];
  const periods = report.data?.periods ?? [];
  const received = periods.map((p) => ({ label: formatDayMonth(p.to), value: (p.receivedPaise + p.membershipReceivedPaise) / 100 }));
  const topReceived = Math.max(1000, ...received.map((p) => p.value));

  return (
    <>
      <PageHeader title="Overview" subtitle={formatLongDate(date)} action={<Button onClick={() => setAdding(true)}>Add booking</Button>} />

      <FilterBar>
        <DateFilter label="Day" value={date} onChange={setDate} />
      </FilterBar>

      {day.error && (
        <div role="alert">
          <Notice tone="warning">{day.error}</Notice>
        </div>
      )}

      <KpiRow>
        <KpiTile label={date === today ? 'Bookings today' : 'Bookings'} value={active.length} caption={`${dayBookings.length - active.length} cancelled`} />
        <KpiTile label="Billed" value={formatPaise(sumPaise(active, 'amountPaise'))} caption="Active bookings on this day" />
        <KpiTile label="Collected" value={formatPaise(sumPaise(active, 'paidPaise'))} caption={`${active.filter((b) => b.paymentState === 'Paid').length} fully paid`} />
        <KpiTile label="All outstanding dues" value={formatPaise(sumPaise(dues, 'outstandingPaise'))} caption={`${dues.length} unpaid ${dues.length === 1 ? 'booking' : 'bookings'}, any date`} />
      </KpiRow>

      {showMoney && periods.length > 0 && (
        <Panel title="Money received" meta={`Last ${WEEKS_SHOWN} weeks · ${formatPaise(sumPaise(periods, 'receivedPaise') + sumPaise(periods, 'membershipReceivedPaise'))}`}>
          <BarChart
            data={received}
            max={topReceived}
            ticks={[topReceived, (topReceived * 2) / 3, topReceived / 3, 0]}
            unitLabel={(t) => formatCompactINR(Math.round(t))}
            formatValue={(v) => formatPaise(v * 100)}
            caption="INR, by the week ending on each date."
          />
        </Panel>
      )}

      <Panel title={date === today ? 'Today’s bookings' : 'Bookings for the day'} meta={`${dayBookings.length} ${dayBookings.length === 1 ? 'record' : 'records'}`}>
        {dayBookings.length ? (
          <div className="table-wrap">
            <table className="data-table data-table--interactive">
              <thead>
                <tr>
                  <th>Booking</th>
                  <th>Customer</th>
                  <th>Court</th>
                  <th>Time · IST</th>
                  <th>Payment</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {dayBookings.map((b) => (
                  <tr key={b.id} onClick={() => navigate(`/bookings/records/${b.bookingNo}`)}>
                    <td className="data-table__key">
                      <Link to={`/bookings/records/${b.bookingNo}`} onClick={(e) => e.stopPropagation()}>
                        {b.bookingNo}
                      </Link>
                    </td>
                    <td>{b.customer.name}</td>
                    <td>{b.courtName}</td>
                    <td>
                      {b.start}–{b.end}
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
        ) : (
          <EmptyState title="No bookings on this day" text={day.data ? 'Try another date, or add a booking.' : 'Loading…'} />
        )}
      </Panel>

      <Panel title="Outstanding dues" meta={`${dues.length} ${dues.length === 1 ? 'record' : 'records'}`}>
        <div className="due-summary">
          <div className="stack-sm">
            {dues.slice(0, 8).map((b) => (
              <p key={b.id} className="small">
                <Link to={`/bookings/records/${b.bookingNo}`}>{b.bookingNo}</Link> · {b.customer.name} · {formatPaise(b.outstandingPaise)}
              </p>
            ))}
            {dues.length > 0 ? <StatusBadge status="Due">{formatPaise(sumPaise(dues, 'outstandingPaise'))} total due</StatusBadge> : <StatusBadge status="Paid">All settled</StatusBadge>}
          </div>
          {can('payments.view') && <Button to="/payments">Review dues</Button>}
        </div>
      </Panel>

      <AnimatePresence>
        {adding && (
          <BookingDialog
            key="add"
            defaults={{ date }}
            onClose={() => setAdding(false)}
            onSaved={(booking) => {
              setAdding(false);
              day.reload();
              duesRes.reload();
              report.reload();
              notify(`${booking.bookingNo} added.`);
            }}
          />
        )}
      </AnimatePresence>
    </>
  );
}
