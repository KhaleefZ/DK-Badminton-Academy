import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { AuthLoading, AuthUnreachable } from './AuthStates';

/**
 * Waits for the server's answer, so private pages never flash, then sends signed-out visitors
 * to /login. An explicit sign-out loses the return path; an expired session keeps it.
 */
export default function RequireAuth({ children }) {
  const { status, user, endReason, retry } = useAuth();
  const location = useLocation();

  if (status === 'loading') return <AuthLoading />;
  if (status === 'unreachable') return <AuthUnreachable onRetry={retry} />;

  const next = `${location.pathname}${location.search}`;
  if (!user) {
    if (endReason === 'signedOut' || endReason === 'signedOutOffline') return <Navigate to="/login" replace />;
    return <Navigate to={next === '/' ? '/login' : `/login?next=${encodeURIComponent(next)}`} replace />;
  }
  // A temporary password has to be replaced before anything else opens.
  if (user.mustChangePassword) return <Navigate to={`/change-password?next=${encodeURIComponent(next)}`} replace />;
  return children;
}
