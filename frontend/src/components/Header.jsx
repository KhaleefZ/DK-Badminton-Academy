import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import { AnimatePresence, m, useMotionValueEvent, useReducedMotion, useScroll } from 'motion/react';
import { EASE_OUT, useMotionTransform } from '../lib/motion';
import Identity from './Identity';
import { LinkButton } from './Button';
import { useContent } from '../lib/site';

const MotionNavLink = m.create(NavLink);

// Links follow the panel in, 40ms apart. No exit variant: the panel's fade carries them out.
const menuItem = (tf) => ({
  hidden: { opacity: 0, transform: tf('translateY(-4px)') },
  open: { opacity: 1, transform: tf('translateY(0px)'), transition: { duration: 0.2, ease: EASE_OUT } },
});

export default function Header() {
  const [open, setOpen] = useState(false);
  const { nav } = useContent();
  const links = nav.links.filter((l) => l.visible);
  const tf = useMotionTransform();
  const reduce = useReducedMotion();
  const { pathname } = useLocation();
  const [hidden, setHidden] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const { scrollY } = useScroll();

  // Reading down hides the bar; any scroll up (or being near the top) brings it back.
  useMotionValueEvent(scrollY, 'change', (y) => {
    const prev = scrollY.getPrevious() ?? 0;
    setScrolled(y > 8);
    if (y < 80) setHidden(false);
    else if (y > prev + 2) setHidden(true);
    else if (y < prev) setHidden(false);
  });

  // Never hide while the mobile menu is open or for reduced-motion users.
  const hide = hidden && !open && !reduce;

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <m.header
      className={`site-header${scrolled ? ' is-scrolled' : ''}`}
      animate={{ transform: hide ? 'translateY(-100%)' : 'translateY(0%)' }}
      initial={false}
      transition={{ duration: 0.2, ease: EASE_OUT }}
      onFocus={() => setHidden(false)}
    >
      <div className="container site-header__bar">
        <div className="site-header__identity site-header__identity--full">
          <Identity />
        </div>
        <div className="site-header__identity site-header__identity--compact">
          <Identity compact />
        </div>

        <nav className="site-nav" aria-label="Main">
          {links.map((link) =>
            /^[a-z]+:/i.test(link.to) ? (
              <a key={link.to} href={link.to} className="site-nav__link">
                {link.label}
              </a>
            ) : (
              <NavLink key={link.to} to={link.to} className="site-nav__link">
                {link.label}
              </NavLink>
            ),
          )}
          <LinkButton link={nav.bookButton} size="sm" />
        </nav>

        <button
          type="button"
          className="site-header__toggle"
          aria-expanded={open}
          aria-controls="mobile-menu"
          onClick={() => setOpen((v) => !v)}
        >
          <span>{nav.mobileMenuLabel}</span>
          {open ? <X size={20} strokeWidth={1.6} aria-hidden="true" /> : <Menu size={20} strokeWidth={1.6} aria-hidden="true" />}
        </button>
      </div>

      <AnimatePresence>
        {open && (
          <m.nav
            id="mobile-menu"
            className="mobile-menu is-open"
            aria-label="Mobile"
            initial="hidden"
            animate="open"
            exit="exit"
            variants={{
              hidden: { opacity: 0, transform: tf('translateY(-8px)') },
              open: {
                opacity: 1,
                transform: tf('translateY(0px)'),
                transition: { duration: 0.2, ease: EASE_OUT, delayChildren: 0.04, staggerChildren: 0.04 },
              },
              exit: { opacity: 0, transform: tf('translateY(-8px)'), transition: { duration: 0.15, ease: EASE_OUT } },
            }}
          >
            <div className="container mobile-menu__inner">
              {links.map((link) =>
                /^[a-z]+:/i.test(link.to) ? (
                  <m.a key={link.to} href={link.to} className="mobile-menu__link" variants={menuItem(tf)}>
                    {link.label}
                  </m.a>
                ) : (
                  <MotionNavLink key={link.to} to={link.to} className="mobile-menu__link" variants={menuItem(tf)}>
                    {link.label}
                  </MotionNavLink>
                ),
              )}
              <m.div variants={menuItem(tf)}>
                <LinkButton link={nav.bookButton} variant="lime" />
              </m.div>
            </div>
          </m.nav>
        )}
      </AnimatePresence>
    </m.header>
  );
}
