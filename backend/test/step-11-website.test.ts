import { readFileSync } from 'node:fs';
import { eq, inArray } from 'drizzle-orm';
import { db } from '../src/db/client.js';
import { auditLog, siteImages } from '../src/db/schema.js';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CONTENT } from '../src/site/content.js';
import { addStaff, ORIGIN, signIn, testApp } from './helpers.js';

const WEBSITE = 'http://localhost:5173';
const { app } = testApp();
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);

let owner: string;
let manager: string;
let desk: string;

const admin = (method: 'get' | 'put' | 'post', path: string, cookie = owner) => request(app)[method](path).set('Origin', ORIGIN).set('Cookie', cookie);
const site = () => request(app).get('/public/site').set('Origin', WEBSITE).expect(200);
const load = async () => (await admin('get', '/site-content').expect(200)).body;
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const save = async (edit: (c: any) => void) => {
  const { content, version } = await load();
  const next = copy(content);
  edit(next);
  return admin('put', '/site-content').send({ content: next, version });
};
const upload = () => admin('post', '/site-content/images').set('Content-Type', 'image/png').send(PNG).expect(201);

beforeEach(async () => {
  owner = await signIn(app, (await addStaff({ role: 'owner' })).email);
  manager = await signIn(app, (await addStaff({ role: 'manager' })).email);
  desk = await signIn(app, (await addStaff({ role: 'front_desk' })).email);
});

describe('website content', () => {
  it('keeps the website’s fallback copy identical to the server’s defaults', () => {
    const fallback = JSON.parse(readFileSync(new URL('../../frontend/src/data/siteDefaults.json', import.meta.url), 'utf8'));
    expect(fallback).toEqual(DEFAULT_CONTENT);
  });

  it('serves the defaults until something is saved, without a login', async () => {
    expect((await site()).body.content).toEqual(DEFAULT_CONTENT);
  });

  it('lets an Owner or Manager edit, and shows the change on the website', async () => {
    expect((await save((c) => { c.home.hero.title = 'Play tonight.'; })).status).toBe(200);
    expect((await site()).body.content.home.hero.title).toBe('Play tonight.');
    const { content, version } = await load();
    await admin('put', '/site-content', manager).send({ content, version }).expect(200);
  });

  it('refuses Front Desk and people who are not signed in', async () => {
    await admin('get', '/site-content', desk).expect(403);
    await admin('put', '/site-content', desk).send({ content: {}, version: 1 }).expect(403);
    await admin('post', '/site-content/images', desk).set('Content-Type', 'image/png').send(PNG).expect(403);
    await request(app).get('/site-content').set('Origin', ORIGIN).expect(401);
    await request(app).put('/site-content').set('Origin', WEBSITE).set('Cookie', owner).send({}).expect(403);
  });

  it('refuses links that could run scripts, and bad values', async () => {
    expect((await save((c) => { c.nav.links[0].to = 'javascript:alert(1)'; })).status).toBe(400);
    expect((await save((c) => { c.home.hero.primaryButton.to = '//evil.example'; })).status).toBe(400);
    expect((await save((c) => { c.brand.mapsUrl = 'data:text/html,x'; })).status).toBe(400);
    expect((await save((c) => { c.theme.primary = 'red;background:url(x)'; })).status).toBe(400);
    expect((await save((c) => { c.shared.reviews.items[0].rating = 6; })).status).toBe(400);
    expect((await save((c) => { c.home.plans.cards[0].priceSource = 'nope'; })).status).toBe(400);
    expect((await save((c) => { c.home.hero.image.imageId = 'not-an-id'; })).status).toBe(400);
  });

  it('drops unknown fields', async () => {
    await save((c) => { c.hack = 'x'; c.home.hero.extra = 'x'; });
    const { content } = (await site()).body;
    expect(content.hack).toBeUndefined();
    expect(content.home.hero.extra).toBeUndefined();
  });

  it('can hide and reorder sections but not add or lose them', async () => {
    await save((c) => {
      c.home.sections.reverse();
      c.home.sections[0].visible = false;
      c.home.sections.push({ id: 'fake', label: 'x', visible: true });
      c.home.sections = c.home.sections.filter((s: any) => s.id !== 'faq');
    });
    const { sections } = (await site()).body.content.home;
    expect(sections[0]).toMatchObject({ id: 'contactBand', visible: false });
    expect(sections.map((s: any) => s.id).sort()).toEqual((DEFAULT_CONTENT as any).home.sections.map((s: any) => s.id).sort());
  });

  it('adds extra pages and checks their addresses', async () => {
    const page = { slug: 'terms', title: 'Terms', overline: '', body: 'Text', visible: true, showInFooter: true, image: { file: '', imageId: null, alt: '', concept: false } };
    expect((await save((c) => { c.customPages = [page]; })).status).toBe(200);
    expect((await site()).body.content.customPages[0].slug).toBe('terms');
    expect((await save((c) => { c.customPages = [page, page]; })).status).toBe(400);
    expect((await save((c) => { c.customPages = [{ ...page, slug: '../x' }]; })).status).toBe(400);
    expect((await save((c) => { c.customPages = [{ ...page, title: '' }]; })).status).toBe(400);
  });

  it('won’t overwrite someone else’s newer save', async () => {
    const { content, version } = await load();
    await admin('put', '/site-content').send({ content, version }).expect(200);
    const res = await admin('put', '/site-content', manager).send({ content, version }).expect(409);
    expect(res.body.error.code).toBe('CONTENT_CHANGED');
  });

  it('saves more text than an ordinary request allows', async () => {
    const res = await save((c) => { for (const r of c.shared.faqs) r.answer = 'x'.repeat(4000); c.shared.faqs = [...c.shared.faqs, ...c.shared.faqs, ...c.shared.faqs]; });
    expect(res.status).toBe(200);
  });
});

