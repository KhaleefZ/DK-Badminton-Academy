import { CircleAlert } from 'lucide-react';
import Button from '../components/Button';

export function AuthLoading() {
  return (
    <div className="auth-state" role="status">
      <p className="muted">Checking your session…</p>
    </div>
  );
}

export function AuthUnreachable({ onRetry }) {
  return (
    <div className="auth-state">
      <div className="state-card">
        <CircleAlert size={28} strokeWidth={1.5} aria-hidden="true" className="state-card__icon state-card__icon--danger" />
        <h1 className="state-card__title">Can’t reach the server</h1>
        <p className="state-card__text">Check your connection and try again.</p>
        <Button variant="primary" icon={false} onClick={onRetry}>
          Try again
        </Button>
      </div>
    </div>
  );
}

/** The two-column frame shared by login, forgot, reset and change password. */
export function AuthFrame({ children, labelledBy, onSubmit }) {
  return (
    <div className="login">
      <aside className="login__brand" aria-hidden="true">
        <span className="sidebar__monogram login__monogram">DK</span>
        <p className="sidebar__title">ACADEMY MANAGEMENT</p>
        <p className="login__statement">Every detail. In play.</p>
        <p className="login__brand-fine">DK Badminton Academy · Selvapuram North, Coimbatore</p>
      </aside>

      <main className="login__panel">
        <form className="login__form" onSubmit={onSubmit} noValidate aria-labelledby={labelledBy}>
          <span className="sidebar__monogram login__monogram login__monogram--mobile" aria-hidden="true">
            DK
          </span>
          {children}
        </form>
      </main>
    </div>
  );
}
