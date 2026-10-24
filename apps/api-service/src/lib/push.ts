import type { FastifyInstance } from 'fastify';
import { and, eq, inArray, or, gt, pushTokens, notificationSettings } from '@subspace/database';

/**
 * Mobile push through the Expo push service. Sent for direct links and meshes, mentions and
 * incoming calls, unless the recipient muted that conversation (or beacon), turned mobile push
 * off for it, or is in Do Not Disturb. Tokens Expo reports as gone are deleted.
 */

export interface PushMessage {
  title: string;
  body: string;
  /** Where tapping it should go, e.g. /channels/@me/<id>. */
  path: string;
}

const EXPO_PUSH_URL = () => process.env.EXPO_PUSH_URL || 'https://exp.host/--/api/v2/push/send';

/** Who of `recipients` wants a push for something in this conversation. */
async function wantsPush(app: FastifyInstance, recipients: string[], scopes: Array<{ type: string; id: string }>): Promise<string[]> {
  const db = (app as any).db;
  const redis = (app as any).redis;
  if (!recipients.length) return [];
  const now = new Date();
  const blocking = await db
    .select({ transmitterId: notificationSettings.transmitterId })
    .from(notificationSettings)
    .where(
      and(
        inArray(notificationSettings.transmitterId, recipients),
        or(...scopes.map((s) => and(eq(notificationSettings.scopeType, s.type), eq(notificationSettings.scopeId, s.id)))),
        or(gt(notificationSettings.mutedUntil, now), eq(notificationSettings.mobilePush, false), eq(notificationSettings.level, 'nothing'))
      )
    );
  const muted = new Set(blocking.map((b: any) => b.transmitterId));
  const presence: Array<string | null> = redis?.status === 'ready' ? await redis.hmget('presence', ...recipients).catch(() => []) : [];
  return recipients.filter((id, i) => !muted.has(id) && presence[i] !== 'dnd');
}

export async function sendPush(app: FastifyInstance, recipients: string[], message: PushMessage, scopes: Array<{ type: string; id: string }>) {
  const db = (app as any).db;
  if (!db) return;
  const targets = await wantsPush(app, [...new Set(recipients)], scopes);
  if (!targets.length) return;
  const tokens = await db.select().from(pushTokens).where(inArray(pushTokens.transmitterId, targets));
  if (!tokens.length) return;
  const messages: Array<{ to: string; title: string; body: string; data: { path: string }; sound: string }> = tokens.map((t: any) => ({
    to: t.token,
    title: message.title.slice(0, 120),
    body: message.body.slice(0, 180),
    data: { path: message.path },
    sound: 'default',
  }));
  for (let i = 0; i < messages.length; i += 100) {
    const batch = messages.slice(i, i + 100);
    try {
      const res = await fetch(EXPO_PUSH_URL(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(process.env.EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` } : {}) },
        body: JSON.stringify(batch),
        signal: AbortSignal.timeout(10_000),
      });
      const tickets = ((await res.json().catch(() => ({}))) as any).data ?? [];
      const gone = batch.filter((_, j) => tickets[j]?.details?.error === 'DeviceNotRegistered').map((m) => m.to);
      if (gone.length) await db.delete(pushTokens).where(inArray(pushTokens.token, gone));
    } catch (err) {
      app.log.warn({ err: (err as Error).message }, '[Push] Expo push request failed');
    }
  }
}

/** Fire and forget: pushes must never slow down or fail a send. */
export function queuePush(app: FastifyInstance, recipients: string[], message: PushMessage, scopes: Array<{ type: string; id: string }>) {
  void sendPush(app, recipients, message, scopes).catch((err) => app.log.warn({ err: (err as Error).message }, '[Push] failed'));
}
