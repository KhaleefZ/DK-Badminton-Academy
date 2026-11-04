import { asc, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { courts, membershipPlans, messageSettings, openingHours, priceRules, settings, siteContent } from '../db/schema.js';
import { invalid } from '../lib/errors.js';
import { toTime } from '../lib/time.js';
import { UUID } from '../lib/validate.js';
import defaults from './defaults.json' with { type: 'json' };

export const DEFAULT_CONTENT = defaults as unknown as Record<string, unknown>;

type Json = Record<string, unknown>;

const SAFE_LINK = /^(\/(?!\/)|https?:\/\/|mailto:|tel:)/i;
const HEX_COLOUR = /^#[0-9a-f]{6}$/i;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_TEXT = 5000;
const MAX_PAGE_BODY = 50000;
const MAX_ITEMS = 100;

const CHOICES: Record<string, readonly string[]> = {
  priceSource: ['manual', 'court', 'membership'],
  file: ['', 'playerSmash', 'playerWide', 'playerJump', 'hallSteel', 'hallArched', 'shuttleAngle', 'shuttleClose', 'shuttleLine'],
};

/** What a new item looks like in a list that starts empty. */
const ITEM_TEMPLATES: Record<string, Json> = {
  customPages: {
    slug: '',
    title: '',
    overline: '',
    body: '',
    visible: true,
    showInFooter: true,
    image: { file: '', imageId: null, alt: '', concept: false },
  },
};

const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Shapes saved content to match the defaults: unknown fields go, missing ones are filled in.
 * Strict is for saving, where a bad value is refused. Otherwise a value that no longer fits
 * falls back to the default, so a change to the defaults can't break the live website.
 */
function shape(value: unknown, def: unknown, path: string[], strict: boolean): unknown {
  const key = path[path.length - 1] ?? '';
  const refuse = (message: string, fallback: unknown = def) => {
    if (strict) throw invalid(`${path.join(' › ')}: ${message}`);
    return fallback;
  };
  if (value === undefined) return def;

  if (def === null) {
    if (value === null || value === '') return null;
    return typeof value === 'string' && UUID.test(value) ? value : refuse('This isn’t a valid photo.');
  }
  if (typeof def === 'string') {
    if (typeof value !== 'string') return refuse('Enter text.');
    const text = value.trim();
    if (text.length > (key === 'body' ? MAX_PAGE_BODY : MAX_TEXT)) return refuse('This text is too long.');
    if (CHOICES[key] && !CHOICES[key].includes(text)) return refuse('Choose one of the options.');
    if (path.includes('theme') && !HEX_COLOUR.test(text)) return refuse('Enter a colour such as #174d3d.');
    if ((key === 'to' || key === 'mapsUrl') && text && !SAFE_LINK.test(text)) return refuse('A link must start with /, https://, mailto: or tel:.');
    return text;
  }
  if (typeof def === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100_000_000) return refuse('Enter a valid number.');
    if (key === 'rating' && (!Number.isInteger(value) || value > 5)) return refuse('A rating is a whole number from 0 to 5.');
    return value;
  }
  if (typeof def === 'boolean') return typeof value === 'boolean' ? value : refuse('Choose yes or no.');

  if (Array.isArray(def)) {
    if (!Array.isArray(value)) return refuse('Expected a list.');
    if (value.length > MAX_ITEMS) return refuse(`A list can have at most ${MAX_ITEMS} items.`);
    if (key === 'sections') return shapeSections(value, def as Json[]);
    const template = def[0] ?? ITEM_TEMPLATES[key];
    if (template === undefined) return refuse('This list can’t be changed.');
    return value.map((item, i) => shape(item, template, [...path, String(i + 1)], strict));
  }
  if (isObject(def)) {
    if (!isObject(value)) return refuse('Expected a group of fields.');
    return Object.fromEntries(Object.entries(def).map(([k, d]) => [k, shape(value[k], d, [...path, k], strict)]));
  }
  return def;
}

/** Sections can be hidden and reordered, but each page always has the same set. */
function shapeSections(value: unknown[], def: Json[]) {
  const saved = value.filter(isObject);
  const known = saved.flatMap((s) => {
    const original = def.find((d) => d.id === s.id);
    return original ? [{ ...original, visible: typeof s.visible === 'boolean' ? s.visible : original.visible } as Json] : [];
  });
  const unique = known.filter((s, i) => known.findIndex((o) => o.id === s.id) === i);
  return [...unique, ...def.filter((d) => !unique.some((s) => s.id === d.id))];
}

export const readableContent = (saved: unknown) => shape(saved, DEFAULT_CONTENT, [], false) as Json;

export function validContent(input: unknown): Json {
  const content = shape(input, DEFAULT_CONTENT, [], true) as Json;
  const pages = content.customPages as Json[];
  const slugs = new Set<string>();
  for (const page of pages) {
    const { slug, title } = page as { slug: string; title: string };
    if (!title) throw invalid('Every extra page needs a title.');
    if (!SLUG.test(slug)) throw invalid(`“${title}”: a page address can only use small letters, numbers and dashes.`);
    if (slugs.has(slug)) throw invalid(`Two extra pages use the address “${slug}”.`);
    slugs.add(slug);
  }
  return content;
}

const minutesSpan = (start: number, end: number) => ({ start: toTime(start), end: toTime(end) });

/** Everything the website needs to draw itself. Hours and prices are the ones bookings really use. */
export async function publicSite() {
  const [[row], [venue], [messaging], hours, rules, courtRows, plans] = await Promise.all([
    db.select().from(siteContent).where(eq(siteContent.id, 1)),
    db.select().from(settings).where(eq(settings.id, 1)),
    db.select().from(messageSettings).where(eq(messageSettings.id, 1)),
    db.select().from(openingHours).orderBy(asc(openingHours.weekday), asc(openingHours.openMinute)),
    db.select().from(priceRules).orderBy(asc(priceRules.startMinute)),
    db.select().from(courts),
    db.select({ pricePaise: membershipPlans.pricePaise }).from(membershipPlans).where(eq(membershipPlans.active, true)),
  ]);
  const courtName = new Map(courtRows.map((c) => [c.id, c.name]));
  return {
    content: readableContent(row?.content),
    venue: { name: venue!.venueName, address: venue!.address, phone: venue!.phone, email: venue!.email, whatsappNumber: messaging!.whatsappNumber },
    live: {
      hours: hours.map((h) => ({ weekday: h.weekday, ...minutesSpan(h.openMinute, h.closeMinute) })),
      rates: rules.map((r) => ({ days: r.days, ...minutesSpan(r.startMinute, r.endMinute), ratePaise: r.ratePaise, court: r.courtId ? (courtName.get(r.courtId) ?? null) : null })),
      membershipFromPaise: plans.length ? Math.min(...plans.map((p) => p.pricePaise)) : null,
    },
  };
}
