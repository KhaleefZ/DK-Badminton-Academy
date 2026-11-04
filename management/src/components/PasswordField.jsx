import { useEffect, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import Field from './Field';

/**
 * Password input with a show/hide eye. Each field toggles on its own and starts hidden.
 * Change `hideKey` (for example, a submit counter) to hide it again.
 */
export default function PasswordField({ label = 'Password', hideKey, ...props }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(false);
  }, [hideKey]);

  return (
    <div className="password-field">
      <Field label={label} {...props} type={visible ? 'text' : 'password'} autoCapitalize="none" autoCorrect="off" spellCheck={false} />
      <button
        type="button"
        className="icon-button password-field__reveal"
        aria-label={`${visible ? 'Hide' : 'Show'} ${label.toLowerCase()}`}
        onClick={() => setVisible((v) => !v)}
      >
        {visible ? <EyeOff size={18} strokeWidth={1.6} aria-hidden="true" /> : <Eye size={18} strokeWidth={1.6} aria-hidden="true" />}
      </button>
    </div>
  );
}
