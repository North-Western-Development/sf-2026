// What's New: the changelog shown once on each platform after an update that affects it, and
// any time from User Settings › What's New. Entries ship with the app (newest first); add one
// with each release that people would notice. An entry or a single item can be limited to the
// platforms it concerns: someone on the web never hears about a desktop-only fix.

export type Platform = 'web' | 'desktop' | 'mobile';

export interface ChangelogItem {
  title: string;
  body: string;
  platforms?: Platform[];
}

export interface ChangelogEntry {
  /** The release date, YYYY-MM-DD, with a letter after it for a second release that day ("2026-10-28b"). */
  id: string;
  title: string;
  platforms?: Platform[];
  added?: ChangelogItem[];
  improved?: ChangelogItem[];
  fixed?: ChangelogItem[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    id: '2026-10-29',
    title: 'More in the header',
    platforms: ['mobile'],
    added: [
      {
        title: 'The ⋮ menu',
        body: 'The ⋮ at the top of a conversation has Threads, Pinned Transmissions, Notification Settings, your Inbox and Help.',
      },
    ],
    fixed: [
      {
        title: 'Long names and narrow screens',
        body: 'Long names no longer run into the time on a transmission, search opens across the header, and the Add Affiliate button, Pinned and Threads panels and account details fit on screen.',
      },
    ],
  },
  {
    id: '2026-10-28g',
    title: 'Discover categories',
    added: [
      {
        title: 'Browse Discover by category',
        body: 'Discover now has a sidebar of categories: Gaming, Music, Entertainment, Science & Tech, Education, Art & Creativity and Hangouts. Owners of a discoverable beacon pick its category in Beacon Settings › Beacon Profile.',
      },
    ],
    improved: [
      {
        title: 'A slimmer scroll bar',
        body: 'Lists show a thin scroll thumb of one size while you scroll, which fades when you stop.',
        platforms: ['mobile'],
      },
      {
        title: 'Tidier on a phone',
        body: 'The Affiliates tabs fit on screen, the + sheet is shorter and no longer scrolls, and names no longer pop up as tooltips when you tap.',
        platforms: ['mobile'],
      },
    ],
    fixed: [
      {
        title: 'The keyboard and the drawer',
        body: 'Picking a beacon with the drawer out no longer brings the keyboard up behind it, and the closed drawer no longer leaves a line down the left edge.',
        platforms: ['mobile'],
      },
    ],
  },
  {
    id: '2026-10-28f',
    title: 'Made for thumbs',
    platforms: ['mobile'],
    added: [
      {
        title: 'Swipe to reply',
        body: 'Swipe a transmission to the left to reply to it.',
      },
      {
        title: 'Swipe for your beacons',
        body: 'Swipe right anywhere in a conversation to pull out your beacons and relays, and left to put them away. The keyboard steps aside while they are out.',
      },
      {
        title: 'A new + menu',
        body: 'The + by the message box opens where the keyboard was: the camera, your gallery, and Photos, Poll, Apps and Files along the bottom. Apps lists every slash command you can use, with a search.',
      },
      {
        title: 'Polls, full screen',
        body: 'Creating a poll now takes the whole screen, with Post at the top.',
      },
    ],
    improved: [
      {
        title: 'Back where you left off',
        body: 'Opening the app takes you to the conversation you last had open.',
      },
    ],
  },
  {
    id: '2026-10-28e',
    title: 'Safer encrypted conversations',
    added: [
      {
        title: 'Screenshot protection',
        body: 'While an end-to-end encrypted direct link or group DM is open, screenshots and screen recordings of it are blocked. It is lifted during calls, so screen sharing still works.',
        platforms: ['desktop', 'mobile'],
      },
      {
        title: 'Report encrypted messages',
        body: 'You can now report a message in an encrypted conversation. You are told first that it, and up to five messages on each side, go to staff in plain text. Every message is checked against what was actually sent, so nobody can fake a report.',
      },
    ],
  },
  {
    id: '2026-10-28d',
    title: 'Subspace on your phone',
    added: [
      {
        title: 'Get the Apps',
        body: 'User Settings › Get the Apps has Subspace for Windows, Android and iPhone.',
        platforms: ['web', 'desktop'],
      },
      {
        title: 'Push notifications without the middlemen',
        body: 'On Android, notifications come through a UnifiedPush app such as ntfy, encrypted so only your phone can read them. On iPhone they come from Apple and say only that something arrived. User Settings › Notifications shows whether this phone gets them, and what to do if not.',
        platforms: ['mobile'],
      },
    ],
  },
  {
    id: '2026-10-28c',
    title: 'The Inbox, reminders and scheduled transmissions',
    added: [
      {
        title: 'A new Inbox',
        body: 'Unreads, Mentions, Bookmarks and Reminders in one place. Right-click a transmission to Bookmark it, or choose Remind Me and it comes back to you when it is time.',
      },
      {
        title: 'Mark Unread',
        body: 'Right-click a transmission and choose Mark Unread: it and everything after it are unread again.',
      },
      {
        title: 'Schedule a transmission',
        body: 'The clock button next to the emoji picker sends what you typed later, from this device. Turn on "Send when available" and it still goes out if you were offline at that time.',
        platforms: ['web', 'desktop'],
      },
      {
        title: 'Notes',
        body: 'Keep a private note about anyone, yourself included, from the button next to their name. It shows at the bottom of their profile beside your Direct Link too (you can turn that off in Chat settings).',
      },
      {
        title: 'Answer a status',
        body: 'Hover someone’s status to react with an emoji or reply: it is quoted in your Direct Link with them.',
      },
      {
        title: 'Activities from developers',
        body: 'Developers can now build Activities you play together in a comm-link. They run on the developer’s own site, and you are told so before one opens.',
        platforms: ['web', 'desktop'],
      },
    ],
    fixed: [
      {
        title: 'Long statuses',
        body: 'A long status now stops at two lines (hover to see it all) instead of running off the bubble.',
      },
    ],
  },
  {
    id: '2026-10-28b',
    title: 'Announcement relays, verified bots and developer teams',
    added: [
      {
        title: 'Announcement relays',
        body: 'Make a relay an announcement relay and other beacons can Follow it into their own. Right-click a transmission and choose Publish to send it to every relay that follows.',
        platforms: ['web', 'desktop'],
      },
      {
        title: 'Announcement relays',
        body: 'Beacons can now follow each other’s announcement relays: what they publish shows up in yours with a BEACON tag.',
        platforms: ['mobile'],
      },
      {
        title: 'Verified bots',
        body: 'Bots instance staff have verified show a check on their APP tag, so a copycat with the same name and picture can’t pass for them. Webhooks now say HOOK.',
      },
      {
        title: 'Bot profiles',
        body: 'A bot’s profile card lists its slash commands, and shows Add App when its developer lets anyone add it.',
      },
      {
        title: 'Developer teams',
        body: 'Build applications together: invite people to a team in Developer Applications as an admin, developer or read-only member.',
      },
      {
        title: 'Bot SDKs',
        body: 'Build bots in JavaScript, Deno, Python, Java, C# and C++, installed from subspace.click/packages, where the Rich Presence SDKs are too.',
      },
    ],
  },
  {
    id: '2026-10-28',
    title: 'Activity status, Rich Presence and the desktop app',
    added: [
      {
        title: 'Activity status',
        body: 'Show what you are playing next to your name, in member lists and on your profile. It is off until you turn it on in User Settings › Activity Privacy, where you pick everyone or affiliates only, and hide any game. What you play is never stored.',
      },
      {
        title: 'The desktop app for Windows',
        body: 'Download it from User Settings › Activity Privacy. It finds the games you play, keeps Subspace in the tray, and updates itself.',
        platforms: ['web', 'mobile'],
      },
      {
        title: 'Game detection and Rich Presence',
        body: 'The desktop app recognises about 150 games, and games with Rich Presence can show what you are doing in them: the map, your party, how long the match has run.',
        platforms: ['desktop'],
      },
      {
        title: 'Automatic updates',
        body: 'The desktop app now keeps itself up to date. An update found while you are using it waits for Restart to Update in the tray menu, so it never cuts off a call.',
        platforms: ['desktop'],
      },
      {
        title: 'For developers',
        body: 'Rich Presence SDKs for JavaScript, C++, C#, Unity and Unreal Engine, and your own art on your game once staff verify your application.',
      },
    ],
    improved: [
      {
        title: 'Bots and your activity',
        body: 'A bot only sees what members are playing if its developer turns on the new Activity Status intent, and still only as each person’s Activity Privacy allows.',
      },
      {
        title: 'Developer policy',
        body: 'Instance staff can now decide who may create applications and use privileged bot intents, for example only accounts with a verified email or phone.',
      },
    ],
    fixed: [
      {
        title: 'Creating a bot',
        body: 'Adding a bot to an application sometimes failed when someone else had just made one with the same name.',
      },
    ],
  },
];

