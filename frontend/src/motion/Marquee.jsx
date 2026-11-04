/**
 * Marquee / ticker — pure CSS (runs on the compositor, keeps going while JS is busy).
 * Two identical groups translate by -50% for a seamless loop; the second is aria-hidden.
 * Pauses on hover for real pointers; static row under reduced motion (see motion.css).
 * Never put information people must read in a marquee.
 */
export default function Marquee({ items, speed = 35, reverse = false, separator = '•', className = '', label }) {
  const group = (hidden) => (
    <ul className="md-marquee__group" aria-hidden={hidden || undefined}>
      {items.map((item, i) => (
        <li key={i} className="md-marquee__item">
          <span>{item}</span>
          <span className="md-marquee__sep" aria-hidden="true">
            {separator}
          </span>
        </li>
      ))}
    </ul>
  );

  return (
    <div className={`md-marquee${reverse ? ' md-marquee--reverse' : ''} ${className}`} style={{ '--md-marquee-speed': `${speed}s` }} aria-label={label}>
      <div className="md-marquee__track">
        {group(false)}
        {group(true)}
      </div>
    </div>
  );
}
