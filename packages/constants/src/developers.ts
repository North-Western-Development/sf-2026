/**
 * Developer policy: who on this instance may create applications (Developer Applications: OAuth2
 * apps, bots, Rich Presence) and turn on each privileged bot intent. Staff set it in Command
 * Console › Developers; it is stored in instance_settings under 'developers'.
 *
 * "Verified" is the instance's choice too: any one of the methods it picks makes an account
 * verified. Out of the box everything is open, as it was before the policy existed.
 */

/** Ways an account can be verified: its email, its phone number, or by hand by staff. */
export const VERIFICATION_METHODS = ['email', 'phone', 'staff'] as const;
export type VerificationMethod = (typeof VERIFICATION_METHODS)[number];

/** Bot intents an instance can keep for verified accounts. Each is off for a bot until its developer turns it on. */
export const PRIVILEGED_INTENTS = ['messageContent', 'activity'] as const;
export type PrivilegedIntent = (typeof PRIVILEGED_INTENTS)[number];

export const PRIVILEGED_INTENT_INFO: Record<PrivilegedIntent, { label: string; description: string }> = {
  messageContent: { label: 'Message Content', description: 'See the text of every message, not just ones that mention the bot.' },
  activity: { label: 'Activity Status', description: 'See what members are playing, as their Activity Privacy allows.' },
};

export type DeveloperAudience = 'everyone' | 'verified';

export interface DeveloperPolicy {
  /** What makes an account verified: any one of these. Never empty. */
  verifiedBy: VerificationMethod[];
  /** Who may create applications. */
  createApps: DeveloperAudience;
  /** Needed to create applications whoever may: a verified email and/or phone. */
  createAppsRequires: Array<'email' | 'phone'>;
  /** Who may turn on each privileged intent. */
  intents: Record<PrivilegedIntent, DeveloperAudience>;
}

export const DEFAULT_DEVELOPER_POLICY: DeveloperPolicy = {
  verifiedBy: ['email', 'phone', 'staff'],
  createApps: 'everyone',
  createAppsRequires: [],
  intents: { messageContent: 'everyone', activity: 'everyone' },
};

/** An account's verifications. */
export interface AccountVerification {
  email: boolean;
  phone: boolean;
  staff: boolean;
}

const audience = (v: unknown): DeveloperAudience => (v === 'verified' ? 'verified' : 'everyone');

/** A stored policy, cleaned up: anything unknown or missing falls back to the default. */
export function normalizeDeveloperPolicy(raw: unknown): DeveloperPolicy {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  const verifiedBy = Array.isArray(r.verifiedBy) ? VERIFICATION_METHODS.filter((m) => r.verifiedBy.includes(m)) : [];
  const requires = Array.isArray(r.createAppsRequires) ? (['email', 'phone'] as const).filter((m) => r.createAppsRequires.includes(m)) : [];
  const intents = (r.intents && typeof r.intents === 'object' ? r.intents : {}) as Record<string, unknown>;
  return {
    verifiedBy: verifiedBy.length ? verifiedBy : [...DEFAULT_DEVELOPER_POLICY.verifiedBy],
    createApps: audience(r.createApps),
    createAppsRequires: requires,
    intents: Object.fromEntries(PRIVILEGED_INTENTS.map((i) => [i, audience(intents[i])])) as DeveloperPolicy['intents'],
  };
}

export const isVerifiedAccount = (v: AccountVerification, policy: DeveloperPolicy) => policy.verifiedBy.some((m) => v[m]);

const METHOD_LABEL: Record<VerificationMethod, string> = { email: 'a verified email', phone: 'a verified phone number', staff: 'verification by staff' };

/** "a verified email or a verified phone number": what the instance accepts as verified. */
export function verifiedMeans(policy: DeveloperPolicy) {
  const parts = policy.verifiedBy.map((m) => METHOD_LABEL[m]);
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} or ${parts[parts.length - 1]}` : parts[0];
}

/** Whether they may create applications, and what they are missing if not. */
export function appCreationCheck(v: AccountVerification, policy: DeveloperPolicy): { allowed: boolean; missing: string[] } {
  const missing: string[] = [];
  if (policy.createAppsRequires.includes('email') && !v.email) missing.push('a verified email');
  if (policy.createAppsRequires.includes('phone') && !v.phone) missing.push('a verified phone number');
  if (policy.createApps === 'verified' && !isVerifiedAccount(v, policy)) missing.push(verifiedMeans(policy));
  return { allowed: missing.length === 0, missing };
}

export const mayUseIntent = (v: AccountVerification, policy: DeveloperPolicy, intent: PrivilegedIntent) =>
  policy.intents[intent] === 'everyone' || isVerifiedAccount(v, policy);

// --- Development teams ---------------------------------------------------------------------------

/** A team member's role, lowest first. The team's owner can do everything. */
export const DEV_TEAM_ROLES = ['read_only', 'developer', 'admin'] as const;
export type DevTeamRole = (typeof DEV_TEAM_ROLES)[number];
/** What someone can do with an application: a team role, or 'owner'. */
export type AppRole = DevTeamRole | 'owner';

export const DEV_TEAM_ROLE_INFO: Record<DevTeamRole, { label: string; description: string }> = {
  admin: { label: 'Admin', description: 'Everything but deleting the team: add and remove members, delete applications, move them in and out.' },
  developer: { label: 'Developer', description: 'Edit the team’s applications and bots, and see and reset their secrets and tokens.' },
  read_only: { label: 'Read-only', description: 'See the team’s applications and settings, but no secrets or tokens.' },
};

const APP_ROLE_RANK: Record<AppRole, number> = { read_only: 1, developer: 2, admin: 3, owner: 4 };
export const appRoleAtLeast = (role: AppRole | null | undefined, needed: AppRole) => !!role && APP_ROLE_RANK[role] >= APP_ROLE_RANK[needed];
