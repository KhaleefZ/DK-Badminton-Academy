import { Info, TriangleAlert } from 'lucide-react';

/** DK / Notification — information or warning. */
export default function Notice({ tone = 'information', children, className = '' }) {
  const Icon = tone === 'warning' ? TriangleAlert : Info;
  return (
    <div className={`notice notice--${tone} ${className}`} role="note">
      <Icon size={18} strokeWidth={1.6} aria-hidden="true" className="notice__icon" />
      <p>{children}</p>
    </div>
  );
}
