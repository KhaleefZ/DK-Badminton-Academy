import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ImagePlus, Plus, Trash2 } from 'lucide-react';
import PageHeader from '../layout/PageHeader';
import Button from '../components/Button';
import Field from '../components/Field';
import Notice from '../components/Notice';
import Panel from '../components/Panel';
import { useWorkspace } from '../store/WorkspaceContext';
import { api, API_URL } from '../lib/api';
import { formatInstant } from '../lib/format';
import { useResource } from '../lib/useResource';

const WEBSITE_URL = (import.meta.env.VITE_WEBSITE_URL || 'http://localhost:5173').replace(/\/$/, '');
const MAX_PHOTO_EDGE = 2000;

const TABS = [
  { key: 'brand', label: 'Business', intro: 'Your name, address, phone and email are set under Settings. You can use {venue}, {address}, {locality}, {city} and {state} in any text on the website.' },
  { key: 'theme', label: 'Colours', intro: 'Check the website after changing colours: text must stay easy to read against its background.' },
  { key: 'nav', label: 'Menu' },
  { key: 'footer', label: 'Footer', intro: '{hours} shows your saved opening hours, or the text under Business until hours are saved.' },
  { key: 'home', label: 'Home' },
  { key: 'courts', label: 'Courts' },
  { key: 'pricing', label: 'Pricing' },
  { key: 'about', label: 'About' },
  { key: 'contact', label: 'Contact' },
  { key: 'booking', label: 'Booking', intro: 'Words in {curly brackets}, such as {name} or {bookingNo}, are filled in for each customer. Keep them as written.' },
  { key: 'membership', label: 'Membership', intro: 'Plans, prices and batches are set under Plans & batches. Words in {curly brackets} are filled in for each customer.' },
  { key: 'shared', label: 'Reviews & questions' },
  { key: 'customPages', label: 'Extra pages', intro: 'Use these for terms, privacy, refund policy or anything else. Each page opens at /p/its-address. To add one to the top menu, add a link to that address under Menu.' },
  { key: 'notFound', label: 'Page not found' },
  { key: 'seo', label: 'Page titles' },
];

// Fields whose meaning isn't clear from their name.
const LABELS = {
  overline: 'Small heading above',
  to: 'Links to',
  titleHighlight: 'Words to emphasise',
  lead: 'Intro text',
  text: 'Text',
  monogram: 'Logo letters',
  wordmark: 'Name beside the logo',
  locality: 'Area',
  mapsUrl: 'Map link',
  mapsLabel: 'Map link text',
  imageDisclosure: 'Label on concept photos',
  addressFallback: 'Address, until one is saved in Settings',
  phoneFallback: 'Phone, until one is saved in Settings',
  emailFallback: 'Email, until one is saved in Settings',
  openingHoursText: 'Opening hours, until hours are saved in Settings',
  priceSource: 'Where the price comes from',
  price: 'Price typed here (₹)',
  popular: 'Mark as most popular',
  badge: 'Label under the typed price',
  primary: 'Main green (buttons)',
  accent: 'Accent lime',
  ink: 'Dark text and dark sections',
  background: 'Page background',
  surface: 'Cards',
  muted: 'Soft text',
  visible: 'Show on the website',
  showInFooter: 'Link to it in the footer',
  slug: 'Address (for example: terms)',
  body: 'Page text',
  showSampleBadge: 'Mark reviews as samples',
  siteSuffix: 'Added to every page title',
  description: 'Search engine description',
};
const HINTS = {
  titleHighlight: 'Copy these exactly from the heading. Leave empty for no emphasis.',
  to: 'A page such as /booking, or a full address starting https://.',
  body: 'Leave a blank line between paragraphs. Start a line with ## to make a heading.',
  priceSource: 'A saved price always wins, so this card can’t disagree with what bookings charge.',
};
const CHOICES = {
  priceSource: [
    { value: 'court', label: 'Lowest saved court price' },
    { value: 'membership', label: 'Lowest membership plan' },
    { value: 'manual', label: 'Typed here' },
  ],
};
const NEW_PAGE = { slug: '', title: '', overline: '', body: '', visible: true, showInFooter: true, image: { file: '', imageId: null, alt: '', concept: false } };

