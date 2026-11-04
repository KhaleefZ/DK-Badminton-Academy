import { useRef } from 'react';
import { m, useReducedMotion, useScroll, useSpring } from 'motion/react';

/**
 * Scroll-linked line drawing — the path draws as the reader scrolls through its section
 * (timelines, process steps, court lines, route maps). Uses a motion value for pathLength,
 * so there is no React re-render while scrolling. A light spring smooths trackpad jitter.
 * `offset` follows Motion's useScroll syntax: when drawing starts / finishes.
 * Reduced motion: fully drawn.
 */
export default function ScrollDrawPath({
  paths,
  viewBox,
  stroke = 'currentColor',
  strokeWidth = 2,
  offset = ['start 85%', 'end 55%'],
  className = '',
  ...svgProps
}) {
  const ref = useRef(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset });
  const progress = useSpring(scrollYProgress, { stiffness: 120, damping: 30, restDelta: 0.001 });

  return (
    <svg ref={ref} className={`md-draw md-draw--scroll ${className}`} viewBox={viewBox} fill="none" aria-hidden="true" {...svgProps}>
      {paths.map((d, i) => (
        <m.path
          key={i}
          d={d}
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ pathLength: reduce ? 1 : progress }}
        />
      ))}
    </svg>
  );
}
