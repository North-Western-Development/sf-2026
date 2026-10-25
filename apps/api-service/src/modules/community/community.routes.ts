import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import {
  and,
  eq,
  inArray,
  max,
  asc,
  beaconMembers,
  clearances,
  relays,
  transmissions,
  onboardingQuestions,
  onboardingOptions,
  memberBeaconPrefs,
} from '@subspace/database';
import { PERMISSIONS, hasPermission } from '@subspace/constants';
import { extractAuthToken, resolveBeaconActorContext } from '../../middleware/hierarchy.js';
import { publishGatewayEvent, publishSessionRefresh } from '../../lib/events.js';
import { buildMember } from '../../lib/members.js';
import { ELEVATED_PERMISSIONS } from '../onboarding/onboarding.routes.js';

const MAX_QUESTIONS = 15;
const MAX_OPTIONS = 50;

interface OptionInput {
  label?: unknown;
  description?: unknown;
  emoji?: unknown;
  clearanceIds?: unknown;
  relayIds?: unknown;
}
interface QuestionInput {
  title?: unknown;
  multiple?: unknown;
  required?: unknown;
  options?: unknown;
}

const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const ids = (v: unknown) => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string'))] : []);

/**
 * Channels & Roles: the beacon's onboarding questions, each member's answers, and the relays
 * a member hides from their own sidebar (Browse Channels).
 *   GET /api/v1/beacons/:id/onboarding-questions
 *   PUT /api/v1/beacons/:id/onboarding-questions      (MANAGE_BEACON) replace all
 *   PUT /api/v1/beacons/:id/onboarding-selections     { optionIds }
 *   GET /api/v1/beacons/:id/relay-prefs
 *   PUT /api/v1/beacons/:id/relay-prefs               { hiddenRelayIds }
 */
