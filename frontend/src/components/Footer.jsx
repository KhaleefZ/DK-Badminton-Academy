import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import { m, useReducedMotion } from 'motion/react';
import Identity from './Identity';
import { EASE_IN_OUT, VIEWPORT } from '../motion';
import { managementUrl } from '../data/site';
import { useContent } from '../lib/site';

const isExternal = (to) => /^[a-z]+:/i.test(to);

export default function Footer() {
  const reduce = useReducedMotion();
  const { nav, footer, customPages } = useContent();
  const links = [...nav.links.filter((l) => l.visible), ...customPages.filter((p) => p.visible && p.showInFooter).map((p) => ({ label: p.title, to: `/p/${p.slug}` }))];
  return (
    <footer className="site-footer on-dark">
      <div className="container stack" style={{ '--stack-gap': '32px' }}>
        <Identity tone="dark" />
        <nav className="site-footer__nav" aria-label="Footer">
          {links.map((link, i) => (
            <Fragment key={link.to}>
              {i > 0 && <span aria-hidden="true">/</span>}
              {isExternal(link.to) ? (
                <a href={link.to} className="md-link">
                  {link.label}
                </a>
              ) : (
                <Link to={link.to} className="md-link">
                  {link.label}
                </Link>
              )}
            </Fragment>
          ))}
        </nav>
        {/* The court-line motif closes the page: the rule draws left → right once */}
        <m.hr
          className="rule rule--light site-footer__rule"
          initial={{ transform: 'scaleX(0)' }}
          whileInView={{ transform: 'scaleX(1)' }}
          viewport={VIEWPORT}
          transition={reduce ? { duration: 0 } : { duration: 0.8, ease: EASE_IN_OUT }}
        />
        {footer.contactLine && <p className="fine">{footer.contactLine}</p>}
        <div className="site-footer__legal">
          {footer.showStaffLogin && <a href={managementUrl}>{footer.staffLoginLabel}</a>}
        </div>
      </div>
    </footer>
  );
}
