import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { AnimatePresence, m } from 'motion/react';
import { EASE, useMotionTransform } from '../lib/motion';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import BookingDialog from '../dialogs/BookingDialog';
import { useWorkspace } from '../store/WorkspaceContext';

export default function AppShell() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { pathname } = useLocation();
  const { toasts, bookingDialogOpen, closeBookingDialog, notify } = useWorkspace();
  const tf = useMotionTransform();

  useEffect(() => {
    setSidebarOpen(false);
    document.getElementById('workspace')?.scrollTo?.(0, 0);
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <div className="app-shell">
      <a href="#workspace" className="skip-link">
        Skip to content
      </a>
      <Sidebar open={sidebarOpen} onNavigate={() => setSidebarOpen(false)} />
      {sidebarOpen && <div className="sidebar-scrim" aria-hidden="true" onClick={() => setSidebarOpen(false)} />}
      <div className="app-shell__main">
        {/* Subtle decorative background organic glow and dot pattern */}
        <div className="workspace-bg-waves" aria-hidden="true">
          <div className="workspace-bg-wave workspace-bg-wave--top" />
          <div className="workspace-bg-wave workspace-bg-wave--bottom" />
          <div className="workspace-bg-dots" />
        </div>

        <TopBar sidebarOpen={sidebarOpen} onToggleSidebar={() => setSidebarOpen((v) => !v)} />
        <main id="workspace" className="workspace" tabIndex={-1}>
          <Outlet />
          <p className="workspace__footnote">
            All times IST · All amounts INR
          </p>
        </main>
      </div>

      {bookingDialogOpen && (
        <BookingDialog
          onClose={closeBookingDialog}
          onSaved={(b) => {
            closeBookingDialog();
            notify(`Booking ${b.bookingNo} saved.`);
            window.dispatchEvent(new CustomEvent('dk:booking-saved', { detail: b }));
          }}
        />
      )}

      <div className="toasts" role="status" aria-live="polite">
        <AnimatePresence initial={false}>
          {toasts.map((t) => (
            <m.p
              key={t.id}
              className="toast"
              initial={{ opacity: 0, transform: tf('translateY(100%)') }}
              animate={{ opacity: 1, transform: tf('translateY(0%)') }}
              exit={{ opacity: 0, transform: tf('translateY(100%)') }}
              transition={{ duration: 0.4, ease: EASE }}
            >
              {t.message}
            </m.p>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
