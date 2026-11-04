import { useId } from 'react';
import { BarChart3, ChevronDown } from 'lucide-react';

/** White admin panel with modern heading, icon, and optional meta/dropdown button. */
export default function Panel({
  title,
  meta,
  icon: customIcon,
  action,
  children,
  className = '',
  headingLevel = 2,
}) {
  const id = useId();
  const Heading = `h${headingLevel}`;

  // Default icon if title matches common sections
  const IconComponent =
    customIcon ||
    (title?.toLowerCase().includes('money') ? BarChart3 : null);

  return (
    <section className={`panel ${className}`} aria-labelledby={title ? id : undefined}>
      {(title || meta || action) && (
        <div className="panel__heading">
          <div className="panel__title-wrapper">
            {IconComponent && (
              <div className="panel__icon-box" aria-hidden="true">
                <IconComponent size={20} strokeWidth={2.2} />
              </div>
            )}
            {title && (
              <Heading id={id} className="panel__title">
                {title}
              </Heading>
            )}
          </div>

          <div className="panel__actions">
            {action}
            {meta && !action && (
              <div className="panel__meta-pill">
                <span>{meta}</span>
                <ChevronDown size={14} strokeWidth={2.2} />
              </div>
            )}
          </div>
        </div>
      )}
      {children}
    </section>
  );
}
