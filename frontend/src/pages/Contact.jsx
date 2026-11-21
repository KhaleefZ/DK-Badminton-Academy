import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { MapPin } from 'lucide-react';
import { m, useReducedMotion } from 'motion/react';
import { DrawPath, TypewriterText, VIEWPORT } from '../motion';
import Button from '../components/Button';
import Field from '../components/Field';
import Notice from '../components/Notice';
import { validateEnquiry } from '../booking/validation';
import { api } from '../lib/api';
import { whatsappLink } from '../lib/useVenue';
import { fill, useSite } from '../lib/site';
import { flagFirstInvalid } from '../lib/formFeedback';

const emptyForm = (topic) => ({ name: '', email: '', phone: '', topic, preferred: '', message: '', consent: false, website: '' });

export default function Contact() {
  const [params] = useSearchParams();
  const { content, venue: saved, hours } = useSite();
  const { brand, contact: text } = content;
  const requested = params.get('topic');
  const initialTopic = text.topics.some((t) => t.value === requested) ? requested : (text.topics[0]?.value ?? '');

  const [form, setForm] = useState(() => emptyForm(initialTopic));
  const [touched, setTouched] = useState({});
  const [sentAs, setSentAs] = useState(null);
  const [pending, setPending] = useState(false);
  const [sendError, setSendError] = useState('');
  const reduce = useReducedMotion();
  const chat = whatsappLink(saved.whatsappNumber, text.whatsappMessage);

  // Follow ?topic= when another page links here while Contact is already open.
  useEffect(() => {
    setForm((f) => ({ ...f, topic: initialTopic }));
  }, [initialTopic]);

  const errors = validateEnquiry(form);
  const show = (field) => (touched[field] ? errors[field] : undefined);
  const bind = (field) => ({
    value: form[field],
    onChange: (e) => {
      setSentAs(null);
      setForm((f) => ({ ...f, [field]: e.target.value }));
    },
    onBlur: () => setTouched((t) => ({ ...t, [field]: true })),
  });

  const submit = async (e) => {
    e.preventDefault();
    setTouched({ name: true, email: true, phone: true, message: true, consent: true });
    if (Object.keys(errors).length) {
      flagFirstInvalid(e.currentTarget);
      return;
    }
    if (pending) return;
    setPending(true);
    setSendError('');
    try {
      const { enquiryNo } = await api('/enquiries', { method: 'POST', body: form });
      setSentAs(enquiryNo);
      setForm(emptyForm(form.topic));
      setTouched({});
    } catch (err) {
      setSendError(err.message);
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="section" aria-labelledby="contact-heading">
      <div className="container stack" style={{ '--stack-gap': '24px' }}>
        <p className="overline">{text.overline}</p>
        {/* Signature: the page says its greeting — "hello." is typed out */}
        <h1 id="contact-heading" className="display display--page">
          {text.title} {text.typedWord && <TypewriterText text={text.typedWord} trigger="mount" speed={70} delay={400} />}
        </h1>
        <p className="lead muted">{text.lead}</p>

        <div className="contact-layout full-width">
          <div className="stack" style={{ '--stack-gap': '24px' }}>
            <h2 className="display display--sm">{text.findUsTitle}</h2>
            <p className="body">
              {/* A saved address already names the city, so it stands alone. */}
              {saved.address || `${text.cityLine} ${brand.addressFallback}`}
            </p>
            <hr className="rule" />
            <dl className="contact-facts">
              <div>
                <dt>{text.phoneLabel}</dt> <dd>{saved.phone || saved.whatsappNumber || brand.phoneFallback}</dd>
              </div>
              <div>
                <dt>{text.emailLabel}</dt> <dd>{saved.email || brand.emailFallback}</dd>
              </div>
              <div>
                <dt>{text.hoursLabel}</dt> <dd>{hours}</dd>
              </div>
            </dl>
            {chat && (
              <div>
                <Button href={chat}>{text.whatsappButton}</Button>
              </div>
            )}
            <div className="directions-card on-dark stack" style={{ '--stack-gap': '16px' }}>
              {/* Supporting: the pin drops in and a route line draws away from it */}
              <div className="directions-card__pin" aria-hidden="true">
                <m.span
                  className="directions-card__icon"
                  initial={{ opacity: 0, transform: reduce ? 'none' : 'translateY(-18px)' }}
                  whileInView={{ opacity: 1, transform: 'translateY(0px)' }}
                  viewport={VIEWPORT}
                  transition={{ type: 'spring', duration: 0.5, bounce: 0.2 }}
                >
                  <MapPin size={26} strokeWidth={1.6} />
                </m.span>
                <DrawPath
                  className="directions-card__route"
                  viewBox="0 0 160 30"
                  paths={['M4 24 C 40 24, 50 6, 90 8 S 140 22, 156 12']}
                  stroke="var(--accent-rally)"
                  strokeWidth={2}
                  duration={1}
                  delay={0.35}
                />
              </div>
              <h3 className="display display--sm">{text.directionsTitle}</h3>
              <p className="meta">{text.directionsText}</p>
              <Button href={brand.mapsUrl} variant="lime">
                {text.directionsButton}
              </Button>
            </div>
          </div>

          <form className="enquiry-form stack" onSubmit={submit} noValidate aria-labelledby="enquiry-heading">
            <p className="overline">{text.formOverline}</p>
            <h2 id="enquiry-heading" className="display display--sm">
              {text.formTitle}
            </h2>
            <div className="form-grid full-width">
              <Field label={text.nameLabel} required placeholder={text.namePlaceholder} autoComplete="name" error={show('name')} {...bind('name')} />
              <Field label={text.emailFieldLabel} required type="email" placeholder={text.emailPlaceholder} autoComplete="email" error={show('email')} {...bind('email')} />
              <Field
                label={text.phoneFieldLabel}
                type="tel"
                inputMode="tel"
                placeholder={text.phonePlaceholder}
                autoComplete="tel"
                error={show('phone')}
                {...bind('phone')}
              />
              <Field as="select" label={text.topicLabel} options={text.topics} {...bind('topic')} />
              <Field label={text.preferredLabel} placeholder={text.preferredPlaceholder} className="form-grid__full" {...bind('preferred')} />
              <Field
                as="textarea"
                label={text.messageLabel}
                required
                placeholder={text.messagePlaceholder}
                className="form-grid__full"
                error={show('message')}
                {...bind('message')}
              />
            </div>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={form.consent}
                onChange={(e) => {
                  setSentAs(null);
                  setForm((f) => ({ ...f, consent: e.target.checked }));
                }}
                aria-invalid={show('consent') ? true : undefined}
              />
              <span>{text.consent}</span>
            </label>
            {show('consent') && <p className="field__error">{errors.consent}</p>}
            {/* Hidden from people; a bot that fills in every box gets refused. */}
            <div className="visually-hidden" aria-hidden="true">
              <label>
                Website
                <input tabIndex={-1} autoComplete="off" value={form.website} onChange={(e) => setForm((f) => ({ ...f, website: e.target.value }))} />
              </label>
            </div>
            <Button type="submit" disabled={pending} aria-busy={pending}>
              {pending ? text.sendingButton : text.sendButton}
            </Button>
            {/* State change: the notice cross-fades when the enquiry is sent */}
            {sentAs && (
              <m.div className="full-width" role="status" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}>
                <Notice className="full-width">{fill(text.sentMessage, { enquiryNo: sentAs })}</Notice>
              </m.div>
            )}
            {sendError && (
              <div className="full-width" role="alert">
                <Notice className="full-width">{sendError}</Notice>
              </div>
            )}
          </form>
        </div>
      </div>
    </section>
  );
}
