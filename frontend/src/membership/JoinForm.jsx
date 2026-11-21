import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, m, useReducedMotion } from 'motion/react';
import Button from '../components/Button';
import Field from '../components/Field';
import Notice from '../components/Notice';
import { validateDetails } from '../booking/validation';
import { formatPaise, todayISO } from '../booking/schedule';
import { api } from '../lib/api';
import { flagFirstInvalid } from '../lib/formFeedback';
import { EASE_OUT } from '../lib/motion';
import { fill, useContent } from '../lib/site';

// Monday first, as people read a week; the server's weekday 0 is Sunday.
const WEEK = [
  [1, 'Mon'],
  [2, 'Tue'],
  [3, 'Wed'],
  [4, 'Thu'],
  [5, 'Fri'],
  [6, 'Sat'],
  [0, 'Sun'],
];
const dayNames = (days) => WEEK.filter(([d]) => days.includes(d)).map(([, n]) => n).join(', ');

/**
 * One step of the form, opening as soon as it applies. Quick on purpose: this is a form,
 * and nobody should wait for decoration. With reduced motion it simply fades.
 */
function Step({ show, stepKey, children }) {
  const reduce = useReducedMotion();
  const hidden = reduce ? { opacity: 0 } : { opacity: 0, height: 0 };
  const shown = reduce ? { opacity: 1 } : { opacity: 1, height: 'auto' };
  return (
    <AnimatePresence initial={false}>
      {show && (
        <m.div key={stepKey} className="join-step" initial={hidden} animate={shown} exit={hidden} transition={{ duration: reduce ? 0.15 : 0.32, ease: EASE_OUT }}>
          <div className="join-step__inner stack" style={{ '--stack-gap': '24px' }}>
            {children}
          </div>
        </m.div>
      )}
    </AnimatePresence>
  );
}

