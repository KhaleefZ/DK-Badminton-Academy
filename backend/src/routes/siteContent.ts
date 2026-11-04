import express, { Router } from 'express';
import { desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client.js';
import { siteContent, siteImages } from '../db/schema.js';
import { writeAudit } from '../lib/audit.js';
import { AppError, invalid } from '../lib/errors.js';
import { parseBody } from '../lib/validate.js';
import { currentAuth, requirePasswordCurrent, requirePermission, requireSession } from '../middleware/auth.js';
import { DEFAULT_CONTENT, readableContent, validContent } from '../site/content.js';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const saveBody = z.object({
  content: z.record(z.string(), z.unknown(), { error: 'Nothing to save.' }),
  version: z.number({ error: 'Reload this page and try again.' }).int(),
});

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
    const saved = await db.transaction(async (tx) => {
      const [before] = await tx.select().from(siteContent).where(eq(siteContent.id, 1)).for('update');
      if (before!.version !== version) throw new AppError(409, 'CONTENT_CHANGED', 'Someone else saved the website while you were editing. Reload to see their changes.');
      const [row] = await tx
        .update(siteContent)
        .set({ content, version: version + 1, updatedAt: new Date(), updatedByStaffId: currentAuth(req).staff.id })
        .where(eq(siteContent.id, 1))
        .returning();
      // A photo nothing uses any more would otherwise sit in the database forever.
      const images = await tx.select({ id: siteImages.id }).from(siteImages);
      for (const { id } of images) if (!text.includes(id)) await tx.delete(siteImages).where(eq(siteImages.id, id));
      await writeAudit({ action: 'website.updated', actorStaffId: currentAuth(req).staff.id, entityType: 'site_content', entityId: '1', oldValues: before!.content, newValues: content, req }, tx);
      return row!;
    });
    res.json({ content: readableContent(saved.content), version: saved.version, updatedAt: saved.updatedAt });
  });

  router.post('/images', express.raw({ type: () => true, limit: MAX_IMAGE_BYTES }), async (req, res) => {
    const data = req.body;
    if (!Buffer.isBuffer(data) || !data.length) throw invalid('Choose a photo to upload.');
    const contentType = imageType(data);
    if (!contentType) throw invalid('Upload a JPG, PNG or WebP photo.');
    const [image] = await db.insert(siteImages).values({ data, contentType, byteSize: data.length }).returning({ id: siteImages.id });
    await writeAudit({ action: 'website.image_uploaded', actorStaffId: currentAuth(req).staff.id, entityType: 'site_image', entityId: image!.id, newValues: { contentType, byteSize: data.length }, req });
    res.status(201).json({ imageId: image!.id });
  });

  router.get('/images', async (_req, res) => {
    const images = await db.select({ id: siteImages.id, contentType: siteImages.contentType, byteSize: siteImages.byteSize, createdAt: siteImages.createdAt }).from(siteImages).orderBy(desc(siteImages.createdAt));
    const [{ total }] = (await db.select({ total: sql<number>`coalesce(sum(${siteImages.byteSize}), 0)::int` }).from(siteImages)) as [{ total: number }];
    res.json({ images, totalBytes: total });
  });

  return router;
}