const humanize = (key) => {
  const words = key.replace(/([A-Z])/g, ' $1').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};
const labelFor = (key) => LABELS[key] ?? humanize(key);
const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const isImage = (v) => isObject(v) && 'imageId' in v;
const isLink = (v) => isObject(v) && 'label' in v && 'to' in v && Object.keys(v).length === 2;
const move = (list, from, to) => {
  const next = [...list];
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
};
const blank = (sample) => {
  if (typeof sample === 'string') return '';
  if (typeof sample === 'number') return 0;
  if (typeof sample === 'boolean') return true;
  if (Array.isArray(sample)) return [];
  if (isImage(sample)) return { file: '', imageId: null, alt: '', concept: false };
  if (isObject(sample)) return Object.fromEntries(Object.entries(sample).map(([k, v]) => [k, blank(v)]));
  return null;
};

/** Phone photos are far bigger than a web page needs, so they are shrunk before they leave the browser. */
async function shrinkPhoto(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_PHOTO_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('That photo couldn’t be read.'))), 'image/jpeg', 0.85));
}

function ImageEditor({ label, value, onChange, original }) {
  const input = useRef(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  const upload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setPending(true);
    setError('');
    try {
      const { imageId } = await api('/site-content/images', { method: 'POST', rawBody: await shrinkPhoto(file), contentType: 'image/jpeg' });
      onChange({ ...value, imageId, concept: false });
    } catch (err) {
      setError(err.message || 'That photo couldn’t be uploaded.');
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="site-editor__image">
      <div className="site-editor__preview">
        {value.imageId ? <img src={`${API_URL}/public/images/${value.imageId}`} alt="" /> : <span>{value.file ? 'Original website photo' : 'No photo'}</span>}
      </div>
      <div className="site-editor__image-fields">
        <p className="field__label">{label}</p>
        <div className="site-editor__row">
          <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="visually-hidden" onChange={upload} aria-label={`Upload ${label}`} tabIndex={-1} />
          <Button icon={false} size="sm" disabled={pending} aria-busy={pending} onClick={() => input.current.click()}>
            <ImagePlus size={15} strokeWidth={1.6} aria-hidden="true" /> {pending ? 'Uploading…' : 'Upload photo'}
          </Button>
          {value.imageId && (
            <Button icon={false} size="sm" variant="ghost" onClick={() => onChange({ ...value, imageId: null, concept: original?.concept ?? false })}>
              {value.file ? 'Use the original' : 'Remove'}
            </Button>
          )}
        </div>
        {error && <p className="field__error" role="alert">{error}</p>}
        <Field label="Description for screen readers" value={value.alt} onChange={(e) => onChange({ ...value, alt: e.target.value })} />
        <label className="site-editor__check">
          <input type="checkbox" checked={value.concept} onChange={(e) => onChange({ ...value, concept: e.target.checked })} />
          <span>Label as concept imagery, not the real venue</span>
        </label>
      </div>
    </div>
  );
}

function SectionsEditor({ value, onChange }) {
  return (
    <fieldset className="site-editor__group">
      <legend>Sections on this page</legend>
      <ul className="site-editor__sections">
        {value.map((section, i) => (
          <li key={section.id}>
            <label className="site-editor__check">
              <input type="checkbox" checked={section.visible} onChange={(e) => onChange(value.map((s, n) => (n === i ? { ...s, visible: e.target.checked } : s)))} />
              <span>{section.label}</span>
            </label>
            <MoveButtons index={i} count={value.length} label={section.label} onMove={(to) => onChange(move(value, i, to))} />
          </li>
        ))}
      </ul>
    </fieldset>
  );
}

function MoveButtons({ index, count, label, onMove }) {
  return (
    <span className="site-editor__moves">
      <button type="button" className="icon-button" aria-label={`Move ${label} up`} disabled={index === 0} onClick={() => onMove(index - 1)}>
        <ArrowUp size={15} strokeWidth={1.6} aria-hidden="true" />
      </button>
      <button type="button" className="icon-button" aria-label={`Move ${label} down`} disabled={index === count - 1} onClick={() => onMove(index + 1)}>
        <ArrowDown size={15} strokeWidth={1.6} aria-hidden="true" />
      </button>
    </span>
  );
}

function ListEditor({ name, value, sample, onChange }) {
  const label = labelFor(name);
  const template = sample ?? (name === 'customPages' ? NEW_PAGE : '');
  return (
    <fieldset className="site-editor__group">
      <legend>{label}</legend>
      <div className="site-editor__list">
        {value.map((item, i) => {
          const itemLabel = `${label} ${i + 1}`;
          const actions = (
            <span className="site-editor__moves">
              <MoveButtons index={i} count={value.length} label={itemLabel} onMove={(to) => onChange(move(value, i, to))} />
              <button type="button" className="icon-button" aria-label={`Remove ${itemLabel}`} onClick={() => onChange(value.filter((_, n) => n !== i))}>
                <Trash2 size={15} strokeWidth={1.6} aria-hidden="true" />
              </button>
            </span>
          );
          const update = (next) => onChange(value.map((v, n) => (n === i ? next : v)));
          if (typeof item === 'string') {
            return (
              <div key={i} className="site-editor__list-line">
                <Field label={itemLabel} value={item} onChange={(e) => update(e.target.value)} />
                {actions}
              </div>
            );
          }
          return (
            <div key={i} className="site-editor__card">
              <div className="site-editor__card-top">
                <strong>{itemLabel}</strong>
                {actions}
              </div>
              <Editor name={name} value={item} original={sample} onChange={update} bare />
            </div>
          );
        })}
      </div>
      <Button icon={false} size="sm" onClick={() => onChange([...value, name === 'customPages' ? NEW_PAGE : blank(template)])}>
        <Plus size={15} strokeWidth={1.6} aria-hidden="true" /> Add
      </Button>
    </fieldset>
  );
}

/** Draws the right control for whatever a piece of content is, so any new text gets an editor by itself. */
function Editor({ name, value, original, onChange, bare = false, colour = false }) {
  if (isImage(value)) return <ImageEditor label={labelFor(name)} value={value} original={original} onChange={onChange} />;
  if (name === 'sections') return <SectionsEditor value={value} onChange={onChange} />;
  if (Array.isArray(value)) return <ListEditor name={name} value={value} sample={original?.[0] ?? value[0]} onChange={onChange} />;
  if (isLink(value)) {
    return (
      <fieldset className="site-editor__group site-editor__group--link">
        <legend>{labelFor(name)}</legend>
        <Field label="Words on it" hint="Leave empty to hide it." value={value.label} onChange={(e) => onChange({ ...value, label: e.target.value })} />
        <Field label={labelFor('to')} hint={HINTS.to} value={value.to} onChange={(e) => onChange({ ...value, to: e.target.value })} />
      </fieldset>
    );
  }
  if (isObject(value)) {
    const children = Object.entries(value)
      .filter(([k]) => k !== 'id')
      .map(([k, v]) => <Editor key={k} name={k} value={v} original={original?.[k]} colour={colour || name === 'theme'} onChange={(next) => onChange({ ...value, [k]: next })} />);
    if (bare) return <div className="settings-form">{children}</div>;
    return (
      <fieldset className="site-editor__group">
        <legend>{labelFor(name)}</legend>
        {children}
      </fieldset>
    );
  }
  if (typeof value === 'boolean') {
    return (
      <label className="site-editor__check">
        <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
        <span>{labelFor(name)}</span>
      </label>
    );
  }
  if (typeof value === 'number') {
    return <Field label={labelFor(name)} type="number" min="0" value={value} onChange={(e) => onChange(Number(e.target.value))} />;
  }
  if (CHOICES[name]) return <Field as="select" label={labelFor(name)} hint={HINTS[name]} options={CHOICES[name]} value={value} onChange={(e) => onChange(e.target.value)} />;
  if (colour) {
    return (
      <div className="site-editor__colour">
        <Field label={labelFor(name)} value={value} onChange={(e) => onChange(e.target.value)} />
        <input type="color" aria-label={`Pick ${labelFor(name)}`} value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'} onChange={(e) => onChange(e.target.value)} />
      </div>
    );
  }
  const long = name === 'body' || value.length > 70 || value.includes('\n') || (original ?? '').length > 70;
  return <Field as={long ? 'textarea' : 'input'} rows={name === 'body' ? 16 : undefined} label={labelFor(name)} hint={HINTS[name]} value={value} onChange={(e) => onChange(e.target.value)} />;
}

export default function WebsiteContent() {
  const { data, error: loadError, reload } = useResource('/site-content');
  const { notify } = useWorkspace();
  const [content, setContent] = useState(null);
  const [saved, setSaved] = useState(null);
  const [version, setVersion] = useState(null);
  const [tab, setTab] = useState('brand');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!data) return;
    setContent(data.content);
    setSaved(JSON.stringify(data.content));
    setVersion(data.version);
    setError('');
  }, [data]);

  const dirty = content && JSON.stringify(content) !== saved;

  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (e) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  if (loadError && !data) return <Notice tone="warning">{loadError}</Notice>;
  if (!content) return <p className="meta muted">Loading the website…</p>;

  const current = TABS.find((t) => t.key === tab);

  const save = async () => {
    setPending(true);
    setError('');
    try {
      const result = await api('/site-content', { method: 'PUT', body: { content, version } });
      setContent(result.content);
      setSaved(JSON.stringify(result.content));
      setVersion(result.version);
      notify('Saved. The website has been updated.');
    } catch (err) {
      setError(err.message);
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <PageHeader title="Website" subtitle={`Everything your website says and shows. Saving updates the live website.${data?.updatedAt ? ` Last saved ${formatInstant(data.updatedAt)}.` : ''}`} />

      <div className="site-editor__bar">
        <Button variant="primary" icon={false} disabled={!dirty || pending} aria-busy={pending} onClick={save}>
          {pending ? 'Saving…' : 'Save changes'}
        </Button>
        <Button icon={false} disabled={!dirty || pending} onClick={() => setContent(JSON.parse(saved))}>
          Discard
        </Button>
        <Button href={WEBSITE_URL}>Open website</Button>
        <span className="meta muted" role="status">{dirty ? 'Unsaved changes' : 'All changes saved'}</span>
      </div>

      {error && (
        <div role="alert" className="settings-panel-alert">
          <Notice tone="warning">
            {error}{' '}
            {version !== null && error.startsWith('Someone else') && (
              <button type="button" className="link-button" onClick={reload}>
                Reload
              </button>
            )}
          </Notice>
        </div>
      )}

      <nav className="site-editor__tabs" aria-label="Website sections">
        {TABS.map((t) => (
          <button key={t.key} type="button" className={`site-editor__tab${t.key === tab ? ' is-active' : ''}`} aria-current={t.key === tab ? 'true' : undefined} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </nav>

      <Panel
        title={current.label}
        meta={
          <button type="button" className="link-button" onClick={() => setContent({ ...content, [tab]: data.defaults[tab] })}>
            Reset this tab to the original
          </button>
        }
      >
        {current.intro && <p className="small muted site-editor__intro">{current.intro}</p>}
        <div className="settings-form">
          <Editor key={tab} name={tab} value={content[tab]} original={data.defaults[tab]} onChange={(next) => setContent({ ...content, [tab]: next })} bare={tab !== 'customPages'} colour={tab === 'theme'} />
        </div>
      </Panel>
    </>
  );
}
