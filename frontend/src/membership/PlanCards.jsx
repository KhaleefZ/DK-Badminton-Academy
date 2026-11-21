import { Check } from 'lucide-react';
import Button from '../components/Button';
import Notice from '../components/Notice';
import { formatPaise } from '../booking/schedule';
import { fill, useContent } from '../lib/site';
import { Stagger, StaggerItem } from '../motion';

/**
 * The membership plans the academy sells, straight from the admin panel, so a price shown here
 * is always the one charged. Picking a plan opens the join form below with that plan chosen.
 */
export default function PlanCards({ options, loadError, selectedId, onChoose }) {
  const { plans: text } = useContent().pricing;
  const join = useContent().membership.join;

  if (loadError) return <Notice>{loadError}</Notice>;
  if (!options) return <p className="meta muted">{join.loading}</p>;
  if (!options.plans.length) return <Notice>{join.noPlans}</Notice>;

  return (
    <Stagger className="grid-3 full-width plan-cards" stagger={0.08}>
      {options.plans.map((plan) => {
        const selected = plan.id === selectedId;
        const seats = plan.kind === 'individual' ? options.batches.filter((b) => b.planId === plan.id).reduce((sum, b) => sum + b.seatsLeft, 0) : null;
        return (
          <StaggerItem key={plan.id} className="grid-3__item">
            <article className={`enquiry-card plan-card${selected ? ' is-selected' : ''}`} aria-current={selected || undefined}>
              <div className="enquiry-card__top">
                <p className="overline">{plan.kind === 'court' ? 'Court membership' : 'Individual'}</p>
                {selected && <span className="badge badge--lime">{text.selectedBadge}</span>}
              </div>
              <h3 className="card-title">{plan.name}</h3>
              {plan.description && <p className="small muted">{plan.description}</p>}
              <p className="enquiry-card__price">
                {formatPaise(plan.pricePaise)}
                <span className="enquiry-card__unit"> {plan.kind === 'court' ? join.perCourtPerMonth : join.perMonth}</span>
              </p>
              {plan.kind === 'court' && <p className="small muted">{fill(join.playersNote, { players: plan.playersPerCourt })}</p>}
              {seats !== null && <p className="small muted">{seats === 0 ? join.full : `${seats} ${seats === 1 ? 'place' : 'places'} left`}</p>}
              {plan.features.length > 0 && (
                <>
                  <hr className="rule" />
                  <ul className="enquiry-card__features">
                    {plan.features.map((feature) => (
                      <li key={feature}>
                        <Check size={16} strokeWidth={2} aria-hidden="true" />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <Button variant={selected ? 'primary' : 'secondary'} className="enquiry-card__cta" disabled={seats === 0} onClick={() => onChoose(plan.id)}>
                {text.joinButton}
              </Button>
            </article>
          </StaggerItem>
        );
      })}
    </Stagger>
  );
}
