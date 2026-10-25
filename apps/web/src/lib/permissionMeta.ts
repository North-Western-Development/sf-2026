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
      p('MANAGE_RELAYS', 'Manage Relays', 'Create, edit, and delete relays and frequency bands.'),
      p('MANAGE_CLEARANCES', 'Manage Clearances', 'Create and edit clearances lower than their highest clearance, and assign them.'),
      p('MANAGE_GLYPHS', 'Manage Signal Glyphs', 'Add, rename, and remove custom emoji.', false),
      p('MANAGE_BEACON', 'Manage Beacon', "Change the beacon's name, icon, and settings, and view all invites.", false),
    ],
  },
  {
    title: 'Membership Permissions',
    items: [
      p('CREATE_INVITES', 'Create Invite', 'Invite new transmitters to this beacon.'),
      p('CHANGE_NICKNAME', 'Change Nickname', 'Change their own nickname in this beacon.', false),
      p('MANAGE_NICKNAMES', 'Manage Nicknames', 'Change the nicknames of other members.', false),
      p('KICK_MEMBERS', 'Kick Members', 'Remove members below their highest clearance. They can rejoin with an invite.', false),
      p('BAN_MEMBERS', 'Ban Members', 'Permanently remove members below their highest clearance.', false),
    ],
  },
  {
    title: 'Text Relay Permissions',
    items: [
      p('SEND_TRANSMISSIONS', 'Send Transmissions', 'Send transmissions in text relays and archival threads.'),
      p('EMBED_LINKS', 'Embed Links', 'Links shared by members show embedded previews.'),
      p('ATTACH_FILES', 'Attach Files', 'Upload files and media.'),
      p('ADD_REACTIONS', 'Add Reactions', 'Add new reactions to transmissions. Existing reactions can always be used.'),
      p('USE_SIGNAL_GLYPHS', 'Use Signal Glyphs', 'Use custom emoji from this beacon.'),
      p('MENTION_EVERYONE', 'Mention @everyone, @here, and All Clearances', 'Notify everyone who can see the relay.'),
      p('MANAGE_TRANSMISSIONS', 'Manage Transmissions', "Delete other members' transmissions."),
      p('PIN_TRANSMISSIONS', 'Pin Transmissions', 'Pin and unpin any transmission.'),
      p('READ_HISTORY', 'Read Transmission History', 'Read transmissions sent before they could see the relay.'),
    ],
  },
  {
    title: 'Comm-Link Permissions',
    items: [
      p('CONNECT_AUDIO', 'Connect', 'Join Comm-Links and hear others.'),
      p('SPEAK_AUDIO', 'Speak', 'Talk in Comm-Links.'),
      p('BROADCAST_HOLO_CAST', 'Video & Holo-Cast', 'Share camera and screen in Comm-Links.'),
      p('MUTE_MEMBERS', 'Mute Members', 'Server-mute other members in Comm-Links.'),
      p('MOVE_MEMBERS', 'Move Members', 'Disconnect or move members between Comm-Links.'),
    ],
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
