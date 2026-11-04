import { useRef } from 'react';
import { m, useMotionTemplate, useMotionValue, useReducedMotion, useSpring } from 'motion/react';
import { hasFinePointer } from './easing';

/**
 * Magnetic — the wrapped element leans toward the pointer and springs back on leave.
 * One primary CTA per page at most. Disabled for touch, coarse pointers and reduced motion.
 */
export default function Magnetic({ children, strength = 0.3, className = '' }) {
  const ref = useRef(null);
  const reduce = useReducedMotion();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const spring = { stiffness: 300, damping: 20, mass: 0.5 };
  const sx = useSpring(x, spring);
  const sy = useSpring(y, spring);
  const transform = useMotionTemplate`translate(${sx}px, ${sy}px)`;
  const enabled = !reduce && hasFinePointer();

  const onMove = (e) => {
    if (!enabled) return;
    const r = ref.current.getBoundingClientRect();
    x.set((e.clientX - (r.left + r.width / 2)) * strength);
    y.set((e.clientY - (r.top + r.height / 2)) * strength);
  };
  const reset = () => {
    x.set(0);
    y.set(0);
  };

  return (
    <m.span
      ref={ref}
      className={`md-magnetic ${className}`}
      style={enabled ? { transform } : undefined}
      onPointerMove={onMove}
      onPointerLeave={reset}
    >
      {children}
    </m.span>
  );
}
