import { Link } from 'react-router-dom';
import { useSite } from '../lib/site';

/** DK identity: type-set monogram + wordmark. `tone="dark"` for ink backgrounds. */
export default function Identity({ tone = 'light', compact = false }) {
  const { content, venue } = useSite();
  const { brand } = content;
  return (
    <Link to="/" className={`identity identity--${tone}`} aria-label={`${venue.name} home`}>
      <span className="identity__monogram">{brand.monogram}</span>
      {!compact && (
        <span className="identity__wordmark">
          <span className="identity__name">{brand.wordmark}</span>
          <span className="identity__locality">
            {brand.locality.toUpperCase()} · {brand.city.toUpperCase()}
          </span>
        </span>
      )}
    </Link>
  );
}
