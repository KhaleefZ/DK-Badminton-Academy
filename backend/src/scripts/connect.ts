// Opens the database for a command-line script. By default that's the local D1 that `wrangler dev`
// uses; with --remote it's the real one on Cloudflare (run `npx wrangler login` first).
import { mkdirSync, writeFileSync } from 'node:fs';
import type { D1Database } from '@cloudflare/workers-types';
import { getPlatformProxy, unstable_readConfig } from 'wrangler';
import { useDatabase } from '../db/client.js';

export async function connect() {
  const remote = process.argv.includes('--remote');
  let configPath = 'wrangler.jsonc';
  if (remote) {
    // The same database, marked as remote, in a throwaway config wrangler reads instead.
    const config = unstable_readConfig({ config: configPath });
    mkdirSync('.wrangler', { recursive: true });
    configPath = '.wrangler/scripts-remote.json';
    writeFileSync(
      configPath,
      JSON.stringify({
        name: config.name,
        compatibility_date: config.compatibility_date,
        compatibility_flags: config.compatibility_flags,
        d1_databases: config.d1_databases.map((d: object) => ({ ...d, remote: true })),
      }),
    );
  }
  const proxy = await getPlatformProxy<{ DB: D1Database }>({ configPath, remoteBindings: remote });
  console.log(remote ? 'Using the live database on Cloudflare.' : 'Using the local database (add --remote for the live one).');
  return { db: useDatabase(proxy.env.DB), close: () => proxy.dispose() };
}
