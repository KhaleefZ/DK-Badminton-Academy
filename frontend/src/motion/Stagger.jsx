import { m, useReducedMotion } from 'motion/react';
import { EASE_OUT, VIEWPORT } from './easing';

/**
 * Staggered group entrance — children rise and fade in one after another, once in view.
 * <Stagger as="ul" className="grid"> <StaggerItem as="li">…</StaggerItem> … </Stagger>
 * Also the "quiet reveal" for plain sections (a Stagger with a single StaggerItem).
 * Reduced motion: opacity only, no stagger.
 */
export function Stagger({ children, as = 'div', stagger = 0.07, delay = 0, trigger = 'view', className = '', ...rest }) {
  const reduce = useReducedMotion();
  const Tag = m[as];
  const variants = { hidden: {}, show: { transition: { staggerChildren: reduce ? 0 : stagger, delayChildren: delay } } };
  const triggerProps = trigger === 'mount' ? { animate: 'show' } : { whileInView: 'show', viewport: VIEWPORT };
  return (
    <Tag className={className} initial="hidden" variants={variants} {...triggerProps} {...rest}>
      {children}
    </Tag>
  );
}

export function StaggerItem({ children, as = 'div', distance = 20, duration = 0.55, className = '', ...rest }) {
  const reduce = useReducedMotion();
  const Tag = m[as];
  const variants = reduce
    ? { hidden: { opacity: 0 }, show: { opacity: 1, transition: { duration: 0.3 } } }
    : {
        hidden: { opacity: 0, transform: `translateY(${distance}px)` },
        show: { opacity: 1, transform: 'translateY(0px)', transition: { duration, ease: EASE_OUT } },
      };
  return (
    <Tag className={className} variants={variants} {...rest}>
      {children}
    </Tag>
  );
}
