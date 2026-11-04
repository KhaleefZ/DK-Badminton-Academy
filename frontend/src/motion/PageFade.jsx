import { m, useReducedMotion } from 'motion/react';
import { EASE_OUT } from './easing';

/**
 * Page fade — marketing-site route transition: the new page's <main> fades and rises 8px
 * on arrival. No exit animation, so the new route is never held back by the old one.
 * Key it by the route: <PageFade routeKey={location.pathname}>…</PageFade>.
 * Skip it on apps/dashboards. Reduced motion: opacity only.
 */
export default function PageFade({ children, routeKey, as = 'main', className = '', ...rest }) {
  const reduce = useReducedMotion();
  const Tag = m[as];
  return (
    <Tag
      key={routeKey}
      className={className}
      initial={{ opacity: 0, transform: reduce ? 'none' : 'translateY(8px)' }}
      animate={{ opacity: 1, transform: 'translateY(0px)' }}
      transition={{ duration: 0.28, ease: EASE_OUT }}
      {...rest}
    >
      {children}
    </Tag>
  );
}