/** Joining a membership online: plan, batch or fixed time, details, then a held place to pay for. */
export default function JoinForm({ options, loadError, planId, onPlanChange }) {
  const navigate = useNavigate();
  const text = useContent().membership.join;
  const [batchId, setBatchId] = useState(null);
  const [courtIds, setCourtIds] = useState([]);
  const [days, setDays] = useState([]);
  const [start, setStart] = useState('');
  const [startsOn, setStartsOn] = useState(todayISO());
  const [details, setDetails] = useState({ name: '', phone: '', email: '', notes: '' });
  const [agreed, setAgreed] = useState(false);
  const [touched, setTouched] = useState(false);
  const [trap, setTrap] = useState('');
  const [code, setCode] = useState('');
  const [applied, setApplied] = useState(null);
  const [codeError, setCodeError] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  const plan = options?.plans.find((p) => p.id === planId);
  const batches = options?.batches.filter((b) => b.planId === planId) ?? [];
  const errors = validateDetails(details, { emailRequired: true });
  const choiceMissing = !plan || (plan.kind === 'individual' ? !batchId : !courtIds.length || !days.length || !start);
  const total = plan ? plan.pricePaise * (plan.kind === 'court' ? Math.max(courtIds.length, 1) : 1) : null;
  const discount = applied ? Math.min(total ?? 0, applied.discountPaise) : 0;
  const toggle = (list, setList, value) => setList(list.includes(value) ? list.filter((x) => x !== value) : [...list, value]);
  const bind = (field) => ({ value: details[field], onChange: (e) => setDetails((d) => ({ ...d, [field]: e.target.value })), error: touched ? errors[field] : undefined });

  // A batch belongs to one plan, so a new plan starts the batch choice again.
  useEffect(() => {
    setBatchId(null);
    setError('');
  }, [planId]);

  // The price can change with the plan or courts, so a checked code is checked again then.
  useEffect(() => {
    setApplied(null);
  }, [planId, courtIds.length]);

  const applyCode = async () => {
    setCodeError('');
    setApplied(null);
    if (!code.trim() || total === null) return;
    try {
      setApplied(await api('/referrals/check', { method: 'POST', body: { code, pricePaise: total } }));
    } catch (err) {
      setCodeError(err.message);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setTouched(true);
    if (Object.keys(errors).length || !agreed || choiceMissing) {
      flagFirstInvalid(e.currentTarget, '.ack-box input:not(:checked)');
      if (choiceMissing) setError(!plan ? text.choosePlanError : plan.kind === 'individual' ? text.chooseBatchError : text.chooseTimeError);
      return;
    }
    setPending(true);
    setError('');
    try {
      const { name, phone, email } = details;
      const choice = plan.kind === 'individual' ? { batchId } : { courtIds, days, start };
      const { token } = await api('/memberships', { method: 'POST', body: { planId, startsOn, name, phone, email, website: trap, referralCode: applied ? code : null, ...choice } });
      navigate(`/membership/status/${token}`);
    } catch (err) {
      setError(err.message);
      setPending(false);
    }
  };

  return (
    <form className="stack join-form" style={{ '--stack-gap': '24px' }} onSubmit={submit} noValidate>
      {options?.testMode && <Notice>{text.testModeNotice}</Notice>}
      {loadError && (
        <div role="alert">
          <Notice>{loadError}</Notice>
        </div>
      )}
      {!options && !loadError && <p className="meta muted">{text.loading}</p>}
      {options && !options.plans.length && <Notice>{text.noPlans}</Notice>}
      {options && !options.onlineJoining && <Notice>{text.offline}</Notice>}

      {options?.plans.length > 0 && (
        <>
          <h3 className="display display--sm">{text.planHeading}</h3>
          <div className="membership-options" role="radiogroup" aria-label="Plans">
            {options.plans.map((p) => (
              <label key={p.id} className={`membership-option${p.id === planId ? ' is-selected' : ''}`}>
                <input type="radio" name="plan" checked={p.id === planId} onChange={() => onPlanChange(p.id)} />
                <span className="membership-option__body">
                  <strong>{p.name}</strong>
                  <span className="enquiry-card__price">
                    {formatPaise(p.pricePaise)}
                    <span className="enquiry-card__unit"> {p.kind === 'court' ? text.perCourtPerMonth : text.perMonth}</span>
                  </span>
                  {p.description && <span className="small muted">{p.description}</span>}
                </span>
              </label>
            ))}
          </div>
        </>
      )}

      <Step show={plan?.kind === 'individual'} stepKey={`batch-${planId}`}>
        <h3 className="display display--sm">{text.batchHeading}</h3>
        {!batches.length && <Notice>{text.noBatches}</Notice>}
        <div className="membership-options" role="radiogroup" aria-label="Batches">
          {batches.map((b) => (
            <label key={b.id} className={`membership-option${b.id === batchId ? ' is-selected' : ''}${b.seatsLeft === 0 ? ' is-full' : ''}`}>
              <input type="radio" name="batch" disabled={b.seatsLeft === 0} checked={b.id === batchId} onChange={() => setBatchId(b.id)} />
              <span className="membership-option__body">
                <strong>{b.name}</strong>
                <span className="small">
                  {dayNames(b.days)} · {b.start}–{b.end} IST · {b.courtName}
                </span>
                <span className="small muted">{b.seatsLeft === 0 ? text.full : `${b.seatsLeft} ${b.seatsLeft === 1 ? 'place' : 'places'} left`}</span>
              </span>
            </label>
          ))}
        </div>
      </Step>

      <Step show={plan?.kind === 'court'} stepKey={`time-${planId}`}>
        <h3 className="display display--sm">{text.timeHeading}</h3>
        <fieldset className="ack-box">
          <legend className="overline">{text.courtsLabel}</legend>
          {options?.courts.map((c) => (
            <label key={c.id} className="checkbox">
              <input type="checkbox" checked={courtIds.includes(c.id)} onChange={() => toggle(courtIds, setCourtIds, c.id)} />
              <span>{c.name}</span>
            </label>
          ))}
        </fieldset>
        <fieldset className="ack-box">
          <legend className="overline">{text.daysLabel}</legend>
          <div className="membership-days">
            {WEEK.map(([d, n]) => (
              <label key={d} className="checkbox">
                <input type="checkbox" checked={days.includes(d)} onChange={() => toggle(days, setDays, d)} />
                <span>{n}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="form-grid">
          <Field label={text.startLabel} type="time" required hint={fill(text.startHint, { minutes: options?.slotMinutes ?? 60 })} value={start} onChange={(e) => setStart(e.target.value)} />
        </div>
      </Step>

      <Step show={Boolean(plan)} stepKey="details">
        <h3 className="display display--sm">{text.detailsHeading}</h3>
        <div className="form-grid">
          <Field label={text.nameLabel} required autoComplete="name" {...bind('name')} />
          <Field label={text.phoneLabel} required type="tel" inputMode="tel" autoComplete="tel" {...bind('phone')} />
          <Field label={text.emailLabel} required type="email" autoComplete="email" hint={text.emailHint} {...bind('email')} />
          <Field label={text.startDateLabel} type="date" required min={options?.today} max={options?.latestStart} value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
        </div>
        <div className="visually-hidden" aria-hidden="true">
          <label>
            Website
            <input tabIndex={-1} autoComplete="off" value={trap} onChange={(e) => setTrap(e.target.value)} />
          </label>
        </div>
        {options?.referralsEnabled && (
          <div className="membership-code">
            <Field
              label={text.codeLabel}
              autoComplete="off"
              maxLength={30}
              value={code}
              error={codeError || undefined}
              onChange={(e) => {
                setCode(e.target.value);
                setApplied(null);
                setCodeError('');
              }}
            />
            <Button variant="secondary" icon={false} onClick={applyCode}>
              {text.codeButton}
            </Button>
            {applied && (
              <p className="small" role="status">
                Code applied: {applied.offer}. You save {formatPaise(discount)}.
              </p>
            )}
          </div>
        )}
        <fieldset className="ack-box">
          <legend className="visually-hidden">Agreement</legend>
          <label className="checkbox">
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
            <span>{text.consent}</span>
          </label>
        </fieldset>
        <p className="fine muted">{fill(text.policyNote, { minutes: options?.holdMinutes ?? 10 })}</p>
        {error && (
          <div role="alert">
            <Notice>{error}</Notice>
          </div>
        )}
        <div className="button-row">
          <Button type="submit" icon={false} className="join-submit" disabled={pending || !options?.onlineJoining} aria-busy={pending}>
            {pending ? text.submittingButton : `${text.submitButton} · ${formatPaise(total - discount)}`}
          </Button>
        </div>
      </Step>
    </form>
  );
}