export const communityRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  const db = (app as any).db;

  async function member(request: any, reply: any) {
    const token = extractAuthToken(request);
    if (!token) return void reply.status(401).send({ error: 'Authentication required' });
    if (!db) return void reply.status(503).send({ error: 'Database service unavailable' });
    const { id: beaconId } = request.params as { id: string };
    const actor = await resolveBeaconActorContext(db, token.transmitterId, beaconId);
    if (!actor) return void reply.status(403).send({ error: 'Transmitter is not a member of this Beacon' });
    return { beaconId, me: token.transmitterId, actor };
  }

  async function prefsOf(beaconId: string, transmitterId: string) {
    const [row] = await db
      .select()
      .from(memberBeaconPrefs)
      .where(and(eq(memberBeaconPrefs.beaconId, beaconId), eq(memberBeaconPrefs.transmitterId, transmitterId)))
      .limit(1);
    return { selectedOptionIds: (row?.selectedOptionIds as string[]) ?? [], hiddenRelayIds: (row?.hiddenRelayIds as string[]) ?? [] };
  }
  async function savePrefs(beaconId: string, transmitterId: string, next: { selectedOptionIds?: string[]; hiddenRelayIds?: string[] }) {
    const cur = await prefsOf(beaconId, transmitterId);
    const row = { beaconId, transmitterId, ...cur, ...next, updatedAt: new Date() };
    await db
      .insert(memberBeaconPrefs)
      .values(row)
      .onConflictDoUpdate({ target: [memberBeaconPrefs.beaconId, memberBeaconPrefs.transmitterId], set: { selectedOptionIds: row.selectedOptionIds, hiddenRelayIds: row.hiddenRelayIds, updatedAt: row.updatedAt } });
    return { selectedOptionIds: row.selectedOptionIds, hiddenRelayIds: row.hiddenRelayIds };
  }

  async function loadQuestions(beaconId: string) {
    const qs = await db.select().from(onboardingQuestions).where(eq(onboardingQuestions.beaconId, beaconId)).orderBy(asc(onboardingQuestions.position));
    const opts = await db.select().from(onboardingOptions).where(eq(onboardingOptions.beaconId, beaconId)).orderBy(asc(onboardingOptions.position));
    return qs.map((q: any) => ({
      id: q.id,
      title: q.title,
      multiple: q.multiple,
      required: q.required,
      options: opts
        .filter((o: any) => o.questionId === q.id)
        .map((o: any) => ({ id: o.id, label: o.label, description: o.description, emoji: o.emoji, clearanceIds: o.clearanceIds, relayIds: o.relayIds })),
    }));
  }

  /** Clearances an option may hand out: in this beacon, not @everyone, and never moderation or admin power. */
  async function safeClearanceIds(beaconId: string) {
    const rows = await db.select().from(clearances).where(eq(clearances.beaconId, beaconId));
    return new Set<string>(rows.filter((c: any) => c.position > 0 && (BigInt(c.permissions) & ELEVATED_PERMISSIONS) === 0n).map((c: any) => c.id));
  }

  app.get('/:id/onboarding-questions', async (request, reply) => {
    const ctx = await member(request, reply);
    if (!ctx) return;
    const prefs = await prefsOf(ctx.beaconId, ctx.me);
    return reply.send({ questions: await loadQuestions(ctx.beaconId), selectedOptionIds: prefs.selectedOptionIds });
  });

  app.put('/:id/onboarding-questions', async (request, reply) => {
    const ctx = await member(request, reply);
    if (!ctx) return;
    if (!hasPermission(ctx.actor.effectivePermissions, PERMISSIONS.MANAGE_BEACON)) return reply.status(403).send({ error: 'Editing onboarding needs MANAGE_BEACON' });
    const input = (request.body as any)?.questions;
    if (!Array.isArray(input) || input.length > MAX_QUESTIONS) return reply.status(400).send({ error: `questions must be a list of at most ${MAX_QUESTIONS}` });

    const safe = await safeClearanceIds(ctx.beaconId);
    const beaconRelays = new Set<string>((await db.select({ id: relays.id }).from(relays).where(eq(relays.beaconId, ctx.beaconId))).map((r: any) => r.id));
    const questions = [];
    for (const raw of input as QuestionInput[]) {
      const title = str(raw?.title, 100);
      const options = Array.isArray(raw?.options) ? (raw.options as OptionInput[]) : [];
      if (!title) return reply.status(400).send({ error: 'Every question needs a title' });
      if (!options.length || options.length > MAX_OPTIONS) return reply.status(400).send({ error: `Each question needs 1 to ${MAX_OPTIONS} options` });
      const clean = [];
      for (const o of options) {
        const label = str(o?.label, 50);
        if (!label) return reply.status(400).send({ error: 'Every option needs a label' });
        const cIds = ids(o?.clearanceIds);
        const bad = cIds.find((id) => !safe.has(id));
        if (bad) return reply.status(400).send({ error: 'Options can only grant clearances without moderation or admin permissions', code: 'UNSAFE_CLEARANCE', clearanceId: bad });
        const rIds = ids(o?.relayIds).filter((id) => beaconRelays.has(id));
        clean.push({ label, description: str(o?.description, 100), emoji: str(o?.emoji, 64), clearanceIds: cIds, relayIds: rIds });
      }
      questions.push({ title, multiple: raw?.multiple !== false, required: raw?.required === true, options: clean });
    }

    await db.delete(onboardingQuestions).where(eq(onboardingQuestions.beaconId, ctx.beaconId));
    for (const [qi, q] of questions.entries()) {
      const [row] = await db.insert(onboardingQuestions).values({ beaconId: ctx.beaconId, title: q.title, multiple: q.multiple, required: q.required, position: qi }).returning();
      await db.insert(onboardingOptions).values(q.options.map((o, oi) => ({ ...o, questionId: row.id, beaconId: ctx.beaconId, position: oi })));
    }
    const out = await loadQuestions(ctx.beaconId);
    await publishGatewayEvent(app, 'ONBOARDING_UPDATE', { beaconId: ctx.beaconId }, { beaconId: ctx.beaconId });
    return reply.send({ questions: out });
  });

  app.put('/:id/onboarding-selections', async (request, reply) => {
    const ctx = await member(request, reply);
    if (!ctx) return;
    const wanted = ids((request.body as any)?.optionIds);
    const questions = await loadQuestions(ctx.beaconId);
    const optionById = new Map<string, { q: any; o: any }>();
    for (const q of questions) for (const o of q.options) optionById.set(o.id, { q, o });
    if (wanted.some((id) => !optionById.has(id))) return reply.status(400).send({ error: 'Unknown onboarding option' });
    for (const q of questions) {
      if (!q.multiple && wanted.filter((id) => optionById.get(id)!.q.id === q.id).length > 1) {
        return reply.status(400).send({ error: `“${q.title}” takes one answer` });
      }
    }

    const prefs = await prefsOf(ctx.beaconId, ctx.me);
    const safe = await safeClearanceIds(ctx.beaconId);
    const grants = (list: string[]) => new Set(list.flatMap((id) => (optionById.get(id)?.o.clearanceIds as string[]) ?? []).filter((c) => safe.has(c)));
    const before = grants(prefs.selectedOptionIds.filter((id) => optionById.has(id)));
    const after = grants(wanted);
    const held = new Set(ctx.actor.member.clearanceIds as string[]);
    for (const c of before) if (!after.has(c)) held.delete(c);
    for (const c of after) held.add(c);
    const nextClearances = [...held];

    // Relays an answer points to come back into the sidebar.
    const shown = new Set(wanted.flatMap((id) => (optionById.get(id)!.o.relayIds as string[]) ?? []));
    const saved = await savePrefs(ctx.beaconId, ctx.me, { selectedOptionIds: wanted, hiddenRelayIds: prefs.hiddenRelayIds.filter((r) => !shown.has(r)) });

    const changed = nextClearances.length !== (ctx.actor.member.clearanceIds as string[]).length || nextClearances.some((c) => !(ctx.actor.member.clearanceIds as string[]).includes(c));
    if (changed) {
      await db.update(beaconMembers).set({ clearanceIds: nextClearances }).where(and(eq(beaconMembers.beaconId, ctx.beaconId), eq(beaconMembers.transmitterId, ctx.me)));
      await publishGatewayEvent(app, 'MEMBER_UPDATE', { beaconId: ctx.beaconId, member: await buildMember(db, (app as any).redis, ctx.beaconId, ctx.me) }, { beaconId: ctx.beaconId });
      await publishSessionRefresh(app, [ctx.me]);
    }
    return reply.send({ ...saved, clearanceIds: nextClearances });
  });

  app.get('/:id/relay-prefs', async (request, reply) => {
    const ctx = await member(request, reply);
    if (!ctx) return;
    const prefs = await prefsOf(ctx.beaconId, ctx.me);
    const beaconRelayIds = (await db.select({ id: relays.id }).from(relays).where(eq(relays.beaconId, ctx.beaconId))).map((r: any) => r.id);
    const activity = beaconRelayIds.length
      ? await db
          .select({ relayId: transmissions.relayId, at: max(transmissions.createdAt) })
          .from(transmissions)
          .where(inArray(transmissions.relayId, beaconRelayIds))
          .groupBy(transmissions.relayId)
      : [];
    return reply.send({ ...prefs, activity: Object.fromEntries(activity.map((a: any) => [a.relayId, a.at])) });
  });

  app.put('/:id/relay-prefs', async (request, reply) => {
    const ctx = await member(request, reply);
    if (!ctx) return;
    const wanted = ids((request.body as any)?.hiddenRelayIds);
    const rows = await db.select({ id: relays.id, isUnhideable: relays.isUnhideable }).from(relays).where(eq(relays.beaconId, ctx.beaconId));
    const hideable = new Set(rows.filter((r: any) => !r.isUnhideable).map((r: any) => r.id));
    const saved = await savePrefs(ctx.beaconId, ctx.me, { hiddenRelayIds: wanted.filter((id) => hideable.has(id)) });
    return reply.send(saved);
  });
};
