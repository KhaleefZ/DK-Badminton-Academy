import { useState } from 'react';

const MIN_LENGTH = 10;

/** The new-password and repeat fields, shared by the reset, change and first-login forms. */
export function usePasswordForm() {
  const [newPassword, setNewPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [submits, setSubmits] = useState(0);

  const errors = {
    ...(newPassword.length < MIN_LENGTH && { newPassword: `Use at least ${MIN_LENGTH} characters.` }),
    ...(repeat !== newPassword && { repeat: 'The passwords don’t match.' }),
  };

  return {
    newPassword,
    submits,
    valid: Object.keys(errors).length === 0,
    markSubmitted: () => setSubmits((n) => n + 1),
    clear: () => {
      setNewPassword('');
      setRepeat('');
    },
    newProps: {
      label: 'New password',
      autoComplete: 'new-password',
      required: true,
      hint: `At least ${MIN_LENGTH} characters. Avoid common passwords and your email.`,
      value: newPassword,
      hideKey: submits,
      onChange: (e) => setNewPassword(e.target.value),
      error: submits > 0 ? errors.newPassword : undefined,
    },
    repeatProps: {
      label: 'Repeat new password',
      autoComplete: 'new-password',
      required: true,
      value: repeat,
      hideKey: submits,
      onChange: (e) => setRepeat(e.target.value),
      error: submits > 0 ? errors.repeat : undefined,
    },
  };
}
