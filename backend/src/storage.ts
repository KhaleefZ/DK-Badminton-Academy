import type { KVNamespace } from '@cloudflare/workers-types';

// Website photos live in Workers KV, which comes with Cloudflare's free plan with no card or checkout:
// 1 GB in all, up to 25 MB a photo (uploads are capped at 5 MB), 100,000 reads and 1,000 writes a day.
// A photo is read once per visitor at most: it's sent with a one-year browser cache, since a new upload
// gets a new id. The list of photos (and each one's type and size) stays in the site_images table.
let store: KVNamespace | undefined;

/** Points the app at the KV namespace for website photos: the Worker's binding, or a local one in tests. */
export function usePhotos(binding: KVNamespace): void {
  store = binding;
}

function photos(): KVNamespace {
  if (!store) throw new Error('No photo storage: call usePhotos() first.');
  return store;
}

export const photoKey = (id: string) => `photos/${id}`;

export async function savePhoto(id: string, data: Uint8Array): Promise<void> {
  await photos().put(photoKey(id), data);
}

export async function readPhoto(id: string): Promise<ArrayBuffer | null> {
  return photos().get(photoKey(id), 'arrayBuffer');
}

/** KV deletes one key at a time. The free plan allows 1,000 a day, far more than the editor ever removes. */
export async function deletePhotos(ids: string[]): Promise<void> {
  for (const id of ids) await photos().delete(photoKey(id));
}
