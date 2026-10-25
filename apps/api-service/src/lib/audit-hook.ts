import type { FastifyInstance, FastifyRequest } from 'fastify';
import { eq, invites, transmissions, relays, archivalThreads } from '@subspace/database';
import { extractAuthToken } from '../middleware/hierarchy.js';
import { audit } from './audit.js';

/**
 * Records the Audit Log from one place: each admin or moderator route below, when it succeeds,
 * becomes an entry (who, what, on what, and the X-Audit-Log-Reason header if sent, as Discord
 * takes it). Routes that log their own detailed changes (beacon settings) are not listed.
 */
type Rule = {
  action: string;
  targetType: string;
  /** Where the target id comes from: a route param, or the response body. */
  target: (p: Record<string, string>, body: any) => string | undefined;
  name?: (body: any, req: FastifyRequest) => string | undefined;
  /** Send the request body's keys as the changes. */
  changes?: boolean;
};

const B = '/api/v1/beacons';
const RULES: Record<string, Rule> = {
  [`POST ${B}/:beaconId/relays`]: { action: 'relay_create', targetType: 'relay', target: (_p, b) => b?.relay?.id, name: (b) => b?.relay?.name },
  [`PATCH ${B}/:beaconId/relays/:relayId`]: { action: 'relay_update', targetType: 'relay', target: (p) => p.relayId, name: (b) => b?.relay?.name, changes: true },
  [`DELETE ${B}/:beaconId/relays/:relayId`]: { action: 'relay_delete', targetType: 'relay', target: (p) => p.relayId },
  [`PUT ${B}/:beaconId/relays/:relayId/overwrites/:targetId`]: { action: 'relay_permissions_update', targetType: 'relay', target: (p) => p.relayId, changes: true },
  [`DELETE ${B}/:beaconId/relays/:relayId/overwrites/:targetId`]: { action: 'relay_permissions_delete', targetType: 'relay', target: (p) => p.relayId },
  [`POST ${B}/:id/clearances`]: { action: 'clearance_create', targetType: 'clearance', target: (_p, b) => b?.clearance?.id, name: (b) => b?.clearance?.name },
  [`PATCH ${B}/:id/clearances/:clearanceId`]: { action: 'clearance_update', targetType: 'clearance', target: (p) => p.clearanceId, name: (b) => b?.clearance?.name, changes: true },
  [`DELETE ${B}/:id/clearances/:clearanceId`]: { action: 'clearance_delete', targetType: 'clearance', target: (p) => p.clearanceId },
  [`POST ${B}/:id/clearances/members/:targetId/assign`]: { action: 'member_clearances_update', targetType: 'member', target: (p) => p.targetId, changes: true },
  [`PATCH ${B}/:id/members/:userId`]: { action: 'member_update', targetType: 'member', target: (p) => p.userId, changes: true },
  [`PUT ${B}/:id/members/:targetId/timeout`]: { action: 'member_timeout', targetType: 'member', target: (p) => p.targetId, changes: true },
  [`POST ${B}/:id/members/:targetId/kick`]: { action: 'member_kick', targetType: 'member', target: (p) => p.targetId },
  [`PUT ${B}/:id/bans/:userId`]: { action: 'member_ban', targetType: 'member', target: (p) => p.userId },
  [`DELETE ${B}/:id/bans/:userId`]: { action: 'member_unban', targetType: 'member', target: (p) => p.userId },
  [`POST ${B}/:id/prune`]: { action: 'member_prune', targetType: 'beacon', target: (p) => p.id, changes: true },
  [`POST ${B}/:id/emojis`]: { action: 'glyph_create', targetType: 'glyph', target: (_p, b) => b?.glyph?.id ?? b?.emoji?.id, name: (b) => b?.glyph?.name ?? b?.emoji?.name },
  [`PATCH ${B}/:id/emojis/:emojiId`]: { action: 'glyph_update', targetType: 'glyph', target: (p) => p.emojiId, changes: true },
  [`DELETE ${B}/:id/emojis/:emojiId`]: { action: 'glyph_delete', targetType: 'glyph', target: (p) => p.emojiId },
  [`POST /api/v1/beacons/:id/invites`]: { action: 'invite_create', targetType: 'invite', target: (_p, b) => b?.invite?.code, name: (b) => b?.invite?.code },
  [`DELETE /api/v1/invites/:code`]: { action: 'invite_delete', targetType: 'invite', target: (p) => p.code, name: (_b, r) => (r.params as any).code },
  [`PUT ${B}/:id/onboarding-questions`]: { action: 'onboarding_update', targetType: 'beacon', target: (p) => p.id },
  [`POST ${B}/:id/events`]: { action: 'event_create', targetType: 'event', target: (_p, b) => b?.event?.id, name: (b) => b?.event?.name },
  [`PATCH ${B}/:id/events/:eventId`]: { action: 'event_update', targetType: 'event', target: (p) => p.eventId, name: (b) => b?.event?.name, changes: true },
  [`DELETE ${B}/:id/events/:eventId`]: { action: 'event_delete', targetType: 'event', target: (p) => p.eventId },
  [`PUT /api/v1/transmissions/:id/pin`]: { action: 'transmission_pin', targetType: 'transmission', target: (p) => p.id },
  [`DELETE /api/v1/transmissions/:id/pin`]: { action: 'transmission_unpin', targetType: 'transmission', target: (p) => p.id },
  [`DELETE /api/v1/transmissions/:id`]: { action: 'transmission_delete', targetType: 'transmission', target: (p) => p.id },
};

