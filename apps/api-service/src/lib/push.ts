import type { FastifyInstance } from 'fastify';
import { and, eq, inArray, or, gt, pushTokens, notificationSettings } from '@subspace/database';
import { apnsConfigured, apnsTokenGone, sendApns } from './apns.js';
import { encryptWebPush } from './web-push.js';
import { safePost } from './safe-fetch.js';

/**
 * Mobile push, with no third-party relay: iOS straight to Apple (APNs, when the operator set a
 * key up; see apns.ts), Android through UnifiedPush (the endpoint of whichever distributor the
 * phone uses, such as this instance's ntfy server), encrypted so only the phone can read it.
 * Sent for direct links and meshes, mentions and incoming calls, unless the recipient muted
 * that conversation (or beacon), turned mobile push off for it, or is in Do Not Disturb.
 * Endpoints and tokens reported as gone are deleted.
 */

export interface PushMessage {
  kind: 'message' | 'mention' | 'call';
  title: string;
  body: string;
  /** Where tapping it should go, e.g. /channels/@me/<id>. */
  path: string;
}

/**
 * What Apple sees: no names and no text, only that something arrived and where it opens. The
 * app shows it as is (reading the content would need a notification service extension).
 */
const APNS_TEXT: Record<PushMessage['kind'], string> = { message: 'New transmission', mention: 'You were mentioned', call: 'Incoming call' };

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
  const gone: string[] = [];
  const apns = apnsConfigured();
  const plain = Buffer.from(JSON.stringify({ kind: message.kind, title: message.title.slice(0, 120), body: message.body.slice(0, 180), path: message.path }));
  await Promise.all(
    tokens.map(async (t: any) => {
      try {
        if (t.kind === 'apns') {
          if (!apns) return;
          const r = await sendApns(t.token, { aps: { alert: { title: APNS_TEXT[message.kind] }, sound: 'default' }, path: message.path });
          if (apnsTokenGone(r)) gone.push(t.token);
          else if (r.status !== 200) app.log.warn({ status: r.status, reason: r.reason }, '[Push] APNs refused a push');
        } else if (t.kind === 'unifiedpush' && t.p256dh && t.auth) {
          const res = await safePost(t.token, encryptWebPush(plain, t.p256dh, t.auth), { 'Content-Type': 'application/octet-stream', 'Content-Encoding': 'aes128gcm', TTL: '86400', Urgency: 'high' }, { timeoutMs: 10_000, maxBytes: 16 * 1024 });
          if (res.status === 404 || res.status === 410) gone.push(t.token);
          else if (res.status >= 300) app.log.warn({ status: res.status }, '[Push] a UnifiedPush endpoint refused a push');
        }
      } catch (err) {
        app.log.warn({ err: (err as Error).message, kind: t.kind }, '[Push] push request failed');
      }
    })
  );
  if (gone.length) await db.delete(pushTokens).where(inArray(pushTokens.token, gone));
}

/** Fire and forget: pushes must never slow down or fail a send. */
export function queuePush(app: FastifyInstance, recipients: string[], message: PushMessage, scopes: Array<{ type: string; id: string }>) {
  void sendPush(app, recipients, message, scopes).catch((err) => app.log.warn({ err: (err as Error).message }, '[Push] failed'));
}
