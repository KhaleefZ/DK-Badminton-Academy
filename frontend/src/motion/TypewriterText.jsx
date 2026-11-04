import { useEffect, useRef, useState } from 'react';
import { useInView, useReducedMotion } from 'motion/react';
import { VIEWPORT } from './easing';

/**
 * Typewriter — types `text` character by character with a blinking caret.
 * Technique: an invisible "ghost" copy reserves the final size (no layout shift);
 * the typed copy is absolutely positioned over it. Screen readers get the full text once.
 * Punctuation adds a short beat so the line reads like speech.
 * Reduced motion: full text immediately, no caret.
 */
export default function TypewriterText({
  text,
  as: Tag = 'span',
  speed = 34, // ms per character
  delay = 300, // ms before typing starts
  cursor = true,
  trigger = 'view', // 'view' | 'mount'
  className = '',
  onDone,
}) {
  const ref = useRef(null);
  const inView = useInView(ref, VIEWPORT);
  const reduce = useReducedMotion();
  const [count, setCount] = useState(0);
  const [done, setDone] = useState(false);
  const active = trigger === 'mount' || inView;

  useEffect(() => {
    if (reduce) {
      setCount(text.length);
      setDone(true);
      return undefined;
    }
    if (!active) return undefined;
    let i = 0;
    let timer;
    const tick = () => {
      i += 1;
      setCount(i);
      if (i < text.length) {
        const pause = /[,.!?;:—]/.test(text[i - 1]) ? speed * 5 : 0;
        timer = setTimeout(tick, speed + pause);
      } else {
        setDone(true);
        onDone?.();
      }
    };
    timer = setTimeout(tick, delay);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, reduce, text, speed, delay]);

  return (
    <Tag ref={ref} className={`md-type ${className}`}>
      <span className="md-sr">{text}</span>
      <span className="md-ghost" aria-hidden="true">
        {text}
      </span>
      <span className="md-type__live" aria-hidden="true">
        {text.slice(0, count)}
        {cursor && !reduce && <span className={`md-caret${done ? ' md-caret--done' : ''}`} />}
      </span>
    </Tag>
  );
}
