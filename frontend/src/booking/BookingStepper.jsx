import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import { m, useReducedMotion } from 'motion/react';
import { EASE_IN_OUT } from '../motion';
import { useContent } from '../lib/site';

/**
 * Step indicator. Earlier steps are links so customers can go back.
 * Motion (state indication): the connector into the current step draws in on arrival;
 * connectors already passed are shown filled.
 */
export default function BookingStepper({ current }) {
  const reduce = useReducedMotion();
  const { steps } = useContent().booking;
  const STEPS = [
    { label: steps.choose, to: '/booking' },
    { label: steps.details, to: '/booking/details' },
    { label: steps.payment },
    { label: steps.confirmed },
  ];

  return (
    <ol className="stepper" aria-label="Booking progress">
      {STEPS.map((step, i) => {
        const number = i + 1;
        const state = number === current ? 'current' : number < current ? 'done' : 'upcoming';
        const body = (
          <>
            <span className="stepper__number">{number}</span>
            <span>{step.label}</span>
          </>
        );
        const connectorFilled = number < current;
        const justArrived = number === current - 1;
        return (
          <Fragment key={step.label}>
            <li className={`stepper__step stepper__step--${state}`} aria-current={state === 'current' ? 'step' : undefined}>
              {state === 'done' && step.to ? <Link to={step.to}>{body}</Link> : body}
            </li>
            {number < STEPS.length && (
              <li className="stepper__connector" aria-hidden="true">
                {connectorFilled && (
                  <m.span
                    className="stepper__connector-fill"
                    initial={{ transform: justArrived && !reduce ? 'scaleX(0)' : 'scaleX(1)' }}
                    animate={{ transform: 'scaleX(1)' }}
                    transition={{ duration: 0.3, ease: EASE_IN_OUT }}
                  />
                )}
              </li>
            )}
          </Fragment>
        );
      })}
    </ol>
  );
}
