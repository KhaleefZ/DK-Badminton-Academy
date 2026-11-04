import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { api, API_URL } from './api';
import { bundledImages } from '../data/site';
import defaults from '../data/siteDefaults.json';

// Shown if the API can't be reached, so the website still reads properly when it is down.
const FALLBACK = { content: defaults, venue: { name: 'DK Badminton Academy' }, live: { hours: [], rates: [], membershipFromPaise: null } };
const LOAD_TIMEOUT_MS = 3000;

const THEME_VARS = { primary: '--action-primary', accent: '--accent-rally', ink: '--text-primary', background: '--background-marketing', surface: '--surface-default', muted: '--text-secondary' };
const WEEK = [1, 2, 3, 4, 5, 6, 0];
const DAY_NAMES = { 0: 'Sun', 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat' };

/** Puts values into text such as "See you, {name}." A name with no value is left as written. */
export const fill = (text, values) => String(text ?? '').replace(/\{(\w+)\}/g, (whole, key) => (values[key] ?? whole));

const fillDeep = (value, values) => {
  if (typeof value === 'string') return fill(value, values);
  if (Array.isArray(value)) return value.map((v) => fillDeep(v, values));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fillDeep(v, values)]));
  return value;
};

const clockTime = (time) => {
  const [h, m] = time.split(':').map(Number);
  const hour = h % 12 || 12;
  return `${hour}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h % 24 < 12 ? 'am' : 'pm'}`;
};
export const timeSpan = (start, end) => `${clockTime(start)}–${clockTime(end)}`;

/** Runs of neighbouring days: [1,2,3,6] reads "Mon–Wed, Sat". */
export function dayRange(days) {
  const runs = [];
  for (const day of WEEK.filter((d) => days.includes(d))) {
    const last = runs[runs.length - 1];
    if (last && WEEK.indexOf(day) === WEEK.indexOf(last[last.length - 1]) + 1) last.push(day);
    else runs.push([day]);
  }
  return runs.map((run) => (run.length > 1 ? `${DAY_NAMES[run[0]]}–${DAY_NAMES[run[run.length - 1]]}` : DAY_NAMES[run[0]])).join(', ');
}

function hoursSummary(hours) {
  const byDay = WEEK.map((day) => ({ day, text: hours.filter((h) => h.weekday === day).map((h) => timeSpan(h.start, h.end)).join(', ') })).filter((d) => d.text);
  const groups = [];
  for (const { day, text } of byDay) {
    const same = groups.find((g) => g.text === text);
    if (same) same.days.push(day);
    else groups.push({ text, days: [day] });
  }
  return groups.map((g) => `${dayRange(g.days)} ${g.text}`).join(' · ');
}

export const imageSrc = (image) => (image?.imageId ? `${API_URL}/public/images/${image.imageId}` : (bundledImages[image?.file] ?? null));

const SiteContext = createContext(null);

export function SiteProvider({ children }) {
  const [site, setSite] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LOAD_TIMEOUT_MS);
    api('/site', { signal: controller.signal })
      .then(setSite)
      .catch(() => setSite(FALLBACK))
      .finally(() => clearTimeout(timer));
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, []);

  const value = useMemo(() => {
    if (!site) return null;
    const { brand } = site.content;
    const hours = hoursSummary(site.live.hours) || brand.openingHoursText;
    const address = site.venue.address || brand.addressFallback;
    const content = fillDeep(site.content, { venue: site.venue.name, locality: brand.locality, city: brand.city, state: brand.state, address, hours });
    return { content, venue: site.venue, live: site.live, hours };
  }, [site]);

  useLayoutEffect(() => {
    if (!value) return;
    for (const [key, cssVar] of Object.entries(THEME_VARS)) document.documentElement.style.setProperty(cssVar, value.content.theme[key]);
  }, [value]);

  // Waiting a moment beats showing the old text and swapping it as the page animates in.
  if (!value) return null;
  return <SiteContext.Provider value={value}>{children}</SiteContext.Provider>;
}

export const useSite = () => useContext(SiteContext);
export const useContent = () => useContext(SiteContext).content;
