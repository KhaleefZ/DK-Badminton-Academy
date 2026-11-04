import { LinkButton } from '../components/Button';
import { useContent } from '../lib/site';
import { DrawPath } from '../motion';

export default function NotFound() {
  const { notFound } = useContent();
  return (
    <section className="section" aria-labelledby="not-found-heading">
      <div className="container stack">
        <p className="overline">{notFound.overline}</p>
        <h1 id="not-found-heading" className="display display--page">
          {notFound.title}
        </h1>
        {/* Rare moment: the baseline draws, then the shuttle's arc sails past it and lands out */}
        <DrawPath
          className="not-found__arc"
          viewBox="0 0 420 130"
          paths={[
            'M300 20 L300 124',
            'M20 118 C 110 -20, 260 -10, 372 112',
            'M372 116 m -6 0 a 6 6 0 1 0 12 0 a 6 6 0 1 0 -12 0',
          ]}
          stroke="var(--action-primary)"
          strokeWidth={3}
          duration={0.9}
          stagger={0.6}
          delay={0.2}
          trigger="mount"
        />
        <p className="lead muted">{notFound.text}</p>
        <div className="button-row">
          <LinkButton link={notFound.primaryButton} />
          <LinkButton link={notFound.secondaryButton} variant="secondary" />
        </div>
      </div>
    </section>
  );
}
