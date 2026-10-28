import { PERMISSIONS } from '@subspace/constants';

export interface PermissionMeta {
  key: keyof typeof PERMISSIONS;
  bit: bigint;
  label: string;
  description: string;
  /** Can be overridden per relay. */
  relay: boolean;
}

const p = (key: keyof typeof PERMISSIONS, label: string, description: string, relay = true): PermissionMeta => ({
  key,
  bit: PERMISSIONS[key],
  label,
  description,
  relay,
});

export const PERMISSION_GROUPS: Array<{ title: string; items: PermissionMeta[] }> = [
  {
    title: 'General Beacon Permissions',
    items: [
      p('VIEW_RELAY', 'View Relays', 'Allows members to view relays by default (excluding private relays).'),
      p('CREATE_RELAYS', 'Create Relays', 'Create relays and frequency bands.', false),
      p('MANAGE_RELAYS', 'Manage Relays', 'Create, edit, and delete relays and frequency bands.'),
      p('MANAGE_CLEARANCES', 'Manage Clearances', 'Create and edit clearances lower than their highest clearance, and assign them. In a relay: edit its permissions.'),
      p('CREATE_EXPRESSIONS', 'Create Expressions', 'Add signal glyphs, stickers and soundboard sounds, and edit or remove the ones they added.', false),
      p('MANAGE_GLYPHS', 'Manage Expressions', "Edit or remove anyone's signal glyphs, stickers and soundboard sounds.", false),
      p('VIEW_AUDIT_LOG', 'View Audit Log', 'Read the record of who changed what in this beacon.', false),
      p('VIEW_INSIGHTS', 'View Insights', 'See the Engagement page: how the beacon is growing and who is active.', false),
      p('MANAGE_WEBHOOKS', 'Manage Webhooks', 'Create, edit, and delete webhooks that post into relays.'),
      p('MANAGE_BEACON', 'Manage Beacon', "Change the beacon's name, icon, and settings.", false),
    ],
  },
  {
    title: 'Membership Permissions',
    items: [
      p('CREATE_INVITES', 'Create Invite', 'Invite new transmitters to this beacon.'),
      p('MANAGE_INVITES', 'Manage Invites', "See and revoke everyone's invites.", false),
      p('CHANGE_NICKNAME', 'Change Nickname', 'Change their own nickname in this beacon.', false),
      p('MANAGE_NICKNAMES', 'Manage Nicknames', 'Change the nicknames of other members.', false),
      p('KICK_MEMBERS', 'Kick Members', 'Remove members below their highest clearance. They can rejoin with an invite.', false),
      p('BAN_MEMBERS', 'Ban Members', 'Permanently remove members below their highest clearance.', false),
      p('MODERATE_MEMBERS', 'Timeout Members', 'Stop members below their highest clearance from sending, reacting or speaking for a while.', false),
    ],
  },
  {
    title: 'Text Relay Permissions',
    items: [
      p('SEND_TRANSMISSIONS', 'Send Transmissions', 'Send transmissions in text relays and archival posts.'),
      p('SEND_IN_THREADS', 'Send Transmissions in Threads', 'Post in threads.'),
      p('CREATE_THREADS', 'Create Public Threads', 'Start threads everyone who can see the relay can join.'),
      p('CREATE_PRIVATE_THREADS', 'Create Private Threads', 'Start invite-only threads.'),
      p('EMBED_LINKS', 'Embed Links', 'Links shared by members show embedded previews.'),
      p('ATTACH_FILES', 'Attach Files', 'Upload files and media.'),
      p('ADD_REACTIONS', 'Add Reactions', 'Add new reactions to transmissions. Existing reactions can always be used.'),
      p('USE_SIGNAL_GLYPHS', 'Use Signal Glyphs', 'Use custom emoji from this beacon.'),
      p('USE_EXTERNAL_GLYPHS', 'Use External Glyphs', 'Use custom emoji from their other beacons.'),
      p('USE_EXTERNAL_STICKERS', 'Use External Stickers', 'Use stickers from their other beacons.'),
      p('MENTION_EVERYONE', 'Mention @everyone and @here', 'Notify everyone who can see the relay, or everyone online in it.'),
      p('MENTION_CLEARANCES', 'Mention All Clearances', 'Mention clearances even when they are not set as mentionable by everyone.'),
      p('MANAGE_TRANSMISSIONS', 'Manage Transmissions', "Delete other members' transmissions."),
      p('MANAGE_THREADS', 'Manage Threads', "Rename, lock, archive or delete anyone's threads, and see every private thread."),
      p('PIN_TRANSMISSIONS', 'Pin Transmissions', 'Pin and unpin any transmission.'),
      p('READ_HISTORY', 'Read Transmission History', 'Read transmissions sent before they could see the relay.'),
      p('SEND_VOICE_MESSAGES', 'Send Voice Messages', 'Record and send voice messages.'),
      p('CREATE_POLLS', 'Create Polls', 'Post polls.'),
      p('BYPASS_SLOWMODE', 'Bypass Slowmode', "Send without waiting for the relay's slowmode."),
      p('USE_APPLICATION_COMMANDS', 'Use Application Commands', "Use bots' slash commands."),
    ],
  },
  {
    title: 'Comm-Link Permissions',
    items: [
      p('CONNECT_AUDIO', 'Connect', 'Join Comm-Links and hear others.'),
      p('SPEAK_AUDIO', 'Speak', 'Talk in Comm-Links.'),
      p('BROADCAST_HOLO_CAST', 'Video', 'Turn on their camera in Comm-Links.'),
      p('SHARE_SCREEN', 'Holo-Cast', 'Share a screen or window in Comm-Links.'),
      p('USE_VOICE_ACTIVITY', 'Use Voice Activity', 'Talk just by speaking. Without it, they must use push-to-talk.'),
      p('PRIORITY_SPEAKER', 'Priority Speaker', 'Others are quieter while they hold the Priority Speaker key.'),
      p('USE_SOUNDBOARD', 'Use Soundboard', "Play sounds from this beacon's soundboard in Comm-Links."),
      p('USE_ACTIVITIES', 'Use Activities', 'Start and join activities, like Watch Together and Whiteboard, in Comm-Links.'),
      p('MUTE_MEMBERS', 'Mute Members', 'Server-mute other members in Comm-Links.'),
      p('DEAFEN_MEMBERS', 'Deafen Members', 'Server-deafen other members in Comm-Links.'),
      p('MOVE_MEMBERS', 'Move Members', 'Disconnect or move members between Comm-Links.'),
    ],
  },
  {
    title: 'Stage Permissions',
    items: [p('REQUEST_TO_SPEAK', 'Request to Speak', 'Raise a hand to ask to speak on a Stage.')],
  },
  {
    title: 'Events Permissions',
    items: [
      p('CREATE_EVENTS', 'Create Events', 'Schedule events, and edit or cancel the ones they created.', false),
      p('MANAGE_EVENTS', 'Manage Events', "Edit, start, end, and cancel anyone's events.", false),
    ],
  },
  {
    title: 'Advanced Permissions',
    items: [
      p('ADMINISTRATOR', 'Administrator', 'Every permission, bypassing relay overrides. This is a dangerous permission to grant.', false),
    ],
  },
];
