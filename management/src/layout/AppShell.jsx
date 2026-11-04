import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { AnimatePresence, m } from 'motion/react';
import { EASE, useMotionTransform } from '../lib/motion';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import { useWorkspace } from '../store/WorkspaceContext';

export default function AppShell() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { pathname } = useLocation();
  const { toasts } = useWorkspace();
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
        <TopBar sidebarOpen={sidebarOpen} onToggleSidebar={() => setSidebarOpen((v) => !v)} />
        <main id="workspace" className="workspace" tabIndex={-1}>
          <Outlet />
          <p className="workspace__footnote">
            All times IST · All amounts INR
          </p>
        </main>
      </div>
      <div className="toasts" role="status" aria-live="polite">
        {/* Enter and exit through the bottom edge. The stack is bottom-anchored and the
            oldest (top) toast leaves first, so the others never jump. */}
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
