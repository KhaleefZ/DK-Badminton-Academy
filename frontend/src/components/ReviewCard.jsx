import { Quote, Star } from 'lucide-react';

/** Testimonial card. `badge` is the label shown while reviews are still placeholders. */
export default function ReviewCard({ review, badge }) {
  return (
    <figure className="review-card">
      <div className="review-card__top">
        <span className="review-card__stars" role="img" aria-label={`Rated ${review.rating} out of 5`}>
          {Array.from({ length: 5 }, (_, i) => (
            <Star key={i} size={16} strokeWidth={1.6} aria-hidden="true" className={i < review.rating ? 'is-filled' : undefined} />
          ))}
        </span>
        {badge && <span className="badge badge--tint">{badge}</span>}
      </div>
      <Quote size={28} strokeWidth={1.4} aria-hidden="true" className="review-card__mark" />
      <blockquote className="review-card__quote">{review.quote}</blockquote>
      <figcaption className="review-card__author">
        <span className="review-card__avatar" aria-hidden="true">
          {review.name
            .split(' ')
            .map((part) => part[0])
            .join('')}
        </span>
        <span>
          <strong>{review.name}</strong>
          <span className="review-card__context">{review.context}</span>
        </span>
      </figcaption>
    </figure>
  );
}
