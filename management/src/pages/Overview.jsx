import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AnimatePresence } from 'motion/react';
import { Calendar, ChevronDown } from 'lucide-react';
import Button from '../components/Button';
import KpiTile, { KpiRow } from '../components/KpiTile';
import Notice from '../components/Notice';
import Panel from '../components/Panel';
import StatusBadge from '../components/StatusBadge';
import BarChart from '../components/BarChart';
import { EmptyState } from '../components/States';
import BookingDialog from '../dialogs/BookingDialog';
import { useCan } from '../auth/AuthContext';
import { useWorkspace } from '../store/WorkspaceContext';
import { addDays, formatCompactINR, formatDayMonth, formatLongDate, formatPaise, venueToday } from '../lib/format';
import { useResource } from '../lib/useResource';

const sumPaise = (rows, key) => rows.reduce((sum, row) => sum + row[key], 0);
const WEEKS_SHOWN = 4;

function formatDashedDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}-${m}-${y}`;
}

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

  useEffect(() => {
    document.title = 'Overview · DK Operations';
  }, []);

  // Reload data when any booking is completed (e.g. from topbar button)
  useEffect(() => {
    const handleSaved = () => {
      day.reload();
      duesRes.reload();
      report.reload();
    };
    window.addEventListener('dk:booking-saved', handleSaved);
    return () => window.removeEventListener('dk:booking-saved', handleSaved);
  }, [day, duesRes, report]);

  const dayBookings = day.data?.bookings ?? [];
  const active = dayBookings.filter((b) => b.status === 'active');
  const dues = duesRes.data?.bookings ?? [];
  const periods = report.data?.periods ?? [];
  const received = periods.map((p) => ({ label: formatDayMonth(p.to), value: (p.receivedPaise + p.membershipReceivedPaise) / 100 }));
  const topReceived = Math.max(1000, ...received.map((p) => p.value));

  return (
    <div className="overview-page">
      {/* Page Title & Subtitle + Date Filter Pill */}
      <div className="overview-page-header">
        <div className="overview-page-header__left">
          <h1 className="overview-page-header__title">Overview</h1>
          <div className="overview-page-header__date-sub">
            <Calendar size={16} strokeWidth={2} />
            <span>{formatLongDate(date)}</span>
          </div>
        </div>

        <div className="overview-page-header__right">
          <label className="date-pill-button">
            <Calendar size={15} strokeWidth={2} className="date-pill-button__icon-cal" />
            <span className="date-pill-button__text">{formatDashedDate(date)}</span>
            <ChevronDown size={14} strokeWidth={2.2} className="date-pill-button__icon-chevron" />
            <input
              type="date"
              value={date}
              onChange={(e) => e.target.value && setDate(e.target.value)}
              className="date-pill-button__native-input"
            />
          </label>
        </div>
      </div>

      {day.error && (
        <div role="alert">
          <Notice tone="warning">{day.error}</Notice>
        </div>
      )}

      {/* KPI Cards Row */}
      <KpiRow>
        <KpiTile
          variant="bookings"
          label={date === today ? 'Bookings today' : 'Bookings'}
          value={active.length}
          badge={`${dayBookings.length - active.length} cancelled`}
        />
        <KpiTile
          variant="billed"
          label="Billed"
          value={formatPaise(sumPaise(active, 'amountPaise'))}
          subtext="Active bookings on this day"
        />
        <KpiTile
          variant="collected"
          label="Collected"
          value={formatPaise(sumPaise(active, 'paidPaise'))}
          subtext={`${active.filter((b) => b.paymentState === 'Paid').length} fully paid`}
        />
        <KpiTile
          variant="dues"
          label="All outstanding dues"
          value={formatPaise(sumPaise(dues, 'outstandingPaise'))}
          subtext={`${dues.length} unpaid ${dues.length === 1 ? 'booking' : 'bookings'}, any date`}
        />
      </KpiRow>

      {/* Money Received Chart Panel */}
      {showMoney && (
        <Panel
          title="Money received"
          meta={`Last ${WEEKS_SHOWN} weeks · ${formatPaise(sumPaise(periods, 'receivedPaise') + sumPaise(periods, 'membershipReceivedPaise'))}`}
        >
          <BarChart
            data={received.length ? received : [
              { label: '14 Oct', value: 0 },
              { label: '21 Oct', value: 0 },
              { label: '28 Oct', value: 0 },
              { label: '04 Nov', value: 500 },
            ]}
            max={topReceived}
            ticks={[topReceived, (topReceived * 2) / 3, topReceived / 3, 0]}
            unitLabel={(t) => formatCompactINR(Math.round(t))}
            formatValue={(v) => formatPaise(v * 100)}
            caption="INR, by the week ending on each date."
          />
        </Panel>
      )}

      {/* Bookings Table Panel */}
      <Panel
        title={date === today ? 'Today’s bookings' : 'Bookings for the day'}
        meta={`${dayBookings.length} ${dayBookings.length === 1 ? 'record' : 'records'}`}
      >
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

      {/* Outstanding Dues Panel */}
      <Panel title="Outstanding dues" meta={`${dues.length} ${dues.length === 1 ? 'record' : 'records'}`}>
        <div className="due-summary">
          <div className="stack-sm">
            {dues.slice(0, 8).map((b) => (
              <p key={b.id} className="small">
                <Link to={`/bookings/records/${b.bookingNo}`}>{b.bookingNo}</Link> · {b.customer.name} · {formatPaise(b.outstandingPaise)}
              </p>
            ))}
            {dues.length > 0 ? (
              <StatusBadge status="Due">{formatPaise(sumPaise(dues, 'outstandingPaise'))} total due</StatusBadge>
            ) : (
              <StatusBadge status="Paid">All settled</StatusBadge>
            )}
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
    </div>
  );
}
