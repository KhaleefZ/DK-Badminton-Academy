import { useId } from 'react';
import { ChevronDown } from 'lucide-react';

/** DK / Input, Select and Textarea with label, hint and error states. */
export default function Field({ label, required, hint, error, as = 'input', options = [], className = '', ...props }) {
  const id = useId();
  const hintId = hint || error ? `${id}-hint` : undefined;
  const control = {
    id,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': hintId,
    required,
    className: `field__control${error ? ' field__control--error' : ''}`,
    ...props,
  };

  return (
    <div className={`field ${className}`}>
      <label htmlFor={id} className="field__label">
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </label>
      {as === 'select' ? (
        <div className="field__select">
          <select {...control}>
            {options.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <ChevronDown size={16} strokeWidth={1.6} aria-hidden="true" />
        </div>
      ) : as === 'textarea' ? (
        <textarea rows={4} {...control} />
      ) : (
        <input {...control} />
      )}
      {(error || hint) && (
        <p id={hintId} className={error ? 'field__error' : 'field__hint'}>
          {error || hint}
        </p>
      )}
    </div>
  );
}
