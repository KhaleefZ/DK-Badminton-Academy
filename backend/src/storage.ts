import type { R2Bucket } from '@cloudflare/workers-types';

let bucket: R2Bucket | undefined;

/** Points the app at the R2 bucket for website photos: the Worker's binding, or a local one in tests. */
export function usePhotos(binding: R2Bucket): void {
  bucket = binding;
}

export function photos(): R2Bucket {
  if (!bucket) throw new Error('No photo storage: call usePhotos() first.');
  return bucket;
}

export const photoKey = (id: string) => `photos/${id}`;
