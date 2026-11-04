import { useEffect, useRef, useState } from 'react';
import { useInView, useReducedMotion } from 'motion/react';
import { VIEWPORT } from './easing';

const DEFAULT_GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/**
 * Text scramble / decode — random glyphs resolve into the real text, left to right.
 * Writes textContent directly each frame (no React re-render per frame). A ghost copy
 * reserves the final width; glyphs refresh every 2nd frame so it reads as decoding, not noise.
 * trigger: 'view' (once in view) | 'mount' | 'hover' (replays on pointer enter, fine pointers only).
 * Reduced motion: final text, no scramble.
 */
export default function ScrambleText({
  text,
  as: Tag = 'span',
  duration = 900, // ms
  delay = 0, // ms
  glyphs = DEFAULT_GLYPHS,
  trigger = 'view',
  className = '',
}) {
  const ref = useRef(null);
  const live = useRef(null);
  const inView = useInView(ref, VIEWPORT);
  const reduce = useReducedMotion();
  const [run, setRun] = useState(0);
  const shouldRun = trigger === 'mount' || (trigger === 'view' && inView) || (trigger === 'hover' && run > 0);

  useEffect(() => {
    const el = live.current;
    if (!el) return undefined;
    if (reduce || !shouldRun) {
      el.textContent = text;
      return undefined;
    }
    const chars = [...text];
    const resolveAt = chars.map((_, i) => (i / chars.length) * duration * 0.7 + Math.random() * duration * 0.3);
    let raf;
    let start;
    let frame = 0;
    const step = (t) => {
      start ??= t;
      const elapsed = t - start - delay;
      if (frame++ % 2 === 0) {
        el.textContent = chars
          .map((c, i) => (c === ' ' || elapsed >= resolveAt[i] ? c : glyphs[Math.floor(Math.random() * glyphs.length)]))
          .join('');
      }
      if (elapsed < duration) raf = requestAnimationFrame(step);
      else el.textContent = text;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [shouldRun, run, reduce, text, duration, delay, glyphs]);

  const hoverProps =
    trigger === 'hover'
      ? { onPointerEnter: (e) => e.pointerType === 'mouse' && setRun((n) => n + 1) }
      : {};

  return (
    <Tag ref={ref} className={`md-scramble ${className}`} {...hoverProps}>
      <span className="md-sr">{text}</span>
      <span className="md-ghost" aria-hidden="true">
        {text}
      </span>
      <span ref={live} className="md-scramble__live" aria-hidden="true">
        {text}
      </span>
    </Tag>
  );
}
