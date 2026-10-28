import { eq } from 'drizzle-orm';
import { storageGroups, transmitters } from './schema.js';

const MB = 1024 * 1024;
const envMb = (name: string, fallback: number) => {
  const n = Number(process.env[name]);
  return (Number.isFinite(n) && n > 0 ? n : fallback) * MB;
};

/** Vault limits for accounts outside any storage group (DEFAULT_STORAGE_QUOTA_MB, DEFAULT_MAX_UPLOAD_MB). */
export const defaultStorageLimits = () => ({ quotaBytes: envMb('DEFAULT_STORAGE_QUOTA_MB', 500), maxUploadBytes: envMb('DEFAULT_MAX_UPLOAD_MB', 50) });

/** The Vault limits that apply to an account: its storage group's, or the instance defaults. */
export async function storageLimitsFor(db: any, transmitterId: string): Promise<{ quotaBytes: number; maxUploadBytes: number; group: { id: string; name: string } | null }> {
  const [row] = await db
    .select({ id: storageGroups.id, name: storageGroups.name, quotaBytes: storageGroups.quotaBytes, maxUploadBytes: storageGroups.maxUploadBytes })
    .from(transmitters)
    .innerJoin(storageGroups, eq(storageGroups.id, transmitters.storageGroupId))
    .where(eq(transmitters.id, transmitterId))
    .limit(1);
  if (!row) return { ...defaultStorageLimits(), group: null };
  return { quotaBytes: Number(row.quotaBytes), maxUploadBytes: Number(row.maxUploadBytes), group: { id: row.id, name: row.name } };
}
