import { Fragment } from 'react';
import { m, useReducedMotion } from 'motion/react';
import { EASE_OUT, VIEWPORT } from './easing';

/**
 * Split-text reveal — words, characters or lines rise out of an overflow mask.
 * `text` may contain "\n" for explicit line breaks (required for by="line").
 * Words never break mid-word (chars are wrapped inside word spans).
 * Screen readers get the plain text once; the animated pieces are aria-hidden.
 * Reduced motion: the heading fades in as one piece.
 */
export default function SplitReveal({
  text,
  as = 'h2',
  by = 'word', // 'word' | 'char' | 'line'
  stagger, // seconds; defaults: word 0.06 · char 0.025 · line 0.11
  duration = 0.7,
  delay = 0,
  rotate = 0, // degrees of tilt on entry (kinetic brands: 3–6)
  trigger = 'view', // 'view' | 'mount'
  // Optional emphasis on a word or phrase (word/char modes):
  // { match: 'Less guesswork.', wrap: (node) => <ScribbleUnderline variant="marker">{node}</ScribbleUnderline> }
  highlight,
  className = '',
  ...rest // e.g. id for aria-labelledby
}) {
  const reduce = useReducedMotion();
  const Tag = m[as];
  const gap = stagger ?? { word: 0.06, char: 0.025, line: 0.11 }[by];
  const lines = text.split('\n');

  const parent = {
    hidden: {},
    show: { transition: { staggerChildren: reduce ? 0 : gap, delayChildren: delay } },
  };
  const piece = reduce
    ? { hidden: { opacity: 0 }, show: { opacity: 1, transition: { duration: 0.4 } } }
    : {
        hidden: { transform: `translateY(105%) rotate(${rotate}deg)` },
        show: { transform: 'translateY(0%) rotate(0deg)', transition: { duration, ease: EASE_OUT } },
      };

  const mask = (content, key, block = false) => (
    <span key={key} className={`md-split__mask${block ? ' md-split__mask--line' : ''}`}>
      <m.span className="md-split__piece" variants={piece}>
        {content}
      </m.span>
    </span>
  );

  const renderWord = (word, wi) =>
    by === 'char' ? (
      <span key={wi} className="md-split__word">
        {[...word].map((ch, ci) => mask(ch, ci))}
      </span>
    ) : (
      mask(word, wi)
    );

  const renderLine = (line, li) => {
    if (by === 'line') return mask(line, li, true);
    const words = line.split(' ');
    const phrase = highlight?.match.split(' ');
    const nodes = [];
    let wi = 0;
    while (wi < words.length) {
      if (phrase && words.slice(wi, wi + phrase.length).join(' ') === highlight.match) {
        // Keep the highlighted phrase together so the scribble can wrap it (outside the masks,
        // so underlines/circles aren't clipped).
        nodes.push(
          <Fragment key={`hl-${wi}`}>
            {highlight.wrap(
              <span className="md-split__group">
                {phrase.map((w, k) => (
                  <Fragment key={k}>
                    {renderWord(w, wi + k)}
                    {k < phrase.length - 1 && ' '}
                  </Fragment>
                ))}
              </span>,
            )}
          </Fragment>,
        );
        wi += phrase.length;
      } else {
        nodes.push(renderWord(words[wi], wi));
        wi += 1;
      }
      if (wi < words.length) nodes.push(' ');
    }
    return (
      <Fragment key={li}>
        {nodes}
        {li < lines.length - 1 && <br />}
      </Fragment>
    );
  };

  const triggerProps =
    trigger === 'mount' ? { animate: 'show' } : { whileInView: 'show', viewport: VIEWPORT };

  return (
    <Tag className={`md-split ${className}`} initial="hidden" variants={parent} {...triggerProps} {...rest}>
      <span className="md-sr">{text.replace(/\n/g, ' ')}</span>
      <span aria-hidden="true">{lines.map(renderLine)}</span>
    </Tag>
  );
}
