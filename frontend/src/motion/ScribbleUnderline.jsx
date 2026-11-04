import { m, useReducedMotion } from 'motion/react';
import { EASE_IN_OUT, VIEWPORT } from './easing';

// Hand-drawn paths (deliberately imperfect), stretched to the word's size. Stroke width is in
// viewBox units (no non-scaling-stroke: it breaks pathLength drawing and turns lines dashed).
const SHAPES = {
  underline: { viewBox: '0 0 200 20', d: 'M3 14 C 40 6, 92 4, 132 9 S 186 15, 197 7' },
  double: { viewBox: '0 0 200 24', d: 'M4 10 C 60 4, 130 4, 196 9 M10 19 C 70 14, 140 14, 190 18' },
  circle: {
    viewBox: '0 0 200 80',
    d: 'M104 8 C 44 2, 6 20, 8 42 C 10 66, 62 77, 114 74 C 170 71, 197 53, 192 33 C 187 13, 146 3, 86 9',
  },
};

/**
 * Handwriting-style emphasis around inline text: underline, double underline, circle,
 * or a "marker" highlight sweep behind the text. Draws once in view, after `delay`
 * (let the headline land first). Decorative SVG is aria-hidden.
 * Reduced motion: shown fully drawn.
 */
export default function ScribbleUnderline({
  children,
  variant = 'underline', // 'underline' | 'double' | 'circle' | 'marker'
  color = 'currentColor',
  strokeWidth = 4,
  delay = 0.4,
  duration = 0.9,
  className = '',
}) {
  const reduce = useReducedMotion();
  const transition = { delay: reduce ? 0 : delay, duration: reduce ? 0 : duration, ease: EASE_IN_OUT };

  if (variant === 'marker') {
    return (
      <span className={`md-scribble md-scribble--marker ${className}`}>
        <m.span
          className="md-scribble__marker"
          style={{ background: color }}
          initial={{ transform: reduce ? 'scaleX(1)' : 'scaleX(0)' }}
          whileInView={{ transform: 'scaleX(1)' }}
          viewport={VIEWPORT}
          transition={transition}
          aria-hidden="true"
        />
        <span className="md-scribble__text">{children}</span>
      </span>
    );
  }

  const shape = SHAPES[variant];
  return (
    <span className={`md-scribble md-scribble--${variant} ${className}`}>
      {children}
      <svg className="md-scribble__svg" viewBox={shape.viewBox} preserveAspectRatio="none" aria-hidden="true" fill="none">
        <m.path
          d={shape.d}
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ pathLength: reduce ? 1 : 0 }}
          whileInView={{ pathLength: 1 }}
          viewport={VIEWPORT}
          transition={transition}
        />
      </svg>
    </span>
  );
}
