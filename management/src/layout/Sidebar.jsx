import { NavLink, useLocation } from 'react-router-dom';
import { BarChart2, Calendar, Contact, Globe, LayoutGrid, LogOut, MessageSquare, Settings, ShieldCheck, Users, Wallet } from 'lucide-react';
import { useAuth, useCan } from '../auth/AuthContext';
import { INBOX, PEOPLE, inSection } from './sections';

// A grouped item (`section`) opens its first tab the staff member may see, and stays highlighted on any of its tabs.
const NAV = [
  { to: '/', label: 'Overview', icon: LayoutGrid, end: true },
  { to: '/bookings', label: 'Bookings', icon: Calendar },
  { section: PEOPLE, icon: Contact },
  { to: '/memberships/setup', label: 'Plans & batches', icon: Users },
  { section: INBOX, icon: MessageSquare },
  { to: '/payments', label: 'Payments', icon: Wallet, permission: 'payments.view' },
  { to: '/reports', label: 'Reports', icon: BarChart2, permission: 'reports.view' },
  { to: '/website', label: 'Website', icon: Globe, permission: 'website.manage' },
  { to: '/staff', label: 'Staff', icon: ShieldCheck, permission: 'staff.manage' },
  { to: '/settings', label: 'Settings', icon: Settings, permission: 'settings.manage' },
];

/** Management sidebar matching the modern curved aesthetic. */
export default function Sidebar({ open, onNavigate }) {
  const { signOut } = useAuth();
  const can = useCan();
  const { pathname } = useLocation();
  const items = NAV.flatMap((item) => {
    if (!item.section) return !item.permission || can(item.permission) ? [item] : [];
    const first = item.section.tabs.find((tab) => !tab.permission || can(tab.permission));
    return first ? [{ to: first.to, label: item.section.label, icon: item.icon, active: inSection(item.section, pathname) }] : [];
  });

  return (
    <aside id="sidebar" className={`sidebar${open ? ' is-open' : ''}`}>
      <div className="sidebar__header">
        <NavLink to="/" className="sidebar__monogram" aria-label="DK Operations overview" onClick={onNavigate}>
          <span>DK</span>
        </NavLink>
        <p className="sidebar__title">ACADEMY MANAGEMENT</p>
      </div>

      <nav className="sidebar__nav" aria-label="Management">
        {items.map(({ to, label, icon: Icon, end, active }) => (
          <NavLink
            key={label}
            to={to}
            end={end}
            // A grouped item decides its own highlight, so it stays lit on either of its tabs.
            className={({ isActive }) => `sidebar__item${(active ?? isActive) ? ' active' : ''}`}
            aria-current={active ? 'page' : undefined}
            onClick={onNavigate}
          >
            <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>

      {/* Organic fluid curves in the bottom of the sidebar */}
      <div className="sidebar__wave-decoration" aria-hidden="true">
        <svg viewBox="0 0 240 160" fill="none" xmlns="http://www.w3.org/2000/svg" className="sidebar__wave-svg">
          <path
            d="M-20 120 C40 100 80 140 140 110 C200 80 230 130 260 120 L260 180 L-20 180 Z"
            fill="url(#sidebarWaveGrad1)"
            opacity="0.35"
          />
          <path
            d="M-20 140 C50 110 110 130 160 105 C210 80 230 110 260 95 L260 180 L-20 180 Z"
            fill="url(#sidebarWaveGrad2)"
            opacity="0.65"
          />
          <defs>
            <linearGradient id="sidebarWaveGrad1" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#10b981" />
              <stop offset="100%" stopColor="#047857" />
            </linearGradient>
            <linearGradient id="sidebarWaveGrad2" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#22c55e" />
              <stop offset="100%" stopColor="#15803d" />
            </linearGradient>
          </defs>
        </svg>
      </div>

      <div className="sidebar__workspace">
        <button
          type="button"
          className="sidebar__signout"
          onClick={() => {
            signOut();
          }}
        >
          <LogOut size={16} strokeWidth={1.8} aria-hidden="true" />
          <span>Sign out</span>
        </button>
      </div>
    </aside>
  );
}
