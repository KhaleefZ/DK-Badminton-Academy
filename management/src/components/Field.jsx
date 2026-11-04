import { useId } from 'react';
import { ChevronDown } from 'lucide-react';

/** DK / Input · Select · Textarea for dialogs. `options` is [{ value, label }]. */
export default function Field({ label, error, hint, as = 'input', options = [], required, className = '', ...props }) {
  const id = useId();
  const describedBy = error || hint ? `${id}-hint` : undefined;
  const control = {
    id,
    required,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': describedBy,
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
            {options.map((o) => (
              <option key={o.value} value={o.value} disabled={o.disabled}>
                {o.label}
              </option>
            ))}
          </select>
          <ChevronDown size={14} strokeWidth={1.6} aria-hidden="true" />
        </div>
      ) : as === 'textarea' ? (
        <textarea rows={3} {...control} />
      ) : (
        <input {...control} />
      )}
      {(error || hint) && (
        <p id={describedBy} className={error ? 'field__error' : 'field__hint'}>
          {error || hint}
        </p>
      )}
    </div>
  );
}