/** Which app this is: the desktop app, the mobile app, or a browser. */
export function currentPlatform(): Platform {
  const w = window as unknown as { subspaceDesktop?: boolean; subspaceNative?: unknown };
  if (w.subspaceDesktop) return 'desktop';
  if (w.subspaceNative) return 'mobile';
  return 'web';
}

const applies = (platforms: Platform[] | undefined, platform: Platform) => !platforms || platforms.includes(platform);

/** The entry as this platform sees it (only its items), or null if none of it applies. */
export function entryFor(entry: ChangelogEntry, platform: Platform): ChangelogEntry | null {
  if (!applies(entry.platforms, platform)) return null;
  const keep = (items?: ChangelogItem[]) => items?.filter((i) => applies(i.platforms, platform));
  const view = { ...entry, added: keep(entry.added), improved: keep(entry.improved), fixed: keep(entry.fixed) };
  return view.added?.length || view.improved?.length || view.fixed?.length ? view : null;
}

export const changelogFor = (platform: Platform, changelog = CHANGELOG) =>
  changelog.map((e) => entryFor(e, platform)).filter((e): e is ChangelogEntry => !!e);

/** At most this many entries pop up at once; the rest are in User Settings › What's New. */
const MAX_POPUP = 3;

/**
 * What to show when they open the app on this platform: entries newer than the last one they saw
 * here. With nothing seen here yet, only the newest entry, and only if it came out after their
 * account was made (someone new gets no history lesson).
 */
export function unseenEntries(platform: Platform, seen: string | undefined, accountCreatedAt: string | undefined, changelog = CHANGELOG) {
  const entries = changelogFor(platform, changelog);
  if (seen) return entries.filter((e) => e.id > seen).slice(0, MAX_POPUP);
  const joined = accountCreatedAt?.slice(0, 10) ?? '';
  return entries.slice(0, 1).filter((e) => e.id.slice(0, 10) > joined);
}

/** "October 28, 2026" for an entry. */
export const entryDate = (id: string) =>
  new Date(`${id.slice(0, 10)}T12:00:00`).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
