import { auditLog } from '@subspace/database';

export interface AuditEntry {
  beaconId: string;
  actorId: string | null;
  action: string;
  targetType?: string;
  targetId?: string | null;
  targetName?: string | null;
  changes?: Array<{ key: string; old?: unknown; new?: unknown }>;
  reason?: string | null;
}

/** Records an admin or moderator action for the beacon's Audit Log. Never fails the request. */
export async function audit(db: any, entry: AuditEntry): Promise<void> {
  if (!db) return;
  try {
    await db.insert(auditLog).values({
      beaconId: entry.beaconId,
      actorId: entry.actorId,
      action: entry.action,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      targetName: entry.targetName ?? null,
      changes: entry.changes?.length ? entry.changes : null,
      reason: entry.reason ?? null,
    });
  } catch {
    /* the log is best effort */
  }
}

/** { key, old, new } for each field that changed between two rows. */
export function diff(before: Record<string, any>, after: Record<string, any>, keys: string[]) {
  const out: Array<{ key: string; old?: unknown; new?: unknown }> = [];
  for (const key of keys) {
    const a = before[key] instanceof Date ? before[key].toISOString() : before[key];
    const b = after[key] instanceof Date ? after[key].toISOString() : after[key];
    if (JSON.stringify(a ?? null) !== JSON.stringify(b ?? null)) out.push({ key, old: a ?? null, new: b ?? null });
  }
  return out;
}
