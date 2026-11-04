import { Fragment } from 'react';
import { LinkButton } from '../components/Button';
import ConceptImage from '../components/ConceptImage';
import Notice from '../components/Notice';
import Reveal from '../components/Reveal';
import { DrawPath, Marquee, ScribbleUnderline, SplitReveal, Stagger, StaggerItem, TextRotator } from '../motion';
import { useContent } from '../lib/site';
import { highlightOf } from '../lib/highlight';

export default function About() {
  const { sections, hero, values, marquee, coaching, local } = useContent().about;
  const words = coaching.rotatingWords.filter(Boolean);

  const blocks = {
    hero: (
      <section className="hero hero--about on-dark" aria-labelledby="about-heading">
        <div className="hero__copy stack" style={{ '--stack-gap': '30px' }}>
          <p className="overline">{hero.overline}</p>
          {/* Signature: conviction lands word by word, then a hand-drawn circle rings the highlight */}
          <SplitReveal
            as="h1"
            id="about-heading"
            className="display display--xl"
            text={hero.title}
            trigger="mount"
            stagger={0.07}
            highlight={highlightOf(hero.titleHighlight, (node) => (
              <ScribbleUnderline variant="circle" color="var(--accent-rally)" delay={0.9} duration={1} strokeWidth={3}>
                {node}
              </ScribbleUnderline>
            ))}
          />
          <p className="body">{hero.text}</p>
          {hero.note && <p className="fine">{hero.note}</p>}
        </div>
        <ConceptImage image={hero.image} className="hero__image" eager reveal="left" />
      </section>
    ),
    values: (
      <section className="section" aria-labelledby="values-heading">
        <div className="container stack" style={{ '--stack-gap': '32px' }}>
          <div className="stack" style={{ '--stack-gap': '16px' }}>
            <p className="overline">{values.overline}</p>
            {/* Supporting: the three values land as three beats */}
            <SplitReveal as="h2" id="values-heading" className="display display--lg" text={values.title} stagger={0.12} />
          </div>
          <Stagger as="ol" className="stage-list stage-list--plain" stagger={0.08} delay={0.3}>
            {values.items.map((value, i) => (
              <StaggerItem as="li" key={i} className="stage-list__item">
                <p className="overline">{value.number}</p>
                <h3 className="stage-list__title">{value.title}</h3>
                <p className="small muted">{value.text}</p>
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      </section>
    ),
    /* Supporting: the values repeat like a mantra (the site's only marquee) */
    marquee: marquee.items.length > 0 && (
      <section className="values-marquee on-dark" aria-label="Our values">
        <Marquee items={marquee.items} speed={40} separator="●" />
      </section>
    ),
    coaching: (
      <section className="section section--paper" aria-labelledby="coaching-heading">
        <Reveal className="container media-split">
          <ConceptImage image={coaching.image} height={420} />
          <div className="stack">
            <p className="overline">{coaching.overline}</p>
            {/* Supporting: the slot rests on the last word. The "?" lives inside each word so the
                slot's reserved width trails invisibly at the end. */}
            <h2 id="coaching-heading" className="display display--lg" aria-label={[coaching.title, words.join(', ')].filter(Boolean).join(' ')}>
              {coaching.title} {words.length > 0 && <TextRotator words={words} className="coaching-rotator" />}
            </h2>
            <p className="body muted">{coaching.text}</p>
            {coaching.notice && <Notice>{coaching.notice}</Notice>}
            {/* Supporting: a hand-drawn arrow nudges toward the enquiry */}
            <div className="coaching-cta">
              <DrawPath
                className="coaching-cta__arrow"
                viewBox="0 0 80 56"
                paths={['M6 6 C 10 30, 30 46, 66 46', 'M56 36 L 68 46 L 55 54']}
                stroke="var(--action-primary)"
                strokeWidth={2.5}
                duration={0.7}
                stagger={0.6}
                delay={0.3}
              />
              <LinkButton link={coaching.button} />
            </div>
          </div>
        </Reveal>
      </section>
    ),
    local: (
      <section className="section section--lime" aria-labelledby="local-heading">
        <Reveal className="container contact-band">
          <h2 id="local-heading" className="display display--xl">
            {local.title}
          </h2>
          <div className="stack" style={{ '--stack-gap': '20px' }}>
            <p className="small">{local.text}</p>
            <LinkButton link={local.button} />
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
