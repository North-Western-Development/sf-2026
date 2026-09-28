import { and, eq, inArray, vaultFiles } from '@subspace/database';

export interface StoredAttachment {
  id: string;
  url: string;
  filename: string;
  size: number;
  mimeType: string;
}

export const MAX_ATTACHMENTS = 10;

/** Public (unauthenticated, unguessable) URL that redirects to the stored object. */
export const vaultFileUrl = (file: { id: string; storageKey: string }) =>
  process.env.VAULT_PUBLIC_URL_BASE ? `${process.env.VAULT_PUBLIC_URL_BASE}/${file.storageKey}` : `/api/v1/vault/files/${file.id}`;

/**
 * Turn client-supplied vault file ids into attachment records. Only non-quarantined files
 * owned by the sender are accepted; clients can never supply URLs directly.
 * Returns null when any id is invalid.
 */
export async function resolveVaultAttachments(db: any, ownerId: string, ids: unknown): Promise<StoredAttachment[] | null> {
  if (ids === undefined || ids === null) return [];
  if (!Array.isArray(ids) || ids.length > MAX_ATTACHMENTS || ids.some((id) => typeof id !== 'string')) return null;
  const unique = [...new Set(ids as string[])];
  if (unique.length === 0) return [];
  if (unique.some((id) => !/^[0-9a-f-]{36}$/i.test(id))) return null;
  const files = await db
    .select()
    .from(vaultFiles)
    .where(and(inArray(vaultFiles.id, unique), eq(vaultFiles.transmitterId, ownerId)));
  if (files.length !== unique.length || files.some((f: any) => f.isQuarantined)) return null;
  return files.map((f: any) => ({
    id: f.id,
    url: vaultFileUrl(f),
    filename: f.filename,
    size: Number(f.sizeBytes),
    mimeType: f.mimeType,
  }));
}
