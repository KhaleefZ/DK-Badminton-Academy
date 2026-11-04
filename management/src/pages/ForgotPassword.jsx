import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Button from '../components/Button';
import Field from '../components/Field';
import Notice from '../components/Notice';
import { AuthFrame } from '../auth/AuthStates';
import { requestPasswordReset } from '../auth/authService';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    document.title = 'Forgot password · DK Operations';
  }, []);

  const fieldError = !email.trim() ? 'Enter your email address.' : !EMAIL.test(email.trim()) ? 'Check the email format.' : undefined;

  const submit = async (e) => {
    e.preventDefault();
    setSubmitted(true);
    if (fieldError || pending) return;
    setPending(true);
    setError('');
    try {
      const { message: sent } = await requestPasswordReset(email);
      setMessage(sent);
    } catch (err) {
      setError(err.message);
    } finally {
      setPending(false);
    }
  };

  return (
    <AuthFrame labelledBy="forgot-heading" onSubmit={submit}>
      <div className="page-header__intro">
        <h1 id="forgot-heading" className="page-header__title">
          Forgot your password?
        </h1>
        <p className="page-header__subtitle">Enter your staff email and we’ll send a link to choose a new one.</p>
      </div>

      {message && (
        <div role="status">
          <Notice>{message}</Notice>
        </div>
      )}
      {error && (
        <div role="alert">
          <Notice tone="warning">{error}</Notice>
        </div>
      )}

      {!message && (
        <>
          <Field
            label="Email"
            type="email"
            autoComplete="username"
            inputMode="email"
            autoFocus
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={submitted ? fieldError : undefined}
          />
          <Button type="submit" variant="primary" icon={false} className="login__submit" disabled={pending} aria-busy={pending}>
            {pending ? 'Sending…' : 'Send reset link'}
          </Button>
        </>
      )}

      <Link className="fine login__back" to="/login">
        ← Back to sign in
      </Link>
    </AuthFrame>
  );
}
