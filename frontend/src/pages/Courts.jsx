import { Fragment } from 'react';
import { LinkButton } from '../components/Button';
import ConceptImage from '../components/ConceptImage';
import Field from '../components/Field';
import SlotGrid from '../booking/SlotGrid';
import { useAvailability, useBooking } from '../booking/BookingContext';
import { formatLong } from '../booking/schedule';
import CourtLines from '../components/CourtLines';
import Reveal from '../components/Reveal';
import { Magnetic, SplitReveal, Stagger, StaggerItem } from '../motion';
import { EASE_IN_OUT } from '../motion/easing';
import { m, useReducedMotion } from 'motion/react';
import { useContent } from '../lib/site';

// The courts page previews the next few open slots; the full grid lives in /booking.
const PREVIEW_COUNT = 3;

// Facility row rule: draws left → right as its row arrives (inherits the Stagger variants).
const RULE = {
  hidden: { transform: 'scaleX(0)' },
  show: { transform: 'scaleX(1)', transition: { duration: 0.6, ease: EASE_IN_OUT } },
};

export default function Courts() {
  const { date, courtId, slot, setCourt, setSlot } = useBooking();
  const { data } = useAvailability(date);
  const courts = data?.courts ?? [];
  const court = courts.find((c) => c.id === courtId) ?? courts[0];
  const preview = (court?.slots ?? []).filter((s) => s.available).slice(0, PREVIEW_COUNT);
  const reduce = useReducedMotion();
  const { sections, hero, venue, availability } = useContent().courts;

  const blocks = {
    hero: (
      <section className="section" aria-labelledby="courts-heading">
        <div className="container stack">
          <p className="overline">{hero.overline}</p>
          <div className="page-heading">
            <SplitReveal as="h1" id="courts-heading" className="display display--page" text={hero.title} trigger="mount" rotate={3} stagger={0.07} />
            <div className="stack page-heading__aside">
              <p className="body muted">{hero.text}</p>
              <LinkButton link={hero.button} />
            </div>
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
    availability: (
      <section className="section" aria-labelledby="availability-heading">
        <Reveal className="container availability">
          <div className="stack">
            <p className="overline">{availability.overline}</p>
            <h2 id="availability-heading" className="display display--md">
              {availability.title}
            </h2>
            <div className="form-grid">
              <Field label={availability.dateLabel} value={formatLong(date)} readOnly />
              {courts.length > 0 && (
                <Field as="select" label={availability.courtLabel} value={court?.id ?? ''} onChange={(e) => setCourt(e.target.value)} options={courts.map((c) => ({ value: c.id, label: c.name }))} />
              )}
            </div>
            {preview.length > 0 ? (
              <SlotGrid slots={preview} value={slot?.start} onChange={setSlot} className="slot-grid--row" />
            ) : (
              <p className="meta muted">{data ? availability.noSlots : availability.checking}</p>
            )}
          </div>
          <div className="next-step-card on-dark stack">
            <p className="display display--sm">{availability.cardTitle}</p>
            <p className="small">{availability.cardText}</p>
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
