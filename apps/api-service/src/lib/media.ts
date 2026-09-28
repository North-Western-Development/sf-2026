import { eq, and, mediaUploads } from '@subspace/database';
import type { MediaPurpose } from '@subspace/constants';

/** Public path prefix every completed media upload URL is served under. */
export const MEDIA_PUBLIC_PREFIX = '/subspace-media/';

/**
 * Validates that `url` is either null/undefined or a completed media upload owned by
 * `callerId` (optionally restricted to a set of purposes). Returns `{ ok: true }` or
 * `{ ok: false }` — callers respond `400 INVALID_MEDIA_URL` on failure. This is the only
 * gate that lets a URL into a stored `avatarUrl` / `bannerUrl` / `iconUrl` / glyph `url` field,
 * closing arbitrary-URL injection.
 */
export async function validateMediaUrl(
  db: any,
  callerId: string,
  url: string | null | undefined,
  purposes?: MediaPurpose[]
): Promise<boolean> {
  if (url === null || url === undefined) return true;
  if (typeof url !== 'string' || !url.startsWith(MEDIA_PUBLIC_PREFIX)) return false;
  if (!db) return false;

  const [media] = await db
    .select()
    .from(mediaUploads)
    .where(and(eq(mediaUploads.publicUrl, url), eq(mediaUploads.ownerId, callerId)))
    .limit(1);

  if (!media || !media.verified) return false;
  if (purposes && purposes.length > 0 && !purposes.includes(media.purpose)) return false;
  return true;
}
