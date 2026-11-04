import { NavLink } from 'react-router-dom';
import { BadgeCheck, CalendarDays, ChartNoAxesCombined, Contact, Gift, Globe, LayoutDashboard, LogOut, Mail, MessageSquare, Settings, ShieldCheck, Users, Wallet } from 'lucide-react';
import { useAuth, useCan } from '../auth/AuthContext';

const NAV = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/bookings', label: 'Bookings', icon: CalendarDays },
  { to: '/customers', label: 'Customers', icon: Contact },
  { to: '/enquiries', label: 'Enquiries', icon: MessageSquare, permission: 'enquiries.manage' },
  { to: '/messages', label: 'Messages', icon: Mail, permission: 'messages.manage' },
  { to: '/memberships', label: 'Memberships', icon: BadgeCheck, end: true },
  { to: '/memberships/setup', label: 'Plans & batches', icon: Users },
  { to: '/referrals', label: 'Referrals', icon: Gift, permission: 'referrals.view' },
  { to: '/payments', label: 'Payments', icon: Wallet, permission: 'payments.view' },
  { to: '/reports', label: 'Reports', icon: ChartNoAxesCombined, permission: 'reports.view' },
  { to: '/website', label: 'Website', icon: Globe, permission: 'website.manage' },
  { to: '/staff', label: 'Staff', icon: ShieldCheck, permission: 'staff.manage' },
  { to: '/settings', label: 'Settings', icon: Settings, permission: 'settings.manage' },
];

/** Management sidebar (224px). DK / Sidebar item: Selected · Default. */
export default function Sidebar({ open, onNavigate }) {
  const { signOut } = useAuth();
  const can = useCan();

  return (
    <aside id="sidebar" className={`sidebar${open ? ' is-open' : ''}`}>
      <NavLink to="/" className="sidebar__monogram" aria-label="DK Operations overview" onClick={onNavigate}>
        DK
      </NavLink>
      <p className="sidebar__title">ACADEMY MANAGEMENT</p>
      <nav className="sidebar__nav" aria-label="Management">
        {NAV.filter(({ permission }) => !permission || can(permission)).map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className="sidebar__item" onClick={onNavigate}>
            <Icon size={18} strokeWidth={1.6} aria-hidden="true" />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
      <div className="sidebar__workspace">
        <hr className="rule rule--light" />
        <p>
          DK Badminton Academy
          <br />
          Selvapuram North Coimbatore, Tamil Nadu
        </p>
        <button
          type="button"
          className="sidebar__signout"
          onClick={() => {
            signOut();
          }}
        >
          <LogOut size={18} strokeWidth={1.6} aria-hidden="true" />
          <span>Sign out</span>
        </button>
      </div>
    </aside>
  );
}
