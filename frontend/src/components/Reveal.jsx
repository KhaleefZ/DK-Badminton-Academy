import { m } from 'motion/react';
import { EASE_OUT, useMotionTransform } from '../lib/motion';

/**
 * Marketing-only scroll reveal: fades up 16px once, the first time it enters the viewport.
 * Never use on the booking flow — functional UI shouldn't wait for decoration.
 */
export default function Reveal({ as = 'div', children, ...props }) {
  const tf = useMotionTransform();
  const Component = m[as];
  return (
    <Component
      initial={{ opacity: 0, transform: tf('translateY(16px)') }}
      whileInView={{ opacity: 1, transform: tf('translateY(0px)') }}
      viewport={{ once: true, margin: '-100px' }}
      transition={{ duration: 0.4, ease: EASE_OUT }}
      {...props}
    >
      {children}
    </Component>
  );
}
