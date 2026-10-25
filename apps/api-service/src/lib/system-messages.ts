import { and, eq, asc, beacons, relays, transmissions } from '@subspace/database';
import { publishGatewayEvent } from './events.js';
import { formatTransmission } from './transmissions.js';

/** How many welcome lines the client has (it picks the text; the content is the index). */
export const WELCOME_LINES = 13;

/** The relay system messages go to: the beacon's system relay, if it is still a text relay. */
async function systemRelay(db: any, beaconId: string, systemChannelId: string | null) {
  if (!systemChannelId) return null;
  const [relay] = await db
    .select({ id: relays.id })
    .from(relays)
    .where(and(eq(relays.id, systemChannelId), eq(relays.beaconId, beaconId), eq(relays.type, 'text')))
    .limit(1);
  return relay ?? null;
}

async function post(app: any, db: any, beaconId: string, relayId: string, authorId: string, type: string, content: string) {
  const [row] = await db.insert(transmissions).values({ relayId, transmitterId: authorId, content, type }).returning();
  const formatted = await formatTransmission(db, row, authorId, { beaconId });
  await publishGatewayEvent(app, 'TRANSMISSION_CREATE', { channelType: 'relay', channelId: relayId, transmission: formatted }, { relayId });
  return row;
}

/** Discord's random welcome message when someone joins, if the beacon has them on. */
export async function postWelcome(app: any, db: any, beaconId: string, memberId: string) {
  if (!db) return;
  const [beacon] = await db.select().from(beacons).where(eq(beacons.id, beaconId)).limit(1);
  if (!beacon?.welcomeMessages) return;
  const relay = await systemRelay(db, beaconId, beacon.systemChannelId);
  if (!relay) return;
  await post(app, db, beaconId, relay.id, memberId, 'system_join', String(Math.floor(Math.random() * WELCOME_LINES)));
}

/** A new beacon's system relay is its first text relay, and the owner gets the setup checklist. */
export async function setUpSystemChannel(app: any, db: any, beaconId: string, ownerId: string) {
  if (!db) return;
  const [first] = await db
    .select({ id: relays.id })
    .from(relays)
    .where(and(eq(relays.beaconId, beaconId), eq(relays.type, 'text')))
    .orderBy(asc(relays.position))
    .limit(1);
  if (!first) return;
  const [beacon] = await db.update(beacons).set({ systemChannelId: first.id }).where(eq(beacons.id, beaconId)).returning();
  if (beacon?.setupTips) await post(app, db, beaconId, first.id, ownerId, 'system_tips', 'setup');
}
