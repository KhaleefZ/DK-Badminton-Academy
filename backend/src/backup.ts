// Weekly copy of the whole database into the BACKUPS R2 bucket. Cloudflare's own point-in-time restore
// only reaches back 7 days on the free plan; these copies are kept for half a year.
//
// It uses D1's export API (the same one `wrangler d1 export` uses), which needs an API token, so it
// runs only once BACKUP_ACCOUNT_ID, BACKUP_DATABASE_ID and the BACKUP_API_TOKEN secret are set.
// Restoring a copy is described in docs/hosting-on-cloudflare.md.
import type { R2Bucket } from '@cloudflare/workers-types';

/** Sundays at 03:00 IST (21:30 UTC on Saturday), when the academy is closed and nobody is booking. */
export const BACKUP_CRON = '30 21 * * 6';

/** About six months of weekly copies. */
export const BACKUPS_KEPT = 26;

const PREFIX = 'database/';
const POLL_EVERY_MS = 3_000;
const POLL_LIMIT = 60; // 3 minutes: a small database exports in seconds.

export type BackupEnv = {
  BACKUPS?: R2Bucket;
  BACKUP_ACCOUNT_ID?: string;
  BACKUP_DATABASE_ID?: string;
  BACKUP_API_TOKEN?: string;
};

type ExportResult = { at_bookmark?: string; status?: string; signed_url?: string; filename?: string; error?: string };
type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The file name for a backup taken at `at`, sorted oldest first by name. */
export const backupKey = (at: Date) => `${PREFIX}dk-badminton-${at.toISOString().slice(0, 10)}.sql`;

/**
 * Exports the database and stores the SQL file in R2, then deletes copies beyond the newest
 * BACKUPS_KEPT. Returns the stored key, or null when backups aren't set up yet.
 */
export async function backUpDatabase(env: BackupEnv, at = new Date(), { fetcher = fetch as Fetch, pause = wait } = {}): Promise<string | null> {
  const { BACKUPS: bucket, BACKUP_ACCOUNT_ID: account, BACKUP_DATABASE_ID: database, BACKUP_API_TOKEN: token } = env;
  if (!bucket || !account || !database || !token) {
    console.warn('Backup skipped: set BACKUP_ACCOUNT_ID, BACKUP_DATABASE_ID and the BACKUP_API_TOKEN secret, and bind the BACKUPS bucket.');
    return null;
  }

  const url = `https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${database}/export`;
  const ask = async (body: object): Promise<ExportResult> => {
    const response = await fetcher(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
    const json = (await response.json().catch(() => null)) as { success?: boolean; result?: ExportResult; errors?: { message: string }[] } | null;
    if (!response.ok || !json?.success) throw new Error(`Export request failed (HTTP ${response.status}): ${json?.errors?.map((e) => e.message).join('; ') || 'no details'}`);
    return json.result ?? {};
  };

  // Start the export, then ask again with its bookmark until the file is ready to download.
  let result = await ask({ output_format: 'polling' });
  const bookmark = result.at_bookmark;
  if (!bookmark) throw new Error('The export did not start (no bookmark returned).');
  for (let i = 0; !result.signed_url; i += 1) {
    if (result.status === 'error' || result.error) throw new Error(`The export failed: ${result.error ?? 'unknown error'}`);
    if (i >= POLL_LIMIT) throw new Error('The export took too long; it will be tried again next week.');
    await pause(POLL_EVERY_MS);
    result = await ask({ output_format: 'polling', current_bookmark: bookmark });
  }

  const file = await fetcher(result.signed_url!);
  if (!file.ok || !file.body) throw new Error(`Downloading the export failed (HTTP ${file.status}).`);
  const key = backupKey(at);
  // R2 needs the length up front; the download states it, otherwise the file is read into memory first.
  const body = file.headers.get('content-length') ? file.body : await file.arrayBuffer();
  await bucket.put(key, body as Parameters<R2Bucket['put']>[1], {
    httpMetadata: { contentType: 'application/sql' },
    customMetadata: { takenAt: at.toISOString(), source: result.filename ?? '' },
  });

  // Keys sort by date, so everything before the newest BACKUPS_KEPT is old.
  const listed = await bucket.list({ prefix: PREFIX });
  const keys = listed.objects.map((o) => o.key).sort();
  const old = keys.slice(0, Math.max(keys.length - BACKUPS_KEPT, 0));
  if (old.length) await bucket.delete(old);

  console.log(`Backup stored: ${key} (${keys.length - old.length} kept)`);
  return key;
}
