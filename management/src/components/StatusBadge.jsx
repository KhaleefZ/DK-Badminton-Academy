const TONES = {
  Paid: 'success',
  Active: 'success',
  Completed: 'success',
  Upcoming: 'tint',
  Due: 'warning',
  Expiring: 'warning',
  Expired: 'danger',
  Cancelled: 'danger',
  Held: 'warning',
  Lapsed: 'tint',
};

/** DK / Status — colour is always paired with the written state. */
export default function StatusBadge({ status, tone, children }) {
  return <span className={`badge badge--${tone ?? TONES[status] ?? 'tint'}`}>{children ?? status}</span>;
}
