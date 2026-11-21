import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import { LinkButton } from '../components/Button';
import ConceptImage from '../components/ConceptImage';
import CourtLines from '../components/CourtLines';
import { PriceCard } from '../components/EnquiryCard';
import FaqList from '../components/FaqList';
import ReviewCard from '../components/ReviewCard';
import { Magnetic, ScrambleText, ScribbleUnderline, ScrollDrawPath, SplitReveal, Stagger, StaggerItem } from '../motion';
import { useContent } from '../lib/site';
import { highlightOf, splitHighlight } from '../lib/highlight';

// Motion story (docs/motion-plan.md): "You're stepping onto the court."
export default function Home() {
  const { home, shared } = useContent();
  const { hero, locality, discovery, journey, plans, community, reviews, faq, contactBand } = home;
  const discoveryTitle = splitHighlight(discovery.title, discovery.titleHighlight);

  const blocks = {
    /* Hero — Signature: headline called out word by word, image wipes open, court lines draw */
    hero: (
      <section className="hero on-dark" aria-labelledby="hero-heading">
        <div className="hero__copy stack" style={{ '--stack-gap': '30px' }}>
          <p className="overline">{hero.overline}</p>
          <SplitReveal as="h1" id="hero-heading" className="display display--hero" text={hero.title} trigger="mount" rotate={3} stagger={0.07} />
          <p className="lead">{hero.lead}</p>
          <div className="button-row">
            <Magnetic>
              <LinkButton link={hero.primaryButton} variant="lime" />
            </Magnetic>
            <LinkButton link={hero.secondaryButton} variant="secondary" className="hide-mobile" />
          </div>
        </div>
        <ConceptImage image={hero.image} className="hero__image" eager reveal="up" parallax={50} overlay={<CourtLines layout="hero" />} />
      </section>
    ),

    /* Location strip — Quiet: real info stays still */
    locality: (
      <div className="locality-strip">
        <div className="container locality-strip__inner">
          <p>{locality.text.toUpperCase()}</p>
          {locality.link.label && (
            <Link to={locality.link.to} className="muted">
              {locality.link.label}
            </Link>
          )}
        </div>
      </div>
    ),

    /* 01 Court discovery — Supporting: hall wipes open; marker sweeps behind the payoff */
    discovery: (
      <section className="section" aria-labelledby="discovery-heading">
        <div className="container media-split">
          <ConceptImage image={discovery.image} height={450} reveal="right" />
          <div className="stack">
            <p className="overline">{discovery.overline}</p>
            <h2 id="discovery-heading" className="display display--lg">
              {discoveryTitle.before}
              {discoveryTitle.match && (
                <ScribbleUnderline variant="marker" color="var(--accent-rally)" delay={0.5} duration={0.7}>
                  {discoveryTitle.match}
                </ScribbleUnderline>
              )}
              {discoveryTitle.after}
            </h2>
            <p className="body muted">{discovery.text}</p>
            <LinkButton link={discovery.button} variant="secondary" />
          </div>
        </div>
      </section>
    ),

    /* Booking introduction — Supporting: one court line runs through the journey as you scroll */
    journey: (
      <section className="section section--paper" aria-labelledby="journey-heading">
        <div className="container stack" style={{ '--stack-gap': '32px' }}>
          <div className="intro-row">
            <h2 id="journey-heading" className="display display--md">
              {journey.title}
            </h2>
          </div>
          <div className="stage-track">
            <ScrollDrawPath
              className="stage-track__line"
              viewBox="0 0 100 2"
              preserveAspectRatio="none"
              paths={['M0 1 L100 1']}
              stroke="var(--action-primary)"
              strokeWidth={2}
              offset={['start 80%', 'end 50%']}
            />
            <ol className="stage-list stage-list--drawn">
              {journey.stages.map((stage, i) => (
                <li key={i} className="stage-list__item">
                  <ScrambleText as="p" className="overline" text={stage.number} glyphs="0123456789" duration={600} delay={i * 80} />
                  <h3 className="stage-list__title">{stage.title}</h3>
                  <p className="small muted">{stage.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>
    ),

    /* 02 Memberships and pricing — Quiet: options presented calmly */
    plans: (
      <section className="section" aria-labelledby="routine-heading">
        <div className="container stack" style={{ '--stack-gap': '36px' }}>
          <div className="section-heading">
            <div className="stack" style={{ '--stack-gap': '16px' }}>
              <p className="overline">{plans.overline}</p>
              <h2 id="routine-heading" className="display display--lg">
                {plans.title}
              </h2>
            </div>
            <LinkButton link={plans.button} variant="secondary" />
          </div>
          <Stagger className="grid-3" stagger={0.08}>
            {plans.cards.map((card, i) => (
              <StaggerItem key={i} className="grid-3__item">
                <PriceCard card={card} />
              </StaggerItem>
            ))}
          </Stagger>
          <Stagger className="full-width">
            <StaggerItem className="pricing-banner on-dark">
              <p className="display pricing-banner__title">{plans.bannerTitle}</p>
              <p className="small">{plans.bannerText}</p>
              <LinkButton link={plans.bannerButton} variant="lime" />
            </StaggerItem>
          </Stagger>
        </div>
      </section>
    ),

    /* 03 Community philosophy — Supporting: words land, the highlight gets a hand-drawn underline */
    community: (
      <section className="feature-split on-dark" aria-labelledby="community-heading">
        <div className="feature-split__copy stack" style={{ '--stack-gap': '28px' }}>
          <p className="overline">{community.overline}</p>
          <SplitReveal
            as="h2"
            id="community-heading"
            className="display display--xl"
            text={community.title}
            stagger={0.07}
            duration={0.75}
            highlight={highlightOf(community.titleHighlight, (node) => (
              <ScribbleUnderline color="var(--accent-rally)" delay={0.9} strokeWidth={5}>
                {node}
              </ScribbleUnderline>
            ))}
          />
          <p className="body">{community.text}</p>
          <LinkButton link={community.button} variant="lime" />
        </div>
        <ConceptImage image={community.image} className="feature-split__image" parallax={60} />
      </section>
    ),

    /* 04 Reviews — Supporting: social proof after the pitch, before the questions */
    reviews: (
      <section className="section section--paper" aria-labelledby="reviews-heading">
        <div className="container stack" style={{ '--stack-gap': '36px' }}>
          <div className="section-heading">
            <div className="stack" style={{ '--stack-gap': '16px' }}>
              <p className="overline">{reviews.overline}</p>
              <h2 id="reviews-heading" className="display display--lg">
                {reviews.title}
              </h2>
            </div>
          </div>
          <Stagger className="grid-3" stagger={0.08}>
            {shared.reviews.items.map((review, i) => (
              <StaggerItem key={i} className="grid-3__item">
                <ReviewCard review={review} />
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      </section>
    ),

    /* 05 FAQ — Quiet: questions stagger in for scanning */
    faq: (
      <section className="section" aria-labelledby="faq-heading">
        <div className="container split">
          <div className="stack" style={{ '--stack-gap': '20px' }}>
            <p className="overline">{faq.overline}</p>
            <h2 id="faq-heading" className="display display--lg">
              {faq.title}
            </h2>
          </div>
          <FaqList />
        </div>
      </section>
    ),

    /* CTA band — Supporting: the final call arrives word by word */
    contactBand: (
      <section className="section section--lime" aria-labelledby="contact-band-heading">
        <div className="container contact-band">
          <div className="stack" style={{ '--stack-gap': '18px' }}>
            <p className="overline">{contactBand.overline}</p>
            <SplitReveal as="h2" id="contact-band-heading" className="display display--xl" text={contactBand.title} stagger={0.06} duration={0.65} />
            {contactBand.note && <p className="small">{contactBand.note}</p>}
          </div>
          <LinkButton link={contactBand.button} />
        </div>
      </section>
    ),
  };

  return (
    <>
      {home.sections
        .filter((s) => s.visible)
        .map((s) => (
          <Fragment key={s.id}>{blocks[s.id]}</Fragment>
        ))}
    </>
  );
}
