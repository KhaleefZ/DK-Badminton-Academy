import { useRef } from 'react';
import { m, useReducedMotion, useScroll, useTransform } from 'motion/react';

/**
 * Parallax — the content drifts against the scroll direction inside a clipped frame.
 * The inner layer is oversized (`scale`) so edges never show. Scroll-linked motion
 * values write a transform string directly — no React re-render while scrolling.
 * Use on imagery only, never on text blocks. Reduced motion: static.
 */
export default function Parallax({ children, offset = 60, scale = 1.15, className = '' }) {
  const ref = useRef(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] });
  const transform = useTransform(scrollYProgress, (p) => `translateY(${(p - 0.5) * 2 * offset}px) scale(${scale})`);

  return (
    <div ref={ref} className={`md-parallax ${className}`}>
      <m.div className="md-parallax__inner" style={{ transform: reduce ? 'none' : transform }}>
        {children}
      </m.div>
    </div>
  );
}
