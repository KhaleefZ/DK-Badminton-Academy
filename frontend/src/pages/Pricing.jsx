import { Fragment } from 'react';
import { LinkButton } from '../components/Button';
import EnquiryCard from '../components/EnquiryCard';
import FaqList from '../components/FaqList';
import Notice from '../components/Notice';
import Reveal from '../components/Reveal';
import { formatPaise } from '../booking/schedule';
import { ScribbleUnderline, SplitReveal, Stagger, StaggerItem } from '../motion';
import { dayRange, timeSpan, useSite } from '../lib/site';
import { highlightOf } from '../lib/highlight';

export default function Pricing() {
  const { content, live } = useSite();
  const { sections, hero, rates, compare, commit } = content.pricing;

  const blocks = {
    hero: (
      <section className="section" aria-labelledby="pricing-heading">
        <div className="container stack">
          <p className="overline">{hero.overline}</p>
          {/* Signature (light): calm page, one emphasis — a lime marker sweeps behind the promise */}
          <SplitReveal
            as="h1"
            id="pricing-heading"
            className="display display--page"
            text={hero.title}
            trigger="mount"
            stagger={0.07}
            highlight={highlightOf(hero.titleHighlight, (node) => (
              <ScribbleUnderline variant="marker" color="var(--accent-rally)" delay={0.7} duration={0.7}>
                {node}
              </ScribbleUnderline>
            ))}
          />
          <p className="lead muted">{hero.lead}</p>
          <div>
            <LinkButton link={hero.button} />
          </div>
          {hero.notice && <Notice className="full-width">{hero.notice}</Notice>}
          <Stagger className="grid-3 full-width" stagger={0.08} delay={0.3}>
            {hero.cards.map((card, i) => (
              <StaggerItem key={i} className="grid-3__item">
                <EnquiryCard card={card} />
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      </section>
    ),
    // Appears by itself once prices are saved, so it can never show an old price.
    rates: live.rates.length > 0 && (
      <section className="section" aria-labelledby="rates-heading">
        <Reveal className="container stack" style={{ '--stack-gap': '32px' }}>
          <div className="stack" style={{ '--stack-gap': '16px' }}>
            <p className="overline">{rates.overline}</p>
            <h2 id="rates-heading" className="display display--md">
              {rates.title}
            </h2>
          </div>
          <div className="table-scroll full-width" tabIndex={0} role="region" aria-label={rates.title}>
            <table className="compare-table">
              <thead>
                <tr>
                  <th scope="col">{rates.daysColumn}</th>
                  <th scope="col">{rates.timeColumn}</th>
                  <th scope="col">{rates.rateColumn}</th>
                </tr>
              </thead>
              <tbody>
                {live.rates.map((rate, i) => (
                  <tr key={i}>
                    <th scope="row">
                      {dayRange(rate.days)}
                      {rate.court ? ` · ${rate.court}` : ''}
                    </th>
                    <td>{timeSpan(rate.start, rate.end)}</td>
                    <td>{formatPaise(rate.ratePaise)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rates.note && <p className="meta muted">{rates.note}</p>}
        </Reveal>
      </section>
    ),
    compare: (
      <section className="section section--paper" aria-labelledby="compare-heading">
        <Reveal className="container stack" style={{ '--stack-gap': '32px' }}>
          <div className="stack" style={{ '--stack-gap': '16px' }}>
            <p className="overline">{compare.overline}</p>
            <h2 id="compare-heading" className="display display--md">
              {compare.title}
            </h2>
          </div>
          <div className="table-scroll full-width" tabIndex={0} role="region" aria-label={compare.title}>
            <table className="compare-table">
              <thead>
                <tr>
                  <th scope="col">{compare.firstColumn}</th>
                  {compare.columns.map((column, i) => (
                    <th key={i} scope="col">
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {compare.rows.map((row, r) => (
                  <tr key={r}>
                    <th scope="row">{row.label}</th>
                    {compare.columns.map((_, c) => (
                      <td key={c}>{row.values[c] ?? ''}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Reveal>
      </section>
    ),
    commit: (
      <section className="section" aria-labelledby="commit-heading">
        <div className="container split">
          <div className="stack" style={{ '--stack-gap': '20px' }}>
            <h2 id="commit-heading" className="display display--md">
              {commit.title}
            </h2>
            <p className="small muted">{commit.text}</p>
            <LinkButton link={commit.button} />
          </div>
          <FaqList />
        </div>
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
