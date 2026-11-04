import { useEffect, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import Button from '../components/Button';
import Notice from '../components/Notice';
import PasswordField from '../components/PasswordField';
import { useAuth } from '../auth/AuthContext';
import { AuthFrame, AuthLoading } from '../auth/AuthStates';
import { usePasswordForm } from '../auth/usePasswordForm';

const safeNext = (value) => (value && value.startsWith('/') && !value.startsWith('//') ? value : '/');

/** The only page a temporary password can reach. */
export default function ChangeTemporaryPassword() {
  const { status, user, changePassword, signOut } = useAuth();
  const [params] = useSearchParams();
  const form = usePasswordForm();
  const [current, setCurrent] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    document.title = 'Change password · DK Operations';
  }, []);

  if (status === 'loading') return <AuthLoading />;
  if (!user) return <Navigate to="/login" replace />;
  if (!user.mustChangePassword) return <Navigate to={safeNext(params.get('next'))} replace />;

  const currentError = form.submits > 0 && !current ? 'Enter your temporary password.' : undefined;

  const submit = async (e) => {
    e.preventDefault();
    form.markSubmitted();
    if (!form.valid || !current || pending) return;
    setPending(true);
    setError('');
    try {
      await changePassword(current, form.newPassword);
    } catch (err) {
      setError(err.message);
      setPending(false);
    }
  };

  return (
    <AuthFrame labelledBy="temporary-heading" onSubmit={submit}>
      <div className="page-header__intro">
        <h1 id="temporary-heading" className="page-header__title">
          Set your own password
        </h1>
        <p className="page-header__subtitle">You signed in with a temporary password. Replace it to continue.</p>
      </div>

      {error && (
        <div role="alert">
          <Notice tone="warning">{error}</Notice>
        </div>
      )}

      <PasswordField
        label="Temporary password"
        autoComplete="current-password"
        autoFocus
        required
        hideKey={form.submits}
        value={current}
        onChange={(e) => setCurrent(e.target.value)}
        error={currentError}
      />
      <PasswordField {...form.newProps} />
      <PasswordField {...form.repeatProps} />

      <Button type="submit" variant="primary" icon={false} className="login__submit" disabled={pending} aria-busy={pending}>
        {pending ? 'Saving…' : 'Save and continue'}
      </Button>
      <button type="button" className="link-button fine login__back" onClick={signOut}>
        Sign out
      </button>
    </AuthFrame>
  );
}
