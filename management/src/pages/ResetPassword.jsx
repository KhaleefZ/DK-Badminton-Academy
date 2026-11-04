import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Button from '../components/Button';
import Notice from '../components/Notice';
import PasswordField from '../components/PasswordField';
import { AuthFrame } from '../auth/AuthStates';
import { resetPassword } from '../auth/authService';
import { usePasswordForm } from '../auth/usePasswordForm';

export default function ResetPassword() {
  const [params, setParams] = useSearchParams();
  // Read once, then taken out of the address bar so it can't leak through history or links.
  const [token] = useState(() => params.get('token') ?? '');
  const form = usePasswordForm();
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [linkInvalid, setLinkInvalid] = useState(!token);

  useEffect(() => {
    document.title = 'Reset password · DK Operations';
    if (params.has('token')) setParams({}, { replace: true });
  }, [params, setParams]);

  const submit = async (e) => {
    e.preventDefault();
    form.markSubmitted();
    if (!form.valid || pending) return;
    setPending(true);
    setError('');
    try {
      await resetPassword(token, form.newPassword);
      form.clear();
      setDone(true);
    } catch (err) {
      setError(err.message);
      if (err.code === 'INVALID_RESET_LINK') setLinkInvalid(true);
    } finally {
      setPending(false);
    }
  };

  return (
    <AuthFrame labelledBy="reset-heading" onSubmit={submit}>
      <div className="page-header__intro">
        <h1 id="reset-heading" className="page-header__title">
          {done ? 'Password changed' : 'Choose a new password'}
        </h1>
        {!done && !linkInvalid && <p className="page-header__subtitle">All devices using this account will be signed out.</p>}
      </div>

      {done && (
        <div role="status">
          <Notice>Your password has been changed. Sign in with the new one.</Notice>
        </div>
      )}
      {linkInvalid && !done && (
        <div role="alert">
          <Notice tone="warning">{error || 'This reset link is invalid or has expired. Request a new one.'}</Notice>
        </div>
      )}
      {error && !linkInvalid && (
        <div role="alert">
          <Notice tone="warning">{error}</Notice>
        </div>
      )}

      {!done && !linkInvalid && (
        <>
          <PasswordField autoFocus {...form.newProps} />
          <PasswordField {...form.repeatProps} />
          <Button type="submit" variant="primary" icon={false} className="login__submit" disabled={pending} aria-busy={pending}>
            {pending ? 'Saving…' : 'Save new password'}
          </Button>
        </>
      )}

      {linkInvalid && !done && (
        <Link className="fine login__back" to="/forgot-password">
          Request a new reset link
        </Link>
      )}
      <Link className="fine login__back" to="/login">
        ← Back to sign in
      </Link>
    </AuthFrame>
  );
}
