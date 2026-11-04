import { createContext, useCallback, useContext, useMemo, useState } from 'react';

const WorkspaceContext = createContext(null);

/** Short confirmation messages shown over any page and global action state. */
export function WorkspaceProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const [bookingDialogOpen, setBookingDialogOpen] = useState(false);

  const notify = useCallback((message) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);

  const openBookingDialog = useCallback(() => setBookingDialogOpen(true), []);
  const closeBookingDialog = useCallback(() => setBookingDialogOpen(false), []);

  const value = useMemo(
    () => ({
      notify,
      toasts,
      bookingDialogOpen,
      openBookingDialog,
      closeBookingDialog,
    }),
    [notify, toasts, bookingDialogOpen, openBookingDialog, closeBookingDialog],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspace must be used inside <WorkspaceProvider>');
  return ctx;
}
