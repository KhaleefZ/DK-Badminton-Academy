import { useId } from 'react';

/** White admin panel with a title and an optional right-aligned meta label. */
export default function Panel({ title, meta, children, className = '', headingLevel = 2 }) {
  const id = useId();
  const Heading = `h${headingLevel}`;
  return (
    <section className={`panel ${className}`} aria-labelledby={title ? id : undefined}>
      {(title || meta) && (
        <div className="panel__heading">
          {title && (
            <Heading id={id} className="panel__title">
              {title}
            </Heading>
          )}
          {meta && <p className="panel__meta">{meta}</p>}
        </div>
      )}
      {children}
    </section>
  );
}
