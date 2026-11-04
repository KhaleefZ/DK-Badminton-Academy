import { useState } from 'react';
import PageHeader from '../layout/PageHeader';
import Button from '../components/Button';
import KpiTile, { KpiRow } from '../components/KpiTile';
import Panel from '../components/Panel';
import Notice from '../components/Notice';
import BarChart from '../components/BarChart';
import { DateFilter, FilterBar, SelectFilter } from '../components/Filters';
import { useWorkspace } from '../store/WorkspaceContext';
import { formatCompactINR, formatDayMonth, formatPaise, venueToday } from '../lib/format';
import { useResource } from '../lib/useResource';

const METRICS = [
  { value: 'receivedPaise', label: 'Bookings received' },
  { value: 'membershipReceivedPaise', label: 'Memberships received' },
  { value: 'billedPaise', label: 'Billed amount' },
];

const sum = (rows, key) => rows.reduce((total, row) => total + row[key], 0);
const percent = (booked, open) => (open ? `${Math.round((booked / open) * 1000) / 10}%` : '—');

/** Wraps a value so a comma or quote in it can't break the CSV. */
const csvCell = (value) => `"${String(value).replace(/"/g, '""')}"`;

export default function Reports() {
  const { notify } = useWorkspace();
  const today = venueToday();
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const [court, setCourt] = useState('all');
  const [metric, setMetric] = useState('receivedPaise');
  const { data: setup } = useResource('/settings');
  const { data, error } = useResource(`/reports?from=${from}&to=${to}${court === 'all' ? '' : `&courtId=${court}`}`);

  const periods = data?.periods ?? [];
  const metricLabel = METRICS.find((m) => m.value === metric).label;
  const chart = periods.map((p) => ({ label: `${formatDayMonth(p.from)}`, value: p[metric] / 100 }));
  const top = Math.max(1000, ...chart.map((p) => p.value));
  const bookingTop = Math.max(6, ...periods.map((p) => p.bookings));
  const label = (p) => `${formatDayMonth(p.from)}–${formatDayMonth(p.to)}`;

  const exportCsv = () => {
    const header = ['Period', 'Bookings', 'Billed (INR)', 'Bookings received (INR)', 'Memberships received (INR)', 'Occupancy'];
    const lines = periods.map((p) => [label(p), p.bookings, p.billedPaise / 100, p.receivedPaise / 100, p.membershipReceivedPaise / 100, percent(p.bookedMinutes, p.openMinutes)]);
    lines.push(['Total', sum(periods, 'bookings'), sum(periods, 'billedPaise') / 100, sum(periods, 'receivedPaise') / 100, sum(periods, 'membershipReceivedPaise') / 100, percent(sum(periods, 'bookedMinutes'), sum(periods, 'openMinutes'))]);
    const csv = [header, ...lines].map((row) => row.map(csvCell).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const link = Object.assign(document.createElement('a'), { href: url, download: `dk-report-${from}-to-${to}.csv` });
    link.click();
    URL.revokeObjectURL(url);
    notify('Report exported as CSV.');
  };

  return (
    <>
      <PageHeader title="Reports" subtitle="Court bookings and money, by week." action={<Button onClick={exportCsv} disabled={!periods.length}>Export CSV</Button>} />

      <FilterBar>
        <DateFilter label="From" value={from} onChange={setFrom} max={to} />
        <DateFilter label="To" value={to} onChange={setTo} min={from} />
        <SelectFilter label="Court" value={court} onChange={setCourt} options={[{ value: 'all', label: 'All courts' }, ...(setup?.courts ?? []).map((c) => ({ value: c.id, label: c.name }))]} />
        <SelectFilter label="Metric" value={metric} onChange={setMetric} options={METRICS} />
      </FilterBar>

      {error && (
        <div role="alert">
          <Notice tone="warning">{error}</Notice>
        </div>
      )}

      <KpiRow>
        <KpiTile label="Bookings received" value={formatPaise(sum(periods, 'receivedPaise'))} caption={`${formatPaise(sum(periods, 'billedPaise'))} billed`} />
        <KpiTile label="Memberships received" value={formatPaise(sum(periods, 'membershipReceivedPaise'))} caption={court === 'all' ? 'Across all courts' : 'Not split by court'} />
        <KpiTile label="Bookings" value={sum(periods, 'bookings')} caption={`${Math.round(sum(periods, 'bookedMinutes') / 6) / 10} court hours`} />
        <KpiTile label="Occupancy" value={percent(sum(periods, 'bookedMinutes'), sum(periods, 'openMinutes'))} caption={`Of ${Math.round(sum(periods, 'openMinutes') / 60)} open court hours`} />
      </KpiRow>

      <div className="grid-2">
        <Panel title={`${metricLabel} trend`} meta="INR">
          <BarChart data={chart} max={top} ticks={[top, (top * 2) / 3, top / 3, 0]} unitLabel={(t) => formatCompactINR(Math.round(t))} formatValue={(v) => formatPaise(v * 100)} caption="By the week starting on each date." />
        </Panel>
        <Panel title="Booking trend" meta={`${sum(periods, 'bookings')} bookings`}>
          <BarChart data={periods.map((p) => ({ label: formatDayMonth(p.from), value: p.bookings }))} max={bookingTop} ticks={[bookingTop, Math.round((bookingTop * 2) / 3), Math.round(bookingTop / 3), 0]} caption="Active bookings, by the week starting on each date." />
        </Panel>
      </div>

      <Panel title="By week">
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Period</th>
                <th>Bookings</th>
                <th>Billed</th>
                <th>Bookings received</th>
                <th>Memberships received</th>
                <th>Occupancy</th>
              </tr>
            </thead>
            <tbody>
              {periods.map((p) => (
                <tr key={p.from}>
                  <td className="data-table__key">{label(p)}</td>
                  <td>{p.bookings}</td>
                  <td>{formatPaise(p.billedPaise)}</td>
                  <td>{formatPaise(p.receivedPaise)}</td>
                  <td>{formatPaise(p.membershipReceivedPaise)}</td>
                  <td>{percent(p.bookedMinutes, p.openMinutes)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Total</td>
                <td>{sum(periods, 'bookings')}</td>
                <td>{formatPaise(sum(periods, 'billedPaise'))}</td>
                <td>{formatPaise(sum(periods, 'receivedPaise'))}</td>
                <td>{formatPaise(sum(periods, 'membershipReceivedPaise'))}</td>
                <td>{percent(sum(periods, 'bookedMinutes'), sum(periods, 'openMinutes'))}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Panel>

      <Notice>
        Billed counts active bookings whose session falls in the period. Received counts money by the day it arrived, including money on bookings cancelled later. Occupancy compares booked time with today’s opening hours and doesn’t yet count closures or member blocks. Membership money isn’t tied to one court, so a one-court report shows none.
      </Notice>
    </>
  );
}
