import { Check } from 'lucide-react';
import { LinkButton } from './Button';
import { formatPaise } from '../booking/schedule';
import { useSite } from '../lib/site';

const inr = new Intl.NumberFormat('en-IN');

/**
 * Price card on Home. A card can follow the prices bookings really use, so the two can't
 * disagree; until any are saved it shows the price typed in the admin panel.
 */
export function PriceCard({ card }) {
  const { content, live } = useSite();
  const { popularBadge, fromLabel } = content.home.plans;
  const lowestRate = live.rates.length ? Math.min(...live.rates.map((r) => r.ratePaise)) : null;
  const livePaise = card.priceSource === 'court' ? lowestRate : card.priceSource === 'membership' ? live.membershipFromPaise : null;
  return (
    <article className={`enquiry-card${card.popular ? ' enquiry-card--popular' : ''}`}>
      <div className="enquiry-card__top">
        <p className="overline">{card.label}</p>
        {card.popular && <span className="badge badge--lime">{popularBadge}</span>}
      </div>
      <h3 className="card-title">{card.title}</h3>
      <p className="small muted">{card.text}</p>
      <p className="enquiry-card__price">
        {livePaise !== null ? `${fromLabel} ${formatPaise(livePaise)}` : `₹${inr.format(card.price)}`}
        <span className="enquiry-card__unit"> {card.unit}</span>
      </p>
      {livePaise === null && card.badge && <span className="badge badge--tint">{card.badge}</span>}
      <hr className="rule" />
      <ul className="enquiry-card__features">
        {card.features.map((feature, i) => (
          <li key={i}>
            <Check size={16} strokeWidth={2} aria-hidden="true" />
            <span>{feature}</span>
          </li>
        ))}
      </ul>
      <LinkButton link={card.button} variant={card.popular ? 'primary' : 'secondary'} className="enquiry-card__cta" />
    </article>
  );
}

/** Enquiry card on Pricing. */
export default function EnquiryCard({ card }) {
  return (
    <article className="enquiry-card">
      <p className="overline">{card.label}</p>
      <h3 className="card-title">{card.title}</h3>
      <p className="small muted">{card.text}</p>
      <p className="enquiry-card__price">{card.priceText}</p>
      <p className="meta muted">{card.priceNote}</p>
      <hr className="rule" />
      <ul className="enquiry-card__terms">
        {card.terms.map((term, i) => (
          <li key={i}>{term}</li>
        ))}
      </ul>
      <LinkButton link={card.button} variant="secondary" />
    </article>
  );
}
