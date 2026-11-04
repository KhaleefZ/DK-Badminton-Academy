import { m, useReducedMotion } from 'motion/react';
import { EASE_IN_OUT, VIEWPORT } from './easing';

const FROM = {
  up: 'inset(100% 0% 0% 0%)', // revealed from the bottom edge upward
  down: 'inset(0% 0% 100% 0%)',
  left: 'inset(0% 0% 0% 100%)', // revealed from the right edge leftward
  right: 'inset(0% 100% 0% 0%)', // revealed from the left edge rightward (reading direction)
};

/**
 * Mask / clip reveal — the frame wipes open while the content inside settles from a
 * slight zoom (cinematic image reveal). Wrap an <img>, <picture> or any block.
 * The wrapper fills its parent; give the parent a size.
 * Reduced motion: a plain fade.
 */
export default function MaskReveal({
  children,
  direction = 'up',
  duration = 1.1,
  delay = 0,
  zoom = 1.15,
  trigger = 'view', // 'view' | 'mount'
  className = '',
}) {
  const reduce = useReducedMotion();
  const frame = reduce
    ? { hidden: { opacity: 0 }, show: { opacity: 1, transition: { duration: 0.5, delay } } }
    : {
        hidden: { clipPath: FROM[direction] },
        show: { clipPath: 'inset(0% 0% 0% 0%)', transition: { duration, delay, ease: EASE_IN_OUT } },
      };
  const inner = reduce
    ? { hidden: {}, show: {} }
    : {
        hidden: { transform: `scale(${zoom})` },
        show: { transform: 'scale(1)', transition: { duration: duration + 0.25, delay, ease: [0.23, 1, 0.32, 1] } },
      };
  const triggerProps = trigger === 'mount' ? { animate: 'show' } : { whileInView: 'show', viewport: VIEWPORT };

  return (
    <m.div className={`md-mask ${className}`} initial="hidden" variants={frame} {...triggerProps}>
      <m.div className="md-mask__inner" variants={inner}>
        {children}
      </m.div>
    </m.div>
  );
}
