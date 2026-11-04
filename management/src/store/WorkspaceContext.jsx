import { createContext, useCallback, useContext, useMemo, useState } from 'react';

const WorkspaceContext = createContext(null);

/** Short confirmation messages shown over any page. */
export function WorkspaceProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const notify = useCallback((message) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);

  const value = useMemo(() => ({ notify, toasts }), [notify, toasts]);

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspace must be used inside <WorkspaceProvider>');
  return ctx;
}