/** The beacon a route acts on, and for deletes, details that are gone after it runs. */
async function lookup(db: any, key: string, p: Record<string, string>): Promise<{ beaconId?: string; authorId?: string; name?: string } | null> {
  if (p.beaconId || p.id) {
    if (key.startsWith('PUT /api/v1/transmissions') || key.startsWith('DELETE /api/v1/transmissions')) return transmissionBeacon(db, p.id);
    return { beaconId: p.beaconId ?? p.id };
  }
  if (p.code) {
    const [invite] = await db.select({ beaconId: invites.beaconId }).from(invites).where(eq(invites.code, p.code)).limit(1);
    return invite ? { beaconId: invite.beaconId } : null;
  }
  return null;
}

async function transmissionBeacon(db: any, id: string) {
  const [t] = await db.select().from(transmissions).where(eq(transmissions.id, id)).limit(1);
  if (!t) return null;
  let relayId = t.relayId;
  if (!relayId && t.threadId) {
    const [thread] = await db.select({ relayId: archivalThreads.relayId }).from(archivalThreads).where(eq(archivalThreads.id, t.threadId)).limit(1);
    relayId = thread?.relayId;
  }
  if (!relayId) return null;
  const [relay] = await db.select({ beaconId: relays.beaconId, name: relays.name }).from(relays).where(eq(relays.id, relayId)).limit(1);
  return relay ? { beaconId: relay.beaconId, authorId: t.transmitterId, name: `#${relay.name}` } : null;
}

export function registerAuditHook(app: FastifyInstance) {
  const db = (app as any).db;
  // Deletes lose their row, so the beacon is looked up before the route runs.
  app.addHook('preHandler', async (request) => {
    const key = `${request.method} ${request.routeOptions.url}`;
    if (!RULES[key] || !db) return;
    (request as any).auditCtx = await lookup(db, key, request.params as Record<string, string>).catch(() => null);
  });
  app.addHook('onSend', async (request, reply, payload) => {
    const key = `${request.method} ${request.routeOptions.url}`;
    const rule = RULES[key];
    const ctx = (request as any).auditCtx as Awaited<ReturnType<typeof lookup>> | undefined;
    if (!rule || !ctx?.beaconId || reply.statusCode >= 300) return payload;
    const token = extractAuthToken(request);
    if (!token) return payload;
    // Deleting your own transmission is not moderation.
    if (rule.action === 'transmission_delete' && ctx.authorId === token.transmitterId) return payload;
    let body: any = null;
    try {
      body = typeof payload === 'string' ? JSON.parse(payload) : null;
    } catch {
      /* not JSON */
    }
    const params = request.params as Record<string, string>;
    const sent = (request.body ?? {}) as Record<string, unknown>;
    const reason = request.headers['x-audit-log-reason'];
    await audit(db, {
      beaconId: ctx.beaconId,
      actorId: token.transmitterId,
      action: rule.action,
      targetType: rule.targetType,
      targetId: rule.target(params, body) ?? null,
      targetName: rule.name?.(body, request) ?? ctx.name ?? null,
      changes: rule.changes ? Object.entries(sent).map(([k, v]) => ({ key: k, new: v })) : undefined,
      reason: typeof reason === 'string' ? decodeURIComponent(reason).slice(0, 512) : null,
    });
    return payload;
  });
}
