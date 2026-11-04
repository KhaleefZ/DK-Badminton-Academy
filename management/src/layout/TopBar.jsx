import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Bell, Menu, Search } from 'lucide-react';
import { AnimatePresence, m } from 'motion/react';
import { EASE_OUT, useMotionTransform } from '../lib/motion';
import { api } from '../lib/api';
import { formatPaise } from '../lib/format';
import SearchDialog from './SearchDialog';
import { useAuth } from '../auth/AuthContext';

const websiteUrl = import.meta.env.VITE_WEBSITE_URL || 'http://localhost:5173';

/** Close a popover when clicking outside it or pressing Escape. */
function useDismiss(open, setOpen) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, setOpen]);
  return ref;
}

/** Top-bar popover: scales out of its trigger (transform-origin: top right in CSS). */
function Popover({ children, ...props }) {
  const tf = useMotionTransform();
  return (
    <m.div
      initial={{ opacity: 0, transform: tf('scale(0.97)') }}
      animate={{ opacity: 1, transform: tf('scale(1)'), transition: { duration: 0.15, ease: EASE_OUT } }}
      exit={{ opacity: 0, transform: tf('scale(0.97)'), transition: { duration: 0.1, ease: EASE_OUT } }}
      {...props}
    >
      {children}
    </m.div>
  );
}

export default function TopBar({ onToggleSidebar, sidebarOpen }) {
    const { pathname } = useLocation();
  const { user, signOut } = useAuth();
  const [searchOpen, setSearchOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const alertsRef = useDismiss(alertsOpen, setAlertsOpen);
  const accountRef = useDismiss(accountOpen, setAccountOpen);

  const [dues, setDues] = useState([]);
  const [renewals, setRenewals] = useState([]);
  const alertCount = dues.length + renewals.length;

  // Rechecked on each page change and when the bell opens, as payments are made from many pages.
  useEffect(() => {
    const controller = new AbortController();
    api('/bookings?payment=Due', { signal: controller.signal })
      .then(({ bookings }) => setDues(bookings))
      .catch(() => {});
    api('/memberships?state=Expiring', { signal: controller.signal })
      .then(({ memberships }) => setRenewals(memberships))
      .catch(() => {});
    return () => controller.abort();
  }, [pathname, alertsOpen]);

  return (
    <header className="topbar">
      <div className="topbar__title">
        <button
          type="button"
          className="icon-button topbar__menu"
          aria-label="Toggle navigation"
          aria-controls="sidebar"
          aria-expanded={sidebarOpen}
          onClick={onToggleSidebar}
        >
          <Menu size={20} strokeWidth={1.6} />
        </button>
        <p className="topbar__workspace">DK / Operations</p>
      </div>

      <div className="topbar__actions">
        <button type="button" className="icon-button" aria-label="Search customers and bookings" onClick={() => setSearchOpen(true)}>
          <Search size={18} strokeWidth={1.6} />
        </button>

        <div className="popover-anchor" ref={alertsRef}>
          <button
            type="button"
            className="icon-button"
            aria-label={`Alerts (${alertCount})`}
            aria-expanded={alertsOpen}
            onClick={() => setAlertsOpen((v) => !v)}
          >
            <Bell size={18} strokeWidth={1.6} />
            {alertCount > 0 && <span className="icon-button__dot" aria-hidden="true" />}
          </button>
          <AnimatePresence>
          {alertsOpen && (
            <Popover className="popover" role="dialog" aria-label="Alerts">
              <p className="popover__title">Needs attention</p>
              <ul className="popover__list">
                {dues.slice(0, 20).map((b) => (
                  <li key={b.id}>
                    <Link to={`/bookings/records/${b.bookingNo}`} onClick={() => setAlertsOpen(false)}>
                      <strong>{b.bookingNo}</strong> · {b.customer.name} · {formatPaise(b.outstandingPaise)} due
                    </Link>
                  </li>
                ))}
                {renewals.slice(0, 20).map((m) => (
                  <li key={m.id}>
                    <Link to={`/memberships?selected=${m.id}`} onClick={() => setAlertsOpen(false)}>
                      <strong>{m.membershipNo}</strong> · {m.holderName} · ends in {m.daysLeft} {m.daysLeft === 1 ? 'day' : 'days'}
                    </Link>
                  </li>
                ))}
                {alertCount === 0 && <li className="popover__empty">Nothing needs attention.</li>}
              </ul>
            </Popover>
          )}
          </AnimatePresence>
        </div>

        <div className="popover-anchor" ref={accountRef}>
          <button
            type="button"
            className="avatar avatar--button"
            aria-label={`Account menu for ${user?.name ?? 'staff'}`}
            aria-expanded={accountOpen}
            onClick={() => setAccountOpen((v) => !v)}
          >
            {user?.initials ?? 'DK'}
          </button>
          <AnimatePresence>
          {accountOpen && (
            <Popover className="popover popover--menu" role="menu" aria-label="Account">
              <div className="popover__identity">
                <strong>{user?.name}</strong>
                <span className="muted">{user?.email}</span>
                <span className="muted">{user?.role}</span>
              </div>
              <Link role="menuitem" to="/account" onClick={() => setAccountOpen(false)}>
                My account
              </Link>
              <a role="menuitem" href={websiteUrl} target="_blank" rel="noreferrer">
                View public website ↗
              </a>
              <button
                role="menuitem"
                type="button"
                className="popover__danger"
                onClick={() => {
                  setAccountOpen(false);
                  signOut();
                }}
              >
                Sign out
              </button>
            </Popover>
          )}
          </AnimatePresence>
        </div>
      </div>

      {searchOpen && <SearchDialog onClose={() => setSearchOpen(false)} />}
    </header>
  );
}
