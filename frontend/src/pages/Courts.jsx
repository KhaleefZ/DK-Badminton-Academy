import { Fragment } from 'react';
import { LinkButton } from '../components/Button';
import ConceptImage from '../components/ConceptImage';
import CourtLines from '../components/CourtLines';
import Reveal from '../components/Reveal';
import { Magnetic, SplitReveal, Stagger, StaggerItem } from '../motion';
import { EASE_IN_OUT } from '../motion/easing';
import { m, useReducedMotion } from 'motion/react';
import { useContent } from '../lib/site';

// Facility row rule: draws left → right as its row arrives (inherits the Stagger variants).
const RULE = {
  hidden: { transform: 'scaleX(0)' },
  show: { transform: 'scaleX(1)', transition: { duration: 0.6, ease: EASE_IN_OUT } },
};

export default function Courts() {
  const reduce = useReducedMotion();
  const { sections, hero, venue, availability } = useContent().courts;

  const blocks = {
    hero: (
      <section className="section" aria-labelledby="courts-heading">
        <div className="container stack">
          <p className="overline">{hero.overline}</p>
          <div className="page-heading">
            <SplitReveal as="h1" id="courts-heading" className="display display--page" text={hero.title} trigger="mount" rotate={3} stagger={0.07} />
          </div>
          {/* Signature: the hall wipes open, drifts with scroll, and court lines trace the floor */}
          <ConceptImage image={hero.image} height={480} eager reveal="up" parallax={60} className="full-width" overlay={<CourtLines layout="hall" delay={0.8} />} />
          <Stagger className="gallery-row" stagger={0.08}>
            {hero.gallery.map((image, i) => (
              <StaggerItem key={i}>
                <ConceptImage image={image} height={230} className="md-hover-zoom gallery-row__zoom" />
              </StaggerItem>
            ))}
            <StaggerItem className="gallery-note on-dark stack" style={{ '--stack-gap': '18px' }}>
              <p className="overline">{hero.galleryOverline}</p>
              <p className="display display--sm">{hero.galleryTitle}</p>
              {hero.galleryNote && <p className="meta">{hero.galleryNote}</p>}
            </StaggerItem>
          </Stagger>
        </div>
      </section>
    ),
    venue: (
      <section className="section section--paper" aria-labelledby="venue-heading">
        <div className="container split">
          <div className="stack" style={{ '--stack-gap': '20px' }}>
            <p className="overline">{venue.overline}</p>
            <h2 id="venue-heading" className="display display--md">
              {venue.title}
            </h2>
            <p className="body muted">{venue.text}</p>
          </div>
          {/* Supporting: a checklist being marked out — each row's rule draws like a court line */}
          <Stagger as="dl" className="facility-list" stagger={0.07}>
            {venue.facilities.map((item, i) => (
              <StaggerItem key={i} className="facility-list__row" distance={12}>
                <dt>{item.label}</dt>
                <dd>
                  <span className="badge badge--tint">{item.value}</span>
                </dd>
                <m.span className="facility-list__rule" aria-hidden="true" variants={reduce ? undefined : RULE} />
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      </section>
    ),
    /* Booking call to action: the page points to the booking flow rather than showing slots */
    availability: (
      <section className="section" aria-labelledby="availability-heading">
        <Reveal className="container">
          <div className="next-step-card booking-cta on-dark stack">
            <p className="overline">{availability.overline}</p>
            <h2 id="availability-heading" className="display display--md">
              {availability.title}
            </h2>
            <p className="body">{availability.cardText}</p>
            <Magnetic strength={0.25}>
              <LinkButton link={availability.cardButton} variant="lime" />
            </Magnetic>
          </div>
        </Reveal>
      </section>
    ),
  };

  return (
    <>
      {sections
        .filter((s) => s.visible)
        .map((s) => (
          <Fragment key={s.id}>{blocks[s.id]}</Fragment>
        ))}
    </>
  );
}