describe('photos', () => {
  it('stores a photo and serves it to the website', async () => {
    const { imageId } = (await upload()).body;
    const res = await request(app).get(`/public/images/${imageId}`).expect(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(res.headers['cache-control']).toContain('immutable');
  });

  it('refuses anything that is not a real photo, including SVG', async () => {
    await admin('post', '/site-content/images').set('Content-Type', 'image/png').send(Buffer.from('<svg onload="alert(1)"></svg>')).expect(400);
    await admin('post', '/site-content/images').set('Content-Type', 'image/png').send(Buffer.alloc(0)).expect(400);
    await admin('post', '/site-content/images').set('Content-Type', 'image/png').send(Buffer.concat([PNG, Buffer.alloc(6 * 1024 * 1024)])).expect(413);
  });

  it('removes a photo once nothing uses it', async () => {
    const { imageId } = (await upload()).body;
    await save((c) => { c.home.hero.image.imageId = imageId; });
    await request(app).get(`/public/images/${imageId}`).expect(200);
    await save((c) => { c.home.hero.image.imageId = null; });
    await request(app).get(`/public/images/${imageId}`).expect(404);
  });

  it('clears photos that were uploaded a day ago but never saved, and keeps the rest', async () => {
    const used = (await upload()).body.imageId;
    await save((c) => { c.home.hero.image.imageId = used; });
    const abandoned = (await upload()).body.imageId;
    const fresh = (await upload()).body.imageId;
    await db.update(siteImages).set({ createdAt: new Date(Date.now() - 2 * 86_400_000) }).where(inArray(siteImages.id, [used, abandoned]));
    await upload();
    await request(app).get(`/public/images/${used}`).expect(200);
    await request(app).get(`/public/images/${fresh}`).expect(200);
    await request(app).get(`/public/images/${abandoned}`).expect(404);
  });

  it('records only the changed sections in the audit log', async () => {
    await save(() => {});
    await save((c) => { c.home.hero.title = 'Play tonight.'; });
    const [, entry] = await db.select().from(auditLog).where(eq(auditLog.action, 'website.updated')).orderBy(auditLog.id);
    expect(Object.keys(entry!.newValues as object)).toEqual(['home']);
    expect((entry!.newValues as any).home.hero.title).toBe('Play tonight.');
  });
});

describe('live data', () => {
  it('reports real hours, rates and the lowest active plan', async () => {
    await admin('put', '/settings/hours').send({ hours: [{ weekday: 1, opens: '06:00', closes: '22:00' }] }).expect(200);
    await admin('put', '/settings/prices').send({ rules: [{ courtId: null, days: [1], start: '06:00', end: '22:00', ratePaise: 45000 }] }).expect(200);
    await admin('post', '/memberships/plans').send({ name: 'A', kind: 'individual', pricePaise: 200000 }).expect(201);
    await admin('post', '/memberships/plans').send({ name: 'B', kind: 'individual', pricePaise: 150000 }).expect(201);
    const { live } = (await site()).body;
    expect(live.hours).toEqual([{ weekday: 1, start: '06:00', end: '22:00' }]);
    expect(live.rates[0]).toMatchObject({ days: [1], start: '06:00', end: '22:00', ratePaise: 45000, court: null });
    expect(live.membershipFromPaise).toBe(150000);
  });
});
