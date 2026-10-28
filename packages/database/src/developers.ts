import { eq } from 'drizzle-orm';
import { mayUseIntent, normalizeDeveloperPolicy, type AccountVerification, type DeveloperPolicy } from '@subspace/constants';
import { instanceSettings, transmitters, appBots, oauthApps } from './schema.js';

type Db = any;

export const DEVELOPER_POLICY_KEY = 'developers';

/** The instance's developer policy (Command Console › Developers), or the defaults. */
export async function loadDeveloperPolicy(db: Db): Promise<DeveloperPolicy> {
  const [row] = await db.select({ value: instanceSettings.value }).from(instanceSettings).where(eq(instanceSettings.key, DEVELOPER_POLICY_KEY)).limit(1);
  return normalizeDeveloperPolicy(row?.value);
}

export async function saveDeveloperPolicy(db: Db, policy: DeveloperPolicy) {
  await db
    .insert(instanceSettings)
    .values({ key: DEVELOPER_POLICY_KEY, value: policy })
    .onConflictDoUpdate({ target: instanceSettings.key, set: { value: policy, updatedAt: new Date() } });
}

/** How an account is verified (an unknown account: not at all). */
export async function accountVerification(db: Db, transmitterId: string): Promise<AccountVerification> {
  const [row] = await db
    .select({ email: transmitters.isEmailVerified, phone: transmitters.phoneVerifiedAt, staff: transmitters.handVerifiedAt })
    .from(transmitters)
    .where(eq(transmitters.id, transmitterId))
    .limit(1);
  return { email: !!row?.email, phone: !!row?.phone, staff: !!row?.staff };
}

/**
 * The privileged intents a bot actually gets: those its developer turned on, while the developer
 * still may use them under the instance's policy (it can be tightened after they were turned on).
 */
export async function resolveBotIntents(db: Db, botUserId: string): Promise<{ messageContent: boolean; activity: boolean }> {
  const [bot] = await db
    .select({ messageContent: appBots.messageContent, activity: appBots.activityIntent, ownerId: oauthApps.ownerId })
    .from(appBots)
    .innerJoin(oauthApps, eq(oauthApps.id, appBots.appId))
    .where(eq(appBots.userId, botUserId))
    .limit(1);
  if (!bot || (!bot.messageContent && !bot.activity)) return { messageContent: false, activity: false };
  const [policy, owner] = await Promise.all([loadDeveloperPolicy(db), accountVerification(db, bot.ownerId)]);
  return {
    messageContent: bot.messageContent && mayUseIntent(owner, policy, 'messageContent'),
    activity: bot.activity && mayUseIntent(owner, policy, 'activity'),
  };
}
