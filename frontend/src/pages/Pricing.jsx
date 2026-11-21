import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { AnimatePresence, m, useReducedMotion } from 'motion/react';
import Button from '../components/Button';
import { LinkButton } from '../components/Button';
import EnquiryCard from '../components/EnquiryCard';
import FaqList from '../components/FaqList';
import Notice from '../components/Notice';
import Reveal from '../components/Reveal';
import { formatPaise } from '../booking/schedule';
import { ScribbleUnderline, SplitReveal, Stagger, StaggerItem } from '../motion';
import { dayRange, timeSpan, useSite } from '../lib/site';
import { highlightOf } from '../lib/highlight';
import { EASE_OUT } from '../lib/motion';
import JoinForm from '../membership/JoinForm';
import PlanCards from '../membership/PlanCards';
import { useMembershipOptions } from '../membership/useMembershipOptions';

export default function Pricing() {
  const { content, live } = useSite();
  const { sections, hero, rates, plans, join, compare, commit } = content.pricing;
  const joinText = content.membership.join;
  const joinVisible = sections.some((s) => s.id === 'join' && s.visible);
  const { options, loadError } = useMembershipOptions();
  const [planId, setPlanId] = useState(null);
  const [joinOpen, setJoinOpen] = useState(false);
  const joinHeading = useRef(null);
  // key changes on every link click, even to the address already showing, so a repeat click still works.
  const { hash, key } = useLocation();
  const reduce = useReducedMotion();

  // Glides to a section, leaving room for the sticky header (see .pricing-anchor). Parts of the page
  // above it (live rates, plans) can still be arriving, so for a moment it checks it really got there,
  // unless the visitor starts scrolling themselves.
  const scrollToSection = useCallback(
    (id) => {
      let userMoved = false;
      const stop = () => {
        userMoved = true;
      };
      const events = ['wheel', 'touchstart', 'keydown'];
      events.forEach((e) => window.addEventListener(e, stop, { once: true, passive: true }));
      const go = (behavior) => document.getElementById(id)?.scrollIntoView({ behavior, block: 'start' });
      requestAnimationFrame(() => go(reduce ? 'auto' : 'smooth'));
      [700, 1400].forEach((delay) =>
        setTimeout(() => {
          const target = document.getElementById(id);
          if (userMoved || !target) return;
          const offset = parseFloat(getComputedStyle(target).scrollMarginTop) || 0;
          if (Math.abs(target.getBoundingClientRect().top - offset) > 8) go(reduce ? 'auto' : 'smooth');
        }, delay),
      );
      setTimeout(() => events.forEach((e) => window.removeEventListener(e, stop)), 1600);
    },
    [reduce],
  );

  // Links such as /pricing#plans and /pricing#join (where /membership now leads) land on their section,
  // once the plans have loaded, so nothing above it changes height after the scroll.
  const ready = options !== null || Boolean(loadError);
  useEffect(() => {
    const id = hash.slice(1);
    if (id !== 'plans' && id !== 'join') return;
    if (id === 'join') setJoinOpen(true);
    if (ready) scrollToSection(id);
  }, [hash, key, ready, scrollToSection]);

  /** A plan card's "Join this plan": opens the form with that plan chosen and takes the visitor there. */
  const choosePlan = (id) => {
    setPlanId(id);
    setJoinOpen(true);
    scrollToSection('join');
    // Keyboard and screen-reader users move with the page, once the scroll has had time to start.
    setTimeout(() => joinHeading.current?.focus({ preventScroll: true }), reduce ? 0 : 400);
  };

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
    // Appears by itself once a plan is set up in the admin panel.
    plans: (options === null || options.plans.length > 0) && !loadError && (
      <section id="plans" className="section pricing-anchor" aria-labelledby="plans-heading">
        <div className="container stack" style={{ '--stack-gap': '32px' }}>
          <Reveal className="stack" style={{ '--stack-gap': '16px' }}>
            <p className="overline">{plans.overline}</p>
            <h2 id="plans-heading" className="display display--md">
              {plans.title}
            </h2>
            <p className="lead muted">{plans.lead}</p>
          </Reveal>
          <PlanCards options={options} loadError={loadError} selectedId={joinOpen ? planId : null} onChoose={joinVisible ? choosePlan : null} />
        </div>
      </section>
    ),
    join: (
      <section id="join" className="section section--paper pricing-anchor" aria-labelledby="join-heading">
        <div className="container stack" style={{ '--stack-gap': '32px' }}>
          <Reveal className="join-section__head">
            <div className="stack" style={{ '--stack-gap': '16px' }}>
              <p className="overline">{joinText.overline}</p>
              <h2 id="join-heading" ref={joinHeading} tabIndex={-1} className="display display--md">
                {joinText.title}
              </h2>
              <p className="lead muted">{joinText.lead}</p>
            </div>
            {joinOpen && (
              <Button variant="secondary" icon={false} size="sm" onClick={() => setJoinOpen(false)}>
                {join.closeButton}
              </Button>
            )}
          </Reveal>
          {/* The form opens in place, so the page stays short until someone wants to join. */}
          <AnimatePresence initial={false} mode="wait">
            {joinOpen ? (
              <m.div
                key="open"
                className="join-panel"
                initial={reduce ? { opacity: 0 } : { opacity: 0, height: 0 }}
                animate={reduce ? { opacity: 1 } : { opacity: 1, height: 'auto' }}
                exit={reduce ? { opacity: 0 } : { opacity: 0, height: 0 }}
                transition={{ duration: reduce ? 0.15 : 0.45, ease: EASE_OUT }}
              >
                <div className="join-panel__inner">
                  <JoinForm options={options} loadError={loadError} planId={planId} onPlanChange={setPlanId} />
                </div>
              </m.div>
            ) : (
              <m.div
                key="closed"
                className="join-closed"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2, ease: EASE_OUT }}
              >
                <p className="small muted">{join.closedText}</p>
                <Button icon={false} className="join-closed__button" onClick={() => setJoinOpen(true)}>
                  {join.openButton}
                </Button>
              </m.div>
            )}
          </AnimatePresence>
        </div>
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
