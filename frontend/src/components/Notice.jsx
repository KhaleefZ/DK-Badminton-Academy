import { Info } from 'lucide-react';

/** DK / Notification (information). */
export default function Notice({ children, className = '' }) {
  return (
    <div className={`notice ${className}`} role="note">
      <Info size={18} strokeWidth={1.6} aria-hidden="true" className="notice__icon" />
      <p>{children}</p>
    </div>
  );
}
