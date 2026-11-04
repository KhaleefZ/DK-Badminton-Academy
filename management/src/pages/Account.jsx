import { useState } from 'react';
import PageHeader from '../layout/PageHeader';
import Button from '../components/Button';
import Notice from '../components/Notice';
import Panel from '../components/Panel';
import PasswordField from '../components/PasswordField';
import { useAuth } from '../auth/AuthContext';
import { usePasswordForm } from '../auth/usePasswordForm';

export default function Account() {
  const { user, changePassword, signOutEverywhere } = useAuth();
  const form = usePasswordForm();
  const [current, setCurrent] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [everywhereError, setEverywhereError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    form.markSubmitted();
    setSaved(false);
    if (!form.valid || !current || pending) return;
    setPending(true);
    setError('');
    try {
      await changePassword(current, form.newPassword);
      setCurrent('');
      form.clear();
      setSaved(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setPending(false);
    }
  };

  const everywhere = async () => {
    setEverywhereError('');
    try {
      await signOutEverywhere();
    } catch (err) {
      setEverywhereError(err.message);
    }
  };

  return (
    <>
      <PageHeader title="My account" subtitle={`${user.name} · ${user.role} · ${user.staffNo}`} />

      <div className="account-grid">
        <Panel title="Change password">
          <form className="account-form" onSubmit={submit} noValidate>
            {saved && (
              <div role="status">
                <Notice>Password changed. Your other devices have been signed out.</Notice>
              </div>
            )}
            {error && (
              <div role="alert">
                <Notice tone="warning">{error}</Notice>
              </div>
            )}
            <PasswordField
              label="Current password"
              autoComplete="current-password"
              required
              hideKey={form.submits}
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              error={form.submits > 0 && !current ? 'Enter your current password.' : undefined}
            />
            <PasswordField {...form.newProps} />
            <PasswordField {...form.repeatProps} />
            <Button type="submit" variant="primary" icon={false} disabled={pending} aria-busy={pending}>
              {pending ? 'Saving…' : 'Change password'}
            </Button>
          </form>
        </Panel>

        <Panel title="Devices">
          <div className="account-form">
            <p className="small">Use this if you left the account signed in somewhere, or think someone else may be using it. Every device, including this one, will need to sign in again.</p>
            {everywhereError && (
              <div role="alert">
                <Notice tone="warning">{everywhereError}</Notice>
              </div>
            )}
            <Button variant="danger" icon={false} onClick={everywhere}>
              Sign out everywhere
            </Button>
          </div>
        </Panel>
      </div>
    </>
  );
}
