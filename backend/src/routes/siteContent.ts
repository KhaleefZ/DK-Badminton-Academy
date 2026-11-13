import express, { Router } from 'express';
import { and, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client.js';
import { siteContent, siteImages } from '../db/schema.js';
import { auditEntry, auditIfChanged } from '../lib/audit.js';
import { AppError, invalid } from '../lib/errors.js';
import { parseBody } from '../lib/validate.js';
import { currentAuth, requirePasswordCurrent, requirePermission, requireSession } from '../middleware/auth.js';
import { DEFAULT_CONTENT, readableContent, validContent } from '../site/content.js';
import { photoKey, photos } from '../storage.js';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
// A photo uploaded but never saved into the website is only kept this long, in case the editor is still open.
const UNSAVED_IMAGE_HOURS = 24;

const saveBody = z.object({
  content: z.record(z.string(), z.unknown(), { error: 'Nothing to save.' }),
  version: z.number({ error: 'Reload this page and try again.' }).int(),
});

/** Equal in value, whatever order the keys are in (the database reorders them). */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  return ak.length === bk.length && ak.every((k) => Object.hasOwn(b, k) && sameValue((a as any)[k], (b as any)[k]));
}

/** Only the sections a save changed, so the audit log does not hold a full copy of the website for every save. */
function changedSections(before: unknown, after: Record<string, unknown>) {
  const old = (before ?? {}) as Record<string, unknown>;
  const oldValues: Record<string, unknown> = {};
  const newValues: Record<string, unknown> = {};
  for (const key of new Set([...Object.keys(old), ...Object.keys(after)])) {
    if (sameValue(old[key], after[key])) continue;
    oldValues[key] = old[key] ?? null;
    newValues[key] = after[key] ?? null;
  }
  return { oldValues, newValues };
}

/** Photos listed in the database that this website text doesn't use. */
async function photosUnusedBy(text: string, olderThan?: Date): Promise<string[]> {
  const images = await db
    .select({ id: siteImages.id })
    .from(siteImages)
    .where(olderThan ? lt(siteImages.createdAt, olderThan) : undefined);
  return images.map(({ id }) => id).filter((id) => !text.includes(id));
}

/** Removes photos from the list and from storage. D1 takes at most 100 values per statement. */
async function removePhotos(ids: string[]): Promise<void> {
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90);
    await db.delete(siteImages).where(inArray(siteImages.id, chunk));
    await photos().delete(chunk.map(photoKey));
  }
}

/** Goes by the file's first bytes rather than what the browser says it is. SVG is refused: it can carry scripts. */
function imageType(data: Buffer): string | null {
  if (data.length > 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg';
  if (data.length > 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (data.length > 12 && data.subarray(0, 4).toString('latin1') === 'RIFF' && data.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

export function siteContentRouter(): Router {
  const router = Router();
  router.use(requireSession, requirePasswordCurrent, requirePermission('website.manage'));

  router.get('/', async (_req, res) => {
    const [row] = await db.select().from(siteContent).where(eq(siteContent.id, 1));
    res.json({ content: readableContent(row!.content), defaults: DEFAULT_CONTENT, version: row!.version, updatedAt: row!.updatedAt });
  });

  router.put('/', async (req, res) => {
    const { content: input, version } = parseBody(saveBody, req.body);
    const content = validContent(input);
    const text = JSON.stringify(content);
    const [before] = await db.select().from(siteContent).where(eq(siteContent.id, 1));
    const changed = () => new AppError(409, 'CONTENT_CHANGED', 'Someone else saved the website while you were editing. Reload to see their changes.');
    if (before!.version !== version) throw changed();
    const { oldValues, newValues } = changedSections(before!.content, content as Record<string, unknown>);
    // The version is part of the update, so of two saves made from the same starting point, only one lands.
    const [[saved]] = await db.batch([
      db
        .update(siteContent)
        .set({ content, version: version + 1, updatedAt: new Date(), updatedByStaffId: currentAuth(req).staff.id })
        .where(and(eq(siteContent.id, 1), eq(siteContent.version, version)))
        .returning(),
      auditIfChanged({ action: 'website.updated', actorStaffId: currentAuth(req).staff.id, entityType: 'site_content', entityId: '1', oldValues, newValues, req }),
    ]);
    if (!saved) throw changed();
    // A photo nothing uses any more would otherwise sit in storage forever.
    await removePhotos(await photosUnusedBy(text));
    res.json({ content: readableContent(saved.content), version: saved.version, updatedAt: saved.updatedAt });
  });

  router.post('/images', express.raw({ type: () => true, limit: MAX_IMAGE_BYTES }), async (req, res) => {
    const data = req.body;
    if (!Buffer.isBuffer(data) || !data.length) throw invalid('Choose a photo to upload.');
    const contentType = imageType(data);
    if (!contentType) throw invalid('Upload a JPG, PNG or WebP photo.');
    // Photos uploaded and then abandoned (editor closed without saving) are cleared here, since no save will.
    const [current] = await db.select({ content: siteContent.content }).from(siteContent).where(eq(siteContent.id, 1));
    await removePhotos(await photosUnusedBy(JSON.stringify(current?.content ?? {}), new Date(Date.now() - UNSAVED_IMAGE_HOURS * 3_600_000)));
    const id = crypto.randomUUID();
    // Stored first, so the list never names a photo that isn't there.
    await photos().put(photoKey(id), data, { httpMetadata: { contentType } });
    await db.batch([
      db.insert(siteImages).values({ id, contentType, byteSize: data.length }),
      auditEntry({ action: 'website.image_uploaded', actorStaffId: currentAuth(req).staff.id, entityType: 'site_image', entityId: id, newValues: { contentType, byteSize: data.length }, req }),
    ]);
    res.status(201).json({ imageId: id });
  });

  router.get('/images', async (_req, res) => {
    const images = await db.select({ id: siteImages.id, contentType: siteImages.contentType, byteSize: siteImages.byteSize, createdAt: siteImages.createdAt }).from(siteImages).orderBy(desc(siteImages.createdAt));
    const [{ total }] = (await db.select({ total: sql<number>`coalesce(sum(${siteImages.byteSize}), 0)` }).from(siteImages)) as [{ total: number }];
    res.json({ images, totalBytes: total });
  });

  return router;
}
