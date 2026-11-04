import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowUpRight, Bell, ChevronDown, Menu, Plus, Search } from 'lucide-react';
import { AnimatePresence, m } from 'motion/react';
import { EASE_OUT, useMotionTransform } from '../lib/motion';
import { api } from '../lib/api';
import { formatPaise } from '../lib/format';
import SearchDialog from './SearchDialog';
import { useAuth } from '../auth/AuthContext';
import { useWorkspace } from '../store/WorkspaceContext';

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
  const { openBookingDialog } = useWorkspace();
  const [searchOpen, setSearchOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const alertsRef = useDismiss(alertsOpen, setAlertsOpen);
  const accountRef = useDismiss(accountOpen, setAccountOpen);

  const [dues, setDues] = useState([]);
  const [renewals, setRenewals] = useState([]);
  const alertCount = dues.length + renewals.length;

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
          <Menu size={20} strokeWidth={1.8} />
        </button>
        <div className="topbar__breadcrumbs-container">
          <p className="topbar__workspace">
            <span className="topbar__brand-short">DK</span>
            <span className="topbar__brand-slash"> / </span>
            <span className="topbar__brand-full">Operations</span>
          </p>
          <div className="topbar__accent-line" aria-hidden="true" />
        </div>
      </div>

      <div className="topbar__actions">
        <button
          type="button"
          className="icon-button icon-button--round"
          aria-label="Search customers and bookings"
          onClick={() => setSearchOpen(true)}
        >
          <Search size={17} strokeWidth={1.8} />
        </button>

        <div className="popover-anchor" ref={alertsRef}>
          <button
            type="button"
            className="icon-button icon-button--round"
            aria-label={`Alerts (${alertCount})`}
            aria-expanded={alertsOpen}
            onClick={() => setAlertsOpen((v) => !v)}
          >
            <Bell size={17} strokeWidth={1.8} />
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
            className="avatar-btn"
            aria-label={`Account menu for ${user?.name ?? 'staff'}`}
            aria-expanded={accountOpen}
            onClick={() => setAccountOpen((v) => !v)}
          >
            <span className="avatar avatar--custom">{user?.initials ?? 'A'}</span>
            <ChevronDown size={14} strokeWidth={2.2} className="avatar-btn__chevron" />
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

        <button
          type="button"
          className="topbar__add-booking-btn"
          aria-label="Add booking"
          onClick={openBookingDialog}
        >
          <Plus size={18} strokeWidth={2.4} className="topbar__add-booking-plus" aria-hidden="true" />
          <span className="topbar__add-booking-text">Add booking</span>
          <ArrowUpRight size={17} strokeWidth={2.2} className="topbar__add-booking-arrow" aria-hidden="true" />
        </button>
      </div>

      {searchOpen && <SearchDialog onClose={() => setSearchOpen(false)} />}
    </header>
  );
}
