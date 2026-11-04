import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, m, useInView, useReducedMotion } from 'motion/react';
import { EASE_OUT } from './easing';

/**
 * Text rotator — one slot in a headline cycles through words ("Built for players /
 * coaches / families"), each rolling up out of a mask. The slot reserves the widest word
 * (ghost stack) so the line never reflows. It runs only while in view and stops after
 * `loops` passes on the LAST word, so the page comes to rest (no endless loop).
 * Screen readers hear every option once. Reduced motion: the last word, static.
 */
export default function TextRotator({ words, interval = 2200, loops = 1, delay = 600, className = '' }) {
  const ref = useRef(null);
  const reduce = useReducedMotion();
  const inView = useInView(ref, { margin: '0px 0px -10% 0px' });
  const total = words.length * loops;
  const [step, setStep] = useState(0);
  const done = step >= total - 1;

  useEffect(() => {
    if (reduce || !inView || done) return undefined;
    const id = setTimeout(() => setStep((s) => s + 1), step === 0 ? delay + interval : interval);
    return () => clearTimeout(id);
  }, [reduce, inView, done, step, interval, delay]);

  const word = reduce ? words[words.length - 1] : words[step % words.length];

  return (
    <span ref={ref} className={`md-rotator ${className}`}>
      <span className="md-sr">{words.join(', ')}</span>
      <span className="md-rotator__ghost" aria-hidden="true">
        {words.map((w) => (
          <span key={w}>{w}</span>
        ))}
      </span>
      <span className="md-rotator__live" aria-hidden="true">
        <AnimatePresence initial={false} mode="popLayout">
          <m.span
            key={word + step}
            className="md-rotator__word"
            initial={{ transform: 'translateY(100%)', opacity: 0 }}
            animate={{ transform: 'translateY(0%)', opacity: 1 }}
            exit={{ transform: 'translateY(-100%)', opacity: 0 }}
            transition={{ duration: 0.5, ease: EASE_OUT }}
          >
            {word}
          </m.span>
        </AnimatePresence>
      </span>
    </span>
  );
}
