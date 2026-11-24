import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import Button from '../components/Button';
import Field from '../components/Field';
import Notice from '../components/Notice';
import PasswordField from '../components/PasswordField';
import { useAuth } from '../auth/AuthContext';
import { AuthFrame, AuthLoading } from '../auth/AuthStates';
import { safeNext } from '../lib/safeNext';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const websiteUrl = import.meta.env.VITE_WEBSITE_URL || 'http://localhost:5173';

// Only follow internal paths after sign-in (never an external URL from the query string).

const END_NOTICES = {
  signedOut: { text: 'You’ve signed out. Sign in again to continue.' },
  signedOutOffline: {
    tone: 'warning',
    text: 'You’re signed out on this device, but the server couldn’t be reached. The session on the server ends when it expires, or use “Sign out everywhere” after signing in again.',
  },
  expired: { text: 'Your session has ended. Sign in again to continue.' },
};

export default function Login() {
  const { status, user, endReason, signIn } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'), { allowLogin: false });

  const [form, setForm] = useState({ email: '', password: '', remember: false });
  const [submits, setSubmits] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    document.title = 'Sign in · DK Operations';
  }, []);

  if (status === 'loading') return <AuthLoading />;
  if (user) return <Navigate to={next} replace />;

  const fieldErrors = {
    ...(!form.email.trim() ? { email: 'Enter your email address.' } : !EMAIL.test(form.email.trim()) && { email: 'Check the email format.' }),
    ...(!form.password && { password: 'Enter your password.' }),
  };
  const show = (field) => (submits > 0 ? fieldErrors[field] : undefined);
  const set = (field) => (e) => {
    setError('');
    setForm((f) => ({ ...f, [field]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  };

  const submit = async (e) => {
    e.preventDefault();
    setSubmits((n) => n + 1);
    if (Object.keys(fieldErrors).length || pending) return;
    setPending(true);
    try {
      await signIn(form.email, form.password, form.remember);
      navigate(next, { replace: true });
    } catch (err) {
      setError(err.message);
      setForm((f) => ({ ...f, password: '' }));
      setPending(false);
    }
  };

  const endNotice = END_NOTICES[endReason];

  return (
    <AuthFrame labelledBy="login-heading" onSubmit={submit}>
      <div className="page-header__intro">
        <h1 id="login-heading" className="page-header__title">
          Sign in to DK Operations
        </h1>
        <p className="page-header__subtitle">Staff access to bookings, members, payments and reports.</p>
      </div>

      {status === 'unreachable' && !error && <Notice tone="warning">Can’t reach the server. Check your connection and try again.</Notice>}
      {endNotice && !error && <Notice tone={endNotice.tone}>{endNotice.text}</Notice>}
      {error && (
        <div role="alert">
          <Notice tone="warning">{error}</Notice>
        </div>
      )}

      <Field
        label="Email"
        type="email"
        autoComplete="username"
        inputMode="email"
        autoFocus
        required
        value={form.email}
        onChange={set('email')}
        error={show('email')}
      />

      <PasswordField autoComplete="current-password" required hideKey={submits} value={form.password} onChange={set('password')} error={show('password')} />

      <label className="checkbox">
        <input type="checkbox" checked={form.remember} onChange={set('remember')} />
        <span>Keep me signed in on this device for 30 days</span>
      </label>

      <Button type="submit" variant="primary" icon={false} className="login__submit" disabled={pending} aria-busy={pending}>
        {pending ? 'Signing in…' : 'Sign in'}
      </Button>

      <Link className="fine login__back" to="/forgot-password">
        Forgot your password?
      </Link>
      <a className="fine login__back" href={websiteUrl}>
        ← Back to the public website
      </a>
    </AuthFrame>
  );
}
