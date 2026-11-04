import { m, useReducedMotion } from 'motion/react';
import { EASE_IN_OUT, VIEWPORT } from './easing';

/**
 * Line drawing — strokes one or more SVG paths in sequence (signatures, arrows,
 * court lines, route lines, single-stroke "handwritten" words).
 * `paths`: array of path `d` strings, drawn one after another (stagger defaults to each
 * path's duration so it looks like one continuous hand). For real handwritten words use
 * single-stroke (Hershey / "single line") font paths — outline fonts can't be written.
 * Stretched drawings (preserveAspectRatio="none"): set strokeWidth in viewBox units. Don't add
 * vector-effect="non-scaling-stroke" — it breaks Motion's normalised pathLength dashes (lines turn dashed).
 * Reduced motion: shown fully drawn.
 */
export default function DrawPath({
  paths,
  viewBox,
  stroke = 'currentColor',
  strokeWidth = 2,
  duration = 1.1, // seconds per path
  stagger, // seconds between path starts (default = duration)
  delay = 0,
  trigger = 'view', // 'view' | 'mount'
  className = '',
  title, // optional accessible label; omit for decorative drawings
  ...svgProps
}) {
  const reduce = useReducedMotion();
  const gap = stagger ?? duration;
  const triggerProps = trigger === 'mount' ? { animate: { pathLength: 1, opacity: 1 } } : { whileInView: { pathLength: 1, opacity: 1 }, viewport: VIEWPORT };

  return (
    <svg
      className={`md-draw ${className}`}
      viewBox={viewBox}
      fill="none"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      {...svgProps}
    >
      {paths.map((d, i) => (
        <m.path
          key={i}
          d={d}
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ pathLength: reduce ? 1 : 0, opacity: reduce ? 1 : 0 }}
          transition={{
            pathLength: { delay: reduce ? 0 : delay + i * gap, duration: reduce ? 0 : duration, ease: EASE_IN_OUT },
            opacity: { delay: reduce ? 0 : delay + i * gap, duration: 0.01 },
          }}
          {...triggerProps}
        />
      ))}
    </svg>
  );
}
